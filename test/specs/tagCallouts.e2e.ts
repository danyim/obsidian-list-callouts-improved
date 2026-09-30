import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  captureRendering,
  clickToggleByName,
  closeSettings,
  getTagCallouts,
  openNote,
  openPluginSettings,
  placeCursor,
  reloadPlugin,
  rerenderReading,
  setHideBullets,
  setRendering,
  setSettings,
  setTagCallouts,
  writePluginData,
} from '../helpers';

/**
 * #58: with the "Tag callouts" preference on, a callout whose character is a
 * tag colors any list item with that tag anywhere in it, the way
 * kltsv/obsidian-list-callouts-tags does. A nested tag takes its parent's
 * callout, and when the callout has an icon, the icon stands in for the tag.
 * Off (the default), a tag callout only counts at the start of an item, like
 * any other callout character.
 */

const CALLOUTS = [
  ...DEFAULT_SETTINGS,
  { char: '#breakfast', color: '255, 145, 0', icon: 'coffee' },
  { char: '#work', color: '0, 184, 212' },
];

const NOTE = [
  '- 09:00 #breakfast Eggs',
  '- 10:00 #work/admin Email',
  '- 11:00 #Work Standup',
  '- #breakfast Leading tag',
  '- & Character first #breakfast',
  '- Plain #unconfigured tag',
  '- Code `#breakfast` only',
  '- 12:00 #work then #breakfast',
  '- [ ] Task #breakfast',
  '1. Numbered #work',
  '',
  'Paragraph #breakfast',
  '',
  '- Last line',
].join('\n');

interface Row {
  text: string;
  data: string | null;
  color: string;
  tagIcon: boolean;
}

/** The editor's lines, as drawn. */
function editorRows(): Promise<Row[]> {
  return browser.executeObsidian(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('.markdown-source-view .cm-line')
    ).map((line) => ({
      text: line.textContent ?? '',
      data: line.getAttribute('data-callout'),
      color: line.style.getPropertyValue('--lc-callout-color'),
      tagIcon: !!line.querySelector('.lc-tag-marker svg'),
    }))
  );
}

/** Reading view's list items, with their own text only. */
function readingRows(): Promise<(Row & { tagLink: boolean })[]> {
  return browser.executeObsidian(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('.markdown-preview-view li')
    ).map((li) => ({
      text: li.textContent ?? '',
      data: li.getAttribute('data-callout'),
      color: li.style.getPropertyValue('--lc-callout-color'),
      tagIcon: !!li.querySelector('.lc-tag-marker svg'),
      tagLink: !!li.querySelector('a.tag'),
    }))
  );
}

function pick<T extends { text: string }>(rows: T[], text: string): T {
  const found = rows.find((r) => r.text.includes(text));
  if (!found) throw new Error(`no line containing "${text}"`);
  return found;
}

/** Zero-based position of `needle` in the note, as [line, ch]. */
function positionOf(needle: string): [number, number] {
  const lines = NOTE.split('\n');
  const line = lines.findIndex((l) => l.includes(needle));
  return [line, lines[line].indexOf(needle)];
}

const LAST_LINE = NOTE.split('\n').length - 1;

