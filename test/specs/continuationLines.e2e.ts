import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { openNote } from '../helpers';

/**
 * #43 (mgmeyers/obsidian-list-callouts#48): a list item's wrapped lines are
 * lines of their own in the editor, and only the line holding the callout
 * character got the band. Reading mode paints the whole item, wrapped lines
 * included, and the editor should match it: one seamless band from the
 * marker line down to the item's last continuation line.
 */

const NOTE = [
  '- & First line',
  '  second line of first',
  '  third line of first',
  '- Plain',
  '  plain continuation',
  '\t- ? Nested',
  '\t  nested continuation',
  '\t\t1. ! Deep',
  '\t\t   deep continuation',
  '- [ ] @ Task',
  '      task continuation',
  '- ~ With code',
  '  ```',
  '  code();',
  '  ```',
  '  after code',
  '- $ Last',
  '',
  '  Loose paragraph in item',
  '',
  'Paragraph',
  '',
  '```',
  '- ! in fence',
  '  fence continuation',
  '```',
].join('\n');

interface LineInfo {
  text: string;
  callout: boolean;
  continuation: boolean;
  continued: boolean;
  data: string | null;
  color: string;
  bandLeft: number | null;
}

function lines(): Promise<LineInfo[]> {
  return browser.executeObsidian(() => {
    // Drop the caret: the active line renders differently.
    (document.activeElement as HTMLElement)?.blur();

    return Array.from(
      document.querySelectorAll<HTMLElement>('.markdown-source-view .cm-line')
    ).map((line) => {
      const bg = line.querySelector<HTMLElement>('.lc-list-bg');
      return {
        text: line.textContent ?? '',
        callout: line.classList.contains('lc-list-callout'),
        continuation: line.classList.contains('lc-list-callout-continuation'),
        continued: line.classList.contains('lc-list-callout-continued'),
        data: line.getAttribute('data-callout'),
        color: line.style.getPropertyValue('--lc-callout-color').trim(),
        bandLeft: bg ? parseFloat(bg.style.left) : null,
      };
    });
  });
}

/** The painted extent of a line's band: its box minus the padding. */
function bands(): Promise<{ text: string; top: number; bottom: number }[]> {
  return browser.executeObsidian(() => {
    (document.activeElement as HTMLElement)?.blur();

    return Array.from(
      document.querySelectorAll<HTMLElement>('.markdown-source-view .cm-line')
    ).flatMap((line) => {
      const bg = line.querySelector<HTMLElement>('.lc-list-bg');
      if (!bg) return [];
      const r = bg.getBoundingClientRect();
      const s = getComputedStyle(bg);
      return [
        {
          text: line.textContent ?? '',
          top: r.top + parseFloat(s.paddingTop),
          bottom: r.bottom - parseFloat(s.paddingBottom),
        },
      ];
    });
  });
}

describe('Callout continuation lines in the editor', function () {
  let rows: LineInfo[] = [];

  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }, text) => {
      await app.vault.create('Continuation.md', text + '\n');
    }, NOTE);
    await openNote('Continuation.md');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });
    rows = await lines();
  });

  const row = (text: string) => {
    const found = rows.find((r) => r.text.includes(text));
    if (!found) throw new Error(`no line containing "${text}"`);
    return found;
  };

  it("carries the callout onto the item's continuation lines", async function () {
    const head = row('First line');
    expect(head.callout).toBe(true);
    expect(head.continuation).toBe(false);

    for (const text of ['second line of first', 'third line of first']) {
      const line = row(text);
      expect(line.callout).toBe(false);
      expect(line.continuation).toBe(true);
      expect(line.data).toBe('&');
      expect(line.color).toBe(head.color);
      expect(line.bandLeft).not.toBeNull();
    }
  });

  it('marks every line of the run but the last as continued', async function () {
    expect(row('First line').continued).toBe(true);
    expect(row('second line of first').continued).toBe(true);
    expect(row('third line of first').continued).toBe(false);

    // A callout on one line only is not continued.
    expect(row('Last').continued).toBe(false);
  });

  it('leaves a plain item and its continuation alone', async function () {
    for (const text of ['Plain', 'plain continuation']) {
      const line = row(text);
      expect(line.callout).toBe(false);
      expect(line.continuation).toBe(false);
      expect(line.data).toBeNull();
    }
  });

  it('follows nested items, ordered items and tasks', async function () {
    expect(row('nested continuation').data).toBe('?');
    expect(row('deep continuation').data).toBe('!');
    expect(row('task continuation').data).toBe('@');
  });

  it('runs through a code block inside the item', async function () {
    for (const text of ['code();', 'after code']) {
      expect(row(text).continuation).toBe(true);
      expect(row(text).data).toBe('~');
    }
    expect(row('after code').continued).toBe(false);
  });

  it('ends the run at a blank line', async function () {
    const loose = row('Loose paragraph');
    expect(loose.continuation).toBe(false);
    expect(loose.data).toBeNull();
    expect(row('Last').continued).toBe(false);
  });

  it('ignores list-shaped text inside a fenced code block', async function () {
    expect(row('in fence').callout).toBe(false);
    expect(row('fence continuation').continuation).toBe(false);
  });

  it("starts each continuation band where the item's own band starts", async function () {
    expect(row('second line of first').bandLeft).toBe(
      row('First line').bandLeft
    );
    expect(row('nested continuation').bandLeft).toBe(row('Nested').bandLeft);
    expect(row('deep continuation').bandLeft).toBe(row('Deep').bandLeft);
    expect(row('task continuation').bandLeft).toBe(row('Task').bandLeft);
  });

  it('paints one seamless band down the item', async function () {
    const painted = await bands();
    const band = (text: string) => {
      const found = painted.find((b) => b.text.includes(text));
      if (!found) throw new Error(`no band on the line containing "${text}"`);
      return found;
    };

    // Within a run each band ends exactly where the next begins.
    expect(band('second line of first').top).toBeCloseTo(
      band('First line').bottom,
      0
    );
    expect(band('third line of first').top).toBeCloseTo(
      band('second line of first').bottom,
      0
    );

    // The run's last band still leaves the gap to the next item (#41).
    expect(band('Task').top).toBeGreaterThan(
      band('deep continuation').bottom + 0.5
    );
  });

  it('decorates a continuation line when its callout line is out of view', async function () {
    // The builder walks visible ranges only, so a range that starts on a
    // continuation line has to look back to the item's own line.
    const decorated = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      const cm = (view.editor as any).cm;
      const plugin = (app as any).plugins.plugins['list-callouts-improved'];

      let target = null;
      for (let i = 1; i <= cm.state.doc.lines; i++) {
        const line = cm.state.doc.line(i);
        if (line.text.includes('third line of first')) {
          target = line;
          break;
        }
      }
      if (!target) throw new Error('no continuation line in the note');

      const built = plugin.buildDecorations(
        { visibleRanges: [{ from: target.from, to: target.to }] },
        cm.state
      );

      const classes: string[] = [];
      built.decorations.between(
        target.from,
        target.to,
        (_from: number, _to: number, deco: any) => {
          const cls = deco.spec?.attributes?.class;
          if (cls) classes.push(cls);
        }
      );
      return classes;
    });

    expect(decorated.join(' ')).toContain('lc-list-callout-continuation');
  });
});
