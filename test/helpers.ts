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
    return (app as any).plugins.plugins['list-callouts-improved']
      .legacyDataAvailable;
  }) as Promise<boolean>;
}

/**
 * Run the import the way the settings button does, returning either the number
 * of callouts imported or the error message the user would be shown.
 *
 * The rejection is caught inside the browser and handed back as a value. Left
 * to reject, it reaches WebdriverIO as a script error, and a script error is
 * retried `connectionRetryCount` times before it surfaces -- three WARNs, an
 * ERROR and about a second and a half of backoff per negative-path test.
 *
 * The browser-side key is `failure` rather than `error` on purpose: WebdriverIO
 * reads any returned object carrying a truthy `error` property as a WebDriver
 * error response and rejects with it, which puts the retries straight back.
 */
export async function runImport(): Promise<{
  count?: number;
  error?: string;
}> {
  const result = await browser.executeObsidian(async ({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    try {
      return { count: (await p.importLegacySettings()) as number };
    } catch (e) {
      return { failure: (e as Error).message };
    }
  });

  return 'failure' in result && result.failure
    ? { error: result.failure }
    : { count: (result as { count: number }).count };
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
 * Whether the "Import from List Callouts" row is showing in the settings
 * tab. The row is always in the definitions and hidden with `visible`, which
 * Obsidian applies as an inline display:none, so the tab's text isn't enough
 * to tell.
 */
export function importRowVisible(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as HTMLElement;
    if (!root) return false;

    const row = Array.from(
      root.querySelectorAll<HTMLElement>('.setting-item')
    ).find(
      (el) =>
        el.querySelector('.setting-item-name')?.textContent ===
        'Import from List Callouts'
    );
    return row !== undefined && getComputedStyle(row).display !== 'none';
  });
}

/**
 * Click the Import button on the "Import from List Callouts" row of the
 * settings tab, the way a user migrating would. Throws if the row isn't
 * showing.
 */
export async function clickImportButton(): Promise<void> {
  const clicked = await browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as HTMLElement;
    if (!root) return false;

    const row = Array.from(
      root.querySelectorAll<HTMLElement>('.setting-item')
    ).find(
      (el) =>
        el.querySelector('.setting-item-name')?.textContent ===
        'Import from List Callouts'
    );
    const button = row?.querySelector<HTMLElement>('button');
    if (!row || !button || getComputedStyle(row).display === 'none') {
      return false;
    }

    button.click();
    return true;
  });

  if (!clicked) {
    throw new Error('No "Import from List Callouts" row in the settings tab');
  }
}

/**
 * The forked-from plugin, as installed by config/wdio.conf.mts. These drive
 * its own settings object and `saveSettings()`, which is exactly what its
 * settings tab does when a control changes, so the `data.json` it leaves
 * behind is the genuine article rather than one this test suite wrote.
 */
export const LEGACY_PLUGIN_ID = 'obsidian-list-callouts';

export function legacyPluginLoaded(): Promise<boolean> {
  return browser.executeObsidian(({ app }, id) => {
    return Boolean((app as any).plugins.plugins[id]);
  }, LEGACY_PLUGIN_ID);
}

export function legacyPluginSettings(): Promise<Callout[]> {
  return browser.executeObsidian(({ app }, id) => {
    return JSON.parse(
      JSON.stringify((app as any).plugins.plugins[id].settings)
    );
  }, LEGACY_PLUGIN_ID) as Promise<Callout[]>;
}

/** Replace the legacy plugin's callouts through its own API and let it save. */
export async function customizeLegacyPlugin(
  callouts: Callout[]
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, id, next) => {
      const p = (app as any).plugins.plugins[id];
      p.settings = next;
      await p.saveSettings();
    },
    LEGACY_PLUGIN_ID,
    callouts
  );
}

export async function legacyDataFileExists(): Promise<boolean> {
  return await browser.executeObsidian(async ({ app }, id) => {
    return await app.vault.adapter.exists(
      `${app.vault.configDir}/plugins/${id}/data.json`
    );
  }, LEGACY_PLUGIN_ID);
}

/**
 * Run `op` against the topmost dialog, in whichever window it opened.
 *
 * On Obsidian 1.13 desktop the settings tab lives in its own window, but a
 * dialog opens in whichever window is *active* -- and a synthetic click on a
 * settings control never focuses the popout, so the dialog usually lands in
 * the main window instead. Looking in only one document was a flake that
 * failed one run in several: the dialog was open, just not where the helper
 * looked. Both documents are searched, the settings window's first.
 *
 * The settings modal itself is excluded, since its own text contains labels
 * like "Add callout".
 */
