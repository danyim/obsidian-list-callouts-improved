import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  ListMarkerVisibility,
  bodyHidesBullets,
  calloutPreviewCount,
  captureRendering,
  clickToggleByName,
  closeSettings,
  ensureEditingMode,
  ensureReadingMode,
  getHideBullets,
  listMarkerVisibility,
  openNote,
  openPluginSettings,
  placeCursor,
  reloadPlugin,
  setHideBullets,
  writePluginData,
} from '../helpers';

const EDITOR = '.workspace .markdown-source-view';
const READING = '.workspace .markdown-preview-view';

/**
 * Each kind of list marker Obsidian draws, as a callout and as a plain item
 * next to it, so the plain one shows the preference reaches only callouts.
 */
const NOTE = [
  '- & Bullet callout',
  '- Plain bullet',
  '1. & Numbered callout',
  '2. Plain numbered',
  '- [ ] & Task callout',
  '- [ ] Plain task',
].join('\n');

const BULLET_CALLOUT = 'Bullet callout';
const NUMBERED_CALLOUT = 'Numbered callout';
const TASK_CALLOUT = 'Task callout';

/** The row for the item whose text ends with `suffix`. */
function row(rows: ListMarkerVisibility[], suffix: string) {
  const found = rows.find((r) => r.text.endsWith(suffix));
  if (!found) throw new Error(`No list item ending "${suffix}"`);
  return found;
}

async function markersUntil(root: string): Promise<ListMarkerVisibility[]> {
  let rows: ListMarkerVisibility[] = [];
  await browser.waitUntil(
    async () => {
      rows = await listMarkerVisibility(root);
      return rows.length === 6;
    },
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: `expected six list items under ${root}`,
    }
  );
  return rows;
}

/**
 * The checks shared by the editor and reading view: with the preference on,
 * a callout's bullet or number goes, its checkbox stays, and plain items are
 * untouched.
 */
function expectCalloutMarkersHidden(rows: ListMarkerVisibility[]) {
  expect(row(rows, BULLET_CALLOUT)).toMatchObject({
    callout: true,
    marker: 'bullet',
    shown: false,
  });
  expect(row(rows, NUMBERED_CALLOUT)).toMatchObject({
    callout: true,
    marker: 'number',
    shown: false,
  });
  // The one interactive marker, so it has to stay clickable.
  expect(row(rows, TASK_CALLOUT)).toMatchObject({
    callout: true,
    marker: 'checkbox',
    shown: true,
  });

  for (const plain of rows.filter((r) => !r.callout)) {
    expect(plain.shown).toBe(true);
  }
}

function expectEveryMarkerShown(rows: ListMarkerVisibility[]) {
  expect(rows.length).toBe(6);
  for (const r of rows) expect(r.shown).toBe(true);
}

/**
 * mgmeyers/obsidian-list-callouts#59: a callout line's bullet next to the
 * callout marker is one marker too many, and a checkbox already shows how
 * it could go. The preference is one body class that styles.css keys on, so
 * a note's editor, its reading view and the settings tab's own previews all
 * follow it, with a checkbox left alone.
 */
