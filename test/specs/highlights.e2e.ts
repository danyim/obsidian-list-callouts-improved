import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_HIGHLIGHT_SETTINGS, DEFAULT_SETTINGS } from '../../src/settings';
import {
  RenderedHighlight,
  editorHighlights,
  editorLineNumber,
  editorLineText,
  ensureEditingMode,
  ensureReadingMode,
  openNote,
  placeCursor,
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

/** Wait until the editor's highlight spans satisfy `ready`. */
async function editorUntil(
  ready: (spans: RenderedHighlight[]) => boolean,
  msg: string
): Promise<RenderedHighlight[]> {
  let spans: RenderedHighlight[] = [];
  await browser.waitUntil(
    async () => {
      spans = await editorHighlights();
      return ready(spans);
    },
    { timeout: 10000, interval: 200, timeoutMsg: msg }
  );
  return spans;
}

describe('Highlight rendering in live preview', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHighlights({ ...DEFAULT_HIGHLIGHT_SETTINGS });
    await openNote('Highlights.md');
    await ensureEditingMode();
    // The caret lands on the title line, which holds no highlight, so every
    // marker starts out hidden.
    await placeCursor(0, 0);
  });

  it('decorates every built-in character', async function () {
    const spans = await editorUntil(
      (s) => s.some((x) => x.char === '%'),
      'highlights were not decorated'
    );

    for (const char of BUILT_IN_CHARS) {
      const span = spans.find((s) => s.char === char);
      expect(span).toBeDefined();
      expect(span.color.trim().length).toBeGreaterThan(0);
    }
  });

  it('hides the raw character and the space', async function () {
    const text = await editorLineText('Important');

    expect(text).toContain('Important');
    expect(text).not.toContain('& ');
    expect(text).not.toContain('==');
  });

  // Like a list callout, a highlight without an icon is still led by its
  // character -- otherwise a plain built-in shows nothing but a tint, and
  // which callout it is has to be guessed from the color.
  it('shows the character as the marker when no icon is set', async function () {
    const spans = await editorHighlights();

    for (const char of BUILT_IN_CHARS) {
      const marked = spans.find((s) => s.char === char && s.marker !== null);
      expect(marked?.marker).toBe(char);
      expect(marked.hasIcon).toBe(false);
    }
  });

  it('reveals the markup while the caret is inside', async function () {
    // Whether Obsidian also reveals its own `==` delimiters is Obsidian's
    // call, not this plugin's -- so this only asserts on the marker our own
    // replacement decoration controls, the callout character and its space.
    const line = await editorLineNumber('Important');
    await placeCursor(line, 5);

    await browser.waitUntil(
      async () => (await editorLineText('Important')).includes('& Important'),
      { timeout: 5000, interval: 150, timeoutMsg: 'markup was not revealed' }
    );

    await placeCursor(0, 0);

    await browser.waitUntil(
      async () => !(await editorLineText('Important')).includes('& '),
      { timeout: 5000, interval: 150, timeoutMsg: 'markup was not hidden again' }
    );
  });

  it('decorates two highlights on one line separately', async function () {
    const spans = await editorHighlights();

    expect(spans.find((s) => s.text === 'first')?.char).toBe('&');
    expect(spans.find((s) => s.text === 'second')?.char).toBe('!');
  });

  // CodeMirror renders one highlight as two of our spans: one around the
  // marker widget on its own, and one around the text nested inside the span
  // Obsidian paints its own yellow on. If that yellow is not canceled, the
  // text is blended over it (cyan came out green) while the marker is not, so
  // an icon sat on a different color from its text -- and nothing else in
  // this file notices, because classes and attributes are all still right.
  it('paints the callout color and nothing else', async function () {
    const paint = await browser.executeObsidian(({ app }) => {
      return Array.from(
        app.workspace.containerEl.querySelectorAll<HTMLElement>(
          '.markdown-source-view .lc-highlight-callout[data-callout="@"]'
        )
      ).map((el) => {
        const above: string[] = [];
        for (
          let n = el.parentElement;
          n && !n.classList.contains('cm-line');
          n = n.parentElement
        ) {
          above.push(getComputedStyle(n).backgroundColor);
        }
        return { own: getComputedStyle(el).backgroundColor, above };
      });
    });

    // Marker span and text span, at least.
    expect(paint.length).toBeGreaterThanOrEqual(2);
    for (const { own, above } of paint) {
      expect(own.startsWith('rgba(0, 184, 212, ')).toBe(true);
      expect(above.every((c) => c === 'rgba(0, 0, 0, 0)')).toBe(true);
    }
  });

  it('leaves a plain highlight alone', async function () {
    const spans = await editorHighlights();

    expect(spans.some((s) => s.text === 'highlight')).toBe(false);
  });

  it('never decorates highlights inside code', async function () {
    const spans = await editorHighlights();

    expect(spans.some((s) => s.text.includes('code'))).toBe(false);
    expect(spans.some((s) => s.text.includes('fenced'))).toBe(false);
  });

  it('decorates a highlight inside a list callout', async function () {
    const spans = await editorHighlights();

    expect(spans.find((s) => s.text === 'inline')?.char).toBe('!');
  });

  it('shows the callout icon when one is set', async function () {
    await setSettings(withStar());

    const spans = await editorUntil(
      (s) => s.some((x) => x.char === '&' && x.hasIcon),
      'the icon widget did not appear'
    );

    expect(spans.find((s) => s.char === '&' && s.hasIcon).marker).toBe('');
    expect(spans.some((s) => s.char === '?' && s.hasIcon)).toBe(false);

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
      const spans = await editorUntil(
        (s) => s.some((x) => x.text === 'important' && x.char === '!'),
        '==!important== was not decorated'
      );

      expect(spans.length).toBeGreaterThan(0);
    });
  });

  describe('with the space required', function () {
    it('leaves ==!important== alone', async function () {
      await editorUntil(
        (s) => !s.some((x) => x.text === 'important'),
        '==!important== stayed decorated'
      );

      expect(await editorLineText('important')).toContain('!important');
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
      await editorUntil((s) => s.length === 0, 'highlights stayed decorated');

      const listCallouts = await browser.executeObsidian(({ app }) => {
        return app.workspace.containerEl.querySelectorAll(
          '.markdown-source-view .lc-list-callout'
        ).length;
      });
      expect(listCallouts).toBeGreaterThan(0);
    });
  });
});

