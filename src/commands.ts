import { Editor, EditorChange } from 'obsidian';

import { Callout, CalloutConfig } from './settings';

/**
 * A list item's marker and any task checkbox -- the same shapes the prefix
 * group of `buildEditorConfig`'s pattern accepts.
 *
 * Needed separately because that pattern only matches a line that already
 * carries a callout, and cycling has to be able to start from a plain item.
 */
const LIST_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])(?: \[.\])? )/;

/**
 * Run `body` once for every line the selections touch, collecting the edits it
 * returns.
 *
 * Selections can overlap on the same line -- a multi-cursor on one line, for
 * instance -- and two edits to the same range would fight each other, so each
 * line is visited at most once.
 */
function changesForTouchedLines(
  editor: Editor,
  body: (line: number, text: string) => EditorChange | null
): EditorChange[] {
  const changes: EditorChange[] = [];
  const seen = new Set<number>();

  for (const selection of editor.listSelections()) {
    const first = Math.min(selection.anchor.line, selection.head.line);
    const last = Math.max(selection.anchor.line, selection.head.line);

    for (let line = first; line <= last; line++) {
      if (seen.has(line)) continue;
      seen.add(line);

      const change = body(line, editor.getLine(line));
      if (change) changes.push(change);
    }
  }

  return changes;
}

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
  if (!config.re) return [];

  return changesForTouchedLines(editor, (line, text) => {
    const match = config.re.exec(text);
    if (!match) return null;

    const ch = match[1].length;

    return {
      from: { line, ch },
      to: { line, ch: ch + match[2].length + 1 },
      text: '',
    };
  });
}

/**
 * Edits that step every line the selections touch one place through
 * `callouts`, in list order, wrapping at both ends.
 *
 * A plain list item is part of the cycle rather than only its starting point:
 * the step after the last callout clears the line, and the step before the
 * first does too. That keeps the two directions exact inverses of each other,
 * and means tapping past the callout you wanted comes back round instead of
 * stranding the line as a callout.
 *
 * Lines that are not list items contribute nothing, so a run over a mixed
 * selection leaves prose alone.
 */
export function cycleCalloutChanges(
  editor: Editor,
  config: CalloutConfig,
  callouts: Callout[],
  direction: 1 | -1
): EditorChange[] {
  if (!callouts.length) return [];

  // The callouts themselves plus the plain list item between the last and the
  // first. Positions run 0 (plain) to callouts.length, one ahead of the index
  // into `callouts`, so the wrap is a single modulo.
  const positions = callouts.length + 1;

  return changesForTouchedLines(editor, (line, text) => {
    const current = config.re?.exec(text);
    const prefix = current ? current[1] : LIST_PREFIX_RE.exec(text)?.[1];
    if (prefix === undefined) return null;

    const from = current
      ? callouts.findIndex((callout) => callout.char === current[2])
      : -1;
    const to = ((from + 1 + direction + positions) % positions) - 1;

    return {
      from: { line, ch: prefix.length },
      // A marker is always followed by a space, so it spans one more character
      // than the character itself.
      to: {
        line,
        ch: prefix.length + (current ? current[2].length + 1 : 0),
      },
      text: to === -1 ? '' : `${callouts[to].char} `,
    };
  });
}
