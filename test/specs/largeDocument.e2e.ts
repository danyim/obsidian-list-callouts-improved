import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import { openNote } from '../helpers';

const DEEP_LINE = 13000;

/**
 * Lines on screen that should end up decorated: ones matching the plugin's own
 * pattern, minus the fixture's code-block line, which looks like a callout but
 * must not be treated as one.
 */
function expectedInViewport(): Promise<number> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const cm = (view.editor as any).cm;
    const re = (app as any).plugins.plugins[
      'callout-bullets'
    ].buildEditorConfig().re;

    let count = 0;

    for (const { from, to } of cm.visibleRanges) {
      const first = cm.state.doc.lineAt(from).number;
      const last = cm.state.doc.lineAt(to).number;
      for (let i = first; i <= last; i++) {
        const text = cm.state.doc.line(i).text;
        if (re.test(text) && !text.includes('inside code')) count++;
      }
    }

    return count;
  });
}

function renderedInViewport(): Promise<number> {
  return browser.executeObsidian(({ app }) => {
    return app.workspace.containerEl.querySelectorAll('.lc-list-callout')
      .length;
  });
}

async function jumpToLine(line: number): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }, target) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const cm = (view.editor as any).cm;
    cm.dispatch({
      selection: { anchor: cm.state.doc.line(target).from },
      scrollIntoView: true,
    });
    cm.measure();
  }, line);
}

/**
 * Wait until every callout on screen is decorated.
 *
 * Both sides are re-measured on each poll: scrollIntoView settles over a frame
 * or two, so a count taken once up front can describe a different viewport
 * than the one being rendered.
 */
async function waitForDecorated(where: string): Promise<void> {
  let last = '';

  await browser.waitUntil(
    async () => {
      const expected = await expectedInViewport();
      const rendered = await renderedInViewport();
      last = `expected at least ${expected}, saw ${rendered}`;
      return expected > 0 && rendered >= expected;
    },
    {
      timeout: 15000,
      interval: 250,
      timeoutMsg: `callouts missing ${where}: ${last}`,
    }
  );
}

describe('A large document', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });

    // Built here rather than committed: a few hundred KB of generated prose is
    // not worth carrying in the repository.
    await browser.executeObsidian(async ({ app }) => {
      const chars = ['&', '?', '!', '~', '@', '$', '%'];
      const out: string[] = [];

      for (let section = 0; section < 400; section++) {
        out.push(`## Section ${section}`, '');
        out.push(
          'Prose between the lists, so the parser has real work to do.',
          ''
        );

        for (let item = 0; item < 12; item++) {
          out.push(
            item % 3 === 0
              ? `- ${chars[item % chars.length]} Callout ${section}.${item} with enough text that it wraps`
              : `- Plain list item ${section}.${item}`
          );
          out.push(`\t- nested detail ${section}.${item}`);
        }

        out.push(
          '',
          '```js',
          '// a fenced block',
          '- ! this line is inside code, not a callout',
          'const x = 1;',
          '```',
          ''
        );
      }

      await app.vault.create('Large.md', out.join('\n'));
    });

    await openNote('Large.md');
    await browser.$('.lc-list-callout').waitForExist({ timeout: 30000 });
  });

  it('is long enough to outrun the parser', async function () {
    const lines = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      return (view.editor as any).cm.state.doc.lines as number;
    });

    expect(lines).toBeGreaterThan(DEEP_LINE);
  });

  it('decorates callouts at the top', async function () {
    const rendered = await renderedInViewport();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBe(await expectedInViewport());
  });

  it('leaves list-shaped lines inside a code block alone', async function () {
    const decorated = await browser.executeObsidian(({ app }) => {
      return Array.from(
        app.workspace.containerEl.querySelectorAll('.lc-list-callout')
      ).some((el) => (el.textContent ?? '').includes('inside code'));
    });

    expect(decorated).toBe(false);
  });

  // The reason this suite exists: jumping past the parsed region used to leave
  // every callout undecorated, and it stayed that way until the document was
  // edited.
  //
  // The count can exceed the expected one here. Past the parsed region there is
  // no syntax tree to rule out a list-shaped line inside a code block, so the
  // fixture's fenced line may be decorated until the parser catches up and the
  // next rebuild drops it. Showing a callout slightly too eagerly beats showing
  // none at all.
  it('decorates callouts far past the parsed region', async function () {
    await jumpToLine(DEEP_LINE);
    await waitForDecorated(`near line ${DEEP_LINE}`);
  });

  it('keeps decorating as the viewport moves around', async function () {
    for (const line of [6500, 200, 11000, 3000]) {
      await jumpToLine(line);
      await waitForDecorated(`near line ${line}`);
    }
  });
});
