import { browser, expect } from '@wdio/globals';
import { afterEach, before, beforeEach, describe, it } from 'mocha';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  calloutPreviewCount,
  clickAddCallout,
  clickIconInMenu,
  clickModalButton,
  closeSettings,
  dismissModal,
  getSettings,
  iconMenuCount,
  iconMenuGeometry,
  modalSubmitDisabled,
  modalText,
  openIconMenuInModal,
  openPluginSettings,
  reloadPlugin,
  searchIconMenu,
  setSettings,
  typeInModal,
  waitForModal,
} from '../helpers';

const BUILT_IN_COUNT = 7;

describe('Adding a callout', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    await openPluginSettings();
    await clickAddCallout();
    await waitForModal('Add callout');
  });

  afterEach(async function () {
    // Tolerates both cases: a test that submitted the form and one that
    // left it open.
    await dismissModal();
    await closeSettings();
  });

  it('opens a modal with the callout form', async function () {
    const text = await modalText();
    expect(text).toContain('Add callout');
    expect(text).toContain('Set icon');
  });

  it('refuses a character already used by another callout', async function () {
    await typeInModal('&');
    expect(await modalSubmitDisabled('Add')).toBe(true);
    expect(await modalText()).toContain('already used');
  });

  it('refuses an empty character', async function () {
    await typeInModal('');
    expect(await modalSubmitDisabled('Add')).toBe(true);
  });

  it('accepts an unused character', async function () {
    await typeInModal('(');
    expect(await modalSubmitDisabled('Add')).toBe(false);
  });

  describe('the icon picker inside the modal', function () {
    beforeEach(async function () {
      await openIconMenuInModal();
    });

    // The picker positions itself against the button's offset parent. Inside a
    // modal there is no .vertical-tab-content to measure from, so this guards
    // the styling that gives both elements the same positioning context.
    it('opens anchored to its button and on screen', async function () {
      const geo = await iconMenuGeometry();

      expect(geo).not.toBeNull();
      expect(geo.width).toBeGreaterThan(0);
      expect(geo.height).toBeGreaterThan(0);
      expect(geo.insideViewport).toBe(true);
      expect(geo.belowButton).toBe(true);
      expect(geo.horizontallyAnchored).toBe(true);
    });

    it('lists icons and narrows them by search', async function () {
      const all = await iconMenuCount();
      expect(all).toBeGreaterThan(100);

      await searchIconMenu('wheelchair');
      await browser.waitUntil(async () => (await iconMenuCount()) < all, {
        timeout: 5000,
        interval: 200,
        timeoutMsg: 'icon search did not narrow the list',
      });

      // "wheelchair" is an alias of lucide-accessibility, not part of its id,
      // so this only passes if the alias table is wired into the search.
      const narrowed = await iconMenuCount();
      expect(narrowed).toBeGreaterThan(0);
      expect(narrowed).toBeLessThan(all);
    });

    it('applies a chosen icon to the new callout', async function () {
      await clickIconInMenu('lucide-star');
      await typeInModal('(');
      await clickModalButton('Add');

      const settings = await getSettings();
      expect(settings).toHaveLength(BUILT_IN_COUNT + 1);
      expect(settings[BUILT_IN_COUNT]).toMatchObject({
        char: '(',
        icon: 'lucide-star',
        custom: true,
      });
    });
  });
});

describe('Editing callouts', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    // Reset the callouts rather than rebooting Obsidian for every test: a
    // reload costs enough that four of them push this spec past the timeout.
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
  });

  it('persists a new callout across a plugin reload', async function () {
    await setSettings([
      ...(await getSettings()),
      { char: '(', color: '9, 9, 9', custom: true },
    ]);

    await reloadPlugin();

    const settings = await getSettings();
    expect(settings).toHaveLength(BUILT_IN_COUNT + 1);
    expect(settings[BUILT_IN_COUNT]).toMatchObject({
      char: '(',
      color: '9, 9, 9',
      custom: true,
    });
  });

  it('keeps a recoloured built-in across a plugin reload', async function () {
    const settings = await getSettings();
    settings[0].color = '7, 7, 7';
    await setSettings(settings);

    await reloadPlugin();

    const reloaded = await getSettings();
    expect(reloaded).toHaveLength(BUILT_IN_COUNT);
    expect(reloaded[0].color).toBe('7, 7, 7');
  });

  it('drops a deleted custom callout from the editor config', async function () {
    await setSettings([
      ...(await getSettings()),
      { char: '(', color: '9, 9, 9', custom: true },
    ]);

    let chars = await browser.executeObsidian(({ app }) => {
      const p = (app as any).plugins.plugins['callout-bullets'];
      return Object.keys(p.buildEditorConfig().callouts);
    });
    expect(chars).toContain('(');

    await setSettings((await getSettings()).filter((c) => c.char !== '('));

    chars = await browser.executeObsidian(({ app }) => {
      const p = (app as any).plugins.plugins['callout-bullets'];
      return Object.keys(p.buildEditorConfig().callouts);
    });
    expect(chars).not.toContain('(');
  });

  it('shows every configured callout in the settings tab', async function () {
    await setSettings([
      ...(await getSettings()),
      { char: '(', color: '9, 9, 9', custom: true },
    ]);

    await openPluginSettings();
    expect(await calloutPreviewCount()).toBe(BUILT_IN_COUNT + 1);
    await closeSettings();
  });
});
