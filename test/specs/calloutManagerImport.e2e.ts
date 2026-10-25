import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  CALLOUT_MANAGER_ID,
  PLUGIN_ID,
  calloutManagerIds,
  clickImportButton,
  clickModalButton,
  closeSettings,
  editorCalloutChars,
  getSettings,
  importRowVisible,
  modalText,
  noticeTexts,
  openPluginSettings,
  setCalloutManagerEnabled,
  waitForModal,
} from '../helpers';

const ROW = 'Import from Callout Manager';

/**
 * #66: Callout Manager's callouts imported as tag callouts, so `- #definition`
 * looks the way `> [!definition]` does. The vault has one custom callout
 * (`definition`, recolored and given an icon in Callout Manager), one only a
 * CSS snippet defines (`recipe`), a custom id that can't be a tag (`2024`),
 * and a recolored built-in (`note`), which the import leaves out.
 */
describe('Importing from Callout Manager', function () {
  before(async function () {
    await browser.reloadObsidian({
      vault: 'test/vaults/callout-manager',
      plugins: [PLUGIN_ID, CALLOUT_MANAGER_ID],
    });

    await browser.waitUntil(
      async () => (await calloutManagerIds()).includes('recipe'),
      { timeoutMsg: "Callout Manager never found the snippet's callout" }
    );
  });

  it('offers the import only while Callout Manager is on', async function () {
    await openPluginSettings();
    expect(await importRowVisible(ROW)).toBe(true);
    await closeSettings();

    await setCalloutManagerEnabled(false);
    try {
      await openPluginSettings();
      expect(await importRowVisible(ROW)).toBe(false);
      await closeSettings();
    } finally {
      await setCalloutManagerEnabled(true);
    }
  });

  it("adds a tag callout for each callout that isn't built in", async function () {
    // Turned back on by the test above, it scans the snippet again.
    await browser.waitUntil(async () =>
      (await calloutManagerIds()).includes('recipe')
    );

    await openPluginSettings();
    await clickImportButton(ROW);
    await waitForModal('Adds 2 tag callouts');

    // Listed in Callout Manager's order, so checked one at a time.
    const text = await modalText();
    expect(text).toContain('#definition');
    expect(text).toContain('#recipe');
    expect(text).toContain("Skipped, since they can't be tags: 2024.");
    expect(text).toContain('Tag callouts is off');

    await clickModalButton('Import');
    await browser.waitUntil(
      async () => (await getSettings()).length === DEFAULT_SETTINGS.length + 2,
      { timeoutMsg: 'the import added nothing' }
    );
    await closeSettings();

    const settings = await getSettings();
    expect(settings.slice(0, DEFAULT_SETTINGS.length)).toEqual(
      DEFAULT_SETTINGS
    );
    const added = settings
      .slice(DEFAULT_SETTINGS.length)
      .sort((x, y) => x.char.localeCompare(y.char));
    expect(added).toEqual([
      {
        char: '#definition',
        color: '12, 34, 56',
        icon: 'lucide-book-open',
        custom: true,
      },
      {
        char: '#recipe',
        color: '200, 100, 50',
        icon: 'lucide-chef-hat',
        custom: true,
      },
    ]);

    expect(await editorCalloutChars()).toEqual(
      expect.arrayContaining(['#definition', '#recipe'])
    );
  });

  it('leaves the callouts it already added alone', async function () {
    const before = await getSettings();

    // On a phone the last test's dialog is still sliding away.
    await browser.waitUntil(async () => (await modalText()) === '', {
      timeoutMsg: "the last test's dialog never closed",
    });

    await openPluginSettings();
    await clickImportButton(ROW);
    await browser.waitUntil(
      async () =>
        (await noticeTexts()).some((t) => t.startsWith('Nothing to import')),
      { timeoutMsg: 'no notice that there was nothing to import' }
    );
    expect(await modalText()).toBe('');
    await closeSettings();

    expect(await getSettings()).toEqual(before);
  });
});