function inTopmostModal<T>(
  op:
    | 'text'
    | 'settled'
    | 'type'
    | 'click'
    | 'cancel'
    | 'disabled'
    | 'buttonRowBorder',
  arg = ''
): Promise<T> {
  return browser.executeObsidian(
    ({ app }, what: string, value: string) => {
      const root = (app as any).setting.activeTab?.containerEl as
        HTMLElement | undefined;
      const docs = [root?.ownerDocument, document].filter(
        (d, i, all): d is Document => !!d && all.indexOf(d) === i
      );

      let modal: HTMLElement | null = null;
      for (const doc of docs) {
        const found = doc.querySelectorAll<HTMLElement>(
          '.modal-container .modal:not(.mod-settings)'
        );
        if (found.length) {
          modal = found[found.length - 1];
          break;
        }
      }

      const button = () =>
        modal
          ? Array.from(modal.querySelectorAll('button')).find(
              (b) => (b.textContent ?? '').trim() === value
            )
          : undefined;

      switch (what) {
        case 'text':
          return (modal?.textContent ?? '').trim();
        case 'settled':
          // On a phone the dialog slides in, and until it has arrived it
          // is not where a tap would find it.
          return !!modal && modal.getAnimations({ subtree: true }).length === 0;
        case 'type': {
          const input =
            modal?.querySelector<HTMLInputElement>('input[type="text"]');
          if (!input) return false;
          input.value = value;
          input.dispatchEvent(new Event('input'));
          return true;
        }
        case 'click': {
          const btn = button();
          btn?.click();
          return !!btn;
        }
        case 'cancel': {
          Array.from(modal?.querySelectorAll('button') ?? [])
            .find((b) => (b.textContent ?? '').trim() === 'Cancel')
            ?.click();
          return true;
        }
        case 'disabled':
          return !!button()?.disabled;
        case 'buttonRowBorder': {
          const row = button()?.closest('.setting-item');
          if (!row) throw new Error(`No button row holding "${value}"`);
          return getComputedStyle(row).borderTopStyle;
        }
      }
    },
    op,
    arg
  ) as Promise<T>;
}

/**
 * The computed border-top style of the dialog row holding the button with
 * this label: 'none' when nothing separates it from the form above.
 */
export function modalButtonRowBorder(label: string): Promise<string> {
  return inTopmostModal<string>('buttonRowBorder', label);
}

/** Text of the topmost dialog, or '' when none is open. */
export function modalText(): Promise<string> {
  return inTopmostModal<string>('text');
}

/** Where dialogs are when one fails to show up; appended to the timeout. */
function modalWhereabouts(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const doc = root?.ownerDocument;
    const count = (d: Document | undefined) =>
      d ? d.querySelectorAll('.modal-container .modal').length : -1;
    return `settings window has ${count(doc)} dialog(s), main window ${count(document)}${
      doc === document ? ' (same window)' : ''
    }`;
  });
}

export async function waitForModal(containing: string): Promise<void> {
  try {
    await browser.waitUntil(
      async () =>
        (await modalText()).includes(containing) &&
        (await inTopmostModal<boolean>('settled')),
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: `no modal containing "${containing}"`,
      }
    );
  } catch (e) {
    throw new Error(`${(e as Error).message}; ${await modalWhereabouts()}`);
  }
}

/**
 * Type into the topmost dialog's first text input. Sets the value and fires the
 * input event, which is what Obsidian's TextComponent listens for.
 */
export async function typeInModal(value: string): Promise<void> {
  if (!(await inTopmostModal<boolean>('type', value))) {
    throw new Error('No dialog with a text input is open');
  }
}

/** Click a button in the topmost dialog by its visible label. */
export async function clickModalButton(label: string): Promise<void> {
  if (!(await inTopmostModal<boolean>('click', label))) {
    throw new Error(`No modal button labeled "${label}"`);
  }
}

/**
 * Close any open dialog, tolerating one that is already closing. Used in
 * teardown, where a test may or may not have submitted the form.
 */
export async function dismissModal(): Promise<void> {
  await inTopmostModal<boolean>('cancel');

  await browser.waitUntil(async () => (await modalText()) === '', {
    timeout: 5000,
    interval: 150,
    timeoutMsg: 'a dialog stayed open after teardown',
  });
}

