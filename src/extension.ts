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
  Rect,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { editorLivePreviewField, setIcon } from 'obsidian';

import { Callout, CalloutConfig, calloutColorStyle } from './settings';

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

  /**
   * Report this zero-length widget's position as a point taken from its
   * actual next sibling in the line, rather than letting CodeMirror measure
   * `toDOM()`'s own node. That node is `position: absolute` and stretched
   * across most of the line to paint the callout background, which is
   * exactly the shape of box CodeMirror's own coordinate-based hit-testing
   * doesn't expect -- End/Home and their macOS Cmd-Arrow equivalents resolve
   * a wrapped line's visual boundary this way (mgmeyers/obsidian-list-callouts#86).
   *
   * A `Range` collapsed at the start of the next sibling gives the same
   * coordinates the line's actual content would report on its own, with no
   * dependency on this widget's own CSS. Returning that (rather than `null`)
   * also matters beyond #86: callers like `RectangleMarker.forRange`, which
   * draws the cursor and selection, have no fallback for a `null` result --
   * they simply draw nothing.
   */
  coordsAt(dom: HTMLElement): Rect | null {
    const next = dom.nextSibling;
    if (!next) return null;

    const range = document.createRange();
    range.setStart(next, 0);
    range.setEnd(next, 0);

    const rect = range.getClientRects()[0];
    if (!rect) return null;

    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.left,
    };
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
  constructor(
    readonly char: string,
    readonly icon?: string
  ) {
    super();
  }

  toDOM() {
    return createSpan(
      {
        text: this.char,
        cls: 'lc-highlight-marker',
        attr: { 'aria-hidden': 'true' },
      },
      (s) => {
        if (this.icon) {
          setIcon(s, this.icon);
        }
      }
    );
  }

  eq(widget: HighlightMarker): boolean {
    return widget.char === this.char && widget.icon === this.icon;
  }
}

/**
 * The line class for a callout's own line, or for one of the lines its item
 * wraps onto (`continuation`). `continued` marks any line of the run that
 * has another after it, which is what lets the stylesheet join the bands
 * end to end instead of leaving the per-line spacing between them.
 */
export const calloutDecoration = (
  callout: Callout,
  continuation = false,
  continued = false
) =>
  Decoration.line({
    attributes: {
      class: [
        continuation ? 'lc-list-callout-continuation' : 'lc-list-callout',
        ...(continued ? ['lc-list-callout-continued'] : []),
      ].join(' '),
      style: calloutColorStyle(callout),
      'data-callout': callout.char,
    },
  });

/**
 * The mark over a highlight callout's content. Goes to
 * `EditorView.outerDecorations` rather than `decorations`, so that its span
 * wraps Obsidian's own `span.cm-highlight` instead of sitting inside it. That
 * is what lets a plain descendant selector in styles.css cancel Obsidian's
 * yellow underneath ours; the other way round, only `:has()` could reach the
 * parent. Obsidian's token highlighter is a `Prec.lowest` regular decoration
 * placed after every plugin's, so no precedence on ours would get it outside
 * (CodeMirror nests higher-precedence marks inside lower ones), but outer
 * decorations wrap around all regular ones by definition.
 */
export const highlightDecoration = (callout: Callout) =>
  Decoration.mark({
    class: 'lc-highlight-callout',
    // Without this, the mark and the marker widget it wraps start at the same
    // position with the widget sorted first, which puts the widget's DOM node
    // before the mark's span rather than inside it -- and the marker's color
    // is set via a custom property on the mark, so it has to be a descendant.
    // Between outer marks, it is also what puts ours before Obsidian's, and
    // so outside it, when the two cover exactly the same range.
    inclusiveStart: true,
    attributes: {
      style: calloutColorStyle(callout),
      'data-callout': callout.char,
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

/** Indented text with no list marker of its own: what a continuation line
 * looks like before the parser has said what it is. */
const INDENTED_TEXT = /^\s+(?![-*+] |\d+[.)] )\S/;

/**
 * Whether `line` is one a list item wraps onto: indented to the item's
 * content and carrying no marker of its own, the way Obsidian lays out a
 * hard or soft line break inside an item (#43). Anything else, a blank line
 * or the next item included, ends the item's run.
 *
 * Obsidian's parser names such a line node `HyperMD-list-line-nobullet`,
 * with nothing on its token class prop to go by, so the name is the signal.
 * A fenced code block or a quote inside the item is a nobullet line too,
 * which keeps the run whole, as reading mode's <li> is. Taken on trust from
 * the text alone when the parser has not reached the line, as isListLine is:
 * indented text with no list marker of its own, under an item that already
 * passed, and the next update after the parser catches up corrects a false
 * positive.
 */
function isContinuationLine(state: EditorState, line: Line): boolean {
  if (!INDENTED_TEXT.test(line.text)) return false;
  if (!syntaxTreeAvailable(state, line.to)) return true;

  let isContinuation = false;

  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node): false | void {
      if (isContinuation) return false;

      if (node.name.includes('HyperMD-list-line-nobullet')) {
        isContinuation = true;
        return false;
      }
    },
  });

  return isContinuation;
}

