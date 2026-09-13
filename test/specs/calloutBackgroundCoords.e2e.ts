import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { openNote, setEditorText } from '../helpers';

/**
 * Regression guard for a side effect of the #86 EOL-hotkey fix: nesting the
 * callout background widget behind a `display: contents` anchor makes
 * CodeMirror's `WidgetType.toDOM()` node return an empty `getClientRects()`.
 * That's the intended fix for hit-testing the *stretched* background box, but
 * the widget itself sits at the start of the line (`side: -1`,
 * `extension.ts`), which is also the exact position CodeMirror's
 * `coordsInChildren` resolves through when asked for coordinates on the
 * "before" side of that position -- something both `EditorView.coordsAtPos`
 * (used by `Home`/`Cmd-Left`'s line-boundary handling) and
 * `RectangleMarker.forRange` (which draws the cursor/selection) do. A widget
 * whose measurement comes back `null` there means those callers get `null`
 * back with no fallback, i.e. a cursor that resolves to a valid document
 * position but never gets a screen rectangle -- rendering nowhere at all.
 */
describe('Coordinate resolution at a callout line boundary', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create('Coords.md', '- placeholder\n');
    });
    await openNote('Coords.md');
  });

  it('resolves screen coordinates on the "before" side of a callout line\'s start', async function () {
    await setEditorText('- [ ] ! Here is my list callout item');

    const rect = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      const cm = (view.editor as any).cm;
      const line = cm.state.doc.line(1);
      return cm.coordsAtPos(line.from, -1);
    });

    expect(rect).not.toBeNull();
  });

  // Plain list items carry no widget at the line start, so this is the
  // control case establishing that side -1 coordinates are ordinarily
  // resolvable at all.
  it('resolves screen coordinates on the "before" side of a plain list item\'s start', async function () {
    await setEditorText('- Plain list item');

    const rect = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      const cm = (view.editor as any).cm;
      const line = cm.state.doc.line(1);
      return cm.coordsAtPos(line.from, -1);
    });

    expect(rect).not.toBeNull();
  });
});