describe('Tag callouts', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await setSettings(CALLOUTS);
    await browser.executeObsidian(async ({ app }, text) => {
      await app.vault.create('Tags.md', text + '\n');
    }, NOTE);
    await openNote('Tags.md');
    await setRendering('live-preview');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });
    await placeCursor(LAST_LINE, 0);
  });

  after(async function () {
    await setTagCallouts(false);
    await setHideBullets(false);
    await setSettings(DEFAULT_SETTINGS);
  });

  describe('while off', function () {
    it('is off by default', async function () {
      expect(await getTagCallouts()).toBe(false);
    });

    it('only counts a tag callout at the start of an item', async function () {
      const rows = await editorRows();
      expect(pick(rows, 'Leading tag').data).toBe('#breakfast');
      expect(pick(rows, 'Eggs').data).toBeNull();
      expect(pick(rows, 'Email').data).toBeNull();
      expect(pick(rows, 'Character first').data).toBe('&');
    });
  });

  describe('in Live Preview', function () {
    before(async function () {
      await setTagCallouts(true);
      await browser.waitUntil(
        async () => pick(await editorRows(), 'Eggs').data === '#breakfast',
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: 'the tagged item was not colored after the toggle',
        }
      );
    });

    it('colors an item by a tag anywhere in it', async function () {
      const rows = await editorRows();
      expect(pick(rows, 'Eggs').data).toBe('#breakfast');
      expect(pick(rows, 'Eggs').color).toBe('255, 145, 0');
      expect(pick(rows, 'Leading tag').data).toBe('#breakfast');
      expect(pick(rows, 'Task').data).toBe('#breakfast');
      expect(pick(rows, 'Numbered').data).toBe('#work');
    });

    it("gives a nested tag its parent's callout", async function () {
      expect(pick(await editorRows(), 'Email').data).toBe('#work');
    });

    it('matches a tag whatever its case', async function () {
      expect(pick(await editorRows(), 'Standup').data).toBe('#work');
    });

    it('takes the first tag with a callout', async function () {
      expect(pick(await editorRows(), 'then').data).toBe('#work');
    });

    it('lets a leading callout character win over a later tag', async function () {
      expect(pick(await editorRows(), 'Character first').data).toBe('&');
    });

    it('leaves tags without a callout, code, and prose alone', async function () {
      const rows = await editorRows();
      expect(pick(rows, 'Plain').data).toBeNull();
      expect(pick(rows, 'Code').data).toBeNull();
      expect(pick(rows, 'Paragraph').data).toBeNull();
    });

    it("draws the callout's icon in place of the tag", async function () {
      const rows = await editorRows();
      const eggs = pick(rows, 'Eggs');
      expect(eggs.tagIcon).toBe(true);
      expect(eggs.text).not.toContain('#breakfast');
      expect(eggs.text).toContain('09:00');

      const file = await captureRendering('tag-callouts-live-preview');
      expect(file).toContain('tag-callouts-live-preview');
    });

    it('leaves the tag as it is when the callout has no icon', async function () {
      const email = pick(await editorRows(), 'Email');
      expect(email.tagIcon).toBe(false);
      expect(email.text).toContain('#work/admin');
    });

    it('shows the tag again while the caret is on it', async function () {
      const [line, ch] = positionOf('#breakfast Eggs');
      await placeCursor(line, ch + 3);
      await browser.waitUntil(
        async () =>
          pick(await editorRows(), 'Eggs').text.includes('#breakfast'),
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: 'the tag was not revealed for the caret',
        }
      );
      expect(pick(await editorRows(), 'Eggs').data).toBe('#breakfast');

      await placeCursor(LAST_LINE, 0);
      await browser.waitUntil(
        async () => pick(await editorRows(), 'Eggs').tagIcon,
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: 'the icon did not come back when the caret left',
        }
      );
    });

    it('builds the icon for a tag right after a checkbox', async function () {
      expect(pick(await editorRows(), 'Task').tagIcon).toBe(true);
    });
  });

  describe('in source mode', function () {
    before(async function () {
      await setRendering('source');
      await browser.waitUntil(
        async () =>
          (await browser.executeObsidian(
            () =>
              !!document.querySelector(
                '.markdown-source-view:not(.is-live-preview) .lc-list-callout'
              )
          )) === true,
        { timeout: 5000, interval: 100 }
      );
    });

    after(async function () {
      await setRendering('live-preview');
    });

    it('colors the item and leaves the tag as typed', async function () {
      const eggs = pick(await editorRows(), 'Eggs');
      expect(eggs.data).toBe('#breakfast');
      expect(eggs.tagIcon).toBe(false);
      expect(eggs.text).toContain('#breakfast');
    });
  });

  describe('in reading view', function () {
    before(async function () {
      await setRendering('reading');
      await rerenderReading();
      await browser.$('.markdown-preview-view li').waitForExist({
        timeout: 10000,
      });
    });

    after(async function () {
      await setRendering('live-preview');
    });

    it('colors the same items as the editor', async function () {
      const rows = await readingRows();
      expect(pick(rows, 'Eggs').data).toBe('#breakfast');
      expect(pick(rows, 'Email').data).toBe('#work');
      expect(pick(rows, 'Standup').data).toBe('#work');
      expect(pick(rows, 'Leading tag').data).toBe('#breakfast');
      expect(pick(rows, 'Character first').data).toBe('&');
      expect(pick(rows, 'then').data).toBe('#work');
      expect(pick(rows, 'Task').data).toBe('#breakfast');
      expect(pick(rows, 'Numbered').data).toBe('#work');
      expect(pick(rows, 'Plain').data).toBeNull();
      expect(pick(rows, 'Code').data).toBeNull();
    });

    it("swaps the tag for the callout's icon, and only when it has one", async function () {
      const rows = await readingRows();
      const eggs = pick(rows, 'Eggs');
      expect(eggs.tagIcon).toBe(true);
      expect(eggs.tagLink).toBe(false);

      const email = pick(rows, 'Email');
      expect(email.tagIcon).toBe(false);
      expect(email.tagLink).toBe(true);

      const file = await captureRendering('tag-callouts-reading-mode');
      expect(file).toContain('tag-callouts-reading-mode');
    });

    it('keeps the icon where the tag was when bullets are hidden', async function () {
      await setHideBullets(true);
      try {
        const float = await browser.executeObsidian(() => {
          const marker = Array.from(
            document.querySelectorAll<HTMLElement>(
              '.markdown-preview-view li .lc-tag-marker'
            )
          ).find((el) => el.closest('li')?.textContent?.includes('Eggs'));
          return marker ? getComputedStyle(marker).float : null;
        });
        expect(float).toBe('none');
      } finally {
        await setHideBullets(false);
      }
    });
  });

  describe('turned off again', function () {
    it('takes the tag callouts away from the open editor', async function () {
      await setTagCallouts(false);
      await browser.waitUntil(
        async () => pick(await editorRows(), 'Eggs').data === null,
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: 'the tagged item stayed colored after the toggle',
        }
      );
      expect(pick(await editorRows(), 'Leading tag').data).toBe('#breakfast');
    });
  });

  describe('the setting', function () {
    before(async function () {
      await openPluginSettings();
    });

    after(async function () {
      await closeSettings();
    });

    it('is flipped by its toggle', async function () {
      await clickToggleByName('Tag callouts');
      expect(await getTagCallouts()).toBe(true);

      await clickToggleByName('Tag callouts');
      expect(await getTagCallouts()).toBe(false);
    });
  });

  describe('persistence', function () {
    before(async function () {
      // A fresh Obsidian rather than resetVault, which leaves the plugin
      // with no main.js to load again once disabled (see nestedItems).
      await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
    });

    it('is read back from disk when the plugin reloads', async function () {
      await setTagCallouts(true);
      await reloadPlugin();

      expect(await getTagCallouts()).toBe(true);
    });

    it('defaults to off for data saved before the setting existed', async function () {
      await writePluginData(
        JSON.stringify({
          callouts: DEFAULT_SETTINGS,
          highlights: { enabled: true, requireSpace: true },
          hideBullets: false,
          colorNestedItems: false,
        })
      );
      await reloadPlugin();

      expect(await getTagCallouts()).toBe(false);
    });
  });
});
