import { browser, expect } from '@wdio/globals';
import { before, beforeEach, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import {
  editorText,
  openNote,
  placeCursor,
  selectLines,
  setEditorText,
  undo,
} from '../helpers';

const REMOVE_COMMAND = 'improved-list-callouts:remove-callout';

// One line per shape the editor regex recognises, plus a plain item the
// command must not touch. Line numbers are referenced directly by the tests,
// so keep them in step when editing.
const FIXTURE = [
  '- & Important', // 0
  '- ? Question', // 1
  '- Plain list item', // 2
  '- ! Warning', // 3
  '1. & Ordered callout', // 4
  '- [ ] & Task callout', // 5
  '  - @ Indented callout', // 6
].join('\n');

describe('Remove callout command', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create('Commands.md', '- & placeholder\n');
    });
    await openNote('Commands.md');
  });

  beforeEach(async function () {
    await setEditorText(FIXTURE);
  });

  it('removes the callout from the line holding the cursor', async function () {
    await placeCursor(0, 6);
    await browser.executeObsidianCommand(REMOVE_COMMAND);

    const lines = (await editorText()).split('\n');
    expect(lines[0]).toBe('- Important');
  });

  it('leaves the other lines alone', async function () {
    await placeCursor(0, 6);
    await browser.executeObsidianCommand(REMOVE_COMMAND);

    const lines = (await editorText()).split('\n');
    expect(lines.slice(1).join('\n')).toBe(
      FIXTURE.split('\n').slice(1).join('\n')
    );
  });

  it('does nothing on a line without a callout', async function () {
    await placeCursor(2, 4);
    await browser.executeObsidianCommand(REMOVE_COMMAND);

    expect(await editorText()).toBe(FIXTURE);
  });

  it('removes the callout from an ordered list item', async function () {
    await placeCursor(4, 0);
    await browser.executeObsidianCommand(REMOVE_COMMAND);

    const lines = (await editorText()).split('\n');
    expect(lines[4]).toBe('1. Ordered callout');
  });

  it('removes the callout from a task list item', async function () {
    await placeCursor(5, 0);
    await browser.executeObsidianCommand(REMOVE_COMMAND);

    const lines = (await editorText()).split('\n');
    expect(lines[5]).toBe('- [ ] Task callout');
  });

  it('keeps the indentation of an indented callout', async function () {
    await placeCursor(6, 0);
    await browser.executeObsidianCommand(REMOVE_COMMAND);

    const lines = (await editorText()).split('\n');
    expect(lines[6]).toBe('  - Indented callout');
  });

  it('removes the callout from every line a selection touches', async function () {
    await selectLines(0, 3);
    await browser.executeObsidianCommand(REMOVE_COMMAND);

    const lines = (await editorText()).split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '- Important',
      '- Question',
      '- Plain list item',
      '- Warning',
    ]);
  });

  it('restores every changed line with a single undo', async function () {
    await selectLines(0, 3);
    await browser.executeObsidianCommand(REMOVE_COMMAND);
    expect(await editorText()).not.toBe(FIXTURE);

    await undo();
    expect(await editorText()).toBe(FIXTURE);
  });
});
