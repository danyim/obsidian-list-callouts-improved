import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import escapeStringRegexp from 'escape-string-regexp';
import { Editor, EditorChange, MarkdownView, Plugin, debounce } from 'obsidian';

import { cycleCalloutChanges, removeCalloutChanges } from './commands';
import { loadCustomIcons, unloadCustomIcons } from './customIcons';
import {
  BuildStats,
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
  DEFAULT_COLOR_NESTED_ITEMS,
  DEFAULT_HIDE_BULLETS,
  HIDE_BULLETS_CLASS,
  HighlightSettings,
  ListCalloutsSettings,
  PluginData,
  defaultCallouts,
  defaultHighlightSettings,
} from './settings';
import { ListCalloutSettingTab } from './settingsTab';

export default class ListCalloutsPlugin extends Plugin {
  settings: ListCalloutsSettings;
  highlights: HighlightSettings;
  hideBullets: boolean;
  colorNestedItems: boolean;
  postProcessorConfig: CalloutConfig;

  /**
   * The nested items preference as last pushed to the open views, so a save
   * can tell whether it is the one that flipped it.
   */
  private appliedColorNestedItems: boolean;

  /**
   * Whether this vault still holds settings from the plugin this one was
   * forked from. Resolved during load so the settings tab can decide
   * synchronously whether to offer the import, and re-checked each time the
   * tab opens, since the other plugin may have saved its settings since.
   */
  legacyDataAvailable = false;

  /** The settings tab, kept so structural changes can ask it to re-read. */
  settingTab: ListCalloutSettingTab;

  /** Icon ids registered from the vault's icon folder, to unregister on unload. */
  customIconIds: string[] = [];

  /**
   * The editor's view plugin, exposed so a test can hand it to
   * `EditorView.plugin()` and ask whether CodeMirror still has it running in a
   * given editor: it comes back null once a plugin has thrown.
   */
  readonly editorViewPlugin = calloutExtension;

  async onload() {
    await this.loadSettings();
    this.buildPostProcessorConfig();
    this.applyHideBullets();
    this.appliedColorNestedItems = this.colorNestedItems;

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

    // A popout window starts with a body of its own, so it is told the
    // preference as it opens; the main window's was told during load.
    this.registerEvent(
      this.app.workspace.on('window-open', (win) => {
        win.doc.body.toggleClass(HIDE_BULLETS_CLASS, this.hideBullets);
      })
    );

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
  buildDecorations(view: EditorView, state: EditorState, stats?: BuildStats) {
    return buildCalloutDecos(view, state, stats);
  }

  onunload() {
    // These are registered globally, so hand them back when the plugin goes.
    unloadCustomIcons(this.customIconIds);
    this.customIconIds = [];
    for (const doc of this.documents()) {
      doc.body.removeClass(HIDE_BULLETS_CLASS);
    }
  }

  /**
   * The document of every window a note can be shown in: the main one and
   * each popout, which has a body of its own.
   */
  private documents(): Document[] {
    const docs = new Set<Document>([document]);
    this.app.workspace.iterateAllLeaves((leaf) => {
      docs.add(leaf.getContainer().doc);
    });
    return Array.from(docs);
  }

  /**
   * Put the body class the stylesheet keys on in step with the preference.
   * A class on the body rather than on each callout line: it reaches every
   * open editor and rendered note at once, with nothing to re-decorate or
   * re-render, and the settings tab's previews with it.
   */
  private applyHideBullets(): void {
    let changed = false;
    for (const doc of this.documents()) {
      if (doc.body.hasClass(HIDE_BULLETS_CLASS) === this.hideBullets) continue;
      doc.body.toggleClass(HIDE_BULLETS_CLASS, this.hideBullets);
      changed = true;
    }

    // Straight away, not through the debounced update: the bullets vanish
    // the moment the class flips, and the bands that were inset for them
    // should move in the same frame rather than two seconds later.
    if (changed) this.dispatchUpdate();
  }

  /**
   * Push a flipped nested items preference to every open view at once. The
   * editor takes it as a config change and redecorates; a reading view has
   * to render again, since the post-processor only sees a note as it is
   * rendered. Straight away rather than through the debounced update, as a
   * toggle is one deliberate change, not a color being typed.
   */
  private applyColorNestedItems(): void {
    if (this.appliedColorNestedItems === this.colorNestedItems) return;
    this.appliedColorNestedItems = this.colorNestedItems;

    this.dispatchUpdate();

    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const view = leaf.view as MarkdownView;
      if (view.getMode() === 'preview') view.previewMode.rerender(true);
    });
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

