import { browser } from '@wdio/globals';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { Callout, HighlightSettings } from '../src/settings';

export const PLUGIN_ID = 'list-callouts-improved';

const SCREENSHOT_DIR = path.resolve('test/screenshots');

export async function openNote(pathInVault: string): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, notePath) => {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof obsidian.TFile)) {
      throw new Error(`No such note: ${notePath}`);
    }
    await app.workspace.getLeaf(false).openFile(file);
  }, pathInVault);
}

export function getSettings(): Promise<Callout[]> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    return JSON.parse(JSON.stringify(p.settings));
  }) as Promise<Callout[]>;
}

export function legacyDataAvailable(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    return (app as any).plugins.plugins['list-callouts-improved'].legacyDataAvailable;
  }) as Promise<boolean>;
}

/**
 * Run the import the way the settings button does, returning either the number
 * of callouts imported or the error message the user would be shown.
 *
 * The rejection is caught here rather than inside the browser: a promise that
 * rejects in Obsidian surfaces as a WebDriverError carrying the same message,
 * and catching on this side keeps the assertion close to the failure.
 */
export async function runImport(): Promise<{
  count?: number;
  error?: string;
}> {
  try {
    const count = await browser.executeObsidian(async ({ app }) => {
      const p = (app as any).plugins.plugins['list-callouts-improved'];
      return (await p.importLegacySettings()) as number;
    });
    return { count };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function writeLegacyData(contents: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, data) => {
    const dir = `${app.vault.configDir}/plugins/obsidian-list-callouts`;
    if (!(await app.vault.adapter.exists(dir))) {
      await app.vault.adapter.mkdir(dir);
    }
    await app.vault.adapter.write(`${dir}/data.json`, data);
  }, contents);
}

/**
 * Open the plugin's settings tab and wait for it to actually render.
 *
 * Waiting on one of our own elements rather than an Obsidian selector keeps
 * this working across the desktop and mobile settings layouts, which differ.
 */
export async function openPluginSettings(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const setting = (app as any).setting;
    setting.open();
    setting.openTabById('list-callouts-improved');
  });

  // Poll through executeObsidian rather than browser.$: after a
  // reloadObsidian the element-query context can lag behind the new window,
  // while executeObsidian always addresses the live app.
  await browser.waitUntil(async () => (await calloutPreviewCount()) > 0, {
    timeout: 10000,
    interval: 250,
    timeoutMsg: 'plugin settings tab did not render',
  });
}

/** Number of callout previews drawn in the plugin's settings tab. */
export function calloutPreviewCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => {
    const el = (app as any).setting.activeTab?.containerEl;
    return (el?.querySelectorAll('.lc-callout-container').length ??
      0) as number;
  });
}

/** Rendered text of the plugin's own settings tab. */
export function settingsText(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const el = (app as any).setting.activeTab?.containerEl;
    return (el?.textContent ?? '') as string;
  });
}

export async function closeSettings(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    (app as any).setting.close();
  });
}

/** Obsidian's app version, e.g. "1.13.1". */
export function apiVersion(): Promise<string> {
  return browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
}

export function isMobile(): Promise<boolean> {
  return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

/**
 * Capture a rendering of the current screen, tagged with the Obsidian version
 * and platform so a run across the version matrix leaves one file per
 * combination rather than overwriting a single image.
 */
export async function captureRendering(name: string): Promise<string> {
  const [version, mobile] = await Promise.all([apiVersion(), isMobile()]);
  const platform = mobile ? 'mobile' : 'desktop';
  const file = path.join(SCREENSHOT_DIR, `${version}-${platform}-${name}.png`);

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await browser.saveScreenshot(file);

  return file;
}

/** Replace the plugin's callouts outright, as a test fixture. */
export async function setSettings(callouts: Callout[]): Promise<void> {
  await browser.executeObsidian(async ({ app }, next) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    p.settings = next;
    await p.saveSettings();
    p.dispatchUpdate();
    // Obsidian 1.13 caches the tab's setting definitions, so a change made
    // outside the tab's own controls has to ask it to re-read -- the same call
    // the tab makes after add/delete/import.
    p.settingTab?.refresh?.();
  }, callouts);
}

/**
 * Click the "add callout" affordance: a `+` button in the list header on
 * desktop, or a tappable add row on mobile. Match both rather than branching
 * on platform.
 */
