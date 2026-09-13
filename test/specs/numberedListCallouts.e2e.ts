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
 * the padding around the list marker should look like.
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
        '- [ ] Test',
        '- [x] Test',
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

    expect(count).toBe(12);
  });

  it('captures the rendering for visual inspection', async function () {
    const file = await captureRendering('numbered-list-callouts');
    expect(file).toContain('numbered-list-callouts');
  });
});
