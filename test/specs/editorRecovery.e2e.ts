import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';

import { openNote } from '../helpers';

/**
 * Whether CodeMirror still has our view plugin running in the active editor.
 *
 * CodeMirror disables a view plugin that throws from its constructor or
 * update, for the rest of that editor's life, and `EditorView.plugin()` then
 * answers null for it. The plugin this one was forked from died this way when
 * its parse budget ran out -- opening a vault with a long note restored,
 * jumping deep into a large document -- and every callout in the note stayed
 * gone until the plugin was toggled off and on
 * (mgmeyers/obsidian-list-callouts#73, #75, #80).
 */
function extensionRunning(): Promise<boolean> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const cm = (view.editor as any).cm;
    const plugin = (app as any).plugins.plugins['list-callouts-improved'];
    return cm.plugin(plugin.editorViewPlugin) !== null;
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

/** Type a character at the start of the document and take it back out. */
async function editDocument(): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const cm = (view.editor as any).cm;
    cm.dispatch({ changes: { from: 0, insert: 'x' } });
    cm.dispatch({ changes: { from: 0, to: 1 } });
  });
}

/**
 * Make every decoration build throw, or put the real one back.
 *
 * The view plugin's `build` is patched on its prototype, reached through the
 * running instance CodeMirror hands back, so the failure lands inside the
 * extension exactly where a bug in the builder would. The prototype is kept
 * from the patching call: by the time it is restored, the instance may be
 * gone -- that it is not is the point of the test, but a failing test should
 * say so rather than trip here.
 */
async function setBuildFailing(failing: boolean): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }, fail) => {
    const plugin = (app as any).plugins.plugins['list-callouts-improved'];

    if (fail) {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      const cm = (view.editor as any).cm;
      const proto = Object.getPrototypeOf(cm.plugin(plugin.editorViewPlugin));
      plugin.__patchedBuild = { proto, original: proto.build };
      proto.build = () => {
        throw new Error('simulated builder failure');
      };
    } else if (plugin.__patchedBuild) {
      const { proto, original } = plugin.__patchedBuild;
      proto.build = original;
      delete plugin.__patchedBuild;
    }
  }, failing);
}

async function waitForCallouts(where: string): Promise<void> {
  await browser.waitUntil(async () => (await renderedInViewport()) > 0, {
    timeout: 15000,
    interval: 250,
    timeoutMsg: `no callouts rendered ${where}`,
  });
}

describe('The editor extension', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'test/vaults/callouts' });
  });

  it('keeps running after a jump past the parsed region of a large document', async function () {
    // Large enough that parsing to the end takes well over the 50ms budget
    // the forked-from plugin allowed itself, which is what its crash needed.
    await browser.executeObsidian(async ({ app }) => {
      const chars = ['&', '?', '!', '~', '@', '$', '%'];
      const out: string[] = [];

      for (let section = 0; section < 1500; section++) {
        out.push(`## Section ${section}`, '');
        out.push('Prose between the lists, so the parser has real work to do.');
        out.push('');

        for (let item = 0; item < 12; item++) {
          out.push(
            item % 3 === 0
              ? `- ${chars[item % chars.length]} Callout ${section}.${item}`
              : `- Plain list item ${section}.${item}`
          );
        }

        out.push('');
      }

      await app.vault.create('Huge.md', out.join('\n'));
    });

    await openNote('Huge.md');
    await waitForCallouts('at the top of the document');
    expect(await extensionRunning()).toBe(true);

    const lines = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      return (view.editor as any).cm.state.doc.lines as number;
    });
    expect(lines).toBeGreaterThan(20000);

    await jumpToLine(Math.floor(lines * 0.98));
    await waitForCallouts('near the end of the document');
    expect(await extensionRunning()).toBe(true);

    await jumpToLine(1);
    await waitForCallouts('back at the top of the document');
    expect(await extensionRunning()).toBe(true);
  });

  it('survives a build that throws, and decorates again once it stops', async function () {
    await openNote('Callouts.md');
    await waitForCallouts('in the fixture note');
    expect(await extensionRunning()).toBe(true);

    await setBuildFailing(true);
    try {
      await editDocument();

      // The failing build leaves the update undecorated rather than taking
      // the extension down with it.
      expect(await renderedInViewport()).toBe(0);
      expect(await extensionRunning()).toBe(true);
    } finally {
      await setBuildFailing(false);
    }

    await editDocument();
    await waitForCallouts('after the builder recovered');
    expect(await extensionRunning()).toBe(true);
  });
});
