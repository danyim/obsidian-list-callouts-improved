import { browser, expect } from '@wdio/globals';
import { before, beforeEach, describe, it } from 'mocha';

import {
  calloutPreviewCount,
  closeSettings,
  getSettings,
  hasDeclarativeSettings,
  legacyDataAvailable,
  openPluginSettings,
  runImport,
  settingsText,
  writeLegacyData,
} from '../helpers';

/** Matches test/vaults/legacy/.obsidian/plugins/obsidian-list-callouts/data.json */
const LEGACY_DATA = JSON.stringify(
  [
    { color: '1, 2, 3', char: '&' },
    { color: '255, 145, 0', char: '?' },
    { color: '255, 23, 68', char: '!' },
    { color: '124, 77, 255', char: '~' },
    { color: '0, 184, 212', char: '@' },
    { color: '0, 200, 83', char: '$' },
    { color: '158, 158, 158', char: '%' },
    { color: '12, 34, 56', char: '^', icon: 'lucide-star', custom: true },
  ],
  null,
  2
);

describe('Importing from List Callouts', function () {
  before(async function () {
    // A vault that still holds the forked-from plugin's settings.
    await browser.reloadObsidian({ vault: 'test/vaults/legacy' });
  });

  beforeEach(async function () {
    // Several tests overwrite the legacy file, so put it back each time.
    await writeLegacyData(LEGACY_DATA);
  });

  it('detects the old plugin data during load', async function () {
    expect(await legacyDataAvailable()).toBe(true);
  });

  it('offers the import in the settings tab', async function () {
    await openPluginSettings();

    expect(await settingsText()).toContain('Import from List Callouts');

    await closeSettings();
  });

  it('replaces the current callouts with the imported ones', async function () {
    const result = await runImport();
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(8);

    const settings = await getSettings();

    // Seven built-ins plus the one custom callout the old plugin had.
    expect(settings).toHaveLength(8);

    // A recoloured built-in keeps its position and its stored colour.
    expect(settings[0].char).toBe('&');
    expect(settings[0].color).toBe('1, 2, 3');

    // The custom callout survives intact, icon and all.
    expect(settings[7]).toEqual({
      char: '^',
      color: '12, 34, 56',
      icon: 'lucide-star',
      custom: true,
    });
  });

  it('applies imported callouts to the editor config', async function () {
    await runImport();

    const chars = await browser.executeObsidian(({ app }) => {
      const p = (app as any).plugins.plugins['callout-bullets'];
      return Object.keys(p.buildEditorConfig().callouts);
    });

    expect(chars).toContain('^');
  });

  describe('with unusable data', function () {
    it('reports malformed JSON without touching current settings', async function () {
      const before = await getSettings();

      await writeLegacyData('{ this is not json');

      const result = await runImport();
      expect(result.count).toBeUndefined();
      expect(result.error).toContain('not valid JSON');

      expect(await getSettings()).toEqual(before);
    });

    it('rejects data that is not a list of callouts', async function () {
      const before = await getSettings();

      await writeLegacyData('{"char": "&"}');

      const result = await runImport();
      expect(result.error).toContain('not a list of callouts');
      expect(await getSettings()).toEqual(before);
    });

    it('rejects a callout that is missing its character', async function () {
      const before = await getSettings();

      await writeLegacyData('[{"color": "1, 2, 3"}]');

      const result = await runImport();
      expect(result.error).toContain('missing a character');
      expect(await getSettings()).toEqual(before);
    });
  });
});

describe('A vault with no List Callouts data', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  it('reports nothing to import', async function () {
    expect(await legacyDataAvailable()).toBe(false);
  });

  it('hides the import row', async function () {
    await openPluginSettings();

    expect(await settingsText()).not.toContain('Import from List Callouts');

    await closeSettings();
  });

  it('renders the callout list on whichever settings path applies', async function () {
    await openPluginSettings();

    // Both paths draw one preview per configured callout.
    expect(await calloutPreviewCount()).toBeGreaterThanOrEqual(7);

    // The declarative path additionally groups them under headings; the
    // pre-1.13 fallback lays them out flat.
    if (await hasDeclarativeSettings()) {
      expect(await settingsText()).toContain('Built-in callouts');
    }

    await closeSettings();
  });
});
