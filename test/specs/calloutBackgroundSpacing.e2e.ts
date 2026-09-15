import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

import { openNote } from '../helpers';

/**
 * #41: consecutive callouts in the editor painted as one unbroken block of
 * color, each band butting straight into the next, where reading mode (and
 * the original List Callouts) leave a sliver of the page between them.
 * Obsidian pads every list line top and bottom (`--list-spacing`), and the
 * band is supposed to stay inside that padding rather than cover it.
 */
describe('Callout background spacing in the editor', function () {
  before(async function () {
    await obsidianPage.resetVault();
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        'Spacing.md',
        '- & First\n- ? Second\n- ! Third\n1. ~ Fourth\n- [ ] @ Fifth\n'
      );
    });
    await openNote('Spacing.md');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });
  });

  it("keeps each band inside its line's own vertical padding", async function () {
    const rows = await browser.executeObsidian(() => {
      // The painted band is the widget's ::after, sized to its content box,
      // so the widget's own box minus its padding is where the color is.
      const inset = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          top: r.top + parseFloat(s.paddingTop),
          bottom: r.bottom - parseFloat(s.paddingBottom),
        };
      };

      return Array.from(
        document.querySelectorAll<HTMLElement>(
          '.markdown-source-view .cm-line.lc-list-callout'
        )
      ).map((line) => {
        const bg = line.querySelector<HTMLElement>('.lc-list-bg');
        return {
          text: line.textContent,
          line: inset(line),
          linePaddingTop: parseFloat(getComputedStyle(line).paddingTop),
          band: bg ? inset(bg) : null,
        };
      });
    });

    expect(rows.length).toBe(5);

    for (const row of rows) {
      expect(row.band).not.toBeNull();
      // Obsidian's own spacing between list items is what the band has to
      // respect; if a theme ever zeroed it there would be nothing to test.
      expect(row.linePaddingTop).toBeGreaterThan(0);

      expect(row.band.top).toBeGreaterThanOrEqual(row.line.top - 0.5);
      expect(row.band.bottom).toBeLessThanOrEqual(row.line.bottom + 0.5);
    }
  });

  it('leaves a gap between consecutive bands', async function () {
    const bands = await browser.executeObsidian(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          '.markdown-source-view .cm-line.lc-list-callout .lc-list-bg'
        )
      ).map((bg) => {
        const r = bg.getBoundingClientRect();
        const s = getComputedStyle(bg);
        return {
          top: r.top + parseFloat(s.paddingTop),
          bottom: r.bottom - parseFloat(s.paddingBottom),
        };
      });
    });

    expect(bands.length).toBe(5);

    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].top).toBeGreaterThan(bands[i - 1].bottom + 0.5);
    }
  });
});
