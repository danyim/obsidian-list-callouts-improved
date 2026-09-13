import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import {
  cursorPosition,
  editorText,
  openNote,
  placeCursor,
  setEditorText,
} from '../helpers';

/**
 * mgmeyers/obsidian-list-callouts#86: the end-of-line hotkey (Home/End, and
 * Cmd-ArrowRight on macOS, all resolve through CodeMirror's
 * moveToLineBoundary) lands at the start of the line instead of the end when
 * the line holds a callout.
 */
describe('End-of-line hotkey on a callout line', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create('EOL.md', '- placeholder\n');
    });
    await openNote('EOL.md');
  });

  async function pressEnd(line: number, ch: number): Promise<[number, number]> {
    await placeCursor(line, ch);
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      // @ts-expect-error cm is not part of Obsidian's public Editor type
      view.editor.cm.contentDOM.focus();
    });
    await browser.keys(['End']);
    return cursorPosition();
  }

  // The cursor starts mid-line rather than at column 0: CodeMirror's own
  // moveToLineBoundary retries without visual-line coordinates if its first
  // attempt lands back on the starting position, which papers over the bug
  // when the cursor already sits at the start of the line.
  it('moves the cursor to the end of a plain list item', async function () {
    await setEditorText('- Plain list item');

    const [line, ch] = await pressEnd(0, 4);
    const text = (await editorText()).split('\n')[line];
    expect(ch).toBe(text.length);
  });

  it('moves the cursor to the end of a list item with a callout', async function () {
    await setEditorText('- [ ] ! Here is my list callout item');

    const [line, ch] = await pressEnd(0, 10);
    const text = (await editorText()).split('\n')[line];
    expect(ch).toBe(text.length);
  });

  it('moves the cursor to the end of an unchecked callout without a task box', async function () {
    await setEditorText('- ! Here is my list callout item');

    const [line, ch] = await pressEnd(0, 6);
    const text = (await editorText()).split('\n')[line];
    expect(ch).toBe(text.length);
  });
});
