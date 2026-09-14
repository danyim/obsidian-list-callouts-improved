import { browser, expect } from '@wdio/globals';
import { afterEach, before, beforeEach, describe, it } from 'mocha';

import {
  DEFAULT_HIGHLIGHT_SETTINGS,
  DEFAULT_SETTINGS,
} from '../../src/settings';
import {
  calloutPatternsAreNull,
  calloutPreviewCount,
  clearPluginData,
  clickAddCallout,
  clickIconInMenu,
  clickModalButton,
  clickSettingByName,
  clickToggleByName,
  closeSettings,
  dismissModal,
  editorCalloutChars,
  editorHighlightPattern,
  getHighlights,
  getSettings,
  highlightPatternsAreNull,
  iconIdCount,
  iconInMenu,
  iconMenuCount,
  iconMenuGeometry,
  iconTooltip,
  isMobile,
  modalSubmitDisabled,
  modalText,
  openIconMenuInModal,
  openIconMenuInTab,
  openPluginSettings,
  reloadPlugin,
  reorderCallout,
  runReset,
  scrollIconMenuToEnd,
  searchIconMenu,
  searchIconMenuFor,
  setHighlights,
  setSettings,
  settingsText,
  typeInModal,
  waitForModal,
  writePluginData,
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

    // The modal clips whatever overflows it, so in there the picker floats
    // over the page, above the button when the screen has no room under it.
    // Guards both the anchoring and that no part of it is cut off, by the
    // dialog's edge or the screen's.
    it('opens anchored to its button, on screen and unclipped', async function () {
      const geo = await iconMenuGeometry();

      expect(geo).not.toBeNull();
      expect(geo.width).toBeGreaterThan(0);
      expect(geo.height).toBeGreaterThan(0);
      expect(geo.insideViewport).toBe(true);
      expect(geo.horizontallyAnchored).toBe(true);
      // Tiled alongside the other workers' windows, a desktop test window
      // can be too small for the picker at all, or too short for it on
      // either side of the button -- and then staying whole matters more
      // than touching the button. The emulated phone's viewport is fixed,
      // so both always hold there.
      if (geo.roomToShow) expect(geo.fullyVisible).toBe(true);
      if (geo.roomToAnchor) expect(geo.verticallyAnchored).toBe(true);
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

    // Obsidian registers a couple of thousand icons, and building an SVG for
    // each of them on every open is what made the picker stall. Only the
    // first stretch of the list is built up front; the rest follows as it
    // is scrolled into view.
    it('builds the list lazily as it is scrolled', async function () {
      const total = await iconIdCount();
      const initial = await iconMenuCount();

      expect(initial).toBeGreaterThan(0);
      expect(initial).toBeLessThan(total);

      await scrollIconMenuToEnd();
      await browser.waitUntil(async () => (await iconMenuCount()) > initial, {
        timeout: 5000,
        interval: 200,
        timeoutMsg: 'scrolling the icon list did not add icons',
      });
    });

    // lucide-star sits deep in the alphabet, past what the picker builds on
    // open, so this only passes if search draws on the full id list rather
    // than on what happens to be in the DOM.
    it('finds an icon the list has not built yet', async function () {
      expect(await iconInMenu('lucide-star')).toBe(false);

      await searchIconMenuFor('star', 'lucide-star');
      await clickIconInMenu('lucide-star');
      expect(await modalText()).not.toContain('Set icon');
    });

    it('names an icon in a tooltip as soon as it is hovered', async function () {
      // Hover is a pointer thing; the emulated mobile UI has none.
      if (await isMobile()) this.skip();

      // Half of Obsidian's default tooltip delay, so this only passes if the
      // picker asks for an instant one, with room for a loaded machine.
      expect(await iconTooltip('lucide-activity', 500)).toBe('lucide-activity');
    });

    it('applies a chosen icon to the new callout', async function () {
      await searchIconMenuFor('star', 'lucide-star');
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

  it('keeps a recolored built-in across a plugin reload', async function () {
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

    expect(await editorCalloutChars()).toContain('(');

    await setSettings((await getSettings()).filter((c) => c.char !== '('));

    expect(await editorCalloutChars()).not.toContain('(');
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

  // The picker is positioned within its own row, which scrolls with the tab.
  // Correcting for the tab's scroll on top of that put the menu a whole
  // screen above its button, and focusing its search box then yanked the
  // tab back up to it.
  it('opens the icon picker under its button without scrolling the tab', async function () {
    await openPluginSettings();
    const geo = await openIconMenuInTab();

    expect(geo.scrollBefore).toBeGreaterThan(0);
    expect(geo.buttonInView).toBe(true);
    expect(geo.gapBelowButton).toBeGreaterThanOrEqual(0);
    expect(geo.gapBelowButton).toBeLessThan(10);
    // Hangs from the button's left edge, or its right edge when the row is
    // too narrow for that.
    expect(
      Math.min(Math.abs(geo.leftOffset), Math.abs(geo.rightOffset))
    ).toBeLessThan(1);
    await closeSettings();
  });
});

describe('Deleting built-in callouts', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
  });

  // The regression this feature turns on: the built-ins used to be rebuilt
  // from DEFAULT_SETTINGS on every load, so a deleted one came straight back.
  it('keeps a deleted built-in deleted across a plugin reload', async function () {
    await setSettings((await getSettings()).filter((c) => c.char !== '&'));

    await reloadPlugin();

    const settings = await getSettings();
    expect(settings).toHaveLength(BUILT_IN_COUNT - 1);
    expect(settings.map((c) => c.char)).not.toContain('&');
  });

  it('drops a deleted built-in from the editor config', async function () {
    await setSettings((await getSettings()).filter((c) => c.char !== '&'));

    expect(await editorCalloutChars()).not.toContain('&');
  });

  it('keeps an emptied callout list across a plugin reload', async function () {
    await setSettings([]);

    await reloadPlugin();

    expect(await getSettings()).toHaveLength(0);
  });

  // An empty alternation would compile to a pattern matching every list item,
  // so both renderers get a null pattern instead.
  it('matches nothing when every callout has been deleted', async function () {
    await setSettings([]);

    expect(await calloutPatternsAreNull()).toBe(true);
  });

  it('seeds the built-ins in a vault that has never saved settings', async function () {
    await clearPluginData();

    await reloadPlugin();

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('Resetting to defaults', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  it('restores the built-ins after they have been deleted', async function () {
    await setSettings([]);

    await runReset();

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('discards custom callouts and edits to the built-in ones', async function () {
    const edited = DEFAULT_SETTINGS.map((c) => ({ ...c }));
    edited[0].color = '7, 7, 7';
    edited[1].icon = 'lucide-star';
    await setSettings([
      ...edited,
      { char: '(', color: '9, 9, 9', custom: true },
    ]);

    await runReset();

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('survives a plugin reload', async function () {
    await setSettings([]);
    await runReset();

    await reloadPlugin();

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('offers the reset in the settings tab', async function () {
    await openPluginSettings();

    expect(await settingsText()).toContain('Reset to defaults');

    await closeSettings();
  });

  it('resets from the settings tab once the warning is confirmed', async function () {
    await setSettings([{ char: '(', color: '9, 9, 9', custom: true }]);
    await openPluginSettings();

    await clickSettingByName('Reset to defaults');
    await waitForModal('Reset to defaults');
    expect(await modalText()).toContain("can't be undone");

    await clickModalButton('Reset');

    await browser.waitUntil(
      async () => (await getSettings()).length === BUILT_IN_COUNT,
      {
        timeout: 5000,
        interval: 150,
        timeoutMsg: 'the reset did not take effect',
      }
    );
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);

    await closeSettings();
  });

  it('leaves the callouts alone when the warning is canceled', async function () {
    const only = [{ char: '(', color: '9, 9, 9', custom: true }];
    await setSettings(only);
    await openPluginSettings();

    await clickSettingByName('Reset to defaults');
    await waitForModal('Reset to defaults');
    await dismissModal();

    expect(await getSettings()).toEqual(only);

    await closeSettings();
  });
});

describe('Reordering callouts', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    // The handler re-reads the tab after moving, which only means anything
    // while the tab is open -- which is the only way a drag can happen.
    await openPluginSettings();
  });

  afterEach(async function () {
    await closeSettings();
  });

  it('moves a callout down the list', async function () {
    await reorderCallout(0, 2);

    const chars = (await getSettings()).map((c) => c.char);
    expect(chars.slice(0, 3)).toEqual(['?', '!', '&']);
  });

  it('moves a callout up the list', async function () {
    await reorderCallout(2, 0);

    const chars = (await getSettings()).map((c) => c.char);
    expect(chars.slice(0, 3)).toEqual(['!', '&', '?']);
  });

  // Built-ins and custom callouts share one list now, so a custom one can be
  // dragged in between two built-ins.
  it('interleaves a custom callout with the built-in ones', async function () {
    await setSettings([
      ...DEFAULT_SETTINGS.map((c) => ({ ...c })),
      { char: '(', color: '9, 9, 9', custom: true },
    ]);

    await reorderCallout(BUILT_IN_COUNT, 1);

    const chars = (await getSettings()).map((c) => c.char);
    expect(chars.slice(0, 3)).toEqual(['&', '(', '?']);
  });

  it('persists the new order across a plugin reload', async function () {
    await reorderCallout(0, 2);

    await reloadPlugin();

    const chars = (await getSettings()).map((c) => c.char);
    expect(chars.slice(0, 3)).toEqual(['?', '!', '&']);
  });
});

describe('Highlight settings', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHighlights({ ...DEFAULT_HIGHLIGHT_SETTINGS });
  });

  it('defaults to enabled with a required space', async function () {
    expect(await getHighlights()).toEqual({
      enabled: true,
      requireSpace: true,
    });
  });

  it('persists both toggles across a plugin reload', async function () {
    await setHighlights({ enabled: false, requireSpace: false });

    await reloadPlugin();

    expect(await getHighlights()).toEqual({
      enabled: false,
      requireSpace: false,
    });
  });

  // data.json used to hold the callout array on its own. A vault upgraded
  // from that version keeps its callouts and gets the highlight defaults.
  it('reads a data.json written before highlights existed', async function () {
    const legacy = [{ char: '(', color: '9, 9, 9', custom: true }];
    await writePluginData(JSON.stringify(legacy));

    await reloadPlugin();

    expect(await getSettings()).toEqual(legacy);
    expect(await getHighlights()).toEqual(DEFAULT_HIGHLIGHT_SETTINGS);
  });

  it('keeps the callouts when the old shape is saved in the new one', async function () {
    await writePluginData(JSON.stringify(DEFAULT_SETTINGS));
    await reloadPlugin();

    await setHighlights({ requireSpace: false });
    await reloadPlugin();

    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await getHighlights()).toEqual({
      enabled: true,
      requireSpace: false,
    });
  });

  it('builds no highlight pattern when disabled', async function () {
    await setHighlights({ enabled: false });

    expect(await highlightPatternsAreNull()).toBe(true);
  });

  it('builds no highlight pattern when every callout has been deleted', async function () {
    await setSettings([]);

    expect(await highlightPatternsAreNull()).toBe(true);
  });

  it('makes the space optional when the setting is off', async function () {
    expect(await editorHighlightPattern()).toContain(') (');

    await setHighlights({ requireSpace: false });

    expect(await editorHighlightPattern()).toContain(') ?(');
  });
});

describe('Highlight settings in the tab', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHighlights({ ...DEFAULT_HIGHLIGHT_SETTINGS });
    await openPluginSettings();
  });

  afterEach(async function () {
    await closeSettings();
  });

  it('documents the syntax next to the toggles', async function () {
    const text = await settingsText();

    expect(text).toContain('Highlight callouts');
    expect(text).toContain('Require a space after the character');
    expect(text).toContain('==& text==');
    expect(text).toContain('==&text==');
  });

  it('turns highlights off from the tab', async function () {
    await clickToggleByName('Highlight callouts');

    await browser.waitUntil(
      async () => (await getHighlights()).enabled === false,
      { timeout: 5000, interval: 150, timeoutMsg: 'the toggle did not save' }
    );
  });

  it('makes the space optional from the tab', async function () {
    await clickToggleByName('Require a space after the character');

    await browser.waitUntil(
      async () => (await getHighlights()).requireSpace === false,
      { timeout: 5000, interval: 150, timeoutMsg: 'the toggle did not save' }
    );
  });
});
