import { browser, expect } from '@wdio/globals';
import { afterEach, before, beforeEach, describe, it } from 'mocha';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  clickAddCallout,
  clickModalButton,
  closeSettings,
  dismissModal,
  ensureEditingMode,
  ensureReadingMode,
  getSettings,
  markerColorControls,
  markerPaint,
  modalMarkerColorControls,
  openNote,
  openPluginSettings,
  pickMarkerColor,
  pickModalMarkerColor,
  placeCursor,
  setMarkerColorMode,
  setModalMarkerColorMode,
  setSettings,
  typeInModal,
  waitForModal,
} from '../helpers';

const BUILT_IN_COUNT = 7;

/**
 * The built-ins with `&` and `!` given their own marker colors. `!` also gets
 * an icon, since a highlight only renders a marker element when it has one.
 */
function withMarkerColors() {
  return DEFAULT_SETTINGS.map((c) => {
    if (c.char === '&') return { ...c, markerColor: '1, 2, 3' };
    if (c.char === '!')
      return { ...c, markerColor: '4, 5, 6', icon: 'lucide-star' };
    return { ...c };
  });
}

/** Wait until `selector` yields paint for `char`, then return all of it. */
async function paintUntil(selector: string, char: string) {
  let paint: Awaited<ReturnType<typeof markerPaint>> = {};
  await browser.waitUntil(
    async () => {
      paint = await markerPaint(selector);
      return !!paint[char];
    },
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: `no decorated "${char}" under ${selector}`,
    }
  );
  return paint;
}

describe('Marker color rendering', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
    await setSettings(withMarkerColors());
    await openNote('Callouts.md');
  });

  describe('in live preview', function () {
    before(async function () {
      await ensureEditingMode();
      // Keep the caret off every highlight so its marker widget is drawn.
      await placeCursor(0, 0);
    });

    it('paints an overridden marker in its own color', async function () {
      const paint = await paintUntil('.cm-line.lc-list-callout', '&');

      expect(paint['&'].property).toBe('1, 2, 3');
      expect(paint['&'].painted).toBe('rgb(1, 2, 3)');
    });

    it('paints a default marker in the callout color', async function () {
      const paint = await paintUntil('.cm-line.lc-list-callout', '?');

      expect(paint['?'].property).toBe('');
      expect(paint['?'].painted).toBe('rgb(255, 145, 0)');
    });

    it('colors a highlight marker the same way', async function () {
      const paint = await paintUntil(
        '.markdown-source-view .lc-highlight-callout',
        '!'
      );

      expect(paint['!'].property).toBe('4, 5, 6');
      expect(paint['!'].painted).toBe('rgb(4, 5, 6)');
    });
  });

  describe('in reading mode', function () {
    before(async function () {
      await ensureReadingMode();
    });

    it('paints an overridden marker in its own color', async function () {
      const paint = await paintUntil(
        '.markdown-reading-view li.lc-list-callout',
        '&'
      );

      expect(paint['&'].property).toBe('1, 2, 3');
      expect(paint['&'].painted).toBe('rgb(1, 2, 3)');
    });

    it('paints a default marker in the callout color', async function () {
      const paint = await paintUntil(
        '.markdown-reading-view li.lc-list-callout',
        '?'
      );

      expect(paint['?'].property).toBe('');
      expect(paint['?'].painted).toBe('rgb(255, 145, 0)');
    });

    it('colors a highlight marker the same way', async function () {
      const paint = await paintUntil('.markdown-reading-view mark', '!');

      expect(paint['!'].property).toBe('4, 5, 6');
      expect(paint['!'].painted).toBe('rgb(4, 5, 6)');
    });
  });
});

describe('Marker color in the settings tab', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await openPluginSettings();
  });

  afterEach(async function () {
    await closeSettings();
  });

  it('starts every callout on the default marker color', async function () {
    for (let i = 0; i < BUILT_IN_COUNT; i++) {
      expect(await markerColorControls(i)).toEqual({
        mode: 'default',
        picker: null,
      });
    }
  });

  it('shows the picker, preset to the callout color, on custom', async function () {
    await setMarkerColorMode(0, 'custom');

    // 255, 214, 0 is the first built-in's color.
    expect(await markerColorControls(0)).toEqual({
      mode: 'custom',
      picker: '#ffd600',
    });
    expect((await getSettings())[0].markerColor).toBe('255, 214, 0');
  });

  it('stores a picked marker color', async function () {
    await setMarkerColorMode(0, 'custom');
    await pickMarkerColor(0, '#010203');

    expect((await getSettings())[0].markerColor).toBe('1, 2, 3');
  });

  it('forgets the marker color on default', async function () {
    await setMarkerColorMode(0, 'custom');
    await pickMarkerColor(0, '#010203');
    await setMarkerColorMode(0, 'default');

    expect(await markerColorControls(0)).toEqual({
      mode: 'default',
      picker: null,
    });
    expect('markerColor' in (await getSettings())[0]).toBe(false);
  });

  it('reopens a stored marker color as custom', async function () {
    const settings = await getSettings();
    settings[1].markerColor = '4, 5, 6';
    await setSettings(settings);

    expect(await markerColorControls(1)).toEqual({
      mode: 'custom',
      picker: '#040506',
    });
  });
});

describe('Marker color in the add-callout dialog', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  beforeEach(async function () {
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await openPluginSettings();
    await clickAddCallout();
    await waitForModal('Add callout');
  });

  afterEach(async function () {
    await dismissModal();
    await closeSettings();
  });

  it('starts on the default marker color', async function () {
    expect(await modalMarkerColorControls()).toEqual({
      mode: 'default',
      picker: null,
    });
  });

  it('adds a callout without a marker color by default', async function () {
    await typeInModal('(');
    await clickModalButton('Add');

    const added = (await getSettings())[BUILT_IN_COUNT];
    expect(added.char).toBe('(');
    expect('markerColor' in added).toBe(false);
  });

  it('adds a callout with the chosen marker color', async function () {
    await typeInModal('(');
    await setModalMarkerColorMode('custom');
    await pickModalMarkerColor('#010203');
    await clickModalButton('Add');

    expect((await getSettings())[BUILT_IN_COUNT]).toMatchObject({
      char: '(',
      markerColor: '1, 2, 3',
    });
  });
});
