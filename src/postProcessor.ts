import { MarkdownPostProcessor, setIcon } from 'obsidian';

import { CalloutConfig, applyCalloutColors } from './settings';

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

    if (
      node.nodeType === document.ELEMENT_NODE &&
      (node as HTMLElement).tagName === 'P'
    ) {
      return node.firstChild;
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

    if (callout.icon) {
      mark.prepend(
        createSpan(
          { cls: 'lc-highlight-marker', attr: { 'aria-hidden': 'true' } },
          (span) => setIcon(span, callout.icon)
        )
      );
    }
  });
}

export function buildPostProcessor(
  getConfig: () => CalloutConfig
): MarkdownPostProcessor {
  return async (el, ctx) => {
    const config = getConfig();

    // No callouts configured, so nothing can match. Bailing here also avoids
    // awaiting the pending post-processors below for no reason.
    if (!config.re) return;

    // `promises` is internal: it lets a post-processor wait for the ones
    // registered before it (embeds, for instance) to finish rendering.
    const pending = (ctx as { promises?: Promise<unknown>[] }).promises;

    if (pending?.length) {
      await Promise.all(pending);
    }

    el.findAll('li').forEach((li) => {
      const node = getFirstTextNode(li);
      if (!node) return;

      const text = node.textContent;
      if (!text) return;

      const match = text.match(config.re);
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
      }
    });

    if (config.highlightRe) decorateHighlights(el, config);
  };
}
