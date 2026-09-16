import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  ListItemGeometry,
  ListMarkerVisibility,
  bodyHidesBullets,
  calloutPreviewCount,
  captureRendering,
  clickToggleByName,
  closeSettings,
  ensureEditingMode,
  ensureReadingMode,
  getHideBullets,
  listItemGeometry,
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

  /**
   * The callout marker is drawn where the list's own marker would be, and
   * a bullet callout and a numbered callout in one list come out the same.
   * The editor's bullet span carries its space as a text node beside the
   * glyph where a number's is inside .list-number, which once left the
   * bullet line's marker a space further along; and the band's inset for
   * a bullet (alignCalloutBackgrounds) has to go with the bullet, and go
   * the moment the setting flips rather than on the next edit.
   */
  describe('alignment', function () {
    const ALIGNMENT_NOTE = [
      '- & Bullet callout',
      '- Plain bullet',
      '1. & Numbered callout',
      '2. Plain numbered',
      '- [ ] & Task callout',
      '- [ ] Plain task',
      '- Parent',
      '\t- & Nested bullet callout',
      '\t- Nested plain bullet',
      '\t1. & Nested numbered callout',
      '\t2. Nested plain numbered',
    ].join('\n');

    /** Within a pixel: layout can land on a subpixel either side. */
    const expectNear = (actual: number | null, wanted: number | null) => {
      expect(actual).not.toBeNull();
      expect(wanted).not.toBeNull();
      expect(Math.abs(actual - wanted)).toBeLessThanOrEqual(1);
    };

    const item = (rows: ListItemGeometry[], suffix: string) => {
      const found = rows.find((r) => r.text.endsWith(suffix));
      if (!found) throw new Error(`No list item ending "${suffix}"`);
      return found;
    };

    const geometryUntil = async (
      root: string,
      ready: (rows: ListItemGeometry[]) => boolean
    ) => {
      let rows: ListItemGeometry[] = [];
      await browser.waitUntil(
        async () => {
          rows = await listItemGeometry(root);
          return rows.length === 11 && ready(rows);
        },
        {
          timeout: 10000,
          interval: 200,
          timeoutMsg: `list geometry under ${root} did not settle: ${JSON.stringify(rows)}`,
        }
      );
      return rows;
    };

    before(async function () {
      await browser.executeObsidian(async ({ app }, text) => {
        await app.vault.create('Alignment.md', `${text}\n`);
      }, ALIGNMENT_NOTE);
      await openNote('Alignment.md');
      await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });
      await placeCursor(ALIGNMENT_NOTE.split('\n').length, 0);
      await setHideBullets(false);
    });

    after(async function () {
      await ensureEditingMode();
      await setHideBullets(false);
    });

    describe('in the editor', function () {
      before(async function () {
        await ensureEditingMode();
        await setHideBullets(true);
      });

      it('draws the marker where the bullet or number began, alike on both lines', async function () {
        const rows = await geometryUntil(EDITOR, () => true);
        const bullet = item(rows, BULLET_CALLOUT);
        const numbered = item(rows, NUMBERED_CALLOUT);

        // Where the hidden glyphs would have started: the plain items' own
        // glyphs, which sit in the same place on every line of the list.
        expectNear(bullet.markerLeft, item(rows, 'Plain bullet').glyphLeft);
        expectNear(numbered.markerLeft, item(rows, 'Plain numbered').glyphLeft);
        expectNear(bullet.markerLeft, numbered.markerLeft);
      });

      it("gives the bullet line a numbered line's band once its bullet is gone, without waiting for an edit", async function () {
        const rows = await geometryUntil(
          EDITOR,
          (r) =>
            Math.abs(
              item(r, BULLET_CALLOUT).bandLeft -
                item(r, NUMBERED_CALLOUT).bandLeft
            ) < 0.5
        );
        expectNear(
          item(rows, BULLET_CALLOUT).bandLeft,
          item(rows, NUMBERED_CALLOUT).bandLeft
        );
      });

      it('holds for nested callouts, whose bands start at their own indent', async function () {
        const rows = await geometryUntil(EDITOR, () => true);
        const bullet = item(rows, 'Nested bullet callout');
        const numbered = item(rows, 'Nested numbered callout');

        expectNear(
          bullet.markerLeft,
          item(rows, 'Nested plain bullet').glyphLeft
        );
        expectNear(
          numbered.markerLeft,
          item(rows, 'Nested plain numbered').glyphLeft
        );
        expectNear(bullet.markerLeft, numbered.markerLeft);
        expectNear(bullet.bandLeft, numbered.bandLeft);
        // Nested: not the line's own edge, where a top-level band starts.
        expect(bullet.bandLeft).toBeGreaterThan(
          item(rows, BULLET_CALLOUT).bandLeft + 8
        );
      });

      it('puts the bullet and its band inset back when turned off', async function () {
        await setHideBullets(false);
        // The bullet is back the moment the class goes; its band's inset
        // follows on the re-measure, so wait for that rather than the bullet.
        const rows = await geometryUntil(
          EDITOR,
          (r) =>
            item(r, BULLET_CALLOUT).bandLeft >
            item(r, NUMBERED_CALLOUT).bandLeft + 2
        );
        const bullet = item(rows, BULLET_CALLOUT);
        expectNear(bullet.glyphLeft, item(rows, 'Plain bullet').glyphLeft);
        // The inset that a bullet line has always had, see #91's history.
        expect(bullet.bandLeft).toBeGreaterThan(
          item(rows, NUMBERED_CALLOUT).bandLeft + 2
        );
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

      it("centers the marker on the bullet's dot and keeps the text column", async function () {
        const rows = await geometryUntil(READING, () => true);
        const bullet = item(rows, BULLET_CALLOUT);
        const numbered = item(rows, NUMBERED_CALLOUT);
        const plainBullet = item(rows, 'Plain bullet');

        // A plain item's bullet float is zero width, so its left is the
        // dot's center; the marker's center lands on it, and a numbered
        // callout's marker on the same point.
        expectNear(bullet.markerCenter, plainBullet.glyphLeft);
        expectNear(numbered.markerCenter, plainBullet.glyphLeft);

        expectNear(bullet.textLeft, plainBullet.textLeft);
        expectNear(numbered.textLeft, item(rows, 'Plain numbered').textLeft);
      });

      it('holds for nested callouts, against a plain item of their own list', async function () {
        // Obsidian lays a nested ol out at a different column from a nested
        // ul, plain items included, so each callout is held to its own
        // list's column rather than to the other callout.
        const rows = await geometryUntil(READING, () => true);
        const bullet = item(rows, 'Nested bullet callout');
        const plainBullet = item(rows, 'Nested plain bullet');
        const numbered = item(rows, 'Nested numbered callout');
        const plainNumbered = item(rows, 'Nested plain numbered');

        expectNear(bullet.markerCenter, plainBullet.glyphLeft);
        expectNear(bullet.textLeft, plainBullet.textLeft);
        expectNear(numbered.textLeft, plainNumbered.textLeft);
        // A number's own glyph is a ::marker with no box to measure, so the
        // numbered marker is held to the same offset from its text as the
        // bullet one has from its own.
        expectNear(
          numbered.textLeft - numbered.markerCenter,
          bullet.textLeft - bullet.markerCenter
        );
        expect(bullet.markerCenter).toBeGreaterThan(
          item(rows, BULLET_CALLOUT).markerCenter + 8
        );
      });
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
