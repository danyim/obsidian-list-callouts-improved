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
import {
  openNote,
  openPluginSettings,
  setHighlights,
  setSettings,
} from '../helpers';

const OUT_DIR = path.resolve('screenshots');

/** Gutter between the two halves of a composite, in pixels. */
const GAP = 20;

/** Breathing room added around the captured editor content, in pixels. */
const EDITOR_PADDING = 20;

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
 * Switch the color scheme of whichever window is currently in focus.
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

      // Nothing is left transparent: the gap and whatever lies below the
      // shorter capture take on the background of the half they belong
      // to, so the seam sits in the middle and no viewer shows a
      // checkerboard.
      const cornerColor = (img: HTMLImageElement, x: number) => {
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        probe.getContext('2d').drawImage(img, x, 0, 1, 1, 0, 0, 1, 1);
        const [r, g, bl] = probe.getContext('2d').getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${bl})`;
      };

      const half = Math.floor(gap / 2);
      const mid = a.width + half;

      ctx.fillStyle = cornerColor(a, a.width - 1);
      ctx.fillRect(a.width, 0, half, canvas.height);
      ctx.fillRect(0, a.height, a.width, canvas.height - a.height);

      ctx.fillStyle = cornerColor(b, 0);
      ctx.fillRect(mid, 0, gap - half, canvas.height);
      ctx.fillRect(a.width + gap, b.height, b.width, canvas.height - b.height);

      return canvas.toDataURL('image/png').split(',')[1];
    },
    light,
    dark,
    GAP
  );

  return Buffer.from(encoded, 'base64');
}

/** Prepare the editor for capture and report where the note ends. */
async function prepareEditor(hideTitle = false): Promise<number> {
  return browser.executeObsidian(
    (_obsidian, shouldHideTitle: boolean, padding: number) => {
      // Drop the caret: in live preview the line holding it renders as raw
      // markdown, which would show the callout character unstyled.
      (document.activeElement as HTMLElement)?.blur();
      window.getSelection()?.removeAllRanges();

      const sizer = document.querySelector<HTMLElement>(
        '.markdown-source-view .cm-sizer'
      );
      if (!sizer) return -1;

      // Some captures crop tightly to a couple of list items, and the note's
      // filename sitting above them would be a distraction.
      if (shouldHideTitle) {
        document
          .querySelector<HTMLElement>('.markdown-source-view .inline-title')
          ?.style.setProperty('display', 'none');
      }

      // Breathing room, so the callout backgrounds do not sit flush against
      // the edge of the image.
      sizer.style.setProperty('padding', `${padding}px`, 'important');

      // Where the note actually ends, measured from the top of the captured
      // element. CodeMirror keeps the sizer at least as tall as the
      // scroller, so this is what decides whether the whole note made it
      // into the image.
      // The last block, not the last .cm-line: a table or callout at the end
      // of the note is a widget, not a line.
      const last = document.querySelector('.markdown-source-view .cm-content')
        ?.lastElementChild;
      if (!last) return -1;

      return Math.ceil(
        last.getBoundingClientRect().bottom - sizer.getBoundingClientRect().top
      );
    },
    hideTitle,
    EDITOR_PADDING
  );
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

/**
 * Base64 of the whole current viewport.
 *
 * Used instead of `shotElement` when the thing to capture -- a fixed-position
 * overlay like the icon picker -- can extend past the box of any element
 * that would sensibly anchor a crop, since an element screenshot clips there.
 */
async function shotViewport(label: string): Promise<string> {
  const tmp = path.join(OUT_DIR, `.tmp-${label}.png`);
  await browser.saveScreenshot(tmp);

  try {
    return (await fs.readFile(tmp)).toString('base64');
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

const EDITOR_SELECTOR = '.markdown-source-view .cm-sizer';

/**
 * Capture the editor, optionally cropped to the note's own content height.
 *
 * The sizer CodeMirror measures against is never shorter than the scroller,
 * so a short note (a handful of lines) otherwise screenshots as mostly blank
 * space below the last line. `cropToContent` trims that away, leaving
 * `contentBottom` plus the same breathing room the top padding already adds.
 */
async function captureEditor(
  name: string,
  hideTitle = false,
  cropToContent = false,
  readySelector = '.lc-list-callout'
): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await browser.$(readySelector).waitForExist({ timeout: 10000 });

  const contentBottom = await prepareEditor(hideTitle);

  await setColorScheme(false);
  let light = await shotElement(EDITOR_SELECTOR, 'light');

  await setColorScheme(true);
  let dark = await shotElement(EDITOR_SELECTOR, 'dark');

  await setColorScheme(false);

  if (cropToContent && contentBottom > 0) {
    const width = await browser.execute(() => {
      const sizer = document.querySelector<HTMLElement>(
        '.markdown-source-view .cm-sizer'
      );
      return sizer ? Math.ceil(sizer.getBoundingClientRect().width) : 0;
    });

    if (width > 0) {
      const rect = { x: 0, y: 0, width, height: contentBottom + EDITOR_PADDING };
      light = await cropToRect(light, rect);
      dark = await cropToRect(dark, rect);
    }
  }

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
/**
 * Open the plugin settings and switch to whichever window they render in.
 *
 * On Obsidian 1.13 desktop the settings tab opens in its own window, so
 * anything that looks at its DOM has to run against that window handle.
 */
async function enterSettingsWindow(): Promise<{
  pane: string;
  original: string;
}> {
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

  // The popout opens at whatever size Obsidian last used, which on macOS is
  // too small for the tab sidebar plus a 720px column. Ask for room; a tiling
  // window manager (the Linux capture setup) may decline, and there the
  // window already fills the screen. (The driver's own setWindowSize is not
  // implemented for Electron popouts, hence the DOM call.)
  await browser.execute(() => window.resizeTo(1280, 1000));
  await browser.pause(250);

  // Obsidian centers the settings column inside a much wider pane, which would
  // leave the image mostly empty background. Narrow the pane to the column --
  // or to what the window can show, if that is less: anything past the
  // window's edge is simply absent from a screenshot.
  await browser.execute((selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.style.setProperty('padding', '16px', 'important');

    const room = window.innerWidth - el.getBoundingClientRect().left - 16;
    const width = Math.min(720, room);
    el.style.setProperty('width', `${width}px`, 'important');
    el.style.setProperty('max-width', `${width}px`, 'important');
  }, pane);

  return { pane, original };
}

/** A pixel rect, relative to a capture's own top-left corner. */
interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop a base64-encoded PNG down to `rect`, returning base64 PNG data. */
async function cropToRect(data: string, rect: CropRect): Promise<string> {
  return browser.execute(
    async (data: string, r: CropRect) => {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('could not decode a capture'));
        image.src = `data:image/png;base64,${data}`;
      });

      // A requested rect taller or wider than the source (e.g. a content
      // height measured before the crop) would otherwise draw past the
      // image's edge, leaving blank canvas rather than failing loudly.
      const width = Math.max(1, Math.min(r.width, img.width - r.x));
      const height = Math.max(1, Math.min(r.height, img.height - r.y));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, r.x, r.y, width, height, 0, 0, width, height);

      return canvas.toDataURL('image/png').split(',')[1];
    },
    data,
    rect
  );
}

/**
 * Bounding box, in viewport pixels, that covers the first callout row and
 * whatever icon-picker menu is currently open on it.
 *
 * The menu is an absolutely positioned overlay that can extend past the
 * settings pane's own box, and an element screenshot of the pane clips
 * there -- so this is measured against the viewport instead, to line up
 * with a full-viewport capture.
 */
async function iconPickerCropRect(): Promise<CropRect> {
  return browser.execute(() => {
    const row = document.querySelector<HTMLElement>('.lc-setting');
    const menu = document.querySelector<HTMLElement>('.lc-menu');

    if (!row || !menu) {
      throw new Error(
        'Could not find the callout row and its open icon picker'
      );
    }

    const PAD = 16;
    const rowRect = row.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    const left = Math.max(Math.min(rowRect.left, menuRect.left) - PAD, 0);
    const top = Math.max(Math.min(rowRect.top, menuRect.top) - PAD, 0);
    const right = Math.min(
      Math.max(rowRect.right, menuRect.right) + PAD,
      window.innerWidth
    );
    const bottom = Math.min(
      Math.max(rowRect.bottom, menuRect.bottom) + PAD,
      window.innerHeight
    );

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  });
}

/** Capture the whole viewport in both color schemes, cropped to `crop`. */
async function captureBothSchemes(
  name: string,
  label: string,
  original: string,
  crop: CropRect
): Promise<void> {
  await setColorScheme(false);
  const light = await cropToRect(
    await shotViewport(`${label}-light`),
    crop
  );

  await setColorScheme(true);
  const dark = await cropToRect(await shotViewport(`${label}-dark`), crop);

  await setColorScheme(false);

  // Compose back in the main window, where the Obsidian globals live.
  await browser.switchToWindow(original);
  await fs.writeFile(path.join(OUT_DIR, name), await sideBySide(light, dark));
}

/** One viewport's worth of a scrolled pane, and the slice of it that is new. */
interface PaneSlice {
  data: string;
  /** CSS width of the shot, so the slice can be scaled to the image's pixels. */
  cssWidth: number;
  /** Where the not-yet-captured content starts in this shot, in CSS px. */
  y: number;
  height: number;
}

/**
 * Shoot a scrolling pane in full, however tall its content is.
 *
 * An element screenshot only ever shows the part of a scroller that is on
 * screen, and the window cannot be made taller than the display. So the pane
 * is scrolled one viewport at a time, shot at each stop, and only the strip
 * each stop newly reveals is kept -- the last stop overlaps the one before
 * it, since scrollTop clamps at the bottom.
 */
async function shotPaneScrolled(pane: string, label: string): Promise<string> {
  const metrics = () =>
    browser.execute((selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      return {
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        width: el.getBoundingClientRect().width,
      };
    }, pane);

  await browser.execute((selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);

    // Pin the pane's box inside the window. A box taller than the window
    // keeps its bottom rows below the edge, where scrolling never brings
    // them and an element shot never reaches, and every slice would come
    // out shorter than the clientHeight the stepping assumes.
    const height = window.innerHeight - el.getBoundingClientRect().top - 16;
    el.style.setProperty('height', `${height}px`, 'important');
    el.style.setProperty('max-height', `${height}px`, 'important');
    el.style.setProperty('overflow-y', 'auto', 'important');

    // The scrollbar thumb would otherwise be stitched in at a different
    // height in every slice.
    el.style.setProperty('scrollbar-width', 'none');
  }, pane);

  const slices: PaneSlice[] = [];
  let covered = 0;

  for (;;) {
    await browser.execute(
      (selector: string, top: number) => {
        document.querySelector<HTMLElement>(selector).scrollTop = top;
      },
      pane,
      covered
    );
    // Let the scroll and any repaint settle before measuring and shooting.
    await browser.pause(150);

    const m = await metrics();
    const data = await shotElement(pane, `${label}-${slices.length}`);
    const y = covered - m.scrollTop;

    slices.push({ data, cssWidth: m.width, y, height: m.clientHeight - y });
    covered = m.scrollTop + m.clientHeight;

    if (covered >= m.scrollHeight) break;
  }

  await browser.execute((selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    el.scrollTop = 0;
    el.style.removeProperty('scrollbar-width');
  }, pane);

  return stackVertically(slices);
}

/** Stitch pane slices top to bottom on a canvas, returning base64 PNG data. */
async function stackVertically(slices: PaneSlice[]): Promise<string> {
  return browser.execute(async (parts: PaneSlice[]) => {
    const load = (data: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('could not decode a capture'));
        img.src = `data:image/png;base64,${data}`;
      });

    const images = await Promise.all(parts.map((p) => load(p.data)));

    // A retina display shoots at more than one pixel per CSS pixel, so the
    // CSS-measured slice has to be scaled to the image's own pixels.
    const scaled = parts.map((p, i) => {
      const scale = images[i].width / p.cssWidth;
      return { img: images[i], y: p.y * scale, height: p.height * scale };
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(...scaled.map((s) => s.img.width));
    canvas.height = Math.ceil(scaled.reduce((sum, s) => sum + s.height, 0));

    const ctx = canvas.getContext('2d');
    let offset = 0;
    for (const { img, y, height } of scaled) {
      ctx.drawImage(img, 0, y, img.width, height, 0, offset, img.width, height);
      offset += height;
    }

    return canvas.toDataURL('image/png').split(',')[1];
  }, slices);
}

/** Capture the whole of the plugin's settings tab, in both color schemes. */
async function captureSettingsPage(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { pane, original } = await enterSettingsWindow();

  await setColorScheme(false);
  const light = await shotPaneScrolled(pane, 'settings-light');

  await setColorScheme(true);
  const dark = await shotPaneScrolled(pane, 'settings-dark');

  await setColorScheme(false);

  // Compose back in the main window, where the Obsidian globals live.
  await browser.switchToWindow(original);
  await fs.writeFile(path.join(OUT_DIR, name), await sideBySide(light, dark));
}

/**
 * Capture the settings tab with the icon picker open: the same rows as the
 * full-page shot plus the thing the rows lead to, which a picture explains
 * better than a sentence does.
 */
async function captureIconPicker(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { original } = await enterSettingsWindow();

  const opened = await browser.execute(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Set icon'
    );
    if (!button) return false;

    button.click();
    return true;
  });

  if (!opened) {
    await browser.switchToWindow(original);
    throw new Error('No "Set icon" button in the settings tab');
  }

  await browser
    .$('.lc-menu .lc-menu-icons .clickable-icon')
    .waitForExist({ timeout: 10000 });

  // `.vertical-tab-content` does not respond to scrollIntoView() here, so
  // the row is scrolled into view by setting scrollTop directly. Scroll
  // from the row's own top rather than the button's: the row also carries
  // the preview line and its label above the button, and the menu -- row
  // height plus menu height -- still comfortably fits under it. The margin
  // is wider than the crop's own padding to keep the row clear of the
  // popout window's title bar, which sits just above the viewport's origin.
  await browser.execute(() => {
    const row = document.querySelector<HTMLElement>('.lc-setting');
    const scrollParent = row?.closest<HTMLElement>('.vertical-tab-content');
    if (!row || !scrollParent) return;

    const PAD = 40;
    scrollParent.scrollTop = Math.max(
      scrollParent.scrollTop + row.getBoundingClientRect().top - PAD,
      0
    );
  });

  // The menu tracks the button's position only through a `scroll` listener
  // the plugin attaches after a short delay, which can still be pending
  // here -- and reading the button's rect for this in the same execute()
  // call as the scrollTop write above would still see its pre-scroll
  // position. So this is a separate round trip, repositioning the menu
  // directly from the button's now-settled rect instead of waiting on
  // that listener.
  await browser.execute(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Set icon'
    );
    const menu = document.querySelector<HTMLElement>('.lc-menu');
    if (!button || !menu) return;

    const parent = (menu.offsetParent as HTMLElement) ?? document.body;
    const parentRect = parent.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    menu.style.setProperty(
      'top',
      `${buttonRect.bottom - parentRect.top + 2}px`,
      'important'
    );
    menu.style.setProperty(
      'left',
      `${buttonRect.left - parentRect.left}px`,
      'important'
    );
  });

  const crop = await iconPickerCropRect();

  await captureBothSchemes(name, 'picker', original, crop);
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

    await openNote('List Callouts, Improved.md');

    // Pinned rather than inherited, so the images never depend on whatever
    // the capturing vault last saved.
    await setHighlights({ enabled: true, requireSpace: true });

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
    await captureEditor('callout-characters.png');
  });

  it('captures the icon rendering', async function () {
    // A handful of lines with the note title hidden and the shot cropped to
    // their height, so the focus stays on the icons rather than the whole
    // worked example or a mostly blank frame below it.
    await openNote('Icons.md');
    await setSettings(callouts(true));
    await captureEditor('callout-icons.png', true, true);
  });

  it('captures the highlight rendering', async function () {
    // One prose paragraph, cropped to its height, with icons on so the
    // picture shows the marker giving way to the callout's icon.
    await openNote('Highlights.md');
    await setSettings(callouts(true));
    await captureEditor('highlights.png', true, true, '.lc-highlight-callout');
  });

  it('captures the multi-line highlight rendering', async function () {
    // Obsidian pairs an opener with the next `==` wherever it falls, so a
    // highlight can cross a line break, even between list items; and callout
    // blocks and tables render through the post-processor. Wait for the
    // table, the last of these to draw.
    await openNote('Multi-line highlight.md');
    await setSettings(callouts(true));
    await captureEditor(
      'highlight-multiline.png',
      true,
      true,
      '.markdown-source-view table .lc-highlight-callout'
    );
  });

  it('captures the whole settings tab', async function () {
    await setSettings(callouts(false));
    await captureSettingsPage('settings.png');
  });

  it('captures the settings tab with the icon picker open', async function () {
    await setSettings(callouts(false));
    await captureIconPicker('settings-icon-picker.png');
  });
});