/**
 * The callout whose item `line` continues, when `line` is a continuation
 * line and the item's own line sits above it: walked back to from the first
 * line of a visible range, which is the one place the builder meets a
 * continuation line without having just passed its item's own line.
 */
function calloutContinuedAt(
  state: EditorState,
  config: CalloutConfig,
  line: Line
): Callout | null {
  if (!config.re) return null;

  while (line.number > 1 && isContinuationLine(state, line)) {
    line = state.doc.line(line.number - 1);

    const match = line.text.match(config.re);
    const callout = match ? config.callouts[match[2]] : null;
    if (callout) return isListLine(state, line) ? callout : null;
  }

  return null;
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

/** The two decoration sets one build produces, one per facet. */
export interface CalloutDecorations {
  /** Line classes, background and marker widgets: `EditorView.decorations`. */
  decorations: DecorationSet;
  /** Highlight marks: `EditorView.outerDecorations`, see highlightDecoration. */
  outerDecorations: DecorationSet;
}

/**
 * Where the highlight open at `pos` closes: the start of the next `==` token,
 * which may sit on a later line. Null when the parser has not reached the
 * closer, in which case a later rebuild (the tree advancing is already a
 * trigger) will find it.
 */
function highlightEndAfter(state: EditorState, pos: number): number | null {
  if (!syntaxTreeAvailable(state, pos)) return null;

  const cursor = syntaxTree(state).cursorAt(pos, 1);

  do {
    if (cursor.from >= pos) {
      const prop = cursor.type.prop(tokenClassNodeProp);
      if (prop && /formatting-highlight/.test(prop)) return cursor.from;
    }
  } while (cursor.next());

  return null;
}

/**
 * The tint over a callout character left in place as document text: source
 * mode's stand-in for the marker widget (#49). Only the color comes from
 * the callout, the same one the widget uses, so the character still reads
 * as the raw markdown it is.
 */
const rawMarkerDecoration = Decoration.mark({ class: 'lc-raw-marker' });

/**
 * Decorate one highlight callout: a mark over the content plus, in Live
 * Preview, a replacement showing the marker -- the character, or the icon
 * when one is set -- in place of the raw character and space. The
 * replacement is dropped while the selection touches the highlight, so the
 * raw `==& ` is there to edit, which is what Obsidian does with `==`. Source
 * mode keeps the raw character throughout and tints it instead.
 */
function addHighlightDeco(
  builder: RangeSetBuilder<Decoration>,
  outer: RangeSetBuilder<Decoration>,
  state: EditorState,
  callout: Callout,
  contentFrom: number,
  markerTo: number,
  contentTo: number,
  stats?: BuildStats
) {
  if (stats) stats.highlights++;

  outer.add(contentFrom, contentTo, highlightDecoration(callout));

  if (!isLivePreview(state)) {
    builder.add(
      contentFrom,
      contentFrom + callout.char.length,
      rawMarkerDecoration
    );
  } else if (!selectionTouches(state, contentFrom - 2, contentTo + 2)) {
    builder.add(
      contentFrom,
      markerTo,
      Decoration.replace({
        widget: new HighlightMarker(callout.char, callout.icon),
      })
    );
  }
}

/**
 * Add the decorations for every highlight callout that opens on `line`.
 *
 * Highlights that open and close on the line come straight from the regex. An
 * opener the regex left over has no closer on its line, so its extent is
 * taken from the syntax tree instead: Obsidian pairs it with the next `==`
 * wherever that falls, and the mark simply spans the lines in between.
 */
function addHighlightDecos(
  builder: RangeSetBuilder<Decoration>,
  outer: RangeSetBuilder<Decoration>,
  line: Line,
  config: CalloutConfig,
  state: EditorState,
  stats?: BuildStats
) {
  const re = config.highlightRe;
  let searchFrom = 0;

  re.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(line.text))) {
    searchFrom = re.lastIndex;

    const callout = config.callouts[match[1]];
    if (!callout) continue;

    const from = line.from + match.index;
    const contentFrom = from + 2;
    const contentTo = from + match[0].length - 2;

    if (!isHighlightAt(state, contentFrom)) continue;

    addHighlightDeco(
      builder,
      outer,
      state,
      callout,
      contentFrom,
      contentTo - match[2].length,
      contentTo,
      stats
    );
  }

  const open = config.highlightOpenRe;
  if (!open) return;

  open.lastIndex = searchFrom;
  const opener = open.exec(line.text);
  if (!opener) return;

  const callout = config.callouts[opener[1]];
  if (!callout) return;

  const contentFrom = line.from + opener.index + 2;
  if (!isHighlightAt(state, contentFrom)) return;

  const contentTo = highlightEndAfter(state, contentFrom);
  if (contentTo === null) return;

  addHighlightDeco(
    builder,
    outer,
    state,
    callout,
    contentFrom,
    line.from + opener.index + opener[0].length,
    contentTo,
    stats
  );
}

