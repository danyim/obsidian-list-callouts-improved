export interface Callout {
  char: string;
  color: string;
  icon?: string;
  custom?: boolean;
}

export interface CalloutConfig {
  callouts: Record<string, Callout>;
  re: RegExp;
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
 * Reconcile stored callouts with the built-in defaults. Built-ins are matched
 * by position so a stored tweak keeps overriding the same default, and
 * user-created callouts are appended after them.
 *
 * Shared by initial load and by importing from List Callouts, which stores the
 * same shape.
 */
export function mergeCallouts(loaded?: Callout[] | null): ListCalloutsSettings {
  const customCallouts = loaded?.filter((callout) => callout.custom === true);
  const modifiedBuiltins = loaded?.filter((callout) => callout.custom !== true);

  const merged = DEFAULT_SETTINGS.map((builtin, i) =>
    Object.assign({}, builtin, modifiedBuiltins ? modifiedBuiltins[i] : {})
  );

  if (customCallouts) {
    merged.push(...customCallouts);
  }

  return merged;
}

/** Index in `settings` at which user-created callouts begin. */
export const CUSTOM_CALLOUT_OFFSET = DEFAULT_SETTINGS.length;