export async function clickAddCallout(): Promise<void> {
  const clicked = await browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as HTMLElement;
    if (!root) return false;

    const target =
      root.querySelector<HTMLElement>('[aria-label="Add callout"]') ??
      root.querySelector<HTMLElement>('.mod-add-item');

    if (!target) return false;
    target.click();
    return true;
  });

  if (!clicked) {
    throw new Error(
      'Could not find an "add callout" control in the settings tab'
    );
  }
}

/**
 * Text of the topmost dialog, or '' when none is open.
 *
 * Two wrinkles: on Obsidian 1.13 desktop the settings tab lives in its own
 * window, so dialogs must be looked up in that window's document rather than
 * the main one; and the settings modal itself is excluded, since its own text
 * contains labels like "Add callout".
 */
export function modalText(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    const modals = doc.querySelectorAll(
      '.modal-container .modal:not(.mod-settings)'
    );
    const modal = modals[modals.length - 1];
    return (modal?.textContent ?? '').trim();
  });
}

export async function waitForModal(containing: string): Promise<void> {
  await browser.waitUntil(
    async () => (await modalText()).includes(containing),
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: `no modal containing "${containing}"`,
    }
  );
}

/**
 * Type into the topmost dialog's first text input. Sets the value and fires the
 * input event, which is what Obsidian's TextComponent listens for.
 */
export async function typeInModal(value: string): Promise<void> {
  await browser.executeObsidian(({ app }, v) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    const modals = doc.querySelectorAll(
      '.modal-container .modal:not(.mod-settings)'
    );
    const modal = modals[modals.length - 1] as HTMLElement;
    const input = modal.querySelector<HTMLInputElement>('input[type="text"]');
    input.value = v;
    input.dispatchEvent(new Event('input'));
  }, value);
}

/** Click a button in the topmost dialog by its visible label. */
export async function clickModalButton(label: string): Promise<void> {
  const clicked = await browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    const modals = doc.querySelectorAll(
      '.modal-container .modal:not(.mod-settings)'
    );
    const modal = modals[modals.length - 1] as HTMLElement;
    if (!modal) return false;
    const btn = Array.from(modal.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === wanted
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, label);

  if (!clicked) throw new Error(`No modal button labelled "${label}"`);
}

/**
 * Close any open dialog, tolerating one that is already closing. Used in
 * teardown, where a test may or may not have submitted the form.
 */
export async function dismissModal(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl;
    const doc = root?.ownerDocument ?? document;
    const modals = doc.querySelectorAll(
      '.modal-container .modal:not(.mod-settings)'
    );
    const modal = modals[modals.length - 1] as HTMLElement;
    if (!modal) return;
    const btn = Array.from(modal.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Cancel'
    );
    btn?.click();
  });

  await browser.waitUntil(async () => (await modalText()) === '', {
    timeout: 5000,
    interval: 150,
    timeoutMsg: 'a dialog stayed open after teardown',
  });
}

/** Whether the topmost dialog's button with this label is disabled. */
export function modalSubmitDisabled(label: string): Promise<boolean> {
  return browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    const modals = doc.querySelectorAll(
      '.modal-container .modal:not(.mod-settings)'
    );
    const modal = modals[modals.length - 1] as HTMLElement;
    const btn = Array.from(modal.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === wanted
    );
    return !!btn?.disabled;
  }, label);
}

/**
 * Geometry of the icon picker relative to the button that opened it. Guards
 * against the menu and its button being measured from different offset
 * parents, which puts the picker somewhere off in a corner.
 */
export function iconMenuGeometry(): Promise<null | {
  width: number;
  height: number;
  belowButton: boolean;
  horizontallyAnchored: boolean;
  insideViewport: boolean;
}> {
  return browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;

    const menu = doc.querySelector<HTMLElement>('.lc-menu');
    if (!menu) return null;

    const modals = doc.querySelectorAll(
      '.modal-container .modal:not(.mod-settings)'
    );
    const scope = (modals[modals.length - 1] ?? doc.body) as HTMLElement;
    const btn = Array.from(scope.querySelectorAll('button')).find((b) =>
      /set icon/i.test(b.textContent ?? '')
    );

    const m = menu.getBoundingClientRect();
    const b = btn?.getBoundingClientRect();

    return {
      width: m.width,
      height: m.height,
      belowButton: !!b && m.top >= b.top,
      // The picker anchors to the button's left edge on desktop and its right
      // edge on mobile, so either one being close counts as anchored.
      horizontallyAnchored:
        !!b &&
        Math.min(Math.abs(m.left - b.left), Math.abs(m.right - b.right)) < 200,
      insideViewport:
        m.left >= -1 &&
        m.top >= -1 &&
        m.left < win.innerWidth &&
        m.top < win.innerHeight,
    };
  });
}

