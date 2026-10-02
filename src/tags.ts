import { Callout } from './settings';

/**
 * The characters Obsidian allows in a tag's name: anything but whitespace,
 * the ASCII punctuation other than `-`, `_` and `/`, and the Unicode
 * punctuation blocks. A tag ends at the first character outside it, which is
 * how `#meeting.` or `#meeting)` still carry the `#meeting` tag.
 */
const TAG_NAME =
  '[^\\s!"#$%&\'()*+,.:;<=>?@^`{|}~\\[\\]\\\\\\u2000-\\u206F\\u2E00-\\u2E7F]+';

/** A callout character that is a whole tag, `#` and a name. */
const TAG_CALLOUT_RE = new RegExp(`^#(${TAG_NAME})$`);

/**
 * A tag in running text. Obsidian's editor only starts one at the beginning
 * of the text or after whitespace, so `a#b` and `(#b)` are no tags; group 1
 * is that lead-in, group 2 the name. A source string rather than a RegExp,
 * since each search needs a global one of its own to keep its place in.
 */
const TAG_IN_TEXT = `(^|\\s)#(${TAG_NAME})`;

/**
 * Whether a tag preceded by `before` starts where the editor would start
 * one. Reading view renders a few more as tags than the editor does
 * (`[#meeting]`), and this keeps the two renderers to the same tags.
 */
export function tagCanStartAfter(before: string): boolean {
  return before === '' || /\s$/.test(before);
}

/** Obsidian's rule that a tag needs something besides digits: `#2024` is not one. */
function isTagName(name: string): boolean {
  return !/^\d+$/.test(name);
}

/**
 * The tag a callout stands for, lowercased and without its `#`, or null when
 * its character is not a tag. Lowercased because Obsidian treats `#Meeting`
 * and `#meeting` as the same tag.
 */
export function calloutTag(callout: Callout): string | null {
  const match = TAG_CALLOUT_RE.exec(callout.char);
  return match && isTagName(match[1]) ? match[1].toLowerCase() : null;
}

/**
 * The tag callouts by tag, or null when there are none. Two callouts for the
 * same tag differ at most in case, and the one lower in the list wins, as it
 * does for two callouts with the same character.
 */
export function calloutsByTag(
  callouts: Callout[]
): Record<string, Callout> | null {
  const byTag: Record<string, Callout> = {};
  let any = false;

  for (const callout of callouts) {
    const tag = calloutTag(callout);
    if (tag === null) continue;
    byTag[tag] = callout;
    any = true;
  }

  return any ? byTag : null;
}

/**
 * The callout for a tag, given without its `#`. A nested tag with no callout
 * of its own takes its nearest parent's, so `#task/work/review` falls back
 * to `#task/work` and then to `#task`.
 */
export function calloutForTag(
  tag: string,
  tags: Record<string, Callout>
): Callout | null {
  let name = tag.toLowerCase().replace(/\/+$/, '');

  for (;;) {
    if (tags[name]) return tags[name];
    const slash = name.lastIndexOf('/');
    if (slash <= 0) return null;
    name = name.slice(0, slash);
  }
}

/** A tag in some text that has a callout: where it sits and whose it is. */
export interface TagMatch {
  callout: Callout;
  /** Offset of the `#`. */
  from: number;
  /** Offset just past the tag's name. */
  to: number;
  /** The tag as written, `#` included. */
  text: string;
}

/**
 * Each tag in `text` from `start` on that has a callout, in order. A
 * generator, so a caller that has to confirm a candidate (the editor asks its
 * syntax tree, since `#tag` inside inline code is no tag) can move on to the
 * next without the rest of the line being searched first.
 */
export function* tagMatches(
  text: string,
  tags: Record<string, Callout>,
  start = 0
): Generator<TagMatch> {
  // One back, so a tag right at `start` still has the whitespace before it
  // to match as its lead-in.
  const re = new RegExp(TAG_IN_TEXT, 'g');
  re.lastIndex = Math.max(0, start - 1);

  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const name = match[2];
    const from = match.index + match[1].length;
    if (from < start || !isTagName(name)) continue;

    const callout = calloutForTag(name, tags);
    if (!callout) continue;

    yield { callout, from, to: from + 1 + name.length, text: `#${name}` };
  }
}
