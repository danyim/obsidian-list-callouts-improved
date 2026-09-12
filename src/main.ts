import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import escapeStringRegexp from 'escape-string-regexp';
import { Editor, EditorChange, MarkdownView, Plugin, debounce } from 'obsidian';

import { cycleCalloutChanges, removeCalloutChanges } from './commands';
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
  defaultCallouts,
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
        this.applyChanges(
          editor,
          removeCalloutChanges(editor, this.buildEditorConfig())
        );
      },
    });

    this.addCommand({
      id: 'next-callout',
      name: 'Next callout',
      editorCallback: (editor) => this.cycleCallout(editor, 1),
    });

    this.addCommand({
      id: 'previous-callout',
      name: 'Previous callout',
      editorCallback: (editor) => this.cycleCallout(editor, -1),
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

  /** One transaction, so a single undo puts every changed line back. */
  private applyChanges(editor: Editor, changes: EditorChange[]) {
    if (changes.length) editor.transaction({ changes });
  }

  private cycleCallout(editor: Editor, direction: 1 | -1) {
    this.applyChanges(
      editor,
      cycleCalloutChanges(
        editor,
        this.buildEditorConfig(),
        this.settings,
        direction
      )
    );
  }

  emitSettingsUpdate = debounce(() => this.dispatchUpdate(), 2000, true);

  dispatchUpdate() {
    const newConfig = this.buildEditorConfig();

    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const view = leaf.view as MarkdownView;
      // `cm` is the underlying CodeMirror instance; not part of the public API.
      const cm = (view.editor as unknown as { cm?: EditorView }).cm;

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

  /**
   * The callout characters as a regex alternation, or '' when there are none
   * left -- every callout can be deleted, and an empty alternation would match
   * the empty string on every list item.
   */
  private charPattern(): string {
    return this.settings
      .map((callout) => escapeStringRegexp(callout.char))
      .join('|');
  }

  buildEditorConfig(): CalloutConfig {
    const chars = this.charPattern();

    return {
      callouts: this.calloutsByChar(),
      re: chars
        ? new RegExp(
            `(^\\s*[-*+](?: \\[.\\])? |^\\s*\\d+[\\.\\)](?: \\[.\\])? )(${chars}) `
          )
        : null,
    };
  }

  buildPostProcessorConfig() {
    const chars = this.charPattern();

    this.postProcessorConfig = {
      callouts: this.calloutsByChar(),
      re: chars ? new RegExp(`^(${chars}) `) : null,
    };
  }

  /**
   * Replace the current callouts with the ones saved by List Callouts.
   * Resolves with the number of callouts read, or rejects with a displayable
   * message if the stored data is missing or malformed.
   */
  async importLegacySettings(): Promise<number> {
    const legacy = await readLegacySettings(this.app);

    this.settings = legacy;
    await this.saveSettings();

    return legacy.length;
  }

  /** Put the built-in callouts back, discarding everything currently stored. */
  async resetSettings(): Promise<void> {
    this.settings = defaultCallouts();
    await this.saveSettings();
  }

  async loadSettings() {
    const stored = (await this.loadData()) as Callout[] | null;

    // A vault that has never saved settings gets the built-ins seeded. One
    // that has is taken at its word, empty included -- reconstructing the
    // built-ins here is what used to make deleting them impossible.
    this.settings = Array.isArray(stored) ? stored : defaultCallouts();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.emitSettingsUpdate();
    this.buildPostProcessorConfig();
  }
}