/** Click the "Set icon" button inside the topmost dialog. */
export async function openIconMenuInModal(): Promise<void> {
  await clickModalButton('Set icon');
  await browser.waitUntil(async () => (await iconMenuGeometry()) !== null, {
    timeout: 10000,
    interval: 200,
    timeoutMsg: 'icon picker did not open',
  });
}

/** Number of icons currently listed in the open icon picker. */
export function iconMenuCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    return doc.querySelectorAll('.lc-menu-icons .clickable-icon').length;
  });
}

/** Type a query into the open icon picker's search box. */
export async function searchIconMenu(query: string): Promise<void> {
  await browser.executeObsidian(({ app }, q) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    const input = doc.querySelector<HTMLInputElement>('.lc-menu-search input');
    input.value = q;
    input.dispatchEvent(new Event('input'));
  }, query);
}

/** Click an icon in the open picker by its id. */
export async function clickIconInMenu(id: string): Promise<void> {
  const clicked = await browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument ?? document;
    const el = doc.querySelector<HTMLElement>(
      `.lc-menu-icons .clickable-icon[data-icon="${wanted}"]`
    );
    if (!el) return false;
    el.click();
    return true;
  }, id);

  if (!clicked) throw new Error(`Icon "${id}" not in the picker`);
}

/**
 * Delete the plugin's own `data.json`, so the next load sees a vault that has
 * never saved settings. That is the one case in which the built-in callouts
 * are seeded, and it has to be told apart from a saved-but-empty list.
 */
export async function clearPluginData(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const file = `${app.vault.configDir}/plugins/list-callouts-improved/data.json`;
    if (await app.vault.adapter.exists(file)) {
      await app.vault.adapter.remove(file);
    }
  });
}

/**
 * Click the control of a named row in the plugin's settings tab.
 *
 * `action` definitions render as a clickable icon rather than a button, so
 * take whichever control is there and fall back to the row itself.
 */
export async function clickSettingByName(name: string): Promise<void> {
  const clicked = await browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as HTMLElement;
    if (!root) return false;

    const row = Array.from(
      root.querySelectorAll<HTMLElement>('.setting-item')
    ).find(
      (el) =>
        (el.querySelector('.setting-item-name')?.textContent ?? '').trim() ===
        wanted
    );
    if (!row) return false;

    const control = row.querySelector<HTMLElement>('button, .clickable-icon');
    (control ?? row).click();
    return true;
  }, name);

  if (!clicked) throw new Error(`No settings row named "${name}"`);
}

/** Run the reset the way the settings button does. */
export async function runReset(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    await p.resetSettings();
  });
}

/** The callout characters the editor is currently configured to match. */
export function editorCalloutChars(): Promise<string[]> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    return Object.keys(p.buildEditorConfig().callouts);
  });
}

/**
 * Whether both rendering patterns are null, which is how "no configured
 * callouts" is represented -- an empty alternation would match every list item
 * instead of none.
 */
export function calloutPatternsAreNull(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    p.buildPostProcessorConfig();
    return (
      p.buildEditorConfig().re === null && p.postProcessorConfig.re === null
    );
  });
}

/** Drive the settings tab's reorder handler, as a drag in the list would. */
export async function reorderCallout(
  oldIndex: number,
  newIndex: number
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, move) => {
      const p = (app as any).plugins.plugins['list-callouts-improved'];
      p.settingTab.reorderCallout(move.oldIndex, move.newIndex);
    },
    { oldIndex, newIndex }
  );
}

/** Reload the plugin so persisted settings are read back from disk. */
export async function reloadPlugin(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const plugins = (app as any).plugins;
    await plugins.disablePlugin('list-callouts-improved');
    await plugins.enablePlugin('list-callouts-improved');
  });
}

/** Full text of the active markdown editor. */
export function editorText(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    return view.editor.getValue();
  });
}

/** Replace the active editor's contents, as a per-test fixture. */
export async function setEditorText(text: string): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }, value) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    view.editor.setValue(value);
  }, text);
}

/**
 * Put a bare cursor in the active editor.
 *
 * Focuses CodeMirror directly first: opening a note does not always leave the
 * editor focused (mobile in particular), and a cursor the editor does not
 * consider focused does not touch a selection-dependent decoration.
 */
export async function placeCursor(line: number, ch = 0): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, pos) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      (view.editor as unknown as { cm: { focus(): void } }).cm.focus();
      view.editor.setCursor(pos);
    },
    { line, ch }
  );
}

