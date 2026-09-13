import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { captureRendering, openNote } from '../helpers';

/**
 * mgmeyers/obsidian-list-callouts#91: the background box's left offset is
 * tuned for a bullet's fixed width, so once an ordered list's marker grows
 * past a single digit (10., 11., ...) the reporter says the background
 * coverage looks uneven from item to item. This note reproduces that setup
 * -- every item from 1 through 11 is a callout -- so the captured rendering
 * can be inspected for the misalignment. The leading bullet item matches the
 * reporter's own screenshot, which included one line as a reference for what
 * the padding around the list marker should look like. The trailing task
 * items cover the checkbox marker too, which has its own, wider indent.
 */
describe('Callout background in a numbered list', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      const lines = [
        '- ! Item number 0',
        ...Array.from(
          { length: 11 },
          (_, i) => `${i + 1}. ! Item number ${i + 1}`
        ),
        '- [ ] ! Test',
        '- [x] ! Test',
      ];
      await app.vault.create('NumberedCallouts.md', `${lines.join('\n')}\n`);
    });
    await openNote('NumberedCallouts.md');
  });

  it('renders a callout for every item, single- and double-digit numbers alike', async function () {
    const count = await browser.executeObsidian(({ app }) => {
      return app.workspace.containerEl.querySelectorAll('.lc-list-callout')
        .length;
    });

    expect(count).toBe(14);
  });

  it('captures the rendering for visual inspection', async function () {
    const file = await captureRendering('numbered-list-callouts');
    expect(file).toContain('numbered-list-callouts');
  });
});

/**
 * A callout background's left offset used to be either a fixed constant
 * (uneven across marker widths, mgmeyers/obsidian-list-callouts#91) or a
 * flat 0 (correct for a top-level line, but for a nested one that reaches
 * all the way back through every ancestor's own indentation instead of
 * stopping at this item's own marker). Neither holds up once a callout
 * sits below other list items.
 */
describe('Callout background in a nested list', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        'NestedCallouts.md',
        '- Top level, no callout of its own\n\t- ! Nested once\n\t\t- ! Nested twice\n'
      );
    });
    await openNote('NestedCallouts.md');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });
  });

  it("starts each nested callout's background at its own marker, not its ancestors' indentation", async function () {
    const rows = await browser.executeObsidian(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          '.markdown-source-view .cm-line.lc-list-callout'
        )
      ).map((line) => {
        const bg = line.querySelector<HTMLElement>('.lc-list-bg');
        const marker = line.querySelector<HTMLElement>('.lc-list-marker');
        const bullet = line.querySelector<HTMLElement>('.list-bullet');
        const indentGuide = line.querySelector<HTMLElement>(
          '.cm-hmd-list-indent'
        );
        return {
          text: line.textContent,
          bgLeft: bg?.getBoundingClientRect().left,
          markerLeft: marker?.getBoundingClientRect().left,
          bulletLeft: bullet?.getBoundingClientRect().left,
          indentGuideRight: indentGuide?.getBoundingClientRect().right,
        };
      });
    });

    expect(rows.length).toBe(2);

    for (const row of rows) {
      expect(row.markerLeft).toBeDefined();
      expect(row.bulletLeft).toBeDefined();
      expect(row.indentGuideRight).toBeDefined();

      // Covers this item's own marker -- the point of #91's fix -- rather
      // than stopping short of it.
      expect(row.bgLeft).toBeLessThanOrEqual(row.markerLeft);
      // Never as far left as its ancestors' own indentation: the guide's own
      // right edge is exactly where "ancestor indent" gives way to "this
      // item," so the background may start at or after it, but never before.
      expect(row.bgLeft).toBeGreaterThanOrEqual(row.indentGuideRight - 0.5);
      // And never further right than the bullet itself -- halving its own
      // left inset (a hair of a gap before it, matching how a bullet
      // reference line looked before this fix existed) should narrow that
      // gap, not overshoot past the bullet and re-exclude it.
      expect(row.bgLeft).toBeLessThanOrEqual(row.bulletLeft + 0.5);
    }
  });
});