/** Whether the topmost dialog's button with this label is disabled. */
export function modalSubmitDisabled(label: string): Promise<boolean> {
  return inTopmostModal<boolean>('disabled', label);
}

/**
 * Geometry of the icon picker relative to the button that opened it. Guards
 * against the menu and its button being measured from different offset
 * parents, which puts the picker somewhere off in a corner.
 *
 * The picker opens inside the dialog, so like the dialog it may be in either
 * window; see inTopmostModal.
 */
export function iconMenuGeometry(): Promise<null | {
  width: number;
  height: number;
  /** Hangs from the button's bottom edge, or stands on its top edge. */
  verticallyAnchored: boolean;
  /** Whether the screen has room for the picker on either side of the button.
   * A window too short for both (the tiled test popout can be) gets it
   * clamped to the top edge instead: still whole, no longer touching. */
  roomToAnchor: boolean;
  horizontallyAnchored: boolean;
  insideViewport: boolean;
  /** Every corner of the picker is what a click there would land on: nothing
   * between it and the window (a dialog's overflow, say) clips it, and it is
   * not off the edge of the screen. */
  fullyVisible: boolean;
  /** Whether the window is big enough to show the whole picker anywhere.
   * Several test windows tiled into one virtual display can leave one that
   * is not; the emulated phone's viewport is fixed and always is. */
  roomToShow: boolean;
}> {
  return browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const menu = [root?.ownerDocument, document]
      .map((d) => d?.querySelector<HTMLElement>('.lc-menu'))
      .find((m) => !!m);
    if (!menu) return null;

    const doc = menu.ownerDocument;
    const win = doc.defaultView ?? window;

    const modals = doc.querySelectorAll(
      '.modal-container .modal:not(.mod-settings)'
    );
    const scope = (modals[modals.length - 1] ?? doc.body) as HTMLElement;
    const btn = Array.from(scope.querySelectorAll('button')).find((b) =>
      /set icon/i.test(b.textContent ?? '')
    );

    const m = menu.getBoundingClientRect();
    const b = btn?.getBoundingClientRect();

    // Just inside each corner: the layout rect says nothing about clipping,
    // but hit testing does -- a clipped corner resolves to whatever shows
    // through there instead, and one off the screen to nothing at all. Inset
    // past the picker's rounded corners, which a hit test also respects.
    const INSET = 12;
    const corners: [number, number][] = [
      [m.left + INSET, m.top + INSET],
      [m.right - INSET, m.top + INSET],
      [m.left + INSET, m.bottom - INSET],
      [m.right - INSET, m.bottom - INSET],
    ];

    return {
      width: m.width,
      height: m.height,
      verticallyAnchored:
        !!b &&
        Math.min(Math.abs(m.top - b.bottom), Math.abs(m.bottom - b.top)) < 10,
      // With the couple of pixels the picker keeps from the button.
      roomToAnchor:
        !!b &&
        (b.bottom + 2 + m.height <= win.innerHeight ||
          b.top - 2 - m.height >= 0),
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
      fullyVisible: corners.every(([x, y]) =>
        menu.contains(doc.elementFromPoint(x, y))
      ),
      roomToShow: m.width <= win.innerWidth && m.height <= win.innerHeight,
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

/**
 * Scroll the plugin's settings tab down to its last callout row, open the
 * icon picker there, and report where the picker landed relative to its
 * button and whether the button is still in the tab's view afterwards.
 *
 * The last row, scrolled down to, is the case that exposes a picker
 * positioned against the wrong ancestor: a menu placed a screen above its
 * button pulls the tab back up to it when its search box takes focus, and
 * the button goes off screen.
 *
 * Whether the button stayed in view is what is reported, rather than the
 * scroll position itself: on 1.13 desktop the tab is a popout window, and a
 * tiling window manager (the test display's, for one) keeps resizing it as
 * other windows come and go, which reflows the tab and moves its scroll
 * position on its own by a few pixels. So does the picker's own focus in a
 * window too short for it to fit under its button. Neither takes the button
 * off screen; the bug did.
 */
export async function openIconMenuInTab(): Promise<{
  scrollBefore: number;
  buttonInView: boolean;
  gapBelowButton: number;
  leftOffset: number;
  rightOffset: number;
}> {
  return await browser.executeObsidian(async ({ app }) => {
    const root = (app as any).setting.activeTab.containerEl as HTMLElement;
    const tab = root.closest<HTMLElement>('.vertical-tab-content');
    const win = root.ownerDocument.defaultView ?? window;

    const buttons = Array.from(root.querySelectorAll('button')).filter((b) =>
      /set icon/i.test(b.textContent ?? '')
    );
    const btn = buttons[buttons.length - 1];

    // Into view, as a user would have it, rather than to the very end of
    // the tab: the last row carries a deep bottom padding, and in a short
    // window the end of the tab leaves the button itself above the viewport.
    btn.scrollIntoView({ block: 'center' });
    await new Promise((r) => win.setTimeout(r, 50));
    const scrollBefore = tab.scrollTop;

    btn.click();
    // Past the picker's own deferred focus() and listener setup.
    await new Promise((r) => win.setTimeout(r, 300));

    const menu = root.querySelector<HTMLElement>('.lc-menu');
    if (!menu) throw new Error('icon picker did not open');
    const m = menu.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const t = tab.getBoundingClientRect();

    return {
      scrollBefore,
      buttonInView: b.top >= t.top && b.bottom <= t.bottom,
      gapBelowButton: m.top - b.bottom,
      leftOffset: m.left - b.left,
      rightOffset: m.right - b.right,
    };
  });
}

/** Number of icons currently listed in the open icon picker. */
export function iconMenuCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    return (
      [root?.ownerDocument, document]
        .map(
          (d) => d?.querySelectorAll('.lc-menu-icons .clickable-icon').length
        )
        .find((n) => !!n) ?? 0
    );
  });
}

