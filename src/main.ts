import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import escapeStringRegexp from 'escape-string-regexp';
import { MarkdownView, Plugin, debounce } from 'obsidian';

import { removeCalloutChanges } from './commands';
import { loadCustomIcons, unloadCustomIcons } from './customIcons';
import {
  buildCalloutDecos,
  calloutExtension,
  calloutsConfigField,
  setConfig,
} from './extension';
import { legacySettingsExist, readLegacySettings } from './import';
import { buildPostProcessor } from './postProcessor';
import {
  Callout,
  CalloutConfig,
  ListCalloutsSettings,
  mergeCallouts,
} from './settings';
import { ListCalloutSettingTab } from './settingsTab';

export default class ListCalloutsPlugin extends Plugin {
  settings: ListCalloutsSettings;
  postProcessorConfig: CalloutConfig;

  /**
   * Whether this vault still holds settings from the plugin this one was
   * forked from. Resolved once during load so the settings tab can decide
   * synchronously whether to offer the import.
   */
  legacyDataAvailable = false;

  /** The settings tab, kept so structural changes can ask it to re-read. */
  settingTab: ListCalloutSettingTab;

  /** Icon ids registered from the vault's icon folder, to unregister on unload. */
  customIconIds: string[] = [];

  async onload() {
    await this.loadSettings();
    this.buildPostProcessorConfig();

    this.legacyDataAvailable = await legacySettingsExist(this.app);

    await this.registerCustomIcons();

    this.settingTab = new ListCalloutSettingTab(this);
    this.addSettingTab(this.settingTab);

    this.registerMarkdownPostProcessor(
      buildPostProcessor(() => this.postProcessorConfig),
      10000
    );

    this.addCommand({
      id: 'remove-callout',
      name: 'Remove callout',
      editorCallback: (editor) => {
        const changes = removeCalloutChanges(editor, this.buildEditorConfig());
        // One transaction, so a single undo puts every line back.
        if (changes.length) editor.transaction({ changes });
      },
    });

    this.registerEditorExtension([
      calloutsConfigField.init(() => {
        return this.buildEditorConfig();
      }),
      calloutExtension,
    ]);

    this.app.workspace.trigger('parse-style-settings');
  }

  /**
   * Build the callout decorations for a given set of visible ranges.
   *
   * A seam for the tests. Two consecutive visible ranges landing on the same
   * line is something a real viewport produces only occasionally, depending on
   * what is on screen, and there is no way to arrange it through the editor on
   * demand. Getting it wrong takes every callout off the screen rather than
   * failing loudly, so it is worth being able to hand the builder those ranges
   * directly.
   */
  buildDecorations(view: EditorView, state: EditorState) {
    return buildCalloutDecos(view, state);
  }

  onunload() {
    // These are registered globally, so hand them back when the plugin goes.
    unloadCustomIcons(this.customIconIds);
    this.customIconIds = [];
  }

  /**
   * Register the vault's own SVG icons so they show up in the icon picker
   * alongside the ones Obsidian ships.
   */
  async registerCustomIcons(): Promise<void> {
    const { registered, skipped } = await loadCustomIcons(this.app);

    this.customIconIds = registered;

    for (const { file, reason } of skipped) {
      console.warn(
        `List Callouts, Improved: skipped custom icon ${file}: ${reason}`
      );
    }
  }

  emitSettingsUpdate = debounce(() => this.dispatchUpdate(), 2000, true);

  dispatchUpdate() {
    const newConfig = this.buildEditorConfig();

    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const view = leaf.view as MarkdownView;
      // `cm` is the underlying CodeMirror instance; not part of the public API.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- untyped access to a private field
      const cm = (view.editor as any).cm as EditorView;

      cm?.dispatch({
        effects: [setConfig.of(newConfig)],
      });
    });
  }

  private calloutsByChar(): Record<string, Callout> {
    return this.settings.reduce<Record<string, Callout>>((record, curr) => {
      record[curr.char] = curr;
      return record;
    }, {});
  }

  private charPattern(): string {
    return this.settings
      .map((callout) => escapeStringRegexp(callout.char))
      .join('|');
  }

  buildEditorConfig(): CalloutConfig {
    return {
      callouts: this.calloutsByChar(),
      re: new RegExp(
        `(^\\s*[-*+](?: \\[.\\])? |^\\s*\\d+[\\.\\)](?: \\[.\\])? )(${this.charPattern()}) `
      ),
    };
  }

  buildPostProcessorConfig() {
    this.postProcessorConfig = {
      callouts: this.calloutsByChar(),
      re: new RegExp(`^(${this.charPattern()}) `),
    };
  }

  /**
   * Replace the current callouts with the ones saved by List Callouts.
   * Resolves with the number of callouts read, or rejects with a displayable
   * message if the stored data is missing or malformed.
   */
  async importLegacySettings(): Promise<number> {
    const legacy = await readLegacySettings(this.app);

    this.settings = mergeCallouts(legacy);
    await this.saveSettings();

    return legacy.length;
  }

  async loadSettings() {
    this.settings = mergeCallouts((await this.loadData()) as Callout[]);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.emitSettingsUpdate();
    this.buildPostProcessorConfig();
  }
}