/** Whether the editor is in Live Preview, as opposed to source mode. */
function isLivePreview(state: EditorState): boolean {
  return state.field(editorLivePreviewField, false) ?? false;
}

/**
 * Build the callout decorations for everything on screen.
 *
 * Source mode is the rendering Obsidian keeps as raw markdown, so a callout
 * there shows as the `- & text` the user typed, the character there to see
 * and edit (mgmeyers/obsidian-list-callouts#35): no marker widget stands in
 * for it. The band and a highlight's color are drawn all the same, and the
 * character is tinted, so the callout is still told apart at a glance and
 * nothing is lost switching modes (#49).
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
): CalloutDecorations {
  const config = state.field(calloutsConfigField);
  if ((!config?.re && !config?.highlightRe) || !view.visibleRanges.length)
    return { decorations: Decoration.none, outerDecorations: Decoration.none };

  const livePreview = isLivePreview(state);
  const builder = new RangeSetBuilder<Decoration>();
  const outer = new RangeSetBuilder<Decoration>();
  const { doc } = state;

  // Visible ranges can start partway through a line, so consecutive ranges can
  // both land on the same one. RangeSetBuilder requires positions in
  // increasing order and throws otherwise, and CodeMirror answers a throwing
  // view plugin by dropping its decorations entirely, so a repeated line takes
  // every callout off the screen rather than duplicating one.
  let lastLine = 0;

  // The callout whose item the current line continues, carried from one
  // line to the next; null outside a run. `nextContinues` is the answer for
  // the line after the current one, which deciding the current line's
  // `continued` class already had to compute.
  let run: Callout | null = null;
  let nextContinues = false;

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);

    for (;;) {
      if (line.number <= lastLine) {
        if (line.to >= to || line.number >= doc.lines) break;
        line = doc.line(line.number + 1);
        continue;
      }

      // A range can open partway down an item, with the line that names the
      // callout above it. The carried state is only right for the line after
      // the last one processed, so anywhere else look back for the item.
      if (line.number !== lastLine + 1) {
        run = calloutContinuedAt(state, config, line);
        nextContinues = run !== null;
      }

      lastLine = line.number;

      const match = config.re ? line.text.match(config.re) : null;
      const callout = match ? config.callouts[match[2]] : null;
      const isHead = !!callout && isListLine(state, line);
      const continuation = !isHead && nextContinues ? run : null;

      run = isHead ? callout : continuation;

      if (run) {
        nextContinues =
          line.number < doc.lines &&
          isContinuationLine(state, doc.line(line.number + 1));

        // Set the line class and callout color
        builder.add(
          line.from,
          line.from,
          calloutDecoration(run, !!continuation, nextContinues)
        );

        // Add the callout background element
        builder.add(
          line.from,
          line.from,
          Decoration.widget({ widget: new CalloutBackground(), side: -1 })
        );

        if (!continuation) {
          const labelPos = line.from + match[1].length;

          // Decorate the callout marker: the widget in place of the
          // character, or the character itself, tinted, in source mode.
          builder.add(
            labelPos,
            labelPos + run.char.length,
            livePreview
              ? Decoration.replace({
                  widget: new CalloutMarker(run.char, run.icon),
                })
              : rawMarkerDecoration
          );
        }
      } else {
        nextContinues = false;
      }

      // `includes` is the whole cost for a line without highlights.
      if (config.highlightRe && line.text.includes('==')) {
        addHighlightDecos(builder, outer, line, config, state, stats);
      }

      if (line.to >= to || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }

  return { decorations: builder.finish(), outerDecorations: outer.finish() };
}

/**
 * The marker glyph a list line renders as pure decoration rather than
 * content -- a styled bullet dot or a checkbox -- as opposed to a number's
 * own digits. Both carry a left inset from where CalloutBackground would
 * otherwise start (Obsidian's own `padding-left` on the marker's formatting
 * span for a bullet; a few px of the same kind for a checkbox), which
 * `alignCalloutBackgrounds` halves rather than covers outright, matching
 * how a bullet or checkbox reference line looked before this fix existed.
 *
 * A number's digits are deliberately excluded here: unlike a small bullet
 * sitting in otherwise-empty space, a gap before a digit re-excludes part
 * of it from the highlight, not just empty padding -- which is exactly
 * mgmeyers/obsidian-list-callouts#91's own bug. There is also no fallback
 * to the raw "- " text: the active (cursor-holding) line shows that
 * unstyled, flush with the marker's own box, and covering that outright
 * already looks right with no adjustment.
 */
