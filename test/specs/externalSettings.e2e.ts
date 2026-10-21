import { browser, expect } from '@wdio/globals';
import { after, afterEach, before, beforeEach, describe, it } from 'mocha';

import {
  Callout,
  DEFAULT_HIGHLIGHT_SETTINGS,
  DEFAULT_SETTINGS,
  PluginData,
} from '../../src/settings';
import {
  bodyHidesBullets,
  calloutPreviewCount,
  closeSettings,
  ensureEditingMode,
  ensureReadingMode,
  getSettings,
  openNote,
  openPluginSettings,
  setHideBullets,
  setSettings,
  writePluginData,
} from '../helpers';

const NOTE = ['- & Built-in callout', '- ^ Added callout'].join('\n');

const ADDED: Callout = { char: '^', color: '12, 120, 200', custom: true };

function pluginData(overrides: Partial<PluginData> = {}): string {
  return JSON.stringify({
    callouts: DEFAULT_SETTINGS,
    highlights: DEFAULT_HIGHLIGHT_SETTINGS,
    hideBullets: false,
    colorNestedItems: false,
    tagCallouts: false,
    ...overrides,
  });
}

/** The callout characters drawn under `root` in the workspace. */
function drawnCallouts(root: string): Promise<string[]> {
  return browser.executeObsidian(({ app }, selector) => {
    return Array.from(
      app.workspace.containerEl.querySelectorAll(
        `${selector} .lc-list-callout[data-callout]`
      )
    ).map((el) => el.getAttribute('data-callout'));
  }, root);
}

async function waitForCallout(root: string, char: string): Promise<void> {
  await browser.waitUntil(
    async () => (await drawnCallouts(root)).includes(char),
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: `${char} was never drawn under ${root}`,
    }
  );
}

/**
 * How many times Obsidian has finished handing the plugin an outside change
 * to data.json, counted by wrapping the plugin's handler.
 */
function externalChangeCount(): Promise<number> {
  return browser.executeObsidian(
    () => ((window as any).__lcExternalChanges ?? 0) as number
  );
}

/**
 * Settings changed on disk by something other than the plugin, such as Sync
 * or a script editing data.json, reach the open notes and the settings tab
 * without a restart.
 */
describe('Settings changed outside the plugin', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
    await browser.executeObsidian(async ({ app }, text) => {
      await app.vault.create('External.md', `${text}\n`);

      const p = (app as any).plugins.plugins['list-callouts-improved'];
      const handle = p.onExternalSettingsChange;
      p.onExternalSettingsChange = async function () {
        await handle.call(this);
        (window as any).__lcExternalChanges =
          ((window as any).__lcExternalChanges ?? 0) + 1;
      };
    }, NOTE);
    await openNote('External.md');
  });

  after(async function () {
    await browser.executeObsidian(({ app }) => {
      const p = (app as any).plugins.plugins['list-callouts-improved'];
      delete p.onExternalSettingsChange;
    });
  });

  beforeEach(async function () {
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHideBullets(false);
  });

  afterEach(async function () {
    await closeSettings();
  });

  it('draws a callout added to data.json in the editor', async function () {
    await ensureEditingMode();
    expect(await drawnCallouts('.markdown-source-view')).not.toContain('^');

    await writePluginData(
      pluginData({ callouts: [...DEFAULT_SETTINGS, ADDED] })
    );

    await waitForCallout('.markdown-source-view', '^');
    expect(await getSettings()).toEqual([...DEFAULT_SETTINGS, ADDED]);
  });

  it('draws a callout added to data.json in reading view', async function () {
    await ensureReadingMode();
    await waitForCallout('.markdown-reading-view', '&');
    expect(await drawnCallouts('.markdown-reading-view')).not.toContain('^');

    await writePluginData(
      pluginData({ callouts: [...DEFAULT_SETTINGS, ADDED] })
    );

    await waitForCallout('.markdown-reading-view', '^');
    await ensureEditingMode();
  });

  it('applies a preference changed in data.json', async function () {
    expect(await bodyHidesBullets()).toBe(false);

    await writePluginData(pluginData({ hideBullets: true }));

    await browser.waitUntil(bodyHidesBullets, {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'the bullets preference was never applied',
    });
  });

  it('shows the change in an open settings tab', async function () {
    await openPluginSettings();
    const before = await calloutPreviewCount();

    await writePluginData(
      pluginData({ callouts: [...DEFAULT_SETTINGS, ADDED] })
    );

    await browser.waitUntil(
      async () => (await calloutPreviewCount()) === before + 1,
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'the settings tab never showed the added callout',
      }
    );
  });

  // Reading such a file the way a fresh vault is read would put the
  // built-ins back in place of the callouts, and the next save would make
  // that permanent.
  it('keeps the settings when data.json does not parse', async function () {
    await writePluginData(
      pluginData({ callouts: [...DEFAULT_SETTINGS, ADDED] })
    );
    await waitForCallout('.markdown-source-view', '^');
    const seen = await externalChangeCount();

    await writePluginData('{"callouts": [');

    await browser.waitUntil(async () => (await externalChangeCount()) > seen, {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'Obsidian never reported the change',
    });
    expect(await getSettings()).toEqual([...DEFAULT_SETTINGS, ADDED]);
    expect(await drawnCallouts('.markdown-source-view')).toContain('^');
  });
});
