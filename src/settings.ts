export interface Callout {
  char: string;
  color: string;
  icon?: string;
  /**
   * Marked the user-created callouts back when the built-in seven were fixed
   * and had to be told apart from them. Callouts are one reorderable list now
   * and nothing branches on this, but it is still written and preserved so a
   * `data.json` stays readable by List Callouts, which we can import from.
   */
  custom?: boolean;
}

export interface CalloutConfig {
  callouts: Record<string, Callout>;
  /**
   * Null when no callouts are configured. Every callout can be deleted, so
   * that is a reachable state, and an empty character class would compile to a
   * pattern that matches every list item.
   */
  re: RegExp | null;
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