const DECORATIVE_MARKER_GLYPH_SELECTOR = '.list-bullet, .task-list-label';

/**
 * A nested list line's own `.cm-hmd-list-indent` wraps one span per ancestor
 * indent level -- CodeMirror renders it as a real, measurable element, unlike
 * the marker width folded into the line's own `padding-inline-start`, which
 * has no such breakdown between "ancestor indent" and "this item's own
 * marker." Its right edge is exactly the boundary `CalloutBackground` needs:
 * everything before it is indentation carried over from parent list items
 * (excluded), everything after is this item's own marker and text
 * (covered). A top-level line has no ancestors and so no such element,
 * which is also the case in which the background should reach the line's
 * own left edge, hence the 0 fallback.
 *
 * A continuation line's own indent element runs on past the ancestors'
 * indentation, through the item's content indent too, so its right edge
 * sits at the text, not at the marker. Its band takes the item's own line's
 * offset instead, which is what makes the two one band. That line is a
 * sibling above it, through any continuation lines in between; when the
 * viewport has scrolled it out of the DOM altogether, the ancestors'
 * indentation is measured off the continuation line itself: the start of
 * its content indent (`.cm-indent-spacing`), or the whole indent element
 * for a code block line inside the item, which has no such breakdown.
 */
function alignCalloutBackgrounds(view: EditorView) {
  view.requestMeasure<{ el: HTMLElement; indent: number }[]>({
    read(view) {
      const measured = new Map<HTMLElement, number>();

      const ownIndent = (line: HTMLElement) => {
        const indentGuide = line.querySelector<HTMLElement>(
          '.cm-hmd-list-indent'
        );
        const nestingIndent = indentGuide
          ? indentGuide.getBoundingClientRect().right -
            line.getBoundingClientRect().left
          : 0;

        // A glyph with no box is one the bullets preference has taken out
        // of flow (styles.css, .lc-hide-bullets), and its rect would read as
        // the viewport's origin. Without it the line is laid out like a
        // numbered one, so it gets a numbered line's band: no inset.
        const glyph = line.querySelector<HTMLElement>(
          DECORATIVE_MARKER_GLYPH_SELECTOR
        );
        const glyphInset =
          glyph && glyph.getClientRects().length
            ? glyph.getBoundingClientRect().left -
              (line.getBoundingClientRect().left + nestingIndent)
            : 0;

        return Math.max(0, nestingIndent + glyphInset / 2);
      };

      const continuedIndent = (line: HTMLElement) => {
        let head = line.previousElementSibling as HTMLElement | null;
        while (head?.classList.contains('lc-list-callout-continuation')) {
          head = head.previousElementSibling as HTMLElement | null;
        }
        // Visited before this line, in document order, so already measured.
        if (head?.classList.contains('lc-list-callout')) {
          const indent = measured.get(head);
          if (indent !== undefined) return indent;
        }

        const spacing = line.querySelector<HTMLElement>('.cm-indent-spacing');
        if (spacing) {
          return Math.max(
            0,
            spacing.getBoundingClientRect().left -
              line.getBoundingClientRect().left
          );
        }
        const indentGuide = line.querySelector<HTMLElement>(
          '.cm-hmd-list-indent'
        );
        return indentGuide
          ? Math.max(
              0,
              indentGuide.getBoundingClientRect().right -
                line.getBoundingClientRect().left
            )
          : 0;
      };

      return Array.from(
        view.dom.querySelectorAll<HTMLElement>('.lc-list-bg')
      ).flatMap((el) => {
        // Always a direct child by construction -- this widget is the one
        // inserted at line.from -- so this is parentElement in substance,
        // just without asking getBoundingClientRect's neighbor, closest, to
        // walk and re-match a selector for an answer already known.
        const line = el.parentElement;
        if (!line) return [];

        const indent = line.classList.contains('lc-list-callout-continuation')
          ? continuedIndent(line)
          : ownIndent(line);
        measured.set(line, indent);

        return [{ el, indent }];
      });
    },
    write(results) {
      for (const { el, indent } of results) {
        // Skipped when unchanged (the common case: most updates that reach
        // here at all still leave most on-screen lines' own nesting
        // exactly as it was) to avoid a style write, and the recalculation
        // it can trigger, for a value that would just be set back to itself.
        const next = `${indent}px`;
        if (el.style.left !== next) el.style.left = next;
      }
    },
  });
}

