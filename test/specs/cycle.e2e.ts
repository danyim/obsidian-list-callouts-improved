import { browser, expect } from '@wdio/globals';
import { before, beforeEach, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  editorText,
  openNote,
  placeCursor,
  selectLines,
  setEditorText,
  setSettings,
  undo,
} from '../helpers';

const NEXT = 'list-callouts-improved:next-callout';
const PREVIOUS = 'list-callouts-improved:previous-callout';

/** The built-in order the cycle steps through: & ? ! ~ @ $ % */
const CHARS = DEFAULT_SETTINGS.map((c) => c.char);
const FIRST = CHARS[0];
const LAST = CHARS[CHARS.length - 1];

// One line per shape the editor pattern recognises, plus a plain list item to
// start from and a paragraph the commands must not touch. Line numbers are
// referenced directly by the tests, so keep them in step when editing.
const FIXTURE = [
  '- Plain list item', // 0
  `- ${FIRST} First callout`, // 1
  `- ${LAST} Last callout`, // 2
  'Just a paragraph', // 3
  `1. ${FIRST} Ordered callout`, // 4
  `- [ ] ${FIRST} Task callout`, // 5
  '  - Indented plain item', // 6
].join('\n');

async function line(n: number): Promise<string> {
  return (await editorText()).split('\n')[n];
}

describe('Next and previous callout commands', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create('Cycle.md', '- placeholder\n');
    });
    await openNote('Cycle.md');
  });

  beforeEach(async function () {
    // The list order is the cycle order, so pin it rather than inheriting
    // whatever an earlier spec left behind.
    await setSettings(DEFAULT_SETTINGS.map((c) => ({ ...c })));
    await setEditorText(FIXTURE);
  });

  it('turns a plain list item into the first callout', async function () {
    await placeCursor(0, 4);
    await browser.executeObsidianCommand(NEXT);

    expect(await line(0)).toBe(`- ${FIRST} Plain list item`);
  });

  it('steps an existing callout to the next one in the list', async function () {
    await placeCursor(1, 8);
    await browser.executeObsidianCommand(NEXT);

    expect(await line(1)).toBe(`- ${CHARS[1]} First callout`);
  });

  it('clears the line when stepping past the last callout', async function () {
    await placeCursor(2, 8);
    await browser.executeObsidianCommand(NEXT);

    expect(await line(2)).toBe('- Last callout');
  });

  it('wraps from a plain item to the last callout going backwards', async function () {
    await placeCursor(0, 4);
    await browser.executeObsidianCommand(PREVIOUS);

    expect(await line(0)).toBe(`- ${LAST} Plain list item`);
  });

  it('clears the line when stepping back past the first callout', async function () {
    await placeCursor(1, 8);
    await browser.executeObsidianCommand(PREVIOUS);

    expect(await line(1)).toBe('- First callout');
  });

  it('returns the line to where it started after next then previous', async function () {
    await placeCursor(1, 8);
    await browser.executeObsidianCommand(NEXT);
    expect(await line(1)).not.toBe(`- ${FIRST} First callout`);

    await placeCursor(1, 8);
    await browser.executeObsidianCommand(PREVIOUS);
    expect(await line(1)).toBe(`- ${FIRST} First callout`);
  });

  it('comes back round to the start after a full lap', async function () {
    await placeCursor(0, 4);

    // Every callout, then the plain item between the last and the first.
    for (let i = 0; i < CHARS.length + 1; i++) {
      await browser.executeObsidianCommand(NEXT);
      await placeCursor(0, 4);
    }

    expect(await line(0)).toBe('- Plain list item');
  });

  it('leaves a line that is not a list item alone', async function () {
    await placeCursor(3, 4);
    await browser.executeObsidianCommand(NEXT);

    expect(await editorText()).toBe(FIXTURE);
  });

  it('cycles an ordered list item', async function () {
    await placeCursor(4, 0);
    await browser.executeObsidianCommand(NEXT);

    expect(await line(4)).toBe(`1. ${CHARS[1]} Ordered callout`);
  });

  it('cycles a task list item', async function () {
    await placeCursor(5, 0);
    await browser.executeObsidianCommand(NEXT);

    expect(await line(5)).toBe(`- [ ] ${CHARS[1]} Task callout`);
  });

  it('keeps the indentation of an indented item', async function () {
    await placeCursor(6, 0);
    await browser.executeObsidianCommand(NEXT);

    expect(await line(6)).toBe(`  - ${FIRST} Indented plain item`);
  });

  it('cycles every line a selection touches, skipping the paragraph', async function () {
    await selectLines(0, 3);
    await browser.executeObsidianCommand(NEXT);

    const lines = (await editorText()).split('\n');
    expect(lines.slice(0, 4)).toEqual([
      `- ${FIRST} Plain list item`,
      `- ${CHARS[1]} First callout`,
      '- Last callout',
      'Just a paragraph',
    ]);
  });

  it('restores every changed line with a single undo', async function () {
    await selectLines(0, 3);
    await browser.executeObsidianCommand(NEXT);
    expect(await editorText()).not.toBe(FIXTURE);

    await undo();
    expect(await editorText()).toBe(FIXTURE);
  });

  it('does nothing when every callout has been deleted', async function () {
    await setSettings([]);

    await placeCursor(0, 4);
    await browser.executeObsidianCommand(NEXT);

    expect(await editorText()).toBe(FIXTURE);
  });

  it('follows a reordered list rather than the built-in order', async function () {
    const reversed = DEFAULT_SETTINGS.map((c) => ({ ...c })).reverse();
    await setSettings(reversed);

    await placeCursor(0, 4);
    await browser.executeObsidianCommand(NEXT);

    expect(await line(0)).toBe(`- ${LAST} Plain list item`);
  });
});
