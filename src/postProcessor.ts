import { MarkdownPostProcessor, setIcon } from 'obsidian';

import { Callout, CalloutConfig, applyCalloutColors } from './settings';
import { calloutForTag, tagCanStartAfter } from './tags';

function getFirstTextNode(li: HTMLElement) {
  for (const node of Array.from(li.childNodes)) {
    if (
      node.nodeType === document.ELEMENT_NODE &&
      (node as HTMLElement).classList.contains('tasks-list-text')
    ) {
      const descriptionNode = (node as HTMLElement).firstElementChild;
      if (descriptionNode?.classList.contains('task-description')) {
        const textNode = descriptionNode.firstElementChild?.firstChild;
        if (textNode.nodeType === document.TEXT_NODE) {
          return textNode;
        }
      }
    }

    // A loose list puts each item's text in a <p>, and a task item's
    // checkbox goes inside it ahead of the text, so the first child is not
    // always the text itself.
    if (
      node.nodeType === document.ELEMENT_NODE &&
      (node as HTMLElement).tagName === 'P'
    ) {
      const first = node.firstChild;
      if (
        first?.nodeType === document.ELEMENT_NODE &&
        (first as HTMLElement).hasClass('task-list-item-checkbox')
      ) {
        return first.nextSibling;
      }
      return first;
    }

    if (node.nodeType !== document.TEXT_NODE) {
      continue;
    }

    if ((node as Text).nodeValue.trim() === '') {
      continue;
    }

    return node;
  }

  return null;
}

/**
 * Elements that start a new line of an item: a line break, the second of a
 * loose item's paragraphs, or a block such as a code block or a quote.
 */