  /**
   * The highlight pattern, or null when there is nothing to match. `anchored`
   * is the post-processor's form, which tests the text of a <mark> the
   * renderer has already found; `whole` finds a complete span in a line of
   * raw markdown, and `opener` just the start of one, for a highlight that
   * closes on a later line.
   */
  private highlightPattern(
    chars: string,
    form: 'anchored' | 'whole' | 'opener'
  ): RegExp | null {
    if (!chars || !this.highlights.enabled) return null;

    const space = this.highlights.requireSpace ? ' ' : ' ?';

    switch (form) {
      case 'anchored':
        return new RegExp(`^(${chars})${space}`);
      case 'whole':
        return new RegExp(`==(${chars})${space}(.*?)==`, 'g');
      case 'opener':
        return new RegExp(`==(${chars})${space}`, 'g');
    }
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
      highlightRe: this.highlightPattern(chars, 'whole'),
      highlightOpenRe: this.highlightPattern(chars, 'opener'),
      hideBullets: this.hideBullets,
      colorNestedItems: this.colorNestedItems,
    };
  }

  buildPostProcessorConfig() {
    const chars = this.charPattern();

    this.postProcessorConfig = {
      callouts: this.calloutsByChar(),
      re: chars ? new RegExp(`^(${chars}) `) : null,
      highlightRe: this.highlightPattern(chars, 'anchored'),
      colorNestedItems: this.colorNestedItems,
    };
  }

  /**
   * Look for the legacy settings file again. Resolves true when the answer
   * differs from the last check, so a caller knows whether to re-render.
   */
  async recheckLegacyData(): Promise<boolean> {
    const available = await legacySettingsExist(this.app);
    const changed = available !== this.legacyDataAvailable;
    this.legacyDataAvailable = available;
    return changed;
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
    const stored = (await this.loadData()) as
      Callout[] | Partial<PluginData> | null;

    if (Array.isArray(stored)) {
      // Written before highlight settings existed.
      this.settings = stored;
      this.highlights = defaultHighlightSettings();
      this.hideBullets = DEFAULT_HIDE_BULLETS;
      this.colorNestedItems = DEFAULT_COLOR_NESTED_ITEMS;
    } else if (stored && Array.isArray(stored.callouts)) {
      // A vault that has saved is taken at its word, empty included --
      // reconstructing the built-ins here is what used to make deleting them
      // impossible. Missing highlight, bullet and nested item keys come from
      // a version that did not know them, so they take the defaults.
      this.settings = stored.callouts;
      this.highlights = { ...defaultHighlightSettings(), ...stored.highlights };
      this.hideBullets = stored.hideBullets ?? DEFAULT_HIDE_BULLETS;
      this.colorNestedItems =
        stored.colorNestedItems ?? DEFAULT_COLOR_NESTED_ITEMS;
    } else {
      this.settings = defaultCallouts();
      this.highlights = defaultHighlightSettings();
      this.hideBullets = DEFAULT_HIDE_BULLETS;
      this.colorNestedItems = DEFAULT_COLOR_NESTED_ITEMS;
    }
  }

  async saveSettings() {
    const data: PluginData = {
      callouts: this.settings,
      highlights: this.highlights,
      hideBullets: this.hideBullets,
      colorNestedItems: this.colorNestedItems,
    };

    await this.saveData(data);
    this.emitSettingsUpdate();
    this.buildPostProcessorConfig();
    this.applyHideBullets();
    this.applyColorNestedItems();
  }
}
