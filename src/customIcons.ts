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

/** Elements that draw something, and so take SVG's default black fill. */
const SHAPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
]);

/** A fill, stroke or color declaration in a style attribute or sheet. */
const PAINT_DECLARATION = /(?<![\w-])(fill|stroke|color)(\s*:\s*)([^;}]+)/gi;

/**
 * The solid color a paint value names, spelled one way so that `black` and
 * `#000` compare equal, or null for a value that is not a solid color.
 */
function solidColor(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, '');

  if (
    ['', 'none', 'currentcolor', 'transparent', 'inherit'].includes(v) ||
    v.startsWith('url(')
  ) {
    return null;
  }
  if (v === 'black') return '#000000';
  if (v === 'white') return '#ffffff';

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : v;
}

/** Whether an element sets a fill of its own, in an attribute or its style. */
function setsFill(el: Element): boolean {
  return (
    el.hasAttribute('fill') ||
    /(?<![\w-])fill\s*:/i.test(el.getAttribute('style') ?? '')
  );
}

/**
 * Hand a one-color icon's color over to the callout (#64). Obsidian draws a
 * registered icon in the marker's color only where the icon paints in
 * currentColor, so a file exported with its color written in (black,
 * usually), or with no fill at all, which SVG paints black, stayed black
 * whatever the callout's color. Such an icon is a glyph, drawn in one color
 * the way Obsidian's own icons are, so that color becomes currentColor. An
 * icon in two or more colors, or with a gradient, keeps them: they are part
 * of the picture.
 *
 * Rewrites the paints in place and returns whether the icon is one color.
 */
function recolorOneColorIcon(root: Element): boolean {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const sheets = elements.filter((el) => el.tagName.toLowerCase() === 'style');
  const colors = new Set<string>();
  let patterned = false;

  const see = (property: string, value: string) => {
    if (property.toLowerCase() === 'color') return;
    if (value.trim().toLowerCase().startsWith('url(')) patterned = true;
    const color = solidColor(value);
    if (color) colors.add(color);
  };

  for (const el of elements) {
    for (const property of ['fill', 'stroke']) {
      const value = el.getAttribute(property);
      if (value !== null) see(property, value);
    }
    for (const [, property, , value] of (
      el.getAttribute('style') ?? ''
    ).matchAll(PAINT_DECLARATION)) {
      see(property, value);
    }
  }
  for (const sheet of sheets) {
    for (const [, property, , value] of (sheet.textContent ?? '').matchAll(
      PAINT_DECLARATION
    )) {
      see(property, value);
    }
  }

  // A shape with no fill anywhere above it is painted black. With a style
  // sheet, a class may be what fills it, which is not worth resolving here.
  const unfilled = elements.some((el) => {
    if (!SHAPES.has(el.tagName.toLowerCase())) return false;
    for (let at: Element | null = el; at; at = at.parentElement) {
      if (setsFill(at)) return false;
      if (at === root) break;
    }
    return true;
  });
  if (unfilled && sheets.length === 0) colors.add('#000000');

  if (patterned || colors.size > 1) return false;

  // Solid paints become currentColor, and a color property, which only sets
  // what currentColor means, goes, so the marker's color comes through.
  const recolor = (text: string) =>
    text.replace(
      PAINT_DECLARATION,
      (whole: string, property: string, colon: string, value: string) => {
        if (property.toLowerCase() === 'color') return '';
        return solidColor(value) ? `${property}${colon}currentColor` : whole;
      }
    );

  for (const el of elements) {
    for (const property of ['fill', 'stroke']) {
      const value = el.getAttribute(property);
      if (value !== null && solidColor(value)) {
        el.setAttribute(property, 'currentColor');
      }
    }
    el.removeAttribute('color');
    const style = el.getAttribute('style');
    if (style !== null) el.setAttribute('style', recolor(style));
  }
  for (const sheet of sheets) {
    sheet.textContent = recolor(sheet.textContent ?? '');
  }

  return true;
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
  const oneColor = recolorOneColorIcon(root);

  const [minX, minY, width, height] = parseViewBox(root);
  const transform = `scale(${round(100 / width)}, ${round(100 / height)}) translate(${round(-minX)}, ${round(-minY)})`;

  const attributes = ROOT_ATTRIBUTES.filter((name) => root.hasAttribute(name))
    .map(
      (name) =>
        `${name}="${(root.getAttribute(name) ?? '').replace(/"/g, '&quot;')}"`
    )
    .join(' ');

  // What SVG would paint black, the marker's color paints instead. The root's
  // own style attribute is not carried over, so this goes by its attribute.
  const fill =
    oneColor && !root.hasAttribute('fill') ? 'fill="currentColor" ' : '';

  const body = root.innerHTML.trim();

  if (!body) {
    throw new Error('SVG has no content');
  }

  return `<g ${fill}${attributes} transform="${transform}">${body}</g>`;
}

