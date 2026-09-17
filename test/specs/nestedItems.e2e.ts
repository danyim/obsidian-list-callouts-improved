import { browser, expect } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { DEFAULT_SETTINGS } from '../../src/settings';
import {
  captureRendering,
  clickToggleByName,
  closeSettings,
  ensureEditingMode,
  ensureReadingMode,
  getColorNestedItems,
  openNote,
  openPluginSettings,
  placeCursor,
  reloadPlugin,
  rerenderReading,
  setColorNestedItems,
  setHideBullets,
  writePluginData,
} from '../helpers';

/**
 * mgmeyers/obsidian-list-callouts#1 and #85: with the "Color nested items"
 * preference on, an item nested under a callout takes the callout's color,
 * and so does everything nested under it, down to where an item starts a
 * callout of its own. Off (the default), only the callout's own item is
 * colored, as before.
 */

const NOTE = [
  '- & Parent',
  '\t- Child one',
  '\t  child continuation',
  '\t- Child two',
  '\t\t- Grandchild',
  '\t- ? Own callout child',
  '\t\t- Under own callout',
  '\t- Back to parent',
  '- Sibling',
  '\t- Nested under plain',
  '1. ! Numbered parent',
  '   1. Numbered child',
  '- [ ] @ Task parent',
  '\t- [ ] Task child',
  '- $ Loose parent',
  '',
  '\t- Loose child',
  '',
  'Paragraph',
  '',
  '- Fresh list',
].join('\n');

interface LineInfo {
  text: string;
  callout: boolean;
  nested: boolean;
  continuation: boolean;
  data: string | null;
  color: string;
  bandLeft: number | null;
  bulletShown: boolean | null;
}

function editorLines(): Promise<LineInfo[]> {
  return browser.executeObsidian(() => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.markdown-source-view .cm-line')
    ).map((line) => {
      const bg = line.querySelector<HTMLElement>('.lc-list-bg');
      const bullet = line.querySelector<HTMLElement>('.list-bullet');
      return {
        text: line.textContent ?? '',
        callout: line.classList.contains('lc-list-callout'),
        nested: line.classList.contains('lc-list-callout-nested'),
        continuation: line.classList.contains('lc-list-callout-continuation'),
        data: line.getAttribute('data-callout'),
        color: line.style.getPropertyValue('--lc-callout-color'),
        bandLeft: bg ? bg.getBoundingClientRect().left : null,
        bulletShown: bullet ? bullet.getClientRects().length > 0 : null,
      };
    });
  });
}

interface ItemInfo {
  text: string;
  callout: boolean;
  nested: boolean;
  data: string | null;
  color: string;
  wrapped: boolean;
}

function readingItems(): Promise<ItemInfo[]> {
  return browser.executeObsidian(() => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.markdown-preview-view li')
    ).map((li) => {
      // The item's own text, without its nested list's.
      const own = Array.from(li.childNodes)
        .filter((n) => !['UL', 'OL'].includes((n as HTMLElement).tagName))
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      return {
        text: own,
        callout: li.classList.contains('lc-list-callout'),
        nested: li.classList.contains('lc-list-callout-nested'),
        data: li.getAttribute('data-callout'),
        color: li.style.getPropertyValue('--lc-callout-color'),
        wrapped: !!li.querySelector(':scope > .lc-li-wrapper'),
      };
    });
  });
}

function pick<T extends { text: string }>(rows: T[], text: string): T {
  const found = rows.find((r) => r.text.includes(text));
  if (!found) throw new Error(`no line containing "${text}"`);
  return found;
}

