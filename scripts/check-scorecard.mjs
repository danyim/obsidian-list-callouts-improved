/**
 * Fails when the plugin's scorecard on community.obsidian.md lists anything
 * other than passed checks and disclosures, and prints each finding with the
 * rule, file and line Obsidian's scanner reported.
 *
 * `npm run lint` approximates the scanner, but only the scorecard shows what
 * it actually found: 1.8.1 shipped with 38 warnings that lint here and in CI
 * never reported. The scorecard rates the latest published release, so this
 * runs on a schedule (.github/workflows/scorecard.yaml) rather than per
 * commit. Run it locally with `npm run scorecard`.
 *
 * The site has no API for this. The page is a Next.js app whose scorecard
 * only exists in the React Server Components payload it streams through
 * `self.__next_f.push(...)` script tags, so that is what gets parsed. If the
 * site changes shape the parse finds no scorecard and this fails, rather than
 * passing with nothing checked.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SITE = 'https://community.obsidian.md/plugins/';

// Item keys look like `<severity>:<index>:<title>`. Every other severity
// (`medium` for the lint warnings, so far) is a finding.
const OK_SEVERITIES = new Set(['pass', 'info']);

/** The RSC rows streamed in `html`, by row id. */
function flightRows(html) {
  let flight = '';
  for (const m of html.matchAll(
    /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  )) {
    flight += JSON.parse(m[1]);
  }

  const rows = new Map();
  for (const line of flight.split('\n')) {
    // Only rows holding JSON. Module references (`I[...]`) and text rows
    // (`T<length>,...`) carry nothing the scorecard needs.
    const m = line.match(/^([0-9a-f]+):([[{"].*)$/);
    if (!m) continue;
    try {
      rows.set(m[1], JSON.parse(m[2]));
    } catch {
      // A text row whose content happens to start like JSON.
    }
  }
  return rows;
}

/** `value` with each `"$L<id>"` reference replaced by the row it names. */
function resolve(rows, value, seen = new Set()) {
  if (typeof value === 'string') {
    const id = value.match(/^\$L([0-9a-f]+)$/)?.[1];
    if (id === undefined || !rows.has(id) || seen.has(id)) return value;
    return resolve(rows, rows.get(id), new Set([...seen, id]));
  }
  if (Array.isArray(value)) return value.map((v) => resolve(rows, v, seen));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolve(rows, v, seen)])
    );
  }
  return value;
}

// A rendered element is `["$", tag, key, props]`.
const isElement = (node) =>
  Array.isArray(node) && node[0] === '$' && typeof node[1] === 'string';

function textOf(node) {
  if (typeof node === 'number') return String(node);
  if (typeof node === 'string') return node.startsWith('$') ? '' : node;
  if (isElement(node)) return textOf(node[3]?.children);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}

/** Each element under `node`, depth first, in document order. */
function* elements(node) {
  if (isElement(node)) {
    yield node;
    yield* elements(node[3]?.children);
  } else if (Array.isArray(node)) {
    for (const child of node) yield* elements(child);
  }
}

// https://github.com/<owner>/<repo>/blob/<commit>/<path>#L<line>[-L<end>]
const SOURCE_LINK = /\/blob\/([0-9a-f]+)\/([^#]+)#L(\d+)(?:-L(\d+))?$/;

function parseItem(key, props) {
  const [, severity, title] = key.match(/^([a-z]+):\d+:(.*)$/s);
  const rules = [];
  const locations = [];
  for (const [, tag, childKey, childProps] of elements(props.children)) {
    const link = childProps?.href?.match(SOURCE_LINK);
    if (link) {
      const [, commit, path, line, endLine] = link;
      locations.push({
        commit,
        path,
        line: Number(line),
        endLine: Number(endLine ?? line),
      });
    } else if (tag === 'li' && typeof childKey === 'string') {
      // Lists of links are keyed by index. The other lists name what the
      // item is about (a rule, a file) in their keys.
      if (!/^\d+$/.test(childKey)) rules.push(childKey);
    }
  }
  return { severity, title, rules, locations };
}

/**
 * The scorecard in a plugin page's HTML: each section (Passed, Warnings, ...)
 * with the count it shows and its items. Null when the page has none.
 */
export function parseScorecard(html) {
  const rows = flightRows(html);
  // Rows reference each other, so walk the one scorecard element with its
  // references resolved, not every row, which would visit some twice.
  let root;
  for (const row of rows.values()) {
    if (!JSON.stringify(row).includes('"id":"scorecard"')) continue;
    root = [...elements(resolve(rows, row))].find(
      ([, , , props]) => props?.id === 'scorecard'
    );
    if (root) break;
  }
  if (!root) return null;

  const sections = [];
  for (const [, tag, key, props] of elements(root)) {
    if (tag === 'h3') {
      const [heading, count] = props.children ?? [];
      sections.push({
        heading: textOf(heading),
        count: Number(textOf(count)),
        items: [],
      });
    } else if (
      typeof key === 'string' &&
      /^[a-z]+:\d+:/.test(key) &&
      sections.length > 0
    ) {
      sections.at(-1).items.push(parseItem(key, props));
    }
  }
  const scorecard = sections.filter((s) => s.items.length > 0);
  return scorecard.length > 0 ? scorecard : null;
}

/**
 * The version a plugin page lists as current, which is the release its
 * scorecard rates, or null when the page shows none. Obsidian scans a release
 * some hours after it is published, so until then this is the one before.
 */
export function currentVersion(html) {
  for (const row of flightRows(html).values()) {
    let afterLabel = false;
    for (const [, , , props] of elements(row)) {
      if (afterLabel) return textOf(props?.children) || null;
      afterLabel = textOf(props?.children) === 'Current version';
    }
  }
  return null;
}

/** The items in `scorecard` that are neither passed checks nor disclosures. */
export function findings(scorecard) {
  return scorecard
    .flatMap((s) => s.items)
    .filter((item) => !OK_SEVERITIES.has(item.severity));
}

// Workflow commands are one line each, so the message escapes newlines too.
const escapeData = (s) =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) =>
  escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

const formatLocation = ({ path, line, endLine }) =>
  `${path}:${line}${endLine > line ? `-${endLine}` : ''}`;

/**
 * A GitHub Actions `::error` annotation for `item`, anchored at its first
 * location and listing the rest. One per item, not per location: GitHub
 * shows only the first 10 error annotations of a step.
 */
export function annotation(item) {
  const title = escapeProperty(item.rules.join(', ') || item.severity);
  const [first] = item.locations;
  if (!first) return `::error title=${title}::${escapeData(item.title)}`;

  return (
    `::error file=${first.path},line=${first.line},endLine=${first.endLine},` +
    `title=${title}::` +
    escapeData(
      `${item.title}, reported against ${first.commit.slice(0, 7)}, so ` +
        `lines may have moved since:\n` +
        item.locations.map(formatLocation).join('\n')
    )
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { id, version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const url = SITE + id;

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`${url} returned ${response.status}.`);
    process.exit(1);
  }

  const html = await response.text();
  const scorecard = parseScorecard(html);
  if (!scorecard) {
    console.error(
      `Found no scorecard in ${url}. The page has likely changed shape; ` +
        'update parseScorecard() in scripts/check-scorecard.mjs.'
    );
    process.exit(1);
  }

  // The run on a release's publication reads the page before Obsidian has
  // scanned that release, so say which one the findings belong to.
  const rated = currentVersion(html);
  console.log(`Scorecard for ${rated ?? 'an unknown version'}`);
  if (rated && rated !== version) {
    console.log(
      `Obsidian has not scanned ${version} yet; this is ${rated}'s scorecard.`
    );
  }

  for (const { heading, count, items } of scorecard) {
    console.log(`${heading}: ${count}`);
    for (const item of items) {
      console.log(`  [${item.severity}] ${item.title}`);
      for (const rule of item.rules) console.log(`    ${rule}`);
      for (const location of item.locations) {
        console.log(`    ${formatLocation(location)}`);
      }
    }
  }

  const found = findings(scorecard);
  if (found.length > 0) {
    if (process.env.GITHUB_ACTIONS) {
      for (const item of found) console.log(annotation(item));
    }
    const count = found.reduce(
      (n, item) => n + Math.max(item.locations.length, 1),
      0
    );
    console.error(
      `\n${url} lists ${count} finding(s) above. The scorecard rates the ` +
        'latest release, so a fix shows there only once it is released.'
    );
    process.exit(1);
  }
}
