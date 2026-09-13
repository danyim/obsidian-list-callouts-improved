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
import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import { before, describe, it } from 'mocha';
import * as path from 'path';

import type { Callout } from '../../src/settings';
import {
  editorText,
  openNote,
  openPluginSettings,
  reloadPlugin,
  setEditorText,
  setHighlights,
  setSettings,
  writeLegacyData,
} from '../helpers';

const OUT_DIR = path.resolve('screenshots');

/** Gutter between the two halves of a composite, in pixels. */
const GAP = 20;

/** Breathing room added around the captured editor content, in pixels. */
const EDITOR_PADDING = 20;

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

/** Where the sizer sits in the scroller, and where the note's content ends. */
interface EditorFrame {
  /** Sizer's box, in CSS px, relative to the scroller. */
  left: number;
  top: number;
  width: number;
  /** Bottom of the last block, in CSS px from the top of the sizer. */
  contentBottom: number;
}

/** Prepare the editor for capture and report how to frame it. */
async function prepareEditor(hideTitle = false): Promise<EditorFrame> {
  return browser.executeObsidian(
    (_obsidian, shouldHideTitle: boolean, padding: number) => {
      // Drop the caret: in live preview the line holding it renders as raw
      // markdown, which would show the callout character unstyled.
      (document.activeElement as HTMLElement)?.blur();
      window.getSelection()?.removeAllRanges();

      const scroller = document.querySelector<HTMLElement>(
        '.markdown-source-view .cm-scroller'
      );
      const sizer = document.querySelector<HTMLElement>(
        '.markdown-source-view .cm-sizer'
      );
      if (!scroller || !sizer) {
        throw new Error('No editor on screen to capture');
      }

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

      scroller.scrollTop = 0;
      const scrollerRect = scroller.getBoundingClientRect();
      const sizerRect = sizer.getBoundingClientRect();

      // The last block, not the last .cm-line: a table or callout at the end
      // of the note is a widget, not a line.
      const last = document.querySelector(
        '.markdown-source-view .cm-content'
      )?.lastElementChild;
      if (!last) throw new Error('The note has no content to capture');

      return {
        left: Math.floor(sizerRect.left - scrollerRect.left),
        top: Math.floor(sizerRect.top - scrollerRect.top),
        width: Math.ceil(sizerRect.width),
        contentBottom: Math.ceil(
          last.getBoundingClientRect().bottom - sizerRect.top
        ),
      };
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

const EDITOR_SCROLLER = '.markdown-source-view .cm-scroller';

/**
 * Capture the editor, optionally cropped to the note's own content height.
 *
 * The scroller is shot in scrolled slices, so a note taller than the window
 * still comes out whole. The sizer CodeMirror measures against is never
 * shorter than the scroller, so a short note (a handful of lines) otherwise
 * captures as mostly blank space below the last line. `cropToContent` trims
 * that away, leaving `contentBottom` plus the same breathing room the top
 * padding already adds.
 */
async function captureEditor(
  name: string,
  hideTitle = false,
  cropToContent = false,
  readySelector = '.lc-list-callout'
): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(OUT_DIR, name),
    await editorComposite(hideTitle, cropToContent, readySelector)
  );
}

/** The light/dark composite of the editor, for `captureEditor` or stacking. */
async function editorComposite(
  hideTitle: boolean,
  cropToContent: boolean,
  readySelector: string
): Promise<Buffer> {
  await browser.$(readySelector).waitForExist({ timeout: 10000 });

  const frame = await prepareEditor(hideTitle);

  await setColorScheme(false);
  let light = await shotScrolled(EDITOR_SCROLLER, 'light');

  await setColorScheme(true);
  let dark = await shotScrolled(EDITOR_SCROLLER, 'dark');

  await setColorScheme(false);

  // Frame to the sizer -- the readable column, not the scroller's full width
  // -- and to the content when asked. cropToRect clamps to the image, so an
  // over-tall height keeps the whole stitched height.
  const rect = {
    x: frame.left,
    y: frame.top,
    width: frame.width,
    height: cropToContent
      ? frame.contentBottom + EDITOR_PADDING
      : Number.MAX_SAFE_INTEGER,
  };
  light = await cropToRect(light, rect);
  dark = await cropToRect(dark, rect);

  return sideBySide(light, dark);
}

/**
 * Stack two composites, one above the other.
 *
 * For a picture of the same note under two settings -- the highlights with
 * characters and then with icons -- so the two renderings sit together in one
 * image rather than as two that differ only in their markers. The gap takes
 * the light and dark backgrounds of the halves above it, so the seam between
 * the two schemes runs straight through.
 */
async function stacked(top: Buffer, bottom: Buffer): Promise<Buffer> {
  const encoded = await browser.executeObsidian(
    async (_obsidian, topData: string, bottomData: string, gap: number) => {
      const load = (data: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('could not decode a capture'));
          img.src = `data:image/png;base64,${data}`;
        });

      const [a, b] = await Promise.all([load(topData), load(bottomData)]);

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(a.width, b.width);
      canvas.height = a.height + gap + b.height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(a, 0, 0);
      ctx.drawImage(b, 0, a.height + gap);

      // Each composite is a light half and a dark half of equal width, so
      // the gap is painted from the bottom edge of the top image: its left
      // corner color across the left half, its right corner color across
      // the rest.
      const cornerColor = (img: HTMLImageElement, x: number, y: number) => {
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        probe.getContext('2d').drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
        const [r, g, bl] = probe.getContext('2d').getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${bl})`;
      };

      const mid = Math.floor(canvas.width / 2);

      ctx.fillStyle = cornerColor(a, 0, a.height - 1);
      ctx.fillRect(0, a.height, mid, gap);

      ctx.fillStyle = cornerColor(a, a.width - 1, a.height - 1);
      ctx.fillRect(mid, a.height, canvas.width - mid, gap);

      return canvas.toDataURL('image/png').split(',')[1];
    },
    top.toString('base64'),
    bottom.toString('base64'),
    GAP
  );

  return Buffer.from(encoded, 'base64');
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
    // The tooltip, when one is up, hangs below the hovered icon and can
    // reach past the menu's bottom edge.
    const rects = [row, menu, document.querySelector('.tooltip')]
      .filter((el) => !!el)
      .map((el) => el.getBoundingClientRect());

    const left = Math.max(Math.min(...rects.map((r) => r.left)) - PAD, 0);
    const top = Math.max(Math.min(...rects.map((r) => r.top)) - PAD, 0);
    const right = Math.min(
      Math.max(...rects.map((r) => r.right)) + PAD,
      window.innerWidth
    );
    const bottom = Math.min(
      Math.max(...rects.map((r) => r.bottom)) + PAD,
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
  const light = await cropToRect(await shotViewport(`${label}-light`), crop);

  await setColorScheme(true);
  const dark = await cropToRect(await shotViewport(`${label}-dark`), crop);

  await setColorScheme(false);

  // Compose back in the main window, where the Obsidian globals live.
  await browser.switchToWindow(original);
  await fs.writeFile(path.join(OUT_DIR, name), await sideBySide(light, dark));
}

/** One viewport's worth of a scrolled element, and the slice of it that is new. */
interface PaneSlice {
  data: string;
  /** CSS width of the shot, so the slice can be scaled to the image's pixels. */
  cssWidth: number;
  /** Where the not-yet-captured content starts in this shot, in CSS px. */
  y: number;
  height: number;
}

/** Marks the element being scrolled and shot, so each round trip finds it. */
const SCROLLER_ATTR = 'data-lc-capture-scroller';

/**
 * Height, in CSS px, left out of the bottom of every slice. Whatever floats
 * over the bottom of a window -- Obsidian's status bar, today -- never makes
 * it into a capture, without having to know what it is.
 */
const SLICE_INSET = 48;

/**
 * Shoot scrolling content in full, however tall it is and however small the
 * window.
 *
 * The scroll container is found from `anchor` -- the nearest ancestor that
 * scrolls, or failing that the nearest one allowed to. An element screenshot
 * only ever shows the part of it inside the window, so the content is shot
 * one window at a time and the slices stacked.
 *
 * Each slice begins exactly where the previous one ended: the container is
 * padded by a window's worth at the bottom first, so scrolling never clamps
 * short of the content and there is no overlap to subtract -- a seam a pixel
 * off doubles a line of text. The padding is trimmed from the result.
 */
async function shotScrolled(anchor: string, label: string): Promise<string> {
  const contentHeight = await browser.execute(
    (selector: string, attr: string) => {
      const scrolls = (el: HTMLElement) =>
        /(auto|scroll)/.test(getComputedStyle(el).overflowY);

      let found: HTMLElement | null = null;
      for (
        let el = document.querySelector<HTMLElement>(selector);
        el;
        el = el.parentElement
      ) {
        if (scrolls(el) && el.scrollHeight > el.clientHeight + 1) {
          found = el;
          break;
        }
        if (!found && scrolls(el)) found = el;
      }

      const scroller = found ?? document.querySelector<HTMLElement>(selector);
      const height = scroller.scrollHeight;

      scroller.setAttribute(attr, '');
      // The scrollbar thumb would otherwise be stitched in at a different
      // height in every slice.
      scroller.style.setProperty('scrollbar-width', 'none');
      scroller.style.setProperty(
        'padding-bottom',
        `${window.innerHeight}px`,
        'important'
      );

      return height;
    },
    anchor,
    SCROLLER_ATTR
  );

  const scrollerSelector = `[${SCROLLER_ATTR}]`;

  const slices: PaneSlice[] = [];
  let covered = 0;

  while (covered < contentHeight) {
    const m = await browser.execute(
      (selector: string, target: number, inset: number) => {
        const el = document.querySelector<HTMLElement>(selector);

        // Put content offset `target` at the top of the on-screen part of the
        // box, which is the box's own top unless that sits above the window.
        const above = Math.max(0, -el.getBoundingClientRect().top);
        el.scrollTop = target - above;

        const r = el.getBoundingClientRect();
        const visTop = Math.max(r.top, 0);
        const visBottom = Math.min(r.bottom, window.innerHeight - inset);
        const visLeft = Math.max(r.left, 0);
        const visRight = Math.min(r.right, window.innerWidth);

        // Rects are fractional; the screenshot is not.
        return {
          shownFrom: Math.round(el.scrollTop + (visTop - r.top)),
          shotHeight: Math.round(visBottom - visTop),
          shotWidth: Math.round(visRight - visLeft),
        };
      },
      scrollerSelector,
      covered,
      SLICE_INSET
    );
    // Let the scroll and any repaint settle before shooting.
    await browser.pause(150);

    const y = covered - m.shownFrom;
    const height = Math.min(m.shotHeight - y, contentHeight - covered);
    if (height <= 0) {
      throw new Error(
        `Could not scroll ${anchor} past ${covered}px of ${contentHeight}px`
      );
    }

    const data = await shotElement(
      scrollerSelector,
      `${label}-${slices.length}`
    );
    slices.push({ data, cssWidth: m.shotWidth, y, height });
    covered += height;
  }

  await browser.execute(
    (selector: string, attr: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      el.scrollTop = 0;
      el.style.removeProperty('scrollbar-width');
      el.style.removeProperty('padding-bottom');
      el.removeAttribute(attr);
    },
    scrollerSelector,
    SCROLLER_ATTR
  );

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
  const light = await shotScrolled(pane, 'settings-light');

  await setColorScheme(true);
  const dark = await shotScrolled(pane, 'settings-dark');

  await setColorScheme(false);

  // Compose back in the main window, where the Obsidian globals live.
  await browser.switchToWindow(original);
  await fs.writeFile(path.join(OUT_DIR, name), await sideBySide(light, dark));
}

/**
 * Capture the settings tab with the icon picker open: the same rows as the
 * full-page shot plus the thing the rows lead to, which a picture explains
 * better than a sentence does. With `hover`, the pointer is parked on that
 * icon so its tooltip is in the picture too.
 */
async function captureIconPicker(name: string, hover?: string): Promise<void> {
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

  if (hover) {
    // A real pointer move, which is what the tooltip answers to. It stays
    // put across the two color-scheme shots, and so does the tooltip.
    await browser
      .$(`.lc-menu .lc-menu-icons .clickable-icon[data-icon="${hover}"]`)
      .moveTo();
    await browser.$('.tooltip').waitForExist({ timeout: 5000 });
  }

  const crop = await iconPickerCropRect();

  await captureBothSchemes(name, 'picker', original, crop);
}

/**
 * Base64 of the whole virtual display, not just the page.
 *
 * For what lives outside the page: a color input's picker is a window of
 * Chromium's own, which no DOM screenshot includes. Linux only, like the
 * rest of the capture setup (`scripts/xvfb-wm.sh` provides DISPLAY), and
 * needs ffmpeg for its x11grab input.
 */
async function shotDisplay(
  label: string,
  width: number,
  height: number
): Promise<string> {
  const display = process.env.DISPLAY;
  if (!display) {
    throw new Error('Capturing the display needs DISPLAY (run under Xvfb)');
  }

  const tmp = path.join(OUT_DIR, `.tmp-${label}.png`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'x11grab',
    '-draw_mouse',
    '0',
    '-video_size',
    `${width}x${height}`,
    '-i',
    display,
    '-frames:v',
    '1',
    tmp,
  ]);

  try {
    return (await fs.readFile(tmp)).toString('base64');
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/**
 * How big Chromium draws the popup for an <input type="color">, in CSS px,
 * and where: hanging from the input's bottom-left corner. It is not in the
 * page, so there is no rect to read; this is measured from a capture.
 */
const COLOR_POPUP = { width: 236, height: 254, gap: 2 };

/** Which of a callout row's two color inputs a capture opens. */
type ColorInput = 'lc-color' | 'lc-marker-color';

/**
 * Capture the first callout's row with one of its color pickers open.
 *
 * The picker is a separate window, so the display is grabbed rather than
 * the page, and the settings window is made fullscreen first: that way a
 * point in the grab is the same point in the viewport, and the row's own
 * rect says where to crop. Fullscreen also leaves room under the row, so
 * the popup opens below the input rather than over the row.
 */
async function captureColorPicker(
  name: string,
  input: ColorInput
): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { original } = await enterSettingsWindow();

  // Through @electron/remote, which Obsidian exposes to its renderer: the
  // driver's own window commands are not implemented for Electron popouts.
  const setFullScreen = (on: boolean) =>
    browser.execute((flag: boolean) => {
      const remote = (window as any).require('@electron/remote');
      remote.getCurrentWindow().setFullScreen(flag);
    }, on);

  await setFullScreen(true);
  await browser.pause(500);

  try {
    // Same scroll as the icon picker capture: from the row's own top, with
    // room above it.
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

    const { crop, screen } = await browser.execute(
      (cls: string, popup: typeof COLOR_POPUP) => {
        const row = document.querySelector<HTMLElement>('.lc-setting');
        const el = row?.querySelector<HTMLElement>(`.${cls} input`);
        if (!row || !el) throw new Error(`No .${cls} input in the first row`);

        const PAD = 16;
        const r = row.getBoundingClientRect();
        const i = el.getBoundingClientRect();
        const popupTop = i.bottom + popup.gap;

        const left = Math.max(Math.min(r.left, i.left) - PAD, 0);
        const top = Math.max(r.top - PAD, 0);
        const right = Math.min(
          Math.max(r.right, i.left + popup.width) + PAD,
          window.innerWidth
        );
        const bottom = Math.min(
          Math.max(r.bottom, popupTop + popup.height) + PAD,
          window.innerHeight
        );

        return {
          crop: { x: left, y: top, width: right - left, height: bottom - top },
          screen: { width: window.innerWidth, height: window.innerHeight },
        };
      },
      input,
      COLOR_POPUP
    );

    const shotWithPickerOpen = async (label: string) => {
      // A driver click, not a DOM one: the popup only opens on a real user
      // gesture.
      await browser.$(`.lc-setting .${input} input`).click();
      await browser.pause(750);

      const data = await shotDisplay(label, screen.width, screen.height);

      // Clicking anywhere in the page closes the popup; the row's own top
      // left corner is never under it (the popup opens near the color
      // swatch, toward the row's right side). Was the row's own name
      // element, now empty (and so no longer a click target at all) since
      // callout rows don't show one.
      await browser.$('.lc-setting').click({ x: 4, y: 4 });
      await browser.pause(250);

      return cropToRect(data, crop);
    };

    await setColorScheme(false);
    const light = await shotWithPickerOpen(`${input}-light`);

    await setColorScheme(true);
    const dark = await shotWithPickerOpen(`${input}-dark`);

    await setColorScheme(false);

    await browser.switchToWindow(original);
    await fs.writeFile(path.join(OUT_DIR, name), await sideBySide(light, dark));
  } finally {
    // Back the way the other settings captures expect the window.
    const handles = await browser.getWindowHandles();
    for (const handle of handles) {
      await browser.switchToWindow(handle);
      if (await browser.$('.lc-callout-container').isExisting()) {
        await setFullScreen(false);
        break;
      }
    }
    await browser.switchToWindow(original);
  }
}

/**
 * Capture the import row on its own.
 *
 * The row is only rendered when the original plugin's settings are in the
 * vault, and that is decided once when the plugin loads -- so the file is
 * staged and the plugin reloaded first. Runs last, so no other capture sees
 * the row.
 */
async function captureImportRow(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Any settings the original plugin could have saved will do: only the
  // row's presence is captured, never what it would import.
  await writeLegacyData(JSON.stringify([{ char: '&', color: '255, 214, 0' }]));
  await reloadPlugin();

  const { original } = await enterSettingsWindow();

  const crop = await browser.execute((pad: number) => {
    const row = Array.from(
      document.querySelectorAll<HTMLElement>('.setting-item')
    ).find((el) =>
      (el.querySelector('.setting-item-name')?.textContent ?? '').startsWith(
        'Import from'
      )
    );
    if (!row) throw new Error('No import row in the settings tab');

    const r = row.getBoundingClientRect();
    const left = Math.max(r.left - pad, 0);
    const top = Math.max(r.top - pad, 0);

    return {
      x: left,
      y: top,
      width: Math.min(r.right + pad, window.innerWidth) - left,
      height: Math.min(r.bottom + pad, window.innerHeight) - top,
    };
  }, 16);

  await captureBothSchemes(name, 'import', original, crop);
}

/** Bounding box, in viewport pixels, of the topmost modal dialog. */
async function modalCropRect(pad = 16): Promise<CropRect> {
  return browser.execute((padding: number) => {
    const modals = document.querySelectorAll<HTMLElement>(
      '.modal-container .modal:not(.mod-settings)'
    );
    const modal = modals[modals.length - 1];
    if (!modal) throw new Error('No modal is open');

    const r = modal.getBoundingClientRect();
    const left = Math.max(r.left - padding, 0);
    const top = Math.max(r.top - padding, 0);

    return {
      x: left,
      y: top,
      width: Math.min(r.right + padding, window.innerWidth) - left,
      height: Math.min(r.bottom + padding, window.innerHeight) - top,
    };
  }, pad);
}

/** The topmost dialog's own text, or '' when none is open. Plain execute(),
 * not executeObsidian() -- once enterSettingsWindow has switched the
 * session to a popout, that window has no wdio-obsidian-service bridge, so
 * anything after it has to read the DOM directly instead. */
function modalTextInWindow(): Promise<string> {
  return browser.execute(() => {
    const modals = document.querySelectorAll<HTMLElement>(
      '.modal-container .modal:not(.mod-settings)'
    );
    return (modals[modals.length - 1]?.textContent ?? '').trim();
  });
}

async function waitForModalInWindow(containing: string): Promise<void> {
  await browser.waitUntil(
    async () => (await modalTextInWindow()).includes(containing),
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: `no modal containing "${containing}"`,
    }
  );
}

/** Click "Cancel" on the topmost dialog and wait for it to close. */
async function dismissModalInWindow(): Promise<void> {
  await browser.execute(() => {
    const modals = document.querySelectorAll<HTMLElement>(
      '.modal-container .modal:not(.mod-settings)'
    );
    const modal = modals[modals.length - 1];
    const btn = Array.from(modal?.querySelectorAll('button') ?? []).find(
      (b) => (b.textContent ?? '').trim() === 'Cancel'
    );
    btn?.click();
  });

  await browser.waitUntil(async () => (await modalTextInWindow()) === '', {
    timeout: 5000,
    interval: 150,
    timeoutMsg: 'a dialog stayed open after teardown',
  });
}

/** Capture the "Add callout" modal on its own. */
async function captureAddCalloutModal(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { pane, original } = await enterSettingsWindow();

  const clicked = await browser.execute((selector: string) => {
    const root = document.querySelector<HTMLElement>(selector);
    const target =
      root?.querySelector<HTMLElement>('[aria-label="Add callout"]') ??
      root?.querySelector<HTMLElement>('.mod-add-item');
    if (!target) return false;
    target.click();
    return true;
  }, pane);
  if (!clicked) throw new Error('Could not find the "Add callout" control');

  await waitForModalInWindow('Add callout');

  const settingsWindow = await browser.getWindowHandle();
  const crop = await modalCropRect();
  await captureBothSchemes(name, 'add-callout', original, crop);

  // captureBothSchemes ends switched to `original` (the main window) --
  // dismissing there would silently no-op against a window that never had
  // the modal, leaving it stuck open in the popout underneath. Switching
  // back to `original` again afterward keeps the invariant every other
  // capture here relies on: each one leaves the session on the main
  // window, not wherever its own popout happened to be.
  await browser.switchToWindow(settingsWindow);
  await dismissModalInWindow();
  await browser.switchToWindow(original);
}

/** Capture the "Reset to defaults" confirmation modal on its own. */
async function captureResetConfirmModal(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { pane, original } = await enterSettingsWindow();

  const clicked = await browser.execute(
    (selector: string, wanted: string) => {
      const root = document.querySelector<HTMLElement>(selector);
      const row = Array.from(
        root?.querySelectorAll<HTMLElement>('.setting-item') ?? []
      ).find(
        (el) =>
          (el.querySelector('.setting-item-name')?.textContent ?? '').trim() ===
          wanted
      );
      const control = row?.querySelector<HTMLElement>('button');
      if (!control) return false;
      control.click();
      return true;
    },
    pane,
    'Reset to defaults'
  );
  if (!clicked) throw new Error('No "Reset to defaults" button in settings');

  await waitForModalInWindow('Reset to defaults');

  const settingsWindow = await browser.getWindowHandle();
  const crop = await modalCropRect();
  await captureBothSchemes(name, 'reset-confirm', original, crop);

  // captureBothSchemes ends switched to `original` (the main window) --
  // dismissing there would silently no-op against a window that never had
  // the modal, leaving it stuck open in the popout underneath. Switching
  // back to `original` again afterward keeps the invariant every other
  // capture here relies on: each one leaves the session on the main
  // window, not wherever its own popout happened to be.
  await browser.switchToWindow(settingsWindow);
  await dismissModalInWindow();
  await browser.switchToWindow(original);
}

/**
 * Capture a callout row mid-drag, reordering it in the list.
 *
 * Obsidian's own list reorder (Yv/_v in its bundle) is a handwritten
 * mousedown/mousemove/mouseup drag, not HTML5 drag-and-drop or a library
 * like SortableJS -- and specifically mousedown, not pointerdown, so
 * WebDriver's own pointer actions (which Chrome dispatches as trusted
 * PointerEvents) never reach its listener. Real, trusted input aside,
 * nothing about the check is browser-specific, so a plain synthetic
 * MouseEvent sequence dispatched straight at the handle and window drives
 * it identically. Left mid-drag (no mouseup) for the screenshot, then
 * released to leave the settings tab usable afterward.
 */
async function captureDragState(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { original } = await enterSettingsWindow();

  // Defensive: a no-op when nothing is open, but a stray modal left over
  // from an earlier capture in the same window would otherwise sit on top
  // of the drag ghost in the screenshot.
  await dismissModalInWindow();

  const rect = await browser.execute(() => {
    const handle = document.querySelector<HTMLElement>('.mod-drag-handle');
    const scrollParent = handle?.closest<HTMLElement>('.vertical-tab-content');
    if (!handle || !scrollParent) return null;

    // The first callout row -- and so its own drag handle -- sits below
    // the fold under the settings tab's other groups; bring it into view
    // first, the same way a person would have to scroll to reach it.
    scrollParent.scrollTop =
      handle.getBoundingClientRect().top -
      scrollParent.getBoundingClientRect().top +
      scrollParent.scrollTop -
      100;

    const r = handle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    const fire = (target: EventTarget, type: string, cx: number, cy: number) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: 1,
          clientX: cx,
          clientY: cy,
          view: window,
        })
      );

    fire(handle, 'mousedown', x, y);
    fire(window, 'mousemove', x, y + 10);
    fire(window, 'mousemove', x, y + 30);
    fire(window, 'mousemove', x, y + 60);

    const listEl = handle.closest('.setting-item')?.parentElement;
    const listRect = listEl?.getBoundingClientRect();
    const ghostRect = document
      .querySelector('.drag-reorder-ghost')
      ?.getBoundingClientRect();
    if (!listRect || !ghostRect) return null;

    const PAD = 16;
    const left = Math.max(Math.min(listRect.left, ghostRect.left) - PAD, 0);
    const top = Math.max(Math.min(listRect.top, ghostRect.top) - PAD, 0);
    const right = Math.min(
      Math.max(listRect.right, ghostRect.right) + PAD,
      window.innerWidth
    );
    const bottom = Math.min(
      Math.max(listRect.bottom, ghostRect.bottom) + PAD,
      window.innerHeight
    );

    return { x: left, y: top, width: right - left, height: bottom - top };
  });

  if (!rect) throw new Error('Could not start a drag on the callout list');

  await captureBothSchemes(name, 'drag-state', original, rect);

  // Releasing the button ends the drag Obsidian's own side is tracking;
  // window is where _v attaches its mousemove/mouseup listeners once a
  // drag starts, mirroring how fire() above dispatched the moves that
  // drove it.
  await browser.execute(() => {
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 0,
      })
    );
  });
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
    await captureEditor('callout-characters.png', false, true);
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
    // One prose paragraph, cropped to its height, rendered twice: with the
    // built-ins as shipped, so each highlight is led by its character, and
    // then with icons on, so the picture shows the character giving way to
    // the callout's icon. Stacked, so the two differ only where they should,
    // each under a heading that says which it is, so the image explains
    // itself wherever it ends up.
    await openNote('Highlights.md');
    const paragraph = await editorText();

    await setSettings(callouts(false));
    await setEditorText(`### Callouts without icons\n\n${paragraph}`);
    const characters = await editorComposite(true, true, '.lc-highlight-callout');

    await setSettings(callouts(true));
    await setEditorText(`### Callouts with icons\n\n${paragraph}`);
    await browser.$('.lc-highlight-marker svg').waitForExist({ timeout: 10000 });
    const icons = await editorComposite(true, true, '.lc-highlight-callout');

    await fs.writeFile(
      path.join(OUT_DIR, 'highlights.png'),
      await stacked(characters, icons)
    );
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
    await captureIconPicker('settings-icon-picker.png', 'lucide-activity');
  });

  it('captures the add callout modal', async function () {
    await captureAddCalloutModal('settings-add-callout.png');
  });

  it('captures the reset confirmation modal', async function () {
    await captureResetConfirmModal('settings-reset-confirm.png');
  });

  it('captures a callout row mid-drag', async function () {
    await captureDragState('settings-drag-state.png');
  });

  it('captures the color picker open', async function () {
    await setSettings(callouts(true));
    await captureColorPicker('settings-color-picker.png', 'lc-color');
  });

  it('captures the marker color picker open', async function () {
    // The star's usual yellow stays on the background; the marker itself
    // goes a dark amber that reads against it.
    const [first, ...rest] = callouts(true);
    await setSettings([{ ...first, markerColor: '180, 83, 9' }, ...rest]);
    await captureColorPicker(
      'settings-marker-color-picker.png',
      'lc-marker-color'
    );
  });

  // Mutates shared plugin state (legacy data + a plugin reload), so it runs
  // last -- no other capture should see the import row, or the window churn
  // reloading the plugin leaves behind.
  it('captures the import offer', async function () {
    await captureImportRow('settings-import.png');
  });
});