/** Number of icon ids the running app registers, custom ones included. */
export function iconIdCount(): Promise<number> {
  return browser.executeObsidian(
    ({ obsidian }) => obsidian.getIconIds().length
  );
}

/** Scroll the open icon picker's list to its end. */
export async function scrollIconMenuToEnd(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const list = [root?.ownerDocument, document]
      .map((d) => d?.querySelector<HTMLElement>('.lc-menu-icons'))
      .find((l) => !!l);
    list.scrollTop = list.scrollHeight;
  });
}

/** Type a query into the open icon picker's search box. */
export async function searchIconMenu(query: string): Promise<void> {
  await browser.executeObsidian(({ app }, q) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const input = [root?.ownerDocument, document]
      .map((d) => d?.querySelector<HTMLInputElement>('.lc-menu-search input'))
      .find((i) => !!i);
    input.value = q;
    input.dispatchEvent(new Event('input'));
  }, query);
}

/** Whether the open picker currently lists the icon with this id. */
export function iconInMenu(id: string): Promise<boolean> {
  return browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    return [root?.ownerDocument, document].some(
      (d) =>
        !!d?.querySelector(
          `.lc-menu-icons .clickable-icon[data-icon="${wanted}"]`
        )
    );
  }, id);
}

/** Search the open picker and wait for the icon with this id to be listed. */
export async function searchIconMenuFor(
  query: string,
  id: string
): Promise<void> {
  await searchIconMenu(query);
  await browser.waitUntil(() => iconInMenu(id), {
    timeout: 5000,
    interval: 200,
    timeoutMsg: `icon search for "${query}" did not list ${id}`,
  });
}

/**
 * The hover delay, in ms, that the picker asked Obsidian for on an icon, or
 * null when it asked for none (and gets Obsidian's default second of hover).
 * setTooltip records the delay on the element as data-tooltip-delay, which is
 * what Obsidian's global hover handler reads back.
 */
export function iconTooltipDelay(id: string): Promise<number | null> {
  return browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const el = [root?.ownerDocument, document]
      .map((d) =>
        d?.querySelector<HTMLElement>(
          `.lc-menu-icons .clickable-icon[data-icon="${wanted}"]`
        )
      )
      .find((e) => !!e);
    if (!el) throw new Error(`Icon "${wanted}" not in the picker`);
    const delay = el.getAttribute('data-tooltip-delay');
    return delay === null ? null : parseInt(delay, 10);
  }, id);
}

