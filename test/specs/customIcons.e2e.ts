import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import { getSettings, openNote, setSettings } from '../helpers';

/** Ids registered by the plugin from the vault's icon folder. */
function customIconIds(): Promise<string[]> {
  return browser.executeObsidian(({ app }) => {
    return (app as any).plugins.plugins['list-callouts-improved'].customIconIds;
  }) as Promise<string[]>;
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
});
