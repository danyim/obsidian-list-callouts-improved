import { App, addIcon, getIconIds, normalizePath, removeIcon } from 'obsidian';

/**
 * Custom icons are read from `<config>/icons`, the same folder Iconize uses,
 * so a vault that already keeps SVGs there works without moving anything.
 *
 * Obsidian does not register that folder itself: `getIconIds()` returns only
 * the icons the app ships. Registering them here puts them in front of the
 * icon picker and lets `setIcon` draw them, since both work off the same
 * registry.
 */
export const CUSTOM_ICON_FOLDER = 'icons';

/** Presentation attributes worth carrying over from the file's root element. */
const ROOT_ATTRIBUTES = [
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-dasharray',
  'clip-rule',
  'opacity',
  'color',
];

const FORBIDDEN_ELEMENTS = new Set(['script', 'foreignobject', 'use', 'image']);

export function customIconFolder(app: App): string {
  return normalizePath(`${app.vault.configDir}/${CUSTOM_ICON_FOLDER}`);
}

/**
 * Icon id for a file: `Some Icon.svg` becomes `some-icon`.
 */
export function iconIdFromFile(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath;

  return name
    .replace(/\.svg$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Drop anything that could execute or reach off the page. These files come
 * from the vault, which is usually the user's own work, but an SVG is a
 * document format that can carry script and remote references.
 */
function stripUnsafe(el: Element): void {
  for (const child of Array.from(el.children)) {
    if (FORBIDDEN_ELEMENTS.has(child.tagName.toLowerCase())) {
      child.remove();
      continue;
    }

    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      const isEventHandler = name.startsWith('on');
      const isRemoteRef =
        (name === 'href' || name === 'xlink:href' || name === 'src') &&
        !attr.value.trimStart().startsWith('#');

      if (isEventHandler || isRemoteRef) {
        child.removeAttribute(attr.name);
      }
    }

    stripUnsafe(child);
  }
}

function parseViewBox(root: Element): [number, number, number, number] {
  const raw = (root.getAttribute('viewBox') ?? '').trim();
  const parts = raw.split(/[\s,]+/).map(Number);

  if (
    parts.length === 4 &&
    parts.every(Number.isFinite) &&
    parts[2] > 0 &&
    parts[3] > 0
  ) {
    return [parts[0], parts[1], parts[2], parts[3]];
  }

  // No usable viewBox, so fall back to the declared size, then to Lucide's.
  const width = parseFloat(root.getAttribute('width') ?? '') || 24;
  const height = parseFloat(root.getAttribute('height') ?? '') || 24;

  return [0, 0, width, height];
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Convert a standalone SVG file into the body `addIcon` expects.
 *
 * Obsidian drops the registered content into an `svg` with a `0 0 100 100`
 * viewBox, so the artwork has to be mapped into that space. Passing the file's
 * own `<svg>` through instead would nest one svg in another and render at the
 * file's declared width, which for a typical 24px icon is a quarter size.
 *
 * Throws if the file is not SVG we can use.
 */
export function svgToIconBody(source: string): string {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');

  if (parsed.getElementsByTagName('parsererror').length > 0) {
    throw new Error('not valid SVG');
  }

  const root = parsed.documentElement;

  if (!root || root.tagName.toLowerCase() !== 'svg') {
    throw new Error('no <svg> root element');
  }

  stripUnsafe(root);

  const [minX, minY, width, height] = parseViewBox(root);
  const transform = `scale(${round(100 / width)}, ${round(100 / height)}) translate(${round(-minX)}, ${round(-minY)})`;

  const attributes = ROOT_ATTRIBUTES.filter((name) => root.hasAttribute(name))
    .map(
      (name) =>
        `${name}="${(root.getAttribute(name) ?? '').replace(/"/g, '&quot;')}"`
    )
    .join(' ');

  const body = root.innerHTML.trim();

  if (!body) {
    throw new Error('SVG has no content');
  }

  return `<g ${attributes} transform="${transform}">${body}</g>`;
}

export interface CustomIconLoad {
  /** Ids registered with Obsidian, in the order the picker will show them. */
  registered: string[];
  /** Files that could not be used, with the reason. */
  skipped: { file: string; reason: string }[];
}

/**
 * Register every SVG in the custom icon folder.
 *
 * Ids that an Obsidian icon already uses are left alone: overwriting one would
 * change an icon the rest of the app draws.
 */
export async function loadCustomIcons(app: App): Promise<CustomIconLoad> {
  const folder = customIconFolder(app);
  const result: CustomIconLoad = { registered: [], skipped: [] };

  if (!(await app.vault.adapter.exists(folder))) {
    return result;
  }

  const listing = await app.vault.adapter.list(folder);
  const taken = new Set(getIconIds());

  for (const file of listing.files.sort()) {
    if (!file.toLowerCase().endsWith('.svg')) continue;

    const id = iconIdFromFile(file);

    if (!id) {
      result.skipped.push({ file, reason: 'name has no usable characters' });
      continue;
    }

    if (taken.has(id)) {
      result.skipped.push({ file, reason: `"${id}" is already an icon` });
      continue;
    }

    try {
      addIcon(id, svgToIconBody(await app.vault.adapter.read(file)));
      taken.add(id);
      result.registered.push(id);
    } catch (e) {
      result.skipped.push({ file, reason: (e as Error).message });
    }
  }

  return result;
}

export function unloadCustomIcons(ids: string[]): void {
  for (const id of ids) {
    removeIcon(id);
  }
}