/**
 * Hover an icon in the open picker and return the text of the tooltip that
 * shows for it, or null if none appears within `timeout`.
 *
 * The hover is dispatched in-page rather than with the WebDriver pointer.
 * Obsidian's tooltip handler answers a pointerover once it has seen two
 * mouse pointermoves (its guard against touch-faked hovers), and that is what
 * this sends. A real pointer proved unusable in the full suite: CI tiles
 * every worker's Obsidian window onto one screen and re-tiles them whenever
 * one opens or closes, so the icon moved out from under the pointer mid-move
 * and the hover landed on a neighbor, on nothing, or out of bounds.
 *
 * The picker may live in either window (the settings tab is a popout on 1.13
 * desktop), so both documents are searched, for the icon and the tooltip.
 */
export async function iconTooltip(
  id: string,
  timeout = 2000
): Promise<string | null> {
  const hovered = await browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const el = [root?.ownerDocument, document]
      .map((d) =>
        d?.querySelector<HTMLElement>(
          `.lc-menu-icons .clickable-icon[data-icon="${wanted}"]`
        )
      )
      .find((e) => !!e);
    if (!el) return false;

    // The pointermove count Obsidian keeps is global, but the listener that
    // keeps it is on the main window's document only; the picker may be in
    // a popout, whose pointermoves it never sees. So the warm-up goes to
    // the main document, and the hover to the icon wherever it lives.
    const init = { pointerType: 'mouse', bubbles: true };
    document.dispatchEvent(new PointerEvent('pointermove', init));
    document.dispatchEvent(new PointerEvent('pointermove', init));
    el.dispatchEvent(new PointerEvent('pointerover', init));
    return true;
  }, id);
  if (!hovered) throw new Error(`Icon "${id}" not in the picker`);

  // Read in-page as well: WebDriver's getText returns only text on screen,
  // and a tooltip can hang past the edge of a tiled CI window.
  const tooltipText = () =>
    browser.executeObsidian(({ app }) => {
      const root = (app as any).setting.activeTab?.containerEl as
        HTMLElement | undefined;
      const tip = [root?.ownerDocument, document]
        .map((d) => d?.querySelector<HTMLElement>('.tooltip'))
        .find((t) => !!t);
      return tip ? (tip.textContent ?? '').trim() : null;
    });

  let text: string | null = null;
  try {
    await browser.waitUntil(async () => (text = await tooltipText()) !== null, {
      timeout,
      interval: 50,
    });
  } catch {
    return null;
  }
  return text;
}

/** Click an icon in the open picker by its id. */
export async function clickIconInMenu(id: string): Promise<void> {
  const clicked = await browser.executeObsidian(({ app }, wanted) => {
    const root = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    const el = [root?.ownerDocument, document]
      .map((d) =>
        d?.querySelector<HTMLElement>(
          `.lc-menu-icons .clickable-icon[data-icon="${wanted}"]`
        )
      )
      .find((e) => !!e);
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

/** Flip a toggle in the plugin's settings tab, found by its row name. */
export async function clickToggleByName(name: string): Promise<void> {
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

    const toggle = row?.querySelector<HTMLElement>('.checkbox-container');
    if (!toggle) return false;
    toggle.click();
    return true;
  }, name);

  if (!clicked) throw new Error(`No toggle named "${name}"`);
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
  /** The highlighted text, without the marker. */
  text: string;
  /** The marker's text -- the character when no icon is set -- or null. */
  marker: string | null;
  hasIcon: boolean;
}

/** Every <mark> in reading view, decorated or not. */
export function readingHighlights(): Promise<RenderedHighlight[]> {
  return browser.executeObsidian(({ app }) => {
    return Array.from(
      app.workspace.containerEl.querySelectorAll<HTMLElement>(
        '.markdown-reading-view mark'
      )
    ).map((el) => {
      const marker = el.querySelector('.lc-highlight-marker');
      return {
        char: el.getAttribute('data-callout'),
        color: el.style.getPropertyValue('--lc-callout-color'),
        text: Array.from(el.childNodes)
          .filter((n) => n !== marker)
          .map((n) => n.textContent ?? '')
          .join(''),
        marker: marker ? (marker.textContent ?? '') : null,
        hasIcon: !!marker?.querySelector('svg'),
      };
    });
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
    ).map((el) => {
      const marker = el.querySelector('.lc-highlight-marker');
      return {
        char: el.getAttribute('data-callout'),
        color: el.style.getPropertyValue('--lc-callout-color'),
        text: Array.from(el.childNodes)
          .filter((n) => n !== marker)
          .map((n) => n.textContent ?? '')
          .join(''),
        marker: marker ? (marker.textContent ?? '') : null,
        hasIcon: !!marker?.querySelector('svg'),
      };
    });
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

/** Put the active markdown view into reading mode, if it is not already. */
export async function ensureReadingMode(): Promise<void> {
  await setViewMode('preview');
}

/** Put the active markdown view into the editor, if it is not already. */
export async function ensureEditingMode(): Promise<void> {
  await setViewMode('source');
}

async function setViewMode(mode: 'preview' | 'source'): Promise<void> {
  const current = await browser.executeObsidian(({ app, obsidian }) => {
    return app.workspace.getActiveViewOfType(obsidian.MarkdownView).getMode();
  });

  if (current !== mode) {
    await browser.executeObsidianCommand('markdown:toggle-preview');
  }
}

/** The three ways a markdown view can render its note. */
export type Rendering = 'live-preview' | 'source' | 'reading';

/**
 * Put the active markdown view into one particular rendering. Set as view
 * state rather than through the toggle commands: those flip between reading
 * and whichever editing mode the vault last used, so neither can ask for
 * source mode outright.
 */
export async function setRendering(rendering: Rendering): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, rendering) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    await view.setState(
      {
        ...view.getState(),
        mode: rendering === 'reading' ? 'preview' : 'source',
        source: rendering === 'source',
      },
      { history: false }
    );
  }, rendering);
}

