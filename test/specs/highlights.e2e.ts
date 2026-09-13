import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_HIGHLIGHT_SETTINGS, DEFAULT_SETTINGS } from '../../src/settings';
import {
  RenderedHighlight,
  openNote,
  readingHighlights,
  rerenderReadingView,
  setHighlights,
  setSettings,
} from '../helpers';

const BUILT_IN_CHARS = ['&', '?', '!', '~', '@', '$', '%'];

/** The built-ins with a star on `&`, so one highlight shows an icon. */
function withStar() {
  return DEFAULT_SETTINGS.map((c) =>
    c.char === '&' ? { ...c, icon: 'lucide-star' } : { ...c }
  );
}

/**
 * Re-render and wait until `ready` holds for the marks, so a test never reads
 * the DOM from before its settings change landed.
 */
async function rerenderUntil(
  ready: (marks: RenderedHighlight[]) => boolean
): Promise<RenderedHighlight[]> {
  await rerenderReadingView();
  let marks: RenderedHighlight[] = [];
  await browser.waitUntil(
    async () => {
      marks = await readingHighlights();
      return marks.length > 0 && ready(marks);
    },
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'reading view did not reach the expected state',
    }
  );
  return marks;
}

describe('Highlight rendering in reading mode', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHighlights({ ...DEFAULT_HIGHLIGHT_SETTINGS });
    await openNote('Highlights.md');
    await browser.executeObsidianCommand('markdown:toggle-preview');
    await browser
      .$('.markdown-reading-view mark')
      .waitForExist({ timeout: 10000 });
  });

  it('decorates every built-in character', async function () {
    const marks = await rerenderUntil((m) =>
      m.some((x) => x.char === '%')
    );

    for (const char of BUILT_IN_CHARS) {
      const mark = marks.find((m) => m.char === char);
      expect(mark).toBeDefined();
      expect(mark.color.trim().length).toBeGreaterThan(0);
    }
  });

  it('strips the character and the space from the text', async function () {
    const marks = await readingHighlights();
    const important = marks.find((m) => m.char === '&');

    expect(important.text).toBe('Important');
  });

  it('decorates two highlights on one line separately', async function () {
    const marks = await readingHighlights();

    expect(marks.find((m) => m.text === 'first')?.char).toBe('&');
    expect(marks.find((m) => m.text === 'second')?.char).toBe('!');
  });

  it('leaves a plain highlight alone', async function () {
    const marks = await readingHighlights();
    const plain = marks.find((m) => m.text === 'highlight');

    expect(plain).toBeDefined();
    expect(plain.char).toBeNull();
    expect(plain.color).toBe('');
  });

  it('never decorates highlights inside code', async function () {
    const marks = await readingHighlights();

    expect(marks.some((m) => m.text.includes('code'))).toBe(false);
    expect(marks.some((m) => m.text.includes('fenced'))).toBe(false);
  });

  it('decorates a highlight inside a list callout', async function () {
    const marks = await readingHighlights();

    expect(marks.find((m) => m.text === 'inline')?.char).toBe('!');
  });

  it('shows the callout icon when one is set', async function () {
    await setSettings(withStar());

    const marks = await rerenderUntil((m) =>
      m.some((x) => x.char === '&' && x.hasIcon)
    );

    expect(marks.find((m) => m.char === '&').hasIcon).toBe(true);
    expect(marks.find((m) => m.char === '?').hasIcon).toBe(false);

    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
  });

  describe('with the space optional', function () {
    before(async function () {
      await setHighlights({ requireSpace: false });
    });

    after(async function () {
      await setHighlights({ requireSpace: true });
    });

    it('treats ==!important== as a callout', async function () {
      const marks = await rerenderUntil((m) =>
        m.some((x) => x.text === 'important')
      );

      expect(marks.find((m) => m.text === 'important').char).toBe('!');
    });
  });

  describe('with the space required', function () {
    it('leaves ==!important== alone', async function () {
      const marks = await rerenderUntil((m) =>
        m.some((x) => x.text === '!important')
      );

      expect(marks.find((m) => m.text === '!important').char).toBeNull();
    });
  });

  describe('when disabled', function () {
    before(async function () {
      await setHighlights({ enabled: false });
    });

    after(async function () {
      await setHighlights({ enabled: true });
    });

    it('decorates no highlights but still decorates list callouts', async function () {
      const marks = await rerenderUntil((m) => m.every((x) => x.char === null));

      expect(marks.length).toBeGreaterThan(BUILT_IN_CHARS.length);

      const listCallouts = await browser.executeObsidian(({ app }) => {
        return app.workspace.containerEl.querySelectorAll(
          '.markdown-reading-view .lc-list-callout'
        ).length;
      });
      expect(listCallouts).toBeGreaterThan(0);
    });
  });
});
