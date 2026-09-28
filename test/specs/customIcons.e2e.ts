import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import {
  clickAddCallout,
  closeSettings,
  dismissModal,
  getSettings,
  openIconMenuInModal,
  openNote,
  openPluginSettings,
  searchIconMenuFor,
  setRendering,
  setSettings,
} from '../helpers';

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
 * Register every icon in the folder, as opening the icon picker does. At
 * startup only the ones a callout uses are read.
 */
async function loadAllCustomIcons(): Promise<void> {
  await customIconsReady();
  await browser.executeObsidian(async ({ app }) => {
    await (app as any).plugins.plugins['list-callouts-improved'].loadAllIcons();
  });
}

/**
 * Record the path of every file read from the icon folder from here on, until
 * the next reloadObsidian, so a test can tell which icons were read.
 */
function recordIconReads(): Promise<void> {
  return browser.executeObsidian(({ app }) => {
    const adapter = app.vault.adapter as any;
    const read = adapter.read.bind(adapter);
    const reads: string[] = ((window as any).__lcIconReads = []);
    adapter.read = (path: string) => {
      if (path.includes('/icons/')) reads.push(path);
      return read(path);
    };
  });
}

function iconReads(): Promise<string[]> {
  return browser.executeObsidian(() => (window as any).__lcIconReads);
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

  it('reads no icon at startup when no callout uses one', async function () {
    // Some vaults keep thousands of icons here for Iconize, and reading each
    // one ran startup to forty seconds (#50).
    expect(await customIconIds()).toEqual([]);
  });

  it('reads only the icons the callouts use at startup', async function () {
    const settings = await getSettings();
    settings[0].icon = 'my-fancy-mark';
    await setSettings(settings);

    await recordIconReads();
    await reenablePlugin();
    await customIconsReady();

    expect(await iconReads()).toEqual(['.obsidian/icons/My Fancy Mark.svg']);
    expect(await customIconIds()).toEqual(['my-fancy-mark']);
  });

  it('registers the rest of the folder when the icon picker opens', async function () {
    expect(await customIconIds()).not.toContain('scripted');

    await openPluginSettings();
    await clickAddCallout();
    await openIconMenuInModal();

    await browser.waitUntil(
      async () => (await customIconIds()).includes('scripted'),
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'opening the picker never registered the unused icon',
      }
    );
    // The list is built a page at a time and custom icons come last, so
    // search for it rather than expecting it on the first page.
    await searchIconMenuFor('scripted', 'scripted');

    await dismissModal();
    await closeSettings();
  });

  it('registers an SVG dropped in the icon folder', async function () {
    await loadAllCustomIcons();
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