/** What the marker color controls of one callout form currently show. */
export interface MarkerColorControls {
  /** The dropdown's value: 'default' or 'custom'. */
  mode: string;
  /** The marker color picker's hex value, or null when it is not shown. */
  picker: string | null;
}

/** How the highlight band behind a callout preview is painted. */
export interface PreviewBackgroundPaint {
  /** The band's computed z-index. */
  zIndex: string;
  /** The computed background color of the band's tinted ::after layer. */
  tint: string;
}

/**
 * Drive the controls inside one callout form: the callout row at `index` in
 * the settings tab, or the add-callout dialog when `index` is null.
 */
function inCalloutForm<T>(
  index: number | null,
  op: 'read' | 'mode' | 'pick' | 'color' | 'paint',
  arg = ''
): Promise<T> {
  return browser.executeObsidian(
    ({ app }, i: number | null, what: string, value: string) => {
      const tab = (app as any).setting.activeTab?.containerEl as
        HTMLElement | undefined;

      let root: Element | null = null;
      if (i === null) {
        // Same two-window search as the modal helpers: the dialog opens in
        // whichever window is active, not necessarily the settings window.
        const docs = [tab?.ownerDocument, document].filter(
          (d, k, all): d is Document => !!d && all.indexOf(d) === k
        );
        for (const doc of docs) {
          const found = doc.querySelectorAll(
            '.modal-container .modal:not(.mod-settings)'
          );
          if (found.length) {
            root = found[found.length - 1];
            break;
          }
        }
      } else {
        root = tab?.querySelectorAll('.lc-setting')[i] ?? null;
      }
      if (!root) throw new Error(`No callout form (index ${String(i)})`);

      const select = root.querySelector<HTMLSelectElement>(
        'select.lc-marker-color-mode'
      );
      const picker = root.querySelector<HTMLInputElement>(
        '.lc-marker-color input'
      );
      const colorInput =
        root.querySelector<HTMLInputElement>('.lc-color input');

      switch (what) {
        case 'color':
          if (!colorInput) throw new Error('No color picker');
          colorInput.value = value;
          colorInput.dispatchEvent(new Event('change'));
          return null;
        case 'paint': {
          const bg = root.querySelector<HTMLElement>(
            '.lc-callout-container .lc-list-bg'
          );
          if (!bg) throw new Error('No preview background');
          return {
            zIndex: getComputedStyle(bg).zIndex,
            tint: getComputedStyle(bg, '::after').backgroundColor,
          };
        }
        case 'read':
          return { mode: select?.value ?? '', picker: picker?.value ?? null };
        case 'mode':
          if (!select) throw new Error('No marker color dropdown');
          select.value = value;
          select.dispatchEvent(new Event('change'));
          return null;
        case 'pick':
          if (!picker) throw new Error('No marker color picker');
          picker.value = value;
          picker.dispatchEvent(new Event('change'));
          return null;
      }
    },
    index,
    op,
    arg
  ) as Promise<T>;
}

/** The marker color controls of the settings row for the callout at `index`. */
export function markerColorControls(
  index: number
): Promise<MarkerColorControls> {
  return inCalloutForm(index, 'read');
}

