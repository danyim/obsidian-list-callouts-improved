import { Editor, EditorChange } from 'obsidian';

import { CalloutConfig } from './settings';

/**
 * Edits that strip the callout marker from every line the selections touch.
 *
 * `config.re` is the editor pattern from `buildEditorConfig`: group 1 is the
 * list prefix, so its length is where the marker starts, and group 2 is the
 * marker itself, which is always followed by a space. Lines with no callout
 * contribute nothing, so a run over a mixed selection leaves them untouched.
 */
export function removeCalloutChanges(
  editor: Editor,
  config: CalloutConfig
): EditorChange[] {
  const changes: EditorChange[] = [];
  // Selections can overlap on the same line -- a multi-cursor on one line, for
  // instance -- and two edits to the same range would fight each other.
  const seen = new Set<number>();

  for (const selection of editor.listSelections()) {
    const first = Math.min(selection.anchor.line, selection.head.line);
    const last = Math.max(selection.anchor.line, selection.head.line);

    for (let line = first; line <= last; line++) {
      if (seen.has(line)) continue;
      seen.add(line);

      const match = config.re.exec(editor.getLine(line));
      if (!match) continue;

      const ch = match[1].length;

      changes.push({
        from: { line, ch },
        to: { line, ch: ch + match[2].length + 1 },
        text: '',
      });
    }
  }

  return changes;
}
