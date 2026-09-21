import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  captureRendering,
  editorLineText,
  markerPaint,
  openNote,
  placeCursor,
  setHideBullets,
  setRendering,
  setSettings,
} from '../helpers';

const EDITOR = '.workspace .markdown-source-view';

/** Everything the editor extension draws, by class. */
const DECORATION_CLASSES = [
  'lc-list-callout',
  'lc-list-callout-continuation',
  'lc-list-bg',
  'lc-list-marker',
  'lc-raw-marker',
  'lc-highlight-callout',
  'lc-highlight-marker',
];

/** How many elements of each decoration class the editor holds. */
function decorationCounts(): Promise<Record<string, number>> {
  return browser.executeObsidian(
    ({ app }, root: string, classes: string[]) => {
      const counts: Record<string, number> = {};
      for (const cls of classes) {
        counts[cls] = app.workspace.containerEl.querySelectorAll(
          `${root} .${cls}`
        ).length;
      }
      return counts;
    },
    EDITOR,
    DECORATION_CLASSES
  );
}

/**
 * Each tinted raw character next to the callout it belongs to, read off the
 * decorated ancestor's `data-callout`.
 */
function rawMarkers(): Promise<{ text: string; callout: string | null }[]> {
  return browser.executeObsidian(({ app }, root: string) => {
    return Array.from(
      app.workspace.containerEl.querySelectorAll<HTMLElement>(
        `${root} .lc-raw-marker`
      )
    ).map((el) => ({
      text: el.textContent ?? '',
      callout:
        el.closest<HTMLElement>('[data-callout]')?.dataset.callout ?? null,
    }));
  }, EDITOR);
}

/**
 * The list marker text (`- `, `1. `) of each callout line and whether it
 * takes up space, which is what the bullets preference removes.
 */
function listMarkers(): Promise<{ text: string; shown: boolean }[]> {
  return browser.executeObsidian(({ app }, root: string) => {
    return Array.from(
      app.workspace.containerEl.querySelectorAll<HTMLElement>(
        `${root} .cm-line.lc-list-callout`
      )
    ).map((line) => {
      const marker = line.querySelector<HTMLElement>('.cm-formatting-list');
      return {
        text: marker?.textContent ?? '',
        shown: !!marker && marker.getBoundingClientRect().width > 0,
      };
    });
  }, EDITOR);
}

function isLivePreview(): Promise<boolean> {
  return browser.executeObsidian(({ app }, root: string) => {
    const view = app.workspace.containerEl.querySelector(root);
    return !!view && view.classList.contains('is-live-preview');
  }, EDITOR);
}

async function waitForRendering(livePreview: boolean): Promise<void> {
  await browser.waitUntil(async () => (await isLivePreview()) === livePreview, {
    timeout: 10000,
    timeoutMsg: `the editor did not switch to ${livePreview ? 'live preview' : 'source mode'}`,
  });
}

async function waitForDecorations(): Promise<Record<string, number>> {
  let counts: Record<string, number> = {};
  await browser.waitUntil(
    async () => {
      counts = await decorationCounts();
      return counts['lc-list-callout'] > 0 && counts['lc-highlight-callout'] > 0;
    },
    { timeout: 10000, timeoutMsg: 'the editor never decorated the note' }
  );
  return counts;
}

/** Wait for the source-mode rendering: bands drawn, marker widgets gone. */
async function waitForRawRendering(): Promise<Record<string, number>> {
  let counts: Record<string, number> = {};
  await browser.waitUntil(
    async () => {
      counts = await decorationCounts();
      return (
        counts['lc-list-callout'] > 0 &&
        counts['lc-raw-marker'] > 0 &&
        counts['lc-list-marker'] === 0
      );
    },
    {
      timeout: 10000,
      timeoutMsg: 'source mode did not redraw the callouts as raw text',
    }
  );
  return counts;
}

/**
 * Source mode keeps the callout's band and a highlight's color, so the
 * visual cues survive a switch between modes, and keeps the markdown raw:
 * no marker widget stands in for the character, which is there to see and
 * edit as typed (mgmeyers/obsidian-list-callouts#35), tinted in the
 * callout's color (#49). Live preview keeps the full rendering, and
 * switching between the two redraws on its own, with no edit in between.
 */
function expectRawRendering(counts: Record<string, number>) {
  expect(counts['lc-list-callout']).toBeGreaterThan(0);
  expect(counts['lc-list-bg']).toBe(counts['lc-list-callout']);
  expect(counts['lc-highlight-callout']).toBeGreaterThan(0);
  expect(counts['lc-list-marker']).toBe(0);
  expect(counts['lc-highlight-marker']).toBe(0);
  expect(counts['lc-raw-marker']).toBe(
    counts['lc-list-callout'] + counts['lc-highlight-callout']
  );
}

