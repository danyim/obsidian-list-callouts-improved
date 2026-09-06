/**
 * Regenerates the README screenshots from a real Obsidian render.
 *
 * Run with `npm run screenshots`. Writes straight into screenshots/, so the
 * images in the README are always something the current code actually
 * produced rather than a picture inherited from the original plugin.
 */
import { browser } from '@wdio/globals';
import * as fs from 'fs/promises';
import { before, describe, it } from 'mocha';
import * as path from 'path';

import type { Callout } from '../../src/settings';
import { openNote, openPluginSettings, setSettings } from '../helpers';

const OUT_DIR = path.resolve('screenshots');

/** Height in pixels from a PNG's IHDR chunk. */
async function pngHeight(file: string): Promise<number> {
  const buf = await fs.readFile(file);
  return buf.readUInt32BE(20);
}

/** The default palette, kept in step with DEFAULT_SETTINGS. */
const COLORS: Record<string, string> = {
  '&': '255, 214, 0',
  '?': '255, 145, 0',
  '!': '255, 23, 68',
  '~': '124, 77, 255',
  '@': '0, 184, 212',
  $: '0, 200, 83',
  '%': '158, 158, 158',
};

/** Matches the icons the original screenshots used, under current Lucide ids. */
const ICONS: Record<string, string> = {
  '&': 'lucide-star',
  '?': 'lucide-circle-question-mark',
  '!': 'lucide-triangle-alert',
  '~': 'lucide-bookmark',
  '@': 'lucide-key',
  $: 'lucide-thumbs-up',
  '%': 'lucide-quote',
};

function callouts(withIcons: boolean): Callout[] {
  return Object.entries(COLORS).map(([char, color]) => ({
    char,
    color,
    ...(withIcons ? { icon: ICONS[char] } : {}),
  }));
}

/**
 * Capture the rendered note. The editor's sizer hugs its content, so the image
 * has no large empty area below the note and no window chrome around it.
 */
async function captureEditor(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const contentBottom = await browser.executeObsidian(() => {
    // Drop the caret: in live preview the line holding it renders as raw
    // markdown, which would show the callout character unstyled.
    (document.activeElement as HTMLElement)?.blur();
    window.getSelection()?.removeAllRanges();

    const sizer = document.querySelector<HTMLElement>(
      '.markdown-source-view .cm-sizer'
    );
    if (!sizer) return -1;

    // Breathing room, so the callout backgrounds do not sit flush against the
    // edge of the image.
    sizer.style.setProperty('padding', '20px', 'important');

    // Where the note actually ends, measured from the top of the captured
    // element. CodeMirror keeps the sizer at least as tall as the scroller, so
    // this is what decides whether the whole note made it into the image.
    const lines = document.querySelectorAll('.markdown-source-view .cm-line');
    const last = lines[lines.length - 1];
    if (!last) return -1;

    return Math.ceil(
      last.getBoundingClientRect().bottom - sizer.getBoundingClientRect().top
    );
  });

  await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });

  const content = browser.$('.markdown-source-view .cm-sizer');
  await content.waitForExist({ timeout: 10000 });

  const file = path.join(OUT_DIR, name);
  await content.saveScreenshot(file);

  // An element taller than the scroller is captured clipped, silently. Check
  // the note's last line landed inside the image rather than past its edge.
  const captured = await pngHeight(file);
  if (contentBottom < 0 || captured < contentBottom) {
    throw new Error(
      `${name} was clipped: captured ${captured}px, but the note runs to ${contentBottom}px. ` +
        'Run with a taller display.'
    );
  }
}

/**
 * Capture the plugin's settings tab.
 *
 * On Obsidian 1.13 desktop the settings tab opens in its own window, so the
 * screenshot has to be taken after switching to that window handle.
 */
async function captureSettings(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // The note captures use a larger font so the text reads well when scaled
  // down; the settings tab looks oversized at that size, so put it back.
  await browser.executeObsidian(({ app }) => {
    (app as any).vault.setConfig('baseFontSize', 16);
    (app as any).updateFontSize?.();
    app.workspace.trigger('css-change');
  });

  await openPluginSettings();

  const original = await browser.getWindowHandle();
  const handles = await browser.getWindowHandles();

  let captured = false;

  for (const handle of handles) {
    await browser.switchToWindow(handle);

    if (await browser.$('.lc-callout-container').isExisting()) {
      await browser.saveScreenshot(path.join(OUT_DIR, name));
      captured = true;
      break;
    }
  }

  await browser.switchToWindow(original);

  if (!captured) {
    throw new Error('Could not find a window showing the plugin settings');
  }
}

describe('README screenshots', function () {
  before(async function () {
    await browser.executeObsidian(({ app }) => {
      // Collapse both sidebars so the editor fills the captured area.
      (app as any).workspace.leftSplit?.collapse?.();
      (app as any).workspace.rightSplit?.collapse?.();

      // Bump the base font size rather than the window zoom: zoom leaves the
      // element's CSS box unchanged, so the screenshot ends up cropped to the
      // pre-zoom bounds. A larger font grows the box itself.
      (app as any).vault.setConfig('baseFontSize', 20);
      (app as any).updateFontSize?.();
      app.workspace.trigger('css-change');
    });

    await openNote('Callout Bullets.md');
  });

  it('captures the character rendering', async function () {
    await setSettings(callouts(false));
    await captureEditor('01.png');
  });

  it('captures the icon rendering', async function () {
    await setSettings(callouts(true));
    await captureEditor('02.png');
  });

  it('captures the settings tab', async function () {
    await setSettings(callouts(false));
    await captureSettings('03.png');
  });
});
