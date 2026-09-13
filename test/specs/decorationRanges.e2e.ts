import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import { openNote } from '../helpers';

/**
 * How many decorations the builder produces for a given set of visible ranges.
 *
 * Ranges are given as offsets from the start of a line in the note, so a test
 * can describe where a range boundary falls without knowing the document's
 * byte offsets. A builder that throws fails the test on the spot, which is the
 * behaviour under test as much as the count is.
 */
function buildFor(
  ranges: [number, number][],
  anchor: 'callout' | 'plain' | 'mixed' = 'callout'
): Promise<number> {
  return browser.executeObsidian(
    ({ app, obsidian }, offsets, want) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      const cm = (view.editor as any).cm;
      const plugin = (app as any).plugins.plugins['list-callouts-improved'];
      const re = plugin.buildEditorConfig().re;

      let target = null;
      for (let i = 1; i <= cm.state.doc.lines; i++) {
        const line = cm.state.doc.line(i);
        const isCallout = re.test(line.text);
        const wanted =
          want === 'callout'
            ? isCallout
            : want === 'mixed'
              ? isCallout && line.text.includes('==')
              : !isCallout && line.text.startsWith('- ');
        if (wanted) {
          target = line;
          break;
        }
      }

      if (!target) throw new Error(`no ${want} line in the note`);

      const visibleRanges = (offsets).map(
        ([from, to]) => ({
          from: target.from + from,
          to: target.from + to,
        })
      );

      // Only visibleRanges is read off the view, so a stub carries everything
      // the builder needs.
      return plugin.buildDecorations({ visibleRanges }, cm.state)
        .size as number;
    },
    ranges,
    anchor
  );
}

describe('Building decorations for visible ranges', function () {
  let lineLength = 0;

  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
    await openNote('Callouts.md');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });

    lineLength = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      const cm = (view.editor as any).cm;
      const re = (app as any).plugins.plugins[
        'list-callouts-improved'
      ].buildEditorConfig().re;

      for (let i = 1; i <= cm.state.doc.lines; i++) {
        const line = cm.state.doc.line(i);
        if (re.test(line.text)) return line.text.length as number;
      }

      return 0;
    });

    expect(lineLength).toBeGreaterThan(10);
  });

  // Three decorations per callout: the line class, the background widget and
  // the marker that replaces the character.
  const PER_CALLOUT = 3;

  it('decorates a callout line covered by one range', async function () {
    expect(await buildFor([[0, lineLength]])).toBe(PER_CALLOUT);
  });

  // The reason this file exists. Visible ranges can begin partway through a
  // line, so two consecutive ranges can both land on the same one. Feeding the
  // builder the same line twice used to hand RangeSetBuilder a position that
  // did not increase, which throws, and CodeMirror answers a throwing view
  // plugin by dropping its decorations: every callout leaves the screen rather
  // than one being drawn twice.
  it('decorates it once when two ranges land on the same line', async function () {
    expect(
      await buildFor([
        [0, 4],
        [1, lineLength],
      ])
    ).toBe(PER_CALLOUT);
  });

  it('survives several ranges overlapping the same line', async function () {
    expect(
      await buildFor([
        [0, 2],
        [1, 5],
        [3, 9],
        [2, lineLength],
      ])
    ).toBe(PER_CALLOUT);
  });

  it('decorates nothing when the ranges hold no callout', async function () {
    // The fixture's plain list item, which looks like a list but carries no
    // callout character.
    expect(await buildFor([[0, 10]], 'plain')).toBe(0);
  });

  // A highlight adds two decorations: the marker replacement and the mark.
  // Both start at the same position, and the builder only accepts them in
  // one order, so this holds that order as well as the count.
  it('decorates a highlight on a callout line', async function () {
    const length = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      const cm = (view.editor as any).cm;
      for (let i = 1; i <= cm.state.doc.lines; i++) {
        const line = cm.state.doc.line(i);
        if (line.text.includes('==! inline==')) return line.text.length as number;
      }
      return 0;
    });

    expect(await buildFor([[0, length]], 'mixed')).toBe(PER_CALLOUT + 2);
  });
});
