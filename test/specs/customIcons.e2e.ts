import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import { getSettings, openNote, setRendering, setSettings } from '../helpers';

/**
 * Wait for the plugin to finish reading the vault's icon folder. It does that
 * after Obsidian's layout is up rather than during its own load, so right
 * after a reload or an enable the icons may not be registered yet.
 */
async function customIconsReady(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    await (app as any).plugins.plugins['list-callouts-improved']
      .customIconsReady;
  });
}

/** Ids registered by the plugin from the vault's icon folder. */
async function customIconIds(): Promise<string[]> {
  await customIconsReady();
  return browser.executeObsidian(({ app }) => {
    return (app as any).plugins.plugins['list-callouts-improved'].customIconIds;
  }) as Promise<string[]>;
}

/**
 * Make every read of a file in the icon folder take `delay` ms, so the test
 * can tell whether something waited on the folder being read. Undone by the
 * next reloadObsidian.
 */
function slowIconReads(delay: number): Promise<void> {
  return browser.executeObsidian(({ app }, delay) => {
    const adapter = app.vault.adapter as any;
    const read = adapter.read.bind(adapter);
    adapter.read = (path: string) =>
      path.includes('/icons/')
        ? new Promise((resolve) => window.setTimeout(resolve, delay)).then(() =>
            read(path)
          )
        : read(path);
  }, delay);
}

/** Turn the plugin off and on, resolving with how long the enable took. */
async function reenablePlugin(): Promise<number> {
  return await browser.executeObsidian(async ({ app }) => {
    const plugins = (app as any).plugins;
    await plugins.disablePlugin('list-callouts-improved');
    const started = performance.now();
    await plugins.enablePlugin('list-callouts-improved');
    return performance.now() - started;
  });
}

function iconRegistered(id: string): Promise<boolean> {
  return browser.executeObsidian(({ obsidian }, wanted) => {
    return obsidian.getIconIds().includes(wanted);
  }, id);
}

describe('Custom icons from the vault', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/icons' });
  });

  it('registers an SVG dropped in the icon folder', async function () {
    // "My Fancy Mark.svg" becomes "my-fancy-mark".
    expect(await customIconIds()).toContain('my-fancy-mark');
    expect(await iconRegistered('my-fancy-mark')).toBe(true);
  });

  it('leaves an id that Obsidian already ships alone', async function () {
    // dice.svg would otherwise replace Obsidian's own "dice" icon.
    expect(await customIconIds()).not.toContain('dice');

    const stillObsidians = await browser.executeObsidian(({ obsidian }) => {
      const el = document.createElement('div');
      obsidian.setIcon(el, 'dice');
      // Ours is a bare rect; Obsidian's is not.
      return !/^<svg[^>]*><g[^>]*><rect/.test(el.innerHTML);
    });

    expect(stillObsidians).toBe(true);
  });

  it('skips a file that is not usable SVG', async function () {
    expect(await customIconIds()).not.toContain('broken');
    expect(await iconRegistered('broken')).toBe(false);
  });

  it('strips script and event handlers from a registered icon', async function () {
    expect(await customIconIds()).toContain('scripted');

    const rendered = await browser.executeObsidian(({ obsidian }) => {
      const el = document.createElement('div');
      obsidian.setIcon(el, 'scripted');
      return {
        html: el.innerHTML,
        pwned: (window as any).__pwned === true,
      };
    });

    expect(rendered.html).toContain('circle');
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('onclick');
    expect(rendered.pwned).toBe(false);
  });

  it("maps a 24-unit icon into Obsidian's icon box", async function () {
    const html = await browser.executeObsidian(({ obsidian }) => {
      const el = document.createElement('div');
      obsidian.setIcon(el, 'my-fancy-mark');
      return el.innerHTML;
    });

    // Obsidian draws registered icons in a 0 0 100 100 viewport, so a file
    // authored at 24 units has to be scaled into it.
    expect(html).toContain('viewBox="0 0 100 100"');
    expect(html).toMatch(/scale\(4\.1667, ?4\.1667\)/);

    // Handing Obsidian the file's own <svg> instead would nest one svg inside
    // another and draw the icon at the file's declared 24px, a quarter size.
    expect(html.match(/<svg/g)?.length).toBe(1);
  });

  it('renders a custom icon as a callout marker', async function () {
    const settings = await getSettings();
    settings[0].icon = 'my-fancy-mark';
    await setSettings(settings);

    await openNote('Note.md');
    await browser.$('.lc-list-marker svg').waitForExist({ timeout: 10000 });

    const drawn = await browser.executeObsidian(({ app }) => {
      const marker = app.workspace.containerEl.querySelector(
        '.lc-list-marker svg'
      );
      return {
        present: !!marker,
        className: marker?.getAttribute('class') ?? '',
      };
    });

    expect(drawn.present).toBe(true);
    expect(drawn.className).toContain('my-fancy-mark');
  });

  it('offers custom icons in the picker search', async function () {
    const results = await browser.executeObsidian(({ obsidian }) => {
      return obsidian.getIconIds().filter((id) => id === 'my-fancy-mark');
    });

    expect(results).toEqual(['my-fancy-mark']);
  });

  describe('when the icon folder is slow to read', function () {
    const READ_DELAY = 500;

    before(async function () {
      await browser.reloadObsidian({ vault: 'test/vaults/icons' });
      await customIconsReady();

      const settings = await getSettings();
      settings[0].icon = 'my-fancy-mark';
      await setSettings(settings);
      await openNote('Note.md');
    });

    it('does not hold up enabling the plugin', async function () {
      // Obsidian enables plugins one after another and shows a "taking too
      // long" prompt for one whose load runs past a few seconds, so a read per
      // icon file must not be part of the load (#50).
      await slowIconReads(READ_DELAY);

      const took = await reenablePlugin();

      // Enabling takes a few ms on its own, so anything under one delayed
      // read means the load waited on none of them.
      expect(took).toBeLessThan(READ_DELAY);
      expect(await customIconIds()).toContain('my-fancy-mark');
    });

    it('draws the icon on editor markers rendered before it was registered', async function () {
      await setRendering('live-preview');
      await slowIconReads(READ_DELAY);
      await reenablePlugin();

      // The marker is drawn as soon as the plugin is on, before the folder
      // has been read, so at this point it has no icon to show.
      await browser.$('.lc-list-marker').waitForExist();
      await customIconsReady();

      await browser.$('.lc-list-marker svg').waitForExist({ timeout: 10000 });
      const className = await browser.executeObsidian(({ app }) => {
        return (
          app.workspace.containerEl
            .querySelector('.lc-list-marker svg')
            ?.getAttribute('class') ?? ''
        );
      });

      expect(className).toContain('my-fancy-mark');
    });

    it('draws the icon in reading view rendered before it was registered', async function () {
      await setRendering('reading');
      await browser.$('.markdown-reading-view .lc-list-marker').waitForExist();
      await slowIconReads(READ_DELAY);
      await reenablePlugin();
      await customIconsReady();

      await browser
        .$('.markdown-reading-view .lc-list-marker svg')
        .waitForExist({ timeout: 10000 });
      const className = await browser.executeObsidian(({ app }) => {
        return (
          app.workspace.containerEl
            .querySelector('.markdown-reading-view .lc-list-marker svg')
            ?.getAttribute('class') ?? ''
        );
      });

      expect(className).toContain('my-fancy-mark');
    });
  });
});
