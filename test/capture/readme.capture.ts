/**
 * Regenerates the README screenshots from a real Obsidian render.
 *
 * Run with `npm run screenshots`. Writes straight into screenshots/, so the
 * images in the README are always something the current code actually
 * produced rather than a picture inherited from the original plugin.
 *
 * Each image is a composite: the same view rendered in light mode on the left
 * and dark mode on the right.
 */
import { browser } from '@wdio/globals';
import * as fs from 'fs/promises';
import { before, describe, it } from 'mocha';
import * as path from 'path';

import type { Callout } from '../../src/settings';
import { openNote, openPluginSettings, setSettings } from '../helpers';

const OUT_DIR = path.resolve('screenshots');

/** Gutter between the two halves of a composite, in pixels. */
const GAP = 20;

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
 * Switch the colour scheme of whichever window is currently in focus.
 *
 * The theme-dark and theme-light body classes are what drive Obsidian's CSS
 * variables, and toggling them works in a popout window too, where the app
 * globals may not be reachable.
 */
async function setColorScheme(dark: boolean): Promise<void> {
  await browser.execute((isDark: boolean) => {
    document.body.classList.toggle('theme-dark', isDark);
    document.body.classList.toggle('theme-light', !isDark);
  }, dark);

  // Let the repaint settle before the screenshot.
  await browser.pause(250);
}

/**
 * Stitch two captures side by side on a canvas.
 *
 * Done in the page rather than with an image library so `npm run screenshots`
 * needs nothing beyond what the tests already install. A canvas is also not
 * bound by the window size, which a screenshot of a composed element would be.
 */
async function sideBySide(light: string, dark: string): Promise<Buffer> {
  const encoded = await browser.executeObsidian(
    async (_obsidian, lightData: string, darkData: string, gap: number) => {
      const load = (data: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('could not decode a capture'));
          img.src = `data:image/png;base64,${data}`;
        });

      const [a, b] = await Promise.all([load(lightData), load(darkData)]);

      const canvas = document.createElement('canvas');
      canvas.width = a.width + gap + b.width;
      canvas.height = Math.max(a.height, b.height);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(a, 0, 0);
      ctx.drawImage(b, a.width + gap, 0);

      return canvas.toDataURL('image/png').split(',')[1];
    },
    light,
    dark,
    GAP
  );

  return Buffer.from(encoded, 'base64');
}

/** Prepare the editor for capture and report where the note ends. */
async function prepareEditor(): Promise<number> {
  return browser.executeObsidian(() => {
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
}

/**
 * Base64 of an element crop.
 *
 * Goes via a file because element.takeScreenshot() hands back the whole
 * viewport here rather than the element's box, while saveScreenshot crops
 * correctly.
 */
async function shotElement(selector: string, label: string): Promise<string> {
  const el = browser.$(selector);
  await el.waitForExist({ timeout: 10000 });

  const tmp = path.join(OUT_DIR, `.tmp-${label}.png`);
  await el.saveScreenshot(tmp);

  try {
    return (await fs.readFile(tmp)).toString('base64');
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

const EDITOR_SELECTOR = '.markdown-source-view .cm-sizer';

async function captureEditor(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await browser.$('.lc-list-callout').waitForExist({ timeout: 10000 });

  const contentBottom = await prepareEditor();

  await setColorScheme(false);
  const light = await shotElement(EDITOR_SELECTOR, 'light');

  await setColorScheme(true);
  const dark = await shotElement(EDITOR_SELECTOR, 'dark');

  await setColorScheme(false);

  const file = path.join(OUT_DIR, name);
  await fs.writeFile(file, await sideBySide(light, dark));

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

/** The settings pane holding the plugin's own rows, without the tab sidebar. */
async function settingsPane(): Promise<string> {
  // Inner content first: the outer container carries wide empty margins and
  // the scrollbar gutter.
  const candidates = [
    '.vertical-tab-content',
    '.vertical-tab-content-container',
    '.modal-content .vertical-tab-content',
  ];

  for (const selector of candidates) {
    if (await browser.$(selector).isExisting()) return selector;
  }

  throw new Error(
    `None of these matched the settings pane: ${candidates.join(', ')}`
  );
}

/**
 * Capture the plugin's settings tab, without the list of setting categories
 * down the left.
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

  let found = false;

  for (const handle of handles) {
    await browser.switchToWindow(handle);
    if (await browser.$('.lc-callout-container').isExisting()) {
      found = true;
      break;
    }
  }

  if (!found) {
    await browser.switchToWindow(original);
    throw new Error('Could not find a window showing the plugin settings');
  }

  const pane = await settingsPane();

  // Obsidian centres the settings column inside a much wider pane, which would
  // leave the image mostly empty background. Narrow the pane to the column.
  await browser.execute((selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.style.setProperty('width', '720px', 'important');
    el.style.setProperty('max-width', '720px', 'important');
    el.style.setProperty('padding', '16px', 'important');
  }, pane);

  await setColorScheme(false);
  const light = await shotElement(pane, 'settings-light');

  await setColorScheme(true);
  const dark = await shotElement(pane, 'settings-dark');

  await setColorScheme(false);

  // Compose back in the main window, where the Obsidian globals live.
  await browser.switchToWindow(original);
  await fs.writeFile(path.join(OUT_DIR, name), await sideBySide(light, dark));
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

    // The vault asks for Inter so the images do not depend on whatever the
    // capturing machine happens to default to. Fail loudly rather than
    // quietly producing screenshots in a different typeface.
    const font = await browser.executeObsidian(() => {
      const line = document.querySelector('.markdown-source-view .cm-line');
      return {
        installed: document.fonts.check('16px Inter'),
        family: getComputedStyle(line ?? document.body).fontFamily,
      };
    });

    if (!font.installed || !/inter/i.test(font.family)) {
      throw new Error(
        `Screenshots need the Inter font. Resolved family: ${font.family}. ` +
          'Install it with: sudo apt-get install fonts-inter'
      );
    }
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