describe('Nested items under a callout', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }, text) => {
      await app.vault.create('Nested.md', text + '\n');
    }, NOTE);
    await openNote('Nested.md');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });
    // Off the list: the line holding the caret shows its raw `- ` rather
    // than a bullet span, which the bullets check below looks for.
    await placeCursor(NOTE.split('\n').length, 0);
  });

  after(async function () {
    await setColorNestedItems(false);
    await setHideBullets(false);
  });

  describe('in the editor', function () {
    it('is off by default and leaves nested items alone', async function () {
      expect(await getColorNestedItems()).toBe(false);

      const rows = await editorLines();
      expect(rows.some((r) => r.nested)).toBe(false);
      expect(pick(rows, 'Child one').data).toBeNull();
      expect(pick(rows, 'Grandchild').data).toBeNull();
    });

    it('colors the nested items the moment the preference is turned on', async function () {
      await setColorNestedItems(true);

      // No edit, scroll or caret move in between: the toggle alone has to
      // reach the open editor.
      await browser.waitUntil(
        async () => (await editorLines()).some((r) => r.nested),
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: 'no nested item was colored after the toggle',
        }
      );
    });

    it("gives every item under the callout the callout's color", async function () {
      const rows = await editorLines();
      const parent = pick(rows, 'Parent');
      expect(parent.callout).toBe(true);

      for (const text of [
        'Child one',
        'Child two',
        'Grandchild',
        'Back to parent',
      ]) {
        const line = pick(rows, text);
        expect(line.nested).toBe(true);
        expect(line.callout).toBe(false);
        expect(line.continuation).toBe(false);
        expect(line.data).toBe('&');
        expect(line.color).toBe(parent.color);
        expect(line.bandLeft).not.toBeNull();
      }

      const file = await captureRendering('nested-items-live-preview');
      expect(file).toContain('nested-items-live-preview');
    });

    it("carries the color onto a nested item's continuation lines", async function () {
      const rows = await editorLines();
      const line = pick(rows, 'child continuation');
      expect(line.continuation).toBe(true);
      expect(line.data).toBe('&');
      expect(line.bandLeft).toBe(pick(rows, 'Child one').bandLeft);
    });

    it('lets a nested callout of its own take over for its subtree', async function () {
      const rows = await editorLines();
      const own = pick(rows, 'Own callout child');
      expect(own.callout).toBe(true);
      expect(own.nested).toBe(false);
      expect(own.data).toBe('?');

      const under = pick(rows, 'Under own callout');
      expect(under.nested).toBe(true);
      expect(under.data).toBe('?');

      // And the parent's color resumes once the nested callout's subtree ends.
      expect(pick(rows, 'Back to parent').data).toBe('&');
    });

    it('stops at the next item on the same level as the callout', async function () {
      const rows = await editorLines();
      for (const text of ['Sibling', 'Nested under plain', 'Fresh list']) {
        const line = pick(rows, text);
        expect(line.nested).toBe(false);
        expect(line.data).toBeNull();
      }
    });

    it('follows numbered and task list callouts', async function () {
      const rows = await editorLines();
      expect(pick(rows, 'Numbered child').nested).toBe(true);
      expect(pick(rows, 'Numbered child').data).toBe('!');
      expect(pick(rows, 'Task child').nested).toBe(true);
      expect(pick(rows, 'Task child').data).toBe('@');
    });

    it('reaches a nested item across a blank line inside the list', async function () {
      const rows = await editorLines();
      expect(pick(rows, 'Loose child').nested).toBe(true);
      expect(pick(rows, 'Loose child').data).toBe('$');
    });

    it("starts a nested item's band at its own indentation", async function () {
      const rows = await editorLines();
      expect(pick(rows, 'Child one').bandLeft).toBeGreaterThan(
        pick(rows, 'Parent').bandLeft
      );
      expect(pick(rows, 'Grandchild').bandLeft).toBeGreaterThan(
        pick(rows, 'Child one').bandLeft
      );
    });

    it('keeps the bullet on a nested item when bullets are hidden', async function () {
      await setHideBullets(true);
      try {
        await browser.waitUntil(
          async () => (await editorLines()).some((r) => r.callout && r.bulletShown === false),
          {
            timeout: 5000,
            interval: 100,
            timeoutMsg: 'the callout bullets were not hidden',
          }
        );
        const rows = await editorLines();
        expect(pick(rows, 'Parent').bulletShown).toBe(false);
        expect(pick(rows, 'Child one').bulletShown).toBe(true);
      } finally {
        await setHideBullets(false);
      }
    });

    it('colors a nested item when its callout is out of view', async function () {
      // The builder walks visible ranges only, so a range that starts on a
      // nested item has to look back for the callout it sits under.
      const decorated = await browser.executeObsidian(({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        const cm = (view.editor as any).cm;
        const plugin = (app as any).plugins.plugins['list-callouts-improved'];

        const classes: Record<string, string[]> = {};
        for (const text of ['Grandchild', 'Back to parent', 'Loose child']) {
          let target = null;
          for (let i = 1; i <= cm.state.doc.lines; i++) {
            const line = cm.state.doc.line(i);
            if (line.text.includes(text)) {
              target = line;
              break;
            }
          }
          if (!target) throw new Error(`no line containing "${text}"`);

          const built = plugin.buildDecorations(
            { visibleRanges: [{ from: target.from, to: target.to }] },
            cm.state
          );

          classes[text] = [];
          built.decorations.between(
            target.from,
            target.to,
            (_from: number, _to: number, deco: any) => {
              const cls = deco.spec?.attributes?.class;
              if (cls) classes[text].push(cls);
            }
          );
        }
        return classes;
      });

      for (const text of ['Grandchild', 'Back to parent', 'Loose child']) {
        expect(decorated[text].join(' ')).toContain('lc-list-callout-nested');
      }
    });

    it('takes the color away again when the preference is turned off', async function () {
      await setColorNestedItems(false);
      await browser.waitUntil(
        async () => !(await editorLines()).some((r) => r.nested),
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: 'a nested item stayed colored after the toggle',
        }
      );
      expect(pick(await editorLines(), 'Child one').data).toBeNull();
    });
  });

  describe('in reading view', function () {
    before(async function () {
      await ensureReadingMode();
      await browser.$('.markdown-preview-view li').waitForExist({
        timeout: 10000,
      });
    });

    after(async function () {
      await ensureEditingMode();
    });

    it('leaves nested items alone while the preference is off', async function () {
      const items = await readingItems();
      expect(items.some((i) => i.nested)).toBe(false);
      expect(pick(items, 'Child one').data).toBeNull();
      expect(pick(items, 'Child one').wrapped).toBe(false);
    });

    it("gives every item under the callout the callout's color", async function () {
      await setColorNestedItems(true);
      await rerenderReading();
      await browser.waitUntil(
        async () => (await readingItems()).some((i) => i.nested),
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: 'no nested item was colored after re-rendering',
        }
      );

      const items = await readingItems();
      const parent = pick(items, 'Parent');
      expect(parent.callout).toBe(true);

      for (const text of [
        'Child one',
        'Child two',
        'Grandchild',
        'Back to parent',
        'Loose child',
      ]) {
        const item = pick(items, text);
        expect(item.nested).toBe(true);
        expect(item.callout).toBe(false);
        expect(item.color).toBe(text === 'Loose child' ? pick(items, 'Loose parent').color : parent.color);
        expect(item.wrapped).toBe(true);
      }
      expect(pick(items, 'Child one').data).toBe('&');
      expect(pick(items, 'Loose child').data).toBe('$');

      const file = await captureRendering('nested-items-reading-mode');
      expect(file).toContain('nested-items-reading-mode');
    });

    it('lets a nested callout of its own take over for its subtree', async function () {
      const items = await readingItems();
      expect(pick(items, 'Own callout child').callout).toBe(true);
      expect(pick(items, 'Own callout child').nested).toBe(false);
      expect(pick(items, 'Under own callout').nested).toBe(true);
      expect(pick(items, 'Under own callout').data).toBe('?');
    });

    it('stops at the next item on the same level as the callout', async function () {
      const items = await readingItems();
      for (const text of ['Sibling', 'Nested under plain', 'Fresh list']) {
        expect(pick(items, text).nested).toBe(false);
        expect(pick(items, text).data).toBeNull();
      }
    });

    it('follows numbered and task list callouts', async function () {
      const items = await readingItems();
      expect(pick(items, 'Numbered child').data).toBe('!');
      expect(pick(items, 'Task child').data).toBe('@');
    });
  });

  describe('in the settings tab', function () {
    before(async function () {
      await setColorNestedItems(false);
      await openPluginSettings();
    });

    after(async function () {
      await closeSettings();
    });

    it('is flipped by its toggle', async function () {
      await clickToggleByName('Color nested items');
      expect(await getColorNestedItems()).toBe(true);

      await clickToggleByName('Color nested items');
      expect(await getColorNestedItems()).toBe(false);
    });
  });

  describe('persistence', function () {
    before(async function () {
      // A fresh Obsidian rather than resetVault: resetVault empties the
      // plugin's folder in the sandbox vault while the loaded plugin keeps
      // running, so once disabled it has no main.js to load again.
      await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
    });

    it('is read back from disk when the plugin reloads', async function () {
      await setColorNestedItems(true);
      await reloadPlugin();

      expect(await getColorNestedItems()).toBe(true);
    });

    it('defaults to off for data saved before the setting existed', async function () {
      await writePluginData(
        JSON.stringify({
          callouts: DEFAULT_SETTINGS,
          highlights: { enabled: true, requireSpace: true },
          hideBullets: false,
        })
      );
      await reloadPlugin();

      expect(await getColorNestedItems()).toBe(false);
    });
  });
});
