import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import {
  LEGACY_PLUGIN_ID,
  PLUGIN_ID,
  clickImportButton,
  clickModalButton,
  closeSettings,
  customizeLegacyPlugin,
  getSettings,
  importRowVisible,
  legacyDataAvailable,
  legacyDataFileExists,
  legacyPluginLoaded,
  legacyPluginSettings,
  openPluginSettings,
  waitForModal,
} from '../helpers';

/**
 * The real List Callouts plugin running next to this one, the way a user
 * trying the fork has it. import.e2e.ts plants a hand-written data.json; this
 * spec lets the upstream plugin write its own, so a change in what it saves
 * would show up here rather than in a user's vault.
 */
describe('Running alongside List Callouts', function () {
  before(async function () {
    // A fresh vault with both plugins on and neither ever configured.
    await browser.reloadObsidian({
      vault: 'test/vaults/callouts',
      plugins: [PLUGIN_ID, LEGACY_PLUGIN_ID],
    });
  });

  it('has the upstream plugin loaded', async function () {
    expect(await legacyPluginLoaded()).toBe(true);
  });

  it('has nothing to import until List Callouts has saved something', async function () {
    // The upstream plugin only writes data.json from its settings tab, so a
    // vault where it was installed but never customized has no file...
    expect(await legacyDataFileExists()).toBe(false);
    expect(await legacyDataAvailable()).toBe(false);

    await openPluginSettings();
    expect(await importRowVisible()).toBe(false);
    await closeSettings();

    // ...and nothing worth carrying over either: both plugins start from the
    // same seven built-ins.
    const legacy = await legacyPluginSettings();
    const ours = await getSettings();
    expect(legacy.map((c) => c.char)).toEqual(ours.map((c) => c.char));
    expect(legacy.map((c) => c.color)).toEqual(ours.map((c) => c.color));
  });

  it('imports what List Callouts wrote after it was customized', async function () {
    // Recolor one built-in, give another an icon, and add a custom callout,
    // the three kinds of change the upstream settings tab can make.
    const legacy = await legacyPluginSettings();
    legacy[0].color = '1, 2, 3';
    legacy[1].icon = 'lucide-flame';
    legacy.push({
      char: '^',
      color: '12, 34, 56',
      icon: 'lucide-star',
      custom: true,
    });
    await customizeLegacyPlugin(legacy);
    expect(await legacyDataFileExists()).toBe(true);

    // The upstream plugin's in-memory state is the reference for what the
    // import should reproduce.
    const expected = await legacyPluginSettings();
    expect(expected).toHaveLength(8);

    // No restart in between: a user who customizes the old plugin and then
    // opens this tab should find the button waiting.
    await openPluginSettings();
    await browser.waitUntil(async () => await importRowVisible(), {
      timeoutMsg: 'the import row did not appear without a restart',
    });
    expect(await legacyDataAvailable()).toBe(true);

    await clickImportButton();
    await waitForModal('This replaces your current callouts');
    await clickModalButton('Import');

    await browser.waitUntil(
      async () => (await getSettings()).length === expected.length,
      { timeoutMsg: 'import did not replace the callouts' }
    );
    await closeSettings();

    expect(await getSettings()).toEqual(expected);
  });
});
