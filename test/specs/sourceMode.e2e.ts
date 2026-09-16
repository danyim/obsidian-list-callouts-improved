import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import {
  captureRendering,
  editorLineText,
  openNote,
  placeCursor,
  setRendering,
} from '../helpers';

const EDITOR = '.workspace .markdown-source-view';

/** Everything the editor extension draws, by class. */
const DECORATION_CLASSES = [
  'lc-list-callout',
  'lc-list-callout-continuation',
  'lc-list-bg',
  'lc-list-marker',
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

function expectNothingDecorated(counts: Record<string, number>) {
  for (const cls of DECORATION_CLASSES) {
    expect(counts[cls]).toBe(0);
  }
}

/**
 * mgmeyers/obsidian-list-callouts#35: source mode is where the raw markdown
 * is meant to show, so a callout there is the plain `- & text` with nothing
 * drawn over it, no marker, band or highlight color, and the character can
 * be seen and edited as typed. Live preview keeps the rendering, and
 * switching between the two redraws on its own, with no edit in between.
 */
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
    await setRendering('live-preview');
  });

  describe('switched to from live preview', function () {
    before(async function () {
      await setRendering('source');
      await waitForRendering(false);
    });

    it('draws no callout, marker, band or highlight', async function () {
      await browser.waitUntil(
        async () => (await decorationCounts())['lc-list-callout'] === 0,
        {
          timeout: 10000,
          timeoutMsg: 'source mode kept the callout decorations',
        }
      );
      expectNothingDecorated(await decorationCounts());
    });

    it('shows the raw text, callout character included', async function () {
      expect(await editorLineText('Important')).toBe('- & Important');
      expect(await editorLineText('Mixed line')).toBe(
        '- & Mixed line with ==! inline== highlight'
      );
    });

    it('stays plain while the caret moves through a callout', async function () {
      await placeCursor(5, 4);
      expect(await editorLineText('Important')).toBe('- & Important');
      expectNothingDecorated(await decorationCounts());
      await placeCursor(0, 0);
    });

    it('captures the rendering for visual inspection', async function () {
      const file = await captureRendering('source-mode');
      expect(file).toContain('source-mode');
    });
  });

  describe('switched back to live preview', function () {
    before(async function () {
      await setRendering('live-preview');
      await waitForRendering(true);
    });

    it('decorates the callouts again without an edit', async function () {
      const counts = await waitForDecorations();
      expect(counts['lc-list-marker']).toBe(counts['lc-list-callout']);
      expect(counts['lc-list-bg']).toBe(counts['lc-list-callout']);
      expect(counts['lc-highlight-marker']).toBe(counts['lc-highlight-callout']);
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

    it('is plain from the first draw', async function () {
      await browser.waitUntil(
        async () => (await editorLineText('Opened in')) !== '',
        { timeout: 10000, timeoutMsg: 'the note did not open' }
      );
      expect(await editorLineText('Opened in')).toBe(
        '1. & Opened in source mode'
      );
      expectNothingDecorated(await decorationCounts());
    });
  });
});
