import { App, Modal, Setting, getIcon } from 'obsidian';

import { Callout, NEW_CALLOUT_COLOR } from './settings';
import { calloutTag } from './tags';

/**
 * Callout Manager (eth-p/obsidian-callout-manager) lists every callout the
 * vault can style: its own custom ones, and the ones themes and CSS snippets
 * define, which it finds by reading their stylesheets as they load. Only its
 * running instance knows the snippet and theme ones, so the import asks its
 * plugin API rather than reading its data.json.
 */
export const CALLOUT_MANAGER_ID = 'callout-manager';

export const CALLOUT_MANAGER_NAME = 'Callout Manager';

/**
 * The parts of Callout Manager's v1 API the import reads, from its `api/`
 * folder. Declared here instead of depending on its npm package, which is an
 * alpha that stopped being published in 2023 and only wraps the lookup in
 * `calloutManager()` below.
 */
interface CalloutManagerCallout {
  id: string;
  icon: string;
  sources: ReadonlyArray<{ type: 'builtin' | 'snippet' | 'theme' | 'custom' }>;
}

interface CalloutManagerApi {
  getCallouts(): ReadonlyArray<CalloutManagerCallout>;
  getColor(
    callout: CalloutManagerCallout
  ): { r: number; g: number; b: number } | { invalid: string };
}

interface CalloutManagerPlugin {
  // Without a consumer plugin the handle can't listen for changes, which a
  // one-time import doesn't need, and there is nothing to clean up after.
  newApiHandle(
    version: 'v1',
    consumer: undefined,
    cleanup: () => void
  ): Promise<CalloutManagerApi>;
}

/** `App.plugins`, which Obsidian's typings leave out. */
interface AppWithPlugins {
  plugins?: {
    enabledPlugins: Set<string>;
    plugins: Record<string, unknown>;
  };
}

function calloutManager(app: App): CalloutManagerPlugin | null {
  const plugins = (app as unknown as AppWithPlugins).plugins;
  if (!plugins?.enabledPlugins.has(CALLOUT_MANAGER_ID)) return null;

  const instance = plugins.plugins[CALLOUT_MANAGER_ID] as
    Partial<CalloutManagerPlugin> | undefined;
  return typeof instance?.newApiHandle === 'function'
    ? (instance as CalloutManagerPlugin)
    : null;
}

/** Whether Callout Manager is enabled and loaded, so there is something to import. */
export function calloutManagerAvailable(app: App): boolean {
  return calloutManager(app) !== null;
}

export interface CalloutManagerImport {
  /** New tag callouts, one per Callout Manager callout we don't have yet. */
  added: Callout[];
  /** Ids already covered by one of our callouts. */
  existing: string[];
  /** Ids that can't be a tag, such as `2024` or `to do`. */
  invalid: string[];
}

/** `r, g, b`, up to three digits a channel; the range is checked after. */
const BARE_RGB = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/;

/**
 * A callout's color in our `r, g, b` form, or null when there's none to use.
 * Callout Manager only parses `rgb()` and hex, and calls anything else
 * invalid. That includes the bare `r, g, b` Obsidian's own stylesheet uses
 * for `--callout-color`, which most snippets copy, so that form is read
 * here. Anything else, such as a CSS variable, is left to the caller.
 */
function calloutColor(
  color: ReturnType<CalloutManagerApi['getColor']>
): string | null {
  if ('r' in color) return `${color.r}, ${color.g}, ${color.b}`;

  const match = BARE_RGB.exec(color.invalid);
  if (!match) return null;

  const channels = match.slice(1).map(Number);
  return channels.every((c) => c <= 255) ? channels.join(', ') : null;
}

/**
 * Turn Callout Manager's callouts into tag callouts, so `- #definition` takes
 * the color and icon `> [!definition]` has. Obsidian's built-in callouts are
 * left out: those are Obsidian's, not the user's, and a vault would gain two
 * dozen tag callouts it never asked for.
 */
export function planCalloutManagerImport(
  current: Callout[],
  api: CalloutManagerApi
): CalloutManagerImport {
  const plan: CalloutManagerImport = { added: [], existing: [], invalid: [] };

  const taken = new Set<string>();
  for (const callout of current) {
    const tag = calloutTag(callout);
    if (tag !== null) taken.add(tag);
  }

  for (const source of api.getCallouts()) {
    if (source.sources.some((s) => s.type === 'builtin')) continue;

    const callout: Callout = {
      char: `#${source.id}`,
      color: NEW_CALLOUT_COLOR,
      custom: true,
    };

    const tag = calloutTag(callout);
    if (tag === null) {
      plan.invalid.push(source.id);
      continue;
    }
    if (taken.has(tag)) {
      plan.existing.push(source.id);
      continue;
    }
    taken.add(tag);

    // Without a color we can read, it keeps the new-callout default, which
    // the user can change from the settings tab.
    const color = calloutColor(api.getColor(source));
    if (color !== null) callout.color = color;

    // Only an icon this vault can draw, or the marker would be blank.
    if (source.icon && getIcon(source.icon) !== null) {
      callout.icon = source.icon;
    }

    plan.added.push(callout);
  }

  return plan;
}

/**
 * Ask the running Callout Manager for its callouts. Rejects with a
 * displayable message if it has been turned off since the tab opened.
 */
export async function readCalloutManager(
  app: App,
  current: Callout[]
): Promise<CalloutManagerImport> {
  const plugin = calloutManager(app);
  if (plugin === null) {
    throw new Error(`${CALLOUT_MANAGER_NAME} is not enabled.`);
  }

  const api = await plugin.newApiHandle('v1', undefined, () => {});
  return planCalloutManagerImport(current, api);
}

/** At most this many tags are named in the confirmation; the rest are counted. */
const LISTED_TAGS = 12;

function tagList(ids: string[]): string {
  const tags = ids.slice(0, LISTED_TAGS).map((id) => `#${id}`);
  const more = ids.length - tags.length;
  return more > 0 ? `${tags.join(', ')} and ${more} more` : tags.join(', ');
}

/**
 * Shows what the import adds and what it leaves out before anything is
 * saved. It only adds, so the user's own callouts are safe either way, but
 * a vault with many Callout Manager callouts gains a long list at once.
 */
export class ConfirmCalloutManagerImportModal extends Modal {
  constructor(
    app: App,
    private plan: CalloutManagerImport,
    private tagCallouts: boolean,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { added, existing, invalid } = this.plan;

    // Modal.setTitle() postdates our minAppVersion; titleEl does not.
    this.titleEl.setText(`Import from ${CALLOUT_MANAGER_NAME}`);

    this.contentEl.createEl('p', {
      text: `Adds ${added.length} tag callout${added.length === 1 ? '' : 's'} with the colors and icons ${CALLOUT_MANAGER_NAME} gives them now: ${tagList(added.map((c) => c.char.slice(1)))}.`,
    });

    if (existing.length > 0) {
      this.contentEl.createEl('p', {
        text: `Already here, so left as they are: ${tagList(existing)}.`,
      });
    }

    if (invalid.length > 0) {
      this.contentEl.createEl('p', {
        text: `Skipped, since they can't be tags: ${invalid.join(', ')}.`,
      });
    }

    if (!this.tagCallouts) {
      this.contentEl.createEl('p', {
        text: 'Tag callouts is off, so these color an item only when it starts with the tag. Turn it on to color items with the tag anywhere on their first line.',
      });
    }

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText('Import')
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