describe('Hide bullets and numbers', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }, text) => {
      await app.vault.create('Markers.md', `${text}\n`);
    }, NOTE);
    await openNote('Markers.md');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });
    // Off the first line: a note opens with the cursor at its start, and live
    // preview shows the raw `- ` there while the cursor touches it, bullet
    // span and all.
    await placeCursor(NOTE.split('\n').length, 0);
  });

  after(async function () {
    await setHideBullets(false);
  });

  describe('off by default', function () {
    it('shows every list marker', async function () {
      expect(await getHideBullets()).toBe(false);
      expect(await bodyHidesBullets()).toBe(false);
      expectEveryMarkerShown(await markersUntil(EDITOR));
    });
  });

  describe('in the editor', function () {
    before(async function () {
      await ensureEditingMode();
      await setHideBullets(true);
    });

    it('puts the class on the body', async function () {
      expect(await bodyHidesBullets()).toBe(true);
    });

    it("hides a callout's bullet and number but keeps its checkbox, and leaves plain items alone", async function () {
      expectCalloutMarkersHidden(await markersUntil(EDITOR));
    });

    it('keeps the callout marker itself', async function () {
      const shown = await browser.executeObsidian((_, root) => {
        return Array.from(
          document.querySelectorAll<HTMLElement>(
            `${root} .lc-list-callout .lc-list-marker`
          )
        ).map((el) => el.getClientRects().length > 0);
      }, EDITOR);

      expect(shown).toEqual([true, true, true]);
    });

    it('captures the rendering for visual inspection', async function () {
      const file = await captureRendering('hidden-bullets-live-preview');
      expect(file).toContain('hidden-bullets-live-preview');
    });

    it('shows the bullets again when turned off', async function () {
      await setHideBullets(false);
      expect(await bodyHidesBullets()).toBe(false);
      expectEveryMarkerShown(await markersUntil(EDITOR));
    });
  });

  describe('in reading view', function () {
    before(async function () {
      await setHideBullets(true);
      await ensureReadingMode();
      await browser
        .$(`${READING} .lc-list-callout`)
        .waitForExist({ timeout: 10000 });
    });

    after(async function () {
      await ensureEditingMode();
    });

    it("hides a callout's bullet and number but keeps its checkbox, and leaves plain items alone", async function () {
      expectCalloutMarkersHidden(await markersUntil(READING));
    });

    it('captures the rendering for visual inspection', async function () {
      const file = await captureRendering('hidden-bullets-reading-mode');
      expect(file).toContain('hidden-bullets-reading-mode');
    });

    it('shows the bullets again when turned off, with no re-render', async function () {
      await setHideBullets(false);
      expectEveryMarkerShown(await markersUntil(READING));
    });
  });

  describe('in the settings tab', function () {
    before(async function () {
      await setHideBullets(true);
      await openPluginSettings();
    });

    after(async function () {
      await closeSettings();
    });

    /** Whether each callout preview's bullet takes up space. */
    function previewBulletsShown(): Promise<boolean[]> {
      return browser.executeObsidian(({ app }) => {
        const el = (app as any).setting.activeTab?.containerEl as HTMLElement;
        return Array.from(
          el.querySelectorAll<HTMLElement>('.lc-callout-container .list-bullet')
        ).map((bullet) => bullet.getClientRects().length > 0);
      });
    }

    it('hides the bullet in every preview while on', async function () {
      const shown = await previewBulletsShown();
      expect(shown.length).toBe(await calloutPreviewCount());
      expect(shown.length).toBe(DEFAULT_SETTINGS.length);
      expect(shown.every((s) => !s)).toBe(true);
    });

    it('shows them again as soon as the toggle is turned off', async function () {
      await clickToggleByName('Hide bullets and numbers');
      await browser.waitUntil(async () => !(await getHideBullets()), {
        timeout: 5000,
        timeoutMsg: 'the toggle did not turn the preference off',
      });

      expect(await bodyHidesBullets()).toBe(false);
      const shown = await previewBulletsShown();
      expect(shown.length).toBe(DEFAULT_SETTINGS.length);
      expect(shown.every((s) => s)).toBe(true);
    });

    it('hides them again when the toggle is turned back on', async function () {
      await clickToggleByName('Hide bullets and numbers');
      await browser.waitUntil(getHideBullets, {
        timeout: 5000,
        timeoutMsg: 'the toggle did not turn the preference on',
      });

      expect(await bodyHidesBullets()).toBe(true);
      expect((await previewBulletsShown()).every((s) => !s)).toBe(true);
    });
  });

  describe('persistence', function () {
    before(async function () {
      // A fresh Obsidian rather than resetVault: resetVault empties the
      // plugin's folder in the sandbox vault while the loaded plugin keeps
      // running, so once disabled it has no main.js to load again.
      await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
    });

    it('is read back from disk when the plugin reloads', async function () {
      await setHideBullets(true);
      await reloadPlugin();

      expect(await getHideBullets()).toBe(true);
      expect(await bodyHidesBullets()).toBe(true);
    });

    it('takes the body class away when the plugin unloads', async function () {
      await browser.executeObsidian(async ({ app }) => {
        await (app as any).plugins.disablePlugin('list-callouts-improved');
      });
      expect(await bodyHidesBullets()).toBe(false);

      await browser.executeObsidian(async ({ app }) => {
        await (app as any).plugins.enablePlugin('list-callouts-improved');
      });
      expect(await bodyHidesBullets()).toBe(true);
    });

    it('defaults to off for data saved before the setting existed', async function () {
      await writePluginData(
        JSON.stringify({
          callouts: DEFAULT_SETTINGS,
          highlights: { enabled: true, requireSpace: true },
        })
      );
      await reloadPlugin();

      expect(await getHideBullets()).toBe(false);
      expect(await bodyHidesBullets()).toBe(false);
    });
  });
});