/** Pick 'default' or 'custom' in the row's marker color dropdown. */
export async function setMarkerColorMode(
  index: number,
  mode: 'default' | 'custom'
): Promise<void> {
  await inCalloutForm(index, 'mode', mode);
}

/** Choose `hex` (e.g. '#010203') in the row's marker color picker. */
export async function pickMarkerColor(
  index: number,
  hex: string
): Promise<void> {
  await inCalloutForm(index, 'pick', hex);
}

/** The marker color controls of the open add-callout dialog. */
export function modalMarkerColorControls(): Promise<MarkerColorControls> {
  return inCalloutForm(null, 'read');
}

/** Pick 'default' or 'custom' in the add-callout dialog's dropdown. */
export async function setModalMarkerColorMode(
  mode: 'default' | 'custom'
): Promise<void> {
  await inCalloutForm(null, 'mode', mode);
}

/** Choose `hex` in the add-callout dialog's marker color picker. */
export async function pickModalMarkerColor(hex: string): Promise<void> {
  await inCalloutForm(null, 'pick', hex);
}

/** Choose `hex` in the add-callout dialog's callout color picker. */
export async function pickModalColor(hex: string): Promise<void> {
  await inCalloutForm(null, 'color', hex);
}

/**
 * How the preview background of the settings row at `index`, or of the
 * add-callout dialog when `index` is null, is painted.
 */
export function previewBackgroundPaint(
  index: number | null
): Promise<PreviewBackgroundPaint> {
  return inCalloutForm(index, 'paint');
}

/**
 * The `--lc-callout-marker-color` property and the marker's painted color for
 * each decorated element matching `selector`, keyed by callout character.
 */
export function markerPaint(
  selector: string
): Promise<Record<string, { property: string; painted: string }>> {
  return browser.executeObsidian(({ app }, sel: string) => {
    const out: Record<string, { property: string; painted: string }> = {};
    app.workspace.containerEl
      .querySelectorAll<HTMLElement>(sel)
      .forEach((el) => {
        const char = el.getAttribute('data-callout');
        const marker = el.querySelector<HTMLElement>(
          '.lc-list-marker, .lc-highlight-marker'
        );
        if (!char || !marker) return;
        out[char] = {
          property: el.style.getPropertyValue('--lc-callout-marker-color'),
          painted: getComputedStyle(marker).color,
        };
      });
    return out;
  }, selector);
}

export function getHideBullets(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    return p.hideBullets as boolean;
  });
}

/** Flip the bullets preference, as the toggle would. */
export async function setHideBullets(on: boolean): Promise<void> {
  await browser.executeObsidian(async ({ app }, next) => {
    const p = (app as any).plugins.plugins['list-callouts-improved'];
    p.hideBullets = next;
    await p.saveSettings();
    p.settingTab?.refresh?.();
  }, on);
}

/** Whether the body carries the class the bullets preference paints from. */
export function bodyHidesBullets(): Promise<boolean> {
  return browser.executeObsidian(() =>
    document.body.classList.contains('lc-hide-bullets')
  );
}

export interface ListMarkerVisibility {
  text: string;
  callout: boolean;
  marker: 'bullet' | 'number' | 'checkbox';
  /** Whether the marker takes up space: what hiding removes and a checkbox keeps. */
  shown: boolean;
}

/**
 * How each list item under `root` shows its list marker: the editor's bullet
 * or number span, reading view's bullet span or ::marker, or a task item's
 * checkbox.
 */
export function listMarkerVisibility(
  root: string
): Promise<ListMarkerVisibility[]> {
  return browser.executeObsidian((_, selector) => {
    const scope = document.querySelector<HTMLElement>(selector);
    if (!scope) return [];

    const items = Array.from(
      scope.querySelectorAll<HTMLElement>('.cm-line, li')
    );

    return items.flatMap((el): ListMarkerVisibility[] => {
      // The checkbox first: reading view gives a task item a (hidden) bullet
      // span as well, ahead of the checkbox in document order.
      const glyph =
        el.querySelector<HTMLElement>('.task-list-item-checkbox') ??
        el.querySelector<HTMLElement>('.list-bullet, .list-number');
      const isLi = el.tagName === 'LI';
      const listStyle = isLi ? getComputedStyle(el).listStyleType : '';
      const text = (el.textContent ?? '').trim();
      const callout = el.classList.contains('lc-list-callout');

      if (glyph) {
        const marker = glyph.classList.contains('task-list-item-checkbox')
          ? 'checkbox'
          : glyph.classList.contains('list-number')
            ? 'number'
            : 'bullet';
        return [
          { text, callout, marker, shown: glyph.getClientRects().length > 0 },
        ];
      }

      // Reading view's numbered items have no glyph element; the number is
      // the <li>'s ::marker, there unless list-style takes it away. Bullet
      // items set list-style to a zero-width space, which is neither.
      if (isLi && (listStyle === 'decimal' || listStyle === 'none')) {
        return [
          { text, callout, marker: 'number', shown: listStyle !== 'none' },
        ];
      }

      // A paragraph's cm-line, or an <li> holding a nested list.
      return [];
    });
  }, root);
}