export const calloutExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    outerDecorations: DecorationSet = Decoration.none;
    hasHighlights = false;

    /** Whether a failed build has been logged for this editor already. */
    private reported = false;

    constructor(view: EditorView) {
      this.rebuild(view, view.state);
      alignCalloutBackgrounds(view);
    }

    /**
     * Build the decorations, or clear them if the build throws.
     *
     * CodeMirror answers an exception from a view plugin's constructor or
     * update by disabling the plugin for the rest of that editor's life, with
     * nothing but a console error to show for it. The plugin this one was
     * forked from went down that way whenever its parse budget ran out --
     * opening a vault with a long note restored, jumping deep into a large
     * document -- and every callout in the note stayed gone until the plugin
     * was toggled off and on (mgmeyers/obsidian-list-callouts#73, #75, #80).
     * Catching here keeps a failure to a single update: the next document,
     * viewport or parse-tree change runs the build again.
     */
    rebuild(view: EditorView, state: EditorState) {
      try {
        this.build(view, state);
      } catch (e) {
        this.decorations = Decoration.none;
        this.outerDecorations = Decoration.none;
        this.hasHighlights = false;

        if (!this.reported) {
          this.reported = true;
          console.error(
            'List Callouts, Improved: failed to build decorations, ' +
              'leaving this update undecorated:',
            e
          );
        }
      }
    }

    build(view: EditorView, state: EditorState) {
      const stats: BuildStats = { highlights: 0 };
      const built = buildCalloutDecos(view, state, stats);
      this.decorations = built.decorations;
      this.outerDecorations = built.outerDecorations;
      this.hasHighlights = stats.highlights > 0;
    }

    update(update: ViewUpdate) {
      // The parser runs in the background, so a line can be unparsed when it
      // is first drawn. Rebuilding as the tree advances is what lets those
      // lines pick up their decorations without an edit -- and is also the
      // only one of these three that can change a line's own nesting depth
      // without docChanged or viewportChanged already having done so (a
      // block quote or code fence resolving around an already-visible list).
      const layoutMayHaveChanged =
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState);

      // Switching between Live Preview and source mode reconfigures the
      // editor in place, with the document, viewport and tree as they were;
      // the marker is a widget in one and the tinted character in the other.
      const modeChanged =
        isLivePreview(update.state) !== isLivePreview(update.startState);

      if (
        layoutMayHaveChanged ||
        modeChanged ||
        // A highlight's marker is hidden or revealed by where the caret is,
        // so caret movement matters -- but only on a screen that has one.
        (update.selectionSet && this.hasHighlights) ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setConfig))
        )
      ) {
        this.rebuild(update.view, update.state);
      }

      // Nesting depth -- and so where each on-screen callout's own
      // background should start -- only ever moves alongside the document
      // or its viewport. A bare selection change or a setConfig effect
      // (recoloring, say) rebuilds decorations above but never moves a
      // marker, so re-measuring for either would just confirm nothing
      // changed at DOM-read cost. The one config change that does move
      // one is the bullets preference: a bullet line's band is inset for
      // its bullet, and that bullet has just been drawn or taken away. A
      // mode switch moves it the same way: source mode has no bullet glyph,
      // only the raw `- `.
      const hideBulletsChanged =
        update.startState.field(calloutsConfigField).hideBullets !==
        update.state.field(calloutsConfigField).hideBullets;

      if (layoutMayHaveChanged || hideBulletsChanged || modeChanged) {
        alignCalloutBackgrounds(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.outerDecorations.of(
        (view) => view.plugin(plugin)?.outerDecorations ?? Decoration.none
      ),
  }
);