/**
 * Select from the start of `from` to the end of `to`. Used to check that the
 * command acts on every line a selection touches, not just the anchor.
 */
export async function selectLines(from: number, to: number): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, range) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      view.editor.setSelection(
        { line: range.from, ch: 0 },
        { line: range.to, ch: view.editor.getLine(range.to).length }
      );
    },
    { from, to }
  );
}

/** Cursor position in the active editor, as `[line, ch]`. */
export function cursorPosition(): Promise<[number, number]> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const cursor = view.editor.getCursor();
    return [cursor.line, cursor.ch] as [number, number];
  });
}

/** Undo once in the active editor. */
export async function undo(): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    view.editor.undo();
  });
}

export function getHighlights(): Promise<HighlightSettings> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    return JSON.parse(JSON.stringify(p.highlights));
  }) as Promise<HighlightSettings>;
}

/** Change some or all of the highlight settings, as the toggles would. */
export async function setHighlights(
  patch: Partial<HighlightSettings>
): Promise<void> {
  await browser.executeObsidian(async ({ app }, next) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    p.highlights = { ...p.highlights, ...next };
    await p.saveSettings();
    p.dispatchUpdate();
    p.settingTab?.refresh?.();
  }, patch);
}

/** Write the plugin's data.json verbatim, to stage a particular stored shape. */
export async function writePluginData(contents: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, data) => {
    const dir = `${app.vault.configDir}/plugins/list-callouts-improved`;
    if (!(await app.vault.adapter.exists(dir))) {
      await app.vault.adapter.mkdir(dir);
    }
    await app.vault.adapter.write(`${dir}/data.json`, data);
  }, contents);
}

/** Whether both highlight patterns are null, i.e. highlights match nothing. */
export function highlightPatternsAreNull(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    p.buildPostProcessorConfig();
    return (
      p.buildEditorConfig().highlightRe === null &&
      p.postProcessorConfig.highlightRe === null
    );
  });
}

/** Source text of the editor's highlight pattern, or '' when there is none. */
export function editorHighlightPattern(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    return (p.buildEditorConfig().highlightRe?.source ?? '') as string;
  });
}

export interface RenderedHighlight {
  /** The callout character, or null for a highlight the plugin left alone. */
  char: string | null;
  color: string;
  text: string;
  hasIcon: boolean;
}

/** Every <mark> in reading view, decorated or not. */
export function readingHighlights(): Promise<RenderedHighlight[]> {
  return browser.executeObsidian(({ app }) => {
    return Array.from(
      app.workspace.containerEl.querySelectorAll<HTMLElement>(
        '.markdown-reading-view mark'
      )
    ).map((el) => ({
      char: el.getAttribute('data-callout'),
      color: el.style.getPropertyValue('--lc-callout-color'),
      text: el.textContent ?? '',
      hasIcon: !!el.querySelector('.lc-highlight-marker svg'),
    }));
  });
}

/** Re-run the post processors on the open note, as a settings change needs. */
export async function rerenderReadingView(): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    (view as any).previewMode.rerender(true);
  });
}

/** Every decorated highlight span in the editor. */
export function editorHighlights(): Promise<RenderedHighlight[]> {
  return browser.executeObsidian(({ app }) => {
    return Array.from(
      app.workspace.containerEl.querySelectorAll<HTMLElement>(
        '.markdown-source-view .lc-highlight-callout'
      )
    ).map((el) => ({
      char: el.getAttribute('data-callout'),
      color: el.style.getPropertyValue('--lc-callout-color'),
      text: el.textContent ?? '',
      hasIcon: !!el.querySelector('.lc-highlight-marker svg'),
    }));
  });
}

/**
 * Rendered text of the first editor line containing `needle`, which is what
 * the user sees: hidden markup is absent, revealed markup is present.
 */
export function editorLineText(containing: string): Promise<string> {
  return browser.executeObsidian(({ app }, needle) => {
    const line = Array.from(
      app.workspace.containerEl.querySelectorAll<HTMLElement>(
        '.markdown-source-view .cm-line'
      )
    ).find((el) => (el.textContent ?? '').includes(needle));
    return line?.textContent ?? '';
  }, containing);
}

/** Zero-based line number of the first document line containing `needle`. */
export function editorLineNumber(containing: string): Promise<number> {
  return browser.executeObsidian(({ app, obsidian }, needle) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    return view.editor
      .getValue()
      .split('\n')
      .findIndex((l) => l.includes(needle));
  }, containing);
}
