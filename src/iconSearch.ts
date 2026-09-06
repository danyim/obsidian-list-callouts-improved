import Fuse from 'fuse.js';
import { getIconIds } from 'obsidian';

import { iconAliases } from './iconAliases';

interface IconEntry {
  id: string;
  aliases: string[];
}

const FUSE_OPTIONS = {
  threshold: 0.1,
  minMatchCharLength: 2,
  keys: ['id', 'aliases'],
};

let index: Fuse<IconEntry> | null = null;
let indexedCount = -1;

/**
 * Build the search index from the icons the running app actually registers,
 * layering on the alias snapshot where ids still match. Icons registered by
 * other plugins are picked up automatically; they simply have no aliases.
 */
function buildIndex(ids: string[]): Fuse<IconEntry> {
  const entries = ids.map<IconEntry>((id) => ({
    id,
    aliases: iconAliases[id] ?? [],
  }));

  return new Fuse(entries, FUSE_OPTIONS);
}

/**
 * Icon ids the running app registers, in the order the picker should show them.
 */
export function allIconIds(): string[] {
  return getIconIds();
}

/**
 * Ids matching `query`, best match first. An empty query returns every icon.
 */
export function searchIcons(query: string): string[] {
  const ids = getIconIds();

  if (!query) {
    return ids;
  }

  // Other plugins can register icons after the index is built, so rebuild
  // when the count moves rather than caching for the lifetime of the app.
  if (!index || indexedCount !== ids.length) {
    index = buildIndex(ids);
    indexedCount = ids.length;
  }

  return index.search(query).map((result) => result.item.id);
}