const LINE_ENDS = new Set([
  'BR',
  'P',
  'PRE',
  'BLOCKQUOTE',
  'TABLE',
  'HR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

/**
 * The tags on the item's first line, in order: the line the editor looks
 * at, and nothing on the lines the item wraps onto or in what is nested
 * under it, so the two renderers agree on which items are callouts.
 */
function firstLineTags(li: HTMLElement): HTMLElement[] {
  const tags: HTMLElement[] = [];
  let paragraphs = 0;

  const walker = li.doc.createTreeWalker(li, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      ['UL', 'OL'].includes((node as Element).tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as HTMLElement;
    if (el.tagName === 'P' && paragraphs++ === 0) continue;
    if (LINE_ENDS.has(el.tagName)) break;
    if (el.matches('a.tag')) tags.push(el);
  }

  return tags;
}

/**
 * The first tag on the item's first line that has a callout (#58).
 * Obsidian has already turned each tag into an `a.tag`, so there is nothing
 * left to parse, and `#tag` in inline code is not one. A tag reading view
 * starts after punctuation, as in `[#tag]`, is passed over, since the
 * editor does not take it for a tag.
 */
function findTagCallout(
  li: HTMLElement,
  tags: Record<string, Callout>
): { callout: Callout; tagEl: HTMLElement } | null {
  for (const tagEl of firstLineTags(li)) {
    const before = tagEl.previousSibling?.textContent ?? '';
    if (!tagCanStartAfter(before)) continue;

    const text = tagEl.textContent ?? '';
    const callout = text.startsWith('#')
      ? calloutForTag(text.slice(1), tags)
      : null;
    if (callout) return { callout, tagEl };
  }

  return null;
}

/**
 * Swap a tag that named a callout for the callout's icon. With no icon the
 * tag stays as it was, a link to its search, since its own text is all a
 * marker could show.
 */
function replaceTag(tagEl: HTMLElement, callout: Callout) {
  if (!callout.icon) return;

  const text = tagEl.textContent ?? '';
  tagEl.replaceWith(
    createSpan(
      {
        cls: 'lc-list-marker lc-tag-marker',
        text,
        attr: { 'aria-label': text },
      },
      (span) => setIcon(span, callout.icon)
    )
  );
}

function wrapLiContent(li: HTMLElement) {
  const toReplace: ChildNode[] = [];
  let insertBefore = null;

  for (let i = 0, len = li.childNodes.length; i < len; i++) {
    const child = li.childNodes.item(i);

    if (child.nodeType === document.ELEMENT_NODE) {
      const el = child as Element;
      if (
        el.hasClass('list-collapse-indicator') ||
        el.hasClass('list-bullet')
      ) {
        continue;
      }

      if (['UL', 'OL'].includes(el.tagName)) {
        insertBefore = child;
        break;
      }
    }

    toReplace.push(child);
  }

  const wrapper = createSpan({ cls: 'lc-li-wrapper' });

  toReplace.forEach((node) => wrapper.append(node));

  if (insertBefore) {
    insertBefore.before(wrapper);
  } else {
    li.append(wrapper);
  }
}

/**
 * Color the highlights whose text starts with a callout character.
 *
 * <mark> is only ever produced by Obsidian's ==highlight== syntax, so unlike
 * the editor there is nothing to confirm: whatever is here is a highlight.
 */
function decorateHighlights(el: HTMLElement, config: CalloutConfig) {
  const marks = el.querySelectorAll('mark');
  if (!marks.length) return;

  marks.forEach((mark) => {
    const node = mark.firstChild;
    if (!node || node.nodeType !== document.TEXT_NODE) return;

    const text = (node as Text).nodeValue ?? '';
    const match = text.match(config.highlightRe);
    const callout = match ? config.callouts[match[1]] : null;
    if (!callout) return;

    (node as Text).nodeValue = text.slice(match[0].length);

    mark.addClass('lc-highlight-callout');
    mark.setAttribute('data-callout', callout.char);
    applyCalloutColors(mark, callout);

    mark.prepend(
      createSpan(
        {
          text: callout.char,
          cls: 'lc-highlight-marker',
          attr: { 'aria-hidden': 'true' },
        },
        (span) => {
          if (callout.icon) {
            setIcon(span, callout.icon);
          }
        }
      )
    );
  });
}

export function buildPostProcessor(
  getConfig: () => CalloutConfig
): MarkdownPostProcessor {
  return async (el, ctx) => {
    const config = getConfig();

    // No callouts configured, so nothing can match. Bailing here also avoids
    // awaiting the pending post-processors below for no reason.
    if (!config.re && !config.tags) return;

    // `promises` is internal: it lets a post-processor wait for the ones
    // registered before it (embeds, for instance) to finish rendering.
    const pending = (ctx as { promises?: Promise<unknown>[] }).promises;

    if (pending?.length) {
      await Promise.all(pending);
    }

    // Document order, so by the time a nested item is reached the callout
    // item it sits under has been marked and can be found by walking up.
    el.findAll('li').forEach((li) => {
      const node = getFirstTextNode(li);
      const text = node?.textContent ?? '';
      const match = config.re ? text.match(config.re) : null;
      const callout = match ? config.callouts[match[1]] : null;

      if (callout) {
        li.addClass('lc-list-callout');
        li.setAttribute('data-callout', callout.char);
        applyCalloutColors(li, callout);

        node.replaceWith(
          createFragment((f) => {
            f.append(
              createSpan(
                {
                  cls: 'lc-list-marker',
                  text: text.slice(0, callout.char.length),
                },
                (span) => {
                  if (callout.icon) {
                    setIcon(span, callout.icon);
                  }
                }
              )
            );
            f.append(text.slice(callout.char.length));
          })
        );

        wrapLiContent(li);
        return;
      }

      const tagged = config.tags ? findTagCallout(li, config.tags) : null;
      if (tagged) {
        li.addClass('lc-list-callout', 'lc-tag-callout');
        li.setAttribute('data-callout', tagged.callout.char);
        applyCalloutColors(li, tagged.callout);
        replaceTag(tagged.tagEl, tagged.callout);
        wrapLiContent(li);
        return;
      }

      if (!config.colorNestedItems) return;

      // The nearest colored item above, callout or nested alike, so a
      // callout deeper in the tree takes over for everything under it.
      const above = li.parentElement?.closest<HTMLElement>(
        'li.lc-list-callout, li.lc-list-callout-nested'
      );
      const inherited = above
        ? config.callouts[above.getAttribute('data-callout')]
        : null;
      if (!inherited) return;

      li.addClass('lc-list-callout-nested');
      li.setAttribute('data-callout', inherited.char);
      applyCalloutColors(li, inherited);
      wrapLiContent(li);
    });

    if (config.highlightRe) decorateHighlights(el, config);
  };
}
