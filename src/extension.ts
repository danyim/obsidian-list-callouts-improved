import {
  syntaxTree,
  syntaxTreeAvailable,
  tokenClassNodeProp,
} from '@codemirror/language';
import {
  EditorState,
  Line,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { editorLivePreviewField, setIcon } from 'obsidian';

import { CalloutConfig } from './settings';

export const setConfig = StateEffect.define<CalloutConfig>();

export class CalloutBackground extends WidgetType {
  toDOM() {
    return createSpan({
      cls: 'lc-list-bg',
      attr: {
        'aria-hidden': 'true',
      },
    });
  }
  eq(): boolean {
    return true;
  }
}

export class CalloutMarker extends WidgetType {
  char: string;
  icon?: string;

  constructor(char: string, icon?: string) {
    super();

    this.char = char;
    this.icon = icon;
  }

  toDOM() {
    return createSpan(
      {
        text: this.char,
        cls: 'lc-list-marker',
        attr: {
          'aria-hidden': 'true',
        },
      },
      (s) => {
        if (this.icon) {
          setIcon(s, this.icon);
        }
      }
    );
  }

  eq(widget: CalloutMarker): boolean {
    return widget.char === this.char && widget.icon === this.icon;
  }
}

export class HighlightMarker extends WidgetType {
  constructor(readonly icon: string) {
    super();
  }

  toDOM() {
    return createSpan(
      { cls: 'lc-highlight-marker', attr: { 'aria-hidden': 'true' } },
      (s) => setIcon(s, this.icon)
    );
  }

  eq(widget: HighlightMarker): boolean {
    return widget.icon === this.icon;
  }
}

export const calloutDecoration = (char: string, color: string) =>
  Decoration.line({
    attributes: {
      class: 'lc-list-callout',
      style: `--lc-callout-color: ${color}`,
      'data-callout': char,
    },
  });

export const highlightDecoration = (char: string, color: string) =>
  Decoration.mark({
    class: 'lc-highlight-callout',
    // Without this, the mark and the marker widget it wraps start at the same
    // position with the widget sorted first, which puts the widget's DOM node
    // before the mark's span rather than inside it -- and the marker's colour
    // is set via a custom property on the mark, so it has to be a descendant.
    inclusiveStart: true,
    attributes: {
      style: `--lc-callout-color: ${color}`,
      'data-callout': char,
    },
  });

export const calloutsConfigField = StateField.define<CalloutConfig>({
  create() {
    return { callouts: {}, re: null, highlightRe: null };
  },
  update(state, tr) {
    for (const e of tr.effects) {
      if (e.is(setConfig)) {
        state = e.value;
      }
    }

    return state;
  },
});

/**
 * Whether a line whose text already matched the callout pattern is really a
 * list item, rather than something that merely looks like one inside a fenced
 * code block.
 *
 * When the parser has not reached this line the answer is taken on trust. The
 * pattern is anchored to a list marker at the start of the line, so a false
 * positive needs a code block containing list-shaped text, and the next update
 * after the parser catches up corrects it. Waiting for the parser instead
 * means rendering nothing at all, which is what happens when a large document
 * is scrolled past the parsed region.
 */
function isListLine(state: EditorState, line: Line): boolean {
  if (!syntaxTreeAvailable(state, line.to)) return true;

  let isList = false;

  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node): false | void {
      if (isList) return false;

      const prop = node.type.prop(tokenClassNodeProp);

      if (prop && /formatting-list/.test(prop)) {
        isList = true;
        return false;
      }
    },
  });

  return isList;
}

/**
 * Whether `pos` sits inside an Obsidian highlight rather than, say, a code
 * block that happens to contain `==& text==`. Taken on trust when the parser
 * has not reached it, for the same reason isListLine is.
 */
function isHighlightAt(state: EditorState, pos: number): boolean {
  if (!syntaxTreeAvailable(state, pos)) return true;

  const prop = syntaxTree(state)
    .resolveInner(pos, 1)
    .type.prop(tokenClassNodeProp);

  return !!prop && /highlight/.test(prop);
}

function selectionTouches(
  state: EditorState,
  from: number,
  to: number
): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

export interface BuildStats {
  /** Confirmed highlights, hidden or revealed. */
  highlights: number;
}