describe('Highlight rendering in reading mode', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHighlights({ ...DEFAULT_HIGHLIGHT_SETTINGS });
    await openNote('Highlights.md');
    await ensureReadingMode();
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

  it('shows the character as the marker when no icon is set', async function () {
    const marks = await readingHighlights();

    for (const char of BUILT_IN_CHARS) {
      const mark = marks.find((m) => m.char === char);
      expect(mark.marker).toBe(char);
      expect(mark.hasIcon).toBe(false);
    }
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
    expect(marks.find((m) => m.char === '&').marker).toBe('');
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

describe('Highlight edge cases in live preview', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHighlights({ ...DEFAULT_HIGHLIGHT_SETTINGS });
    await openNote('Highlight edges.md');
    await ensureEditingMode();
    await placeCursor(0, 0);
    await browser
      .$('.markdown-source-view .lc-highlight-callout')
      .waitForExist({ timeout: 10000 });
  });

  it('decorates a highlight with formatting inside it', async function () {
    const spans = await editorHighlights();
    const text = await editorLineText('bold');

    expect(spans.some((s) => s.char === '&' && s.text.includes('bold'))).toBe(
      true
    );
    // Our marker and Obsidian's `**` are both hidden; the words remain.
    expect(text).toContain('bold text');
    expect(text).not.toContain('& ');
    expect(text).not.toContain('**');
  });

  it('leaves an unclosed highlight alone', async function () {
    const spans = await editorHighlights();

    expect(spans.some((s) => s.text.includes('never closed'))).toBe(false);
    // Obsidian hides the dangling `==` on its own account; the marker after it
    // is ours to hide, and stays put.
    expect(await editorLineText('never closed')).toContain('& never closed');
  });

  it('decorates a highlight that closes on a later line', async function () {
    const spans = await editorHighlights();

    // CodeMirror draws a mark that crosses a line break as one span per line.
    expect(
      spans.some((s) => s.char === '&' && s.text.includes('spans one line'))
    ).toBe(true);
    expect(
      spans.some((s) => s.char === '&' && s.text.includes('then another'))
    ).toBe(true);

    const first = await editorLineText('spans one line');
    expect(first).not.toContain('& ');
    expect(await editorLineText('then another')).toContain('before ending');
  });
});

describe('Highlight edge cases in reading mode', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setHighlights({ ...DEFAULT_HIGHLIGHT_SETTINGS });
    await openNote('Highlight edges.md');
    await ensureReadingMode();
    await browser
      .$('.markdown-reading-view mark')
      .waitForExist({ timeout: 10000 });
  });

  it('decorates a highlight with formatting inside it', async function () {
    const marks = await readingHighlights();
    const bold = marks.find((m) => m.text === 'bold text');

    expect(bold).toBeDefined();
    expect(bold.char).toBe('&');
  });

  it('leaves an unclosed highlight alone', async function () {
    const marks = await readingHighlights();

    expect(marks.some((m) => m.text.includes('never closed'))).toBe(false);
  });

  it('decorates a highlight that closes on a later line', async function () {
    const marks = await readingHighlights();
    const across = marks.find((m) => m.text.includes('spans one line'));

    expect(across).toBeDefined();
    expect(across.char).toBe('&');
    expect(across.text).toContain('then another');
    expect(across.text.startsWith('spans')).toBe(true);
  });
});
