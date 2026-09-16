export interface Callout {
  char: string;
  /** `r, g, b`, the form the stylesheet's `rgb()`/`rgba()` calls take. */
  color: string;
  /**
   * Same form as `color`. Absent, the marker is painted in `color`, which is
   * what every callout starts with; set, it overrides just the marker (the
   * character or icon) and leaves the background on `color`. Kept off the
   * object rather than stored empty so a saved `data.json` is one the original
   * List Callouts still reads.
   */
  markerColor?: string;
  icon?: string;
  /**
   * Marked the user-created callouts back when the built-in seven were fixed
   * and had to be told apart from them. Callouts are one reorderable list now
   * and nothing branches on this, but it is still written and preserved so a
   * `data.json` stays readable by List Callouts, which we can import from.
   */
  custom?: boolean;
}

/**
 * The custom properties the stylesheet paints a callout from, as an inline
 * style. The marker property is only written when there is an override, so
 * the stylesheet's fallback to the callout color covers the default case.
 */
export function calloutColorStyle(callout: Callout): string {
  let style = `--lc-callout-color: ${callout.color}`;
  if (callout.markerColor) {
    style += `; --lc-callout-marker-color: ${callout.markerColor}`;
  }
  return style;
}

/** `calloutColorStyle` applied to a rendered element. */
export function applyCalloutColors(el: HTMLElement, callout: Callout): void {
  el.style.setProperty('--lc-callout-color', callout.color);
  if (callout.markerColor) {
    el.style.setProperty('--lc-callout-marker-color', callout.markerColor);
  }
}

export interface HighlightSettings {
  /** Color inline highlights that begin with a callout character. */
  enabled: boolean;
  /**
   * Whether `==& text==` needs the space. Off, `==&text==` works too and a
   * space after the character is optional. On by default so highlights such
   * as `==!important==` keep their normal look when the plugin updates.
   */
  requireSpace: boolean;
}

export const DEFAULT_HIGHLIGHT_SETTINGS: HighlightSettings = {
  enabled: true,
  requireSpace: true,
};

export function defaultHighlightSettings(): HighlightSettings {
  return { ...DEFAULT_HIGHLIGHT_SETTINGS };
}

/**
 * What data.json holds. Versions before highlight settings existed stored the
 * callout array on its own, which loadSettings still accepts.
 */
export interface PluginData {
  callouts: Callout[];
  highlights: HighlightSettings;
  /**
   * Show only the callout marker on a callout line, without the bullet or
   * number in front of it. A checkbox stays, since it can be clicked
   * (mgmeyers/obsidian-list-callouts#59).
   */
  hideBullets: boolean;
}

export const DEFAULT_HIDE_BULLETS = false;

/**
 * The class `hideBullets` puts on the document body. Everything the
 * preference changes is done in styles.css under this class, so the editor,
 * reading view and settings previews all follow it the moment it flips.
 */
export const HIDE_BULLETS_CLASS = 'lc-hide-bullets';

export interface CalloutConfig {
  callouts: Record<string, Callout>;
  /**
   * Null when no callouts are configured. Every callout can be deleted, so
   * that is a reachable state, and an empty character class would compile to a
   * pattern that matches every list item.
   */
  re: RegExp | null;
  /**
   * Null when highlights are disabled or no callouts are configured. The
   * editor's copy is global and matches a whole `==& text==` span; the
   * post-processor's is anchored to the start of a <mark>'s text.
   */
  highlightRe: RegExp | null;
  /**
   * Editor only: just the opening `==& ` of a highlight, for one whose closer
   * sits on a later line and so is out of `highlightRe`'s reach. Global, so
   * the search can start past the highlights the line has already matched.
   */
  highlightOpenRe?: RegExp | null;
}

export type ListCalloutsSettings = Callout[];

export const DEFAULT_SETTINGS: ListCalloutsSettings = [
  {
    color: '255, 214, 0',
    char: '&',
  },
  {
    color: '255, 145, 0',
    char: '?',
  },
  {
    color: '255, 23, 68',
    char: '!',
  },
  {
    color: '124, 77, 255',
    char: '~',
  },
  {
    color: '0, 184, 212',
    char: '@',
  },
  {
    color: '0, 200, 83',
    char: '$',
  },
  {
    color: '158, 158, 158',
    char: '%',
  },
];

/**
 * A fresh copy of the built-in callouts, for seeding a vault that has never
 * saved settings and for "Reset to defaults".
 *
 * Copied rather than handed out directly: the settings tab edits callouts in
 * place, and DEFAULT_SETTINGS is also what a later reset restores.
 */
export function defaultCallouts(): ListCalloutsSettings {
  return DEFAULT_SETTINGS.map((callout) => ({ ...callout }));
}