describe('Source mode', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await openNote('Callouts.md');
    await waitForRendering(true);
    await waitForDecorations();
    // Off the callout lines: the caret reveals a highlight's raw marker in
    // live preview, and the point here is what mode does, not the caret.
    await placeCursor(0, 0);
  });

  after(async function () {
    await setHideBullets(false);
    await setRendering('live-preview');
  });

  describe('switched to from live preview', function () {
    before(async function () {
      await setRendering('source');
      await waitForRendering(false);
    });

    it('keeps the band and highlight color, with no marker widget', async function () {
      expectRawRendering(await waitForRawRendering());
    });

    it('shows the raw text, callout character included', async function () {
      expect(await editorLineText('Important')).toBe('- & Important');
      expect(await editorLineText('Mixed line')).toBe(
        '- & Mixed line with ==! inline== highlight'
      );
    });

    it('tints the raw character, and only the character, in the callout color', async function () {
      const markers = await rawMarkers();
      expect(markers.length).toBeGreaterThan(0);
      for (const marker of markers) {
        expect(marker.text).toBe(marker.callout);
      }

      const paint = await markerPaint(`${EDITOR} .cm-line.lc-list-callout`);
      expect(paint['&'].painted).toBe('rgb(255, 214, 0)');

      const highlight = await markerPaint(`${EDITOR} .lc-highlight-callout`);
      expect(highlight['!'].painted).toBe('rgb(255, 23, 68)');
    });

    it('tints the raw character in a custom marker color', async function () {
      await setSettings(
        DEFAULT_SETTINGS.map((c) =>
          c.char === '&' ? { ...c, markerColor: '10, 20, 30' } : c
        )
      );
      try {
        await browser.waitUntil(
          async () =>
            (await markerPaint(`${EDITOR} .cm-line.lc-list-callout`))['&']
              ?.painted === 'rgb(10, 20, 30)',
          {
            timeout: 10000,
            timeoutMsg: 'the raw marker did not take the custom marker color',
          }
        );
      } finally {
        await setSettings(DEFAULT_SETTINGS);
      }
    });

    it('stays as it is while the caret moves through a callout', async function () {
      const before = await waitForRawRendering();
      await placeCursor(5, 4);
      expect(await editorLineText('Important')).toBe('- & Important');
      expect(await decorationCounts()).toEqual(before);
      await placeCursor(0, 0);
    });

    it('captures the rendering for visual inspection', async function () {
      const file = await captureRendering('source-mode');
      expect(file).toContain('source-mode');
    });
  });

  describe('with bullets and numbers hidden', function () {
    before(async function () {
      await setHideBullets(true);
    });

    after(async function () {
      await setHideBullets(false);
    });

    it('keeps the raw list markers, with no callout marker to stand in for them', async function () {
      const markers = await listMarkers();
      expect(markers.length).toBeGreaterThan(0);
      for (const marker of markers) {
        expect(marker.text).toMatch(/^(- |\d+\. )$/);
        expect(marker.shown).toBe(true);
      }
      expect(await editorLineText('Ordered callout')).toBe(
        '1. & Ordered callout'
      );
    });

    it('captures the rendering for visual inspection', async function () {
      const file = await captureRendering('source-mode-hidden-bullets');
      expect(file).toContain('source-mode-hidden-bullets');
    });
  });

  describe('switched back to live preview', function () {
    before(async function () {
      await setRendering('live-preview');
      await waitForRendering(true);
    });

    it('decorates the callouts again without an edit', async function () {
      let counts: Record<string, number> = {};
      await browser.waitUntil(
        async () => {
          counts = await decorationCounts();
          return counts['lc-list-marker'] > 0 && counts['lc-raw-marker'] === 0;
        },
        {
          timeout: 10000,
          timeoutMsg: 'live preview did not put the marker widgets back',
        }
      );
      expect(counts['lc-list-marker']).toBe(counts['lc-list-callout']);
      expect(counts['lc-list-bg']).toBe(counts['lc-list-callout']);
      expect(counts['lc-highlight-marker']).toBe(counts['lc-highlight-callout']);
      expect(counts['lc-raw-marker']).toBe(0);
    });

    it('hides the callout character behind its marker', async function () {
      // The marker widget carries the character, so the visible text is the
      // same; what changes is that it is a widget, not the document's text.
      const marker = await browser.executeObsidian(({ app }, root: string) => {
        const line = Array.from(
          app.workspace.containerEl.querySelectorAll<HTMLElement>(
            `${root} .cm-line.lc-list-callout`
          )
        ).find((el) => (el.textContent ?? '').includes('Important'));
        return line?.querySelector('.lc-list-marker')?.textContent ?? null;
      }, EDITOR);
      expect(marker).toBe('&');
    });
  });

  describe('opened in source mode', function () {
    before(async function () {
      await setRendering('source');
      await waitForRendering(false);
      // A note of its own, so this is a first draw rather than a redraw of
      // the one already open. The leaf keeps its rendering across notes.
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.create('Opened.md', '1. & Opened in source mode\n');
      });
      await openNote('Opened.md');
      await waitForRendering(false);
    });

    it('is raw and tinted from the first draw', async function () {
      await browser.waitUntil(
        async () => (await editorLineText('Opened in')) !== '',
        { timeout: 10000, timeoutMsg: 'the note did not open' }
      );
      expect(await editorLineText('Opened in')).toBe(
        '1. & Opened in source mode'
      );
      await browser.waitUntil(
        async () => (await decorationCounts())['lc-list-callout'] === 1,
        { timeout: 10000, timeoutMsg: 'the note was not decorated' }
      );
      expect(await decorationCounts()).toMatchObject({
        'lc-list-callout': 1,
        'lc-list-bg': 1,
        'lc-raw-marker': 1,
        'lc-list-marker': 0,
      });
    });
  });
});