/**
 * Add the decorations for every highlight callout on `line`.
 *
 * Each one is a mark over the content plus, in Live Preview, a replacement
 * hiding the character and the space -- or showing the icon in their place.
 * The replacement is dropped while the selection touches the highlight, so
 * the raw `==& ` is there to edit, which is what Obsidian does with `==`.
 */
function addHighlightDecos(
  builder: RangeSetBuilder<Decoration>,
  line: Line,
  config: CalloutConfig,
  state: EditorState,
  stats?: BuildStats
) {
  const re = config.highlightRe;
  const livePreview = state.field(editorLivePreviewField, false) ?? false;

  re.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(line.text))) {
    const callout = config.callouts[match[1]];
    if (!callout) continue;

    const from = line.from + match.index;
    const to = from + match[0].length;
    const contentFrom = from + 2;
    const contentTo = to - 2;
    const markerTo = contentTo - match[2].length;

    if (!isHighlightAt(state, contentFrom)) continue;

    if (stats) stats.highlights++;

    // Added before the replacement: both start at contentFrom, and the mark's
    // inclusiveStart makes it sort first, which is what nests the replacement
    // -- the icon widget, when there is one -- inside the mark's span rather
    // than putting it before as a sibling.
    builder.add(
      contentFrom,
      contentTo,
      highlightDecoration(callout.char, callout.color)
    );

    if (livePreview && !selectionTouches(state, from, to)) {
      builder.add(
        contentFrom,
        markerTo,
        Decoration.replace(
          callout.icon ? { widget: new HighlightMarker(callout.icon) } : {}
        )
      );
    }
  }
}

/**
 * Build the callout decorations for everything on screen.
 *
 * Walks the visible lines and tests each against the callout pattern, rather
 * than walking every syntax node in the viewport. The viewport holds a few
 * dozen lines whatever the document's size, and only the handful that match
 * are looked up in the syntax tree.
 */
export function buildCalloutDecos(
  view: EditorView,
  state: EditorState,
  stats?: BuildStats
) {
  const config = state.field(calloutsConfigField);
  if ((!config?.re && !config?.highlightRe) || !view.visibleRanges.length)
    return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = state;

  // Visible ranges can start partway through a line, so consecutive ranges can
  // both land on the same one. RangeSetBuilder requires positions in
  // increasing order and throws otherwise, and CodeMirror answers a throwing
  // view plugin by dropping its decorations entirely, so a repeated line takes
  // every callout off the screen rather than duplicating one.
  let lastLine = 0;

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);

    for (;;) {
      if (line.number <= lastLine) {
        if (line.to >= to || line.number >= doc.lines) break;
        line = doc.line(line.number + 1);
        continue;
      }

      lastLine = line.number;

      const match = config.re ? line.text.match(config.re) : null;
      const callout = match ? config.callouts[match[2]] : null;

      if (callout && isListLine(state, line)) {
        const labelPos = line.from + match[1].length;

        // Set the line class and callout color
        builder.add(
          line.from,
          line.from,
          calloutDecoration(callout.char, callout.color)
        );

        // Add the callout background element
        builder.add(
          line.from,
          line.from,
          Decoration.widget({ widget: new CalloutBackground(), side: -1 })
        );

        // Decorate the callout marker
        builder.add(
          labelPos,
          labelPos + callout.char.length,
          Decoration.replace({
            widget: new CalloutMarker(callout.char, callout.icon),
          })
        );
      }

      // `includes` is the whole cost for a line without highlights.
      if (config.highlightRe && line.text.includes('==')) {
        addHighlightDecos(builder, line, config, state, stats);
      }

      if (line.to >= to || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }

  return builder.finish();
}

export const calloutExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hasHighlights = false;

    constructor(view: EditorView) {
      this.build(view, view.state);
    }

    build(view: EditorView, state: EditorState) {
      const stats: BuildStats = { highlights: 0 };
      this.decorations = buildCalloutDecos(view, state, stats);
      this.hasHighlights = stats.highlights > 0;
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        // The parser runs in the background, so a line can be unparsed when it
        // is first drawn. Rebuilding as the tree advances is what lets those
        // lines pick up their decorations without an edit.
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        // A highlight's marker is hidden or revealed by where the caret is,
        // so caret movement matters -- but only on a screen that has one.
        (update.selectionSet && this.hasHighlights) ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setConfig))
        )
      ) {
        this.build(update.view, update.state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
