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
import { setIcon } from 'obsidian';

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

export const calloutDecoration = (char: string, color: string) =>
  Decoration.line({
    attributes: {
      class: 'lc-list-callout',
      style: `--lc-callout-color: ${color}`,
      'data-callout': char,
    },
  });

export const calloutsConfigField = StateField.define<CalloutConfig>({
  create() {
    return { callouts: {}, re: null };
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
 * Build the callout decorations for everything on screen.
 *
 * Walks the visible lines and tests each against the callout pattern, rather
 * than walking every syntax node in the viewport. The viewport holds a few
 * dozen lines whatever the document's size, and only the handful that match
 * are looked up in the syntax tree.
 */
export function buildCalloutDecos(view: EditorView, state: EditorState) {
  const config = state.field(calloutsConfigField);
  if (!config?.re || !view.visibleRanges.length) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = state;

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);

    for (;;) {
      const match = line.text.match(config.re);
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

      if (line.to >= to || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }

  return builder.finish();
}

export const calloutExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildCalloutDecos(view, view.state);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        // The parser runs in the background, so a line can be unparsed when it
        // is first drawn. Rebuilding as the tree advances is what lets those
        // lines pick up their decorations without an edit.
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setConfig))
        )
      ) {
        this.decorations = buildCalloutDecos(update.view, update.state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