/**
 * How many icon files are read at once when the whole folder is wanted. One
 * at a time, a vault with a few thousand icons took over forty seconds on
 * Windows (#50); a handful in flight hides most of each read's latency
 * without flooding the adapter.
 */
const READ_CONCURRENCY = 16;

/**
 * The vault's custom icons, registered only as they are needed.
 *
 * Listing the folder is one call, but registering an icon is a file read,
 * and some vaults keep thousands of them there for Iconize. So at startup
 * only the icons a callout actually uses are read; the rest wait until the
 * icon picker asks for all of them.
 */
export class CustomIcons {
  /** Ids registered with Obsidian, in the order they were registered. */
  readonly registered: string[] = [];

  /** Listed icons not yet read: id to file path, in file name order. */
  private unread = new Map<string, string>();

  /** Reads in flight, so an icon asked for twice is read once. */
  private reading = new Map<string, Promise<boolean>>();

  private listed: Promise<void> | null = null;
  private everything: Promise<boolean> | null = null;
  private unloaded = false;

  constructor(
    private app: App,
    private warn: (file: string, reason: string) => void
  ) {}

  /**
   * List the icon folder, once. Ids that an Obsidian icon already uses are
   * left alone: overwriting one would change an icon the rest of the app
   * draws.
   */
  list(): Promise<void> {
    return (this.listed ??= this.readListing());
  }

  private async readListing(): Promise<void> {
    const folder = customIconFolder(this.app);

    if (!(await this.app.vault.adapter.exists(folder))) return;

    const listing = await this.app.vault.adapter.list(folder);
    const taken = new Set(getIconIds());

    for (const file of listing.files.sort()) {
      if (!file.toLowerCase().endsWith('.svg')) continue;

      const id = iconIdFromFile(file);

      if (!id) {
        this.warn(file, 'name has no usable characters');
      } else if (taken.has(id) || this.unread.has(id)) {
        this.warn(file, `"${id}" is already an icon`);
      } else {
        this.unread.set(id, file);
      }
    }
  }

  /**
   * Register those of `ids` that name a listed icon not read yet. Resolves
   * true when any of them was registered. Ids that are not custom icons are
   * ignored, so a caller can pass every icon its settings mention.
   */
  async load(ids: Iterable<string>): Promise<boolean> {
    await this.list();

    const reads = [...new Set(ids)].map((id) => this.read(id));
    return (await Promise.all(reads)).some(Boolean);
  }

  /**
   * Register every listed icon, once, for the picker. Resolves true when any
   * icon was registered by this call or an earlier one still running.
   */
  loadAll(): Promise<boolean> {
    return (this.everything ??= this.readAll());
  }

  private async readAll(): Promise<boolean> {
    await this.list();

    const queue = [...this.unread.keys(), ...this.reading.keys()];
    let any = false;

    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        if (await this.read(id)) any = true;
      }
    };

    await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
    return any;
  }

  private read(id: string): Promise<boolean> {
    const inFlight = this.reading.get(id);
    if (inFlight !== undefined) return inFlight;

    const file = this.unread.get(id);
    if (!file) return Promise.resolve(false);

    this.unread.delete(id);

    const reading = this.readOne(id, file).finally(() => {
      this.reading.delete(id);
    });
    this.reading.set(id, reading);
    return reading;
  }

  private async readOne(id: string, file: string): Promise<boolean> {
    let body: string;

    try {
      body = svgToIconBody(await this.app.vault.adapter.read(file));
    } catch (e) {
      this.warn(file, (e as Error).message);
      return false;
    }

    // Unloaded while the file was being read: nothing would remove it.
    if (this.unloaded) return false;

    addIcon(id, body);
    this.registered.push(id);
    return true;
  }

  /** Hand back every registered icon; reads still in flight register none. */
  unload(): void {
    this.unloaded = true;

    for (const id of this.registered) {
      removeIcon(id);
    }

    this.registered.length = 0;
  }
}