export interface ListItemGeometry {
  text: string;
  callout: boolean;
  /**
   * Left edge of the list's own marker as drawn: the editor's bullet or
   * number span, reading view's bullet float (zero width, so its left is the
   * dot's center) or a checkbox. Null when nothing is drawn.
   */
  glyphLeft: number | null;
  /** Left edge and horizontal center of the callout marker's content. */
  markerLeft: number | null;
  markerCenter: number | null;
  /** Left edge of the editor's band widget; null in reading view. */
  bandLeft: number | null;
  /** Left edge of the item's first visible character after its markers. */
  textLeft: number | null;
}

/**
 * Where each list item under `root` draws its list marker, callout marker,
 * band and text, for checking that a callout marker lands where the list's
 * own marker would and that the text column holds.
 */
export function listItemGeometry(root: string): Promise<ListItemGeometry[]> {
  return browser.executeObsidian((_, selector) => {
    const scope = document.querySelector<HTMLElement>(selector);
    if (!scope) return [];

    const drawn = (el: Element | null) =>
      el && el.getClientRects().length ? el.getBoundingClientRect() : null;

    const ownList = (el: HTMLElement) => el.closest('ul, ol');

    // The item's own text nodes, leaving a nested list's to its own items.
    const ownText = (el: HTMLElement): Text[] => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (ownList(node.parentElement) === ownList(el)) nodes.push(node);
      }
      return nodes;
    };

    // The first visible character after `after`, measured as a range so the
    // number is the glyph's and not that of a span starting with a space.
    const textLeftOf = (el: HTMLElement, after: Node | null) => {
      for (const node of ownText(el)) {
        if (after) {
          // Past `after` in document order, and not inside it: a descendant
          // reports as following too.
          const position = after.compareDocumentPosition(node);
          if (
            !(position & Node.DOCUMENT_POSITION_FOLLOWING) ||
            position & Node.DOCUMENT_POSITION_CONTAINED_BY
          ) {
            continue;
          }
        }
        const match = /\S/.exec(node.data);
        if (!match) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + 1);
        return range.getBoundingClientRect().left;
      }
      return null;
    };

    return Array.from(
      scope.querySelectorAll<HTMLElement>('.cm-line.HyperMD-list-line, li')
    ).map((el): ListItemGeometry => {
      const glyph =
        el.querySelector<HTMLElement>(
          ':scope > .lc-li-wrapper > .task-list-item-checkbox, :scope > .task-list-item-checkbox, :scope > .task-list-label .task-list-item-checkbox'
        ) ??
        el.querySelector<HTMLElement>(
          ':scope > .list-bullet, :scope > .cm-formatting-list .list-bullet, :scope > .cm-formatting-list .list-number'
        );
      const marker = el.querySelector<HTMLElement>(
        ':scope > .lc-li-wrapper > .lc-list-marker, :scope > .lc-list-marker, :scope > .cm-list-1 > .lc-list-marker'
      );

      let markerRect: DOMRect | null = null;
      if (marker) {
        const range = document.createRange();
        range.selectNodeContents(marker);
        markerRect = range.getBoundingClientRect();
      }

      return {
        text: ownText(el)
          .map((n) => n.data)
          .join('')
          .trim(),
        callout: el.classList.contains('lc-list-callout'),
        glyphLeft: drawn(glyph)?.left ?? null,
        markerLeft: markerRect?.left ?? null,
        markerCenter: markerRect
          ? (markerRect.left + markerRect.right) / 2
          : null,
        bandLeft: drawn(el.querySelector(':scope > .lc-list-bg'))?.left ?? null,
        textLeft: textLeftOf(el, marker ?? glyph),
      };
    });
  }, root);
}
