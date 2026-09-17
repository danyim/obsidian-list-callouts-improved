import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import {
  captureRendering,
  ensureReadingMode,
  getSettings,
  openNote,
  setSettings,
} from '../helpers';

const BUILT_IN_CHARS = ['&', '?', '!', '~', '@', '$', '%'];

describe('Callout rendering', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await openNote('Callouts.md');
  });

  it('decorates every built-in character in live preview', async function () {
    const callouts = browser.$$('.lc-list-callout');
    await expect(callouts).toBeElementsArrayOfSize({
      gte: BUILT_IN_CHARS.length,
    });

    // Each decorated line carries its color as a custom property, which is
    // what the stylesheet keys off.
    const colors = await browser.executeObsidian(({ app }) => {
      return Array.from(
        app.workspace.containerEl.querySelectorAll('.lc-list-callout')
      ).map((el) =>
        (el as HTMLElement).style.getPropertyValue('--lc-callout-color')
      );
    });

    expect(colors.length).toBeGreaterThanOrEqual(BUILT_IN_CHARS.length);
    expect(colors.every((c: string) => c.trim().length > 0)).toBe(true);
  });

  it('renders a marker for each callout', async function () {
    const markers = browser.$$('.lc-list-marker');
    await expect(markers).toBeElementsArrayOfSize({
      gte: BUILT_IN_CHARS.length,
    });
  });

  it('leaves plain list items alone', async function () {
    // Two lines in the fixture must not be decorated: a plain item, and one
    // where the character is not followed by a space.
    const text = await browser.executeObsidian(({ app }) => {
      return Array.from(
        app.workspace.containerEl.querySelectorAll('.lc-list-callout')
      ).map((el) => el.textContent ?? '');
    });

    expect(text.some((t: string) => t.includes('Plain list item'))).toBe(false);
    expect(text.some((t: string) => t.includes('No space after'))).toBe(false);
  });

  it('captures a live preview rendering', async function () {
    const file = await captureRendering('live-preview');
    expect(file).toContain('live-preview');
  });

  describe('reading mode', function () {
    before(async function () {
      await browser.executeObsidianCommand('markdown:toggle-preview');
      await browser.$('.markdown-reading-view .lc-list-callout').waitForExist();
    });

    it('decorates callouts via the post processor', async function () {
      const chars = await browser.executeObsidian(({ app }) => {
        return Array.from(
          app.workspace.containerEl.querySelectorAll(
            '.markdown-reading-view .lc-list-callout'
          )
        ).map((el) => el.getAttribute('data-callout'));
      });

      for (const char of BUILT_IN_CHARS) {
        expect(chars).toContain(char);
      }
    });

    it('captures a reading mode rendering', async function () {
      const file = await captureRendering('reading-mode');
      expect(file).toContain('reading-mode');
    });
  });
});

/**
 * A loose list (one with a blank line between items, or inside one) renders
 * each item's text in a <p>, and a task item's checkbox goes inside that
 * <p> ahead of the text. The post-processor has to look past the checkbox
 * to find the callout character.
 */
describe('Task callouts in a loose list', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        'Loose.md',
        ['- [ ] & Loose task', '', '- & Loose bullet', ''].join('\n')
      );
    });
    await openNote('Loose.md');
    await ensureReadingMode();
    await browser.$('.markdown-reading-view .lc-list-callout').waitForExist();
  });

  it('decorates the task item in reading mode', async function () {
    const items = await browser.executeObsidian(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.markdown-reading-view li')
      ).map((li) => ({
        text: (li.textContent ?? '').trim(),
        callout: li.classList.contains('lc-list-callout'),
        marker: li.querySelector('.lc-list-marker')?.textContent ?? null,
        // The checkbox has to stay clickable, so it must survive the
        // rewrite that puts the marker in.
        checkbox: !!li.querySelector('input.task-list-item-checkbox'),
      }))
    );

    const task = items.find((i) => i.text.includes('Loose task'));
    expect(task).toMatchObject({ callout: true, marker: '&', checkbox: true });

    const bullet = items.find((i) => i.text.includes('Loose bullet'));
    expect(bullet).toMatchObject({ callout: true, marker: '&' });
  });
});

describe('Custom callout characters', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });

    await setSettings([
      ...(await getSettings()),
      { char: '(', color: '9, 9, 9', custom: true },
    ]);

    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        'Regex.md',
        '- ( Parenthesis callout\n- ) Not a callout\n'
      );
    });

    await openNote('Regex.md');
  });

  // '(' is a regex metacharacter. Without escaping, the character class built
  // in buildEditorConfig would either throw or match the wrong thing.
  it('treats a regex metacharacter as a literal', async function () {
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });

    const decorated = await browser.executeObsidian(({ app }) => {
      return Array.from(
        app.workspace.containerEl.querySelectorAll('.lc-list-callout')
      ).map((el) => el.textContent ?? '');
    });

    expect(
      decorated.some((t: string) => t.includes('Parenthesis callout'))
    ).toBe(true);
    expect(decorated.some((t: string) => t.includes('Not a callout'))).toBe(
      false
    );
  });

  it('builds a usable editor config for it', async function () {
    const ok = await browser.executeObsidian(({ app }) => {
      const p = (app as any).plugins.plugins['list-callouts-improved'];
      const config = p.buildEditorConfig();
      return config.re.test('- ( something');
    });

    expect(ok).toBe(true);
  });
});
