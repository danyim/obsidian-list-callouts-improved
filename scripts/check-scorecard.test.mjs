/**
 * Tests for `scripts/check-scorecard.mjs`. Run with `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  annotation,
  currentVersion,
  findings,
  parseScorecard,
} from './check-scorecard.mjs';

const el = (tag, key, props) => ['$', tag, key, props];

const BLOB =
  'https://github.com/danyim/obsidian-list-callouts-improved/blob/eaeeb5d2d15bad9c4657dfe161adb9a9e69c2f7b';

const link = (path, anchor, text) =>
  el('a', null, { href: `${BLOB}/${path}#${anchor}`, children: [text] });

const heading = (text, count) =>
  el('h3', null, { children: [text, el('span', null, { children: count })] });

/**
 * A page shaped like the site's: the scorecard streamed as RSC rows across
 * more than one `self.__next_f.push` call, with part of it in a row of its
 * own that the scorecard references as `$L<id>`.
 */
function page({ withScorecard = true } = {}) {
  const scorecard = el('div', null, {
    id: 'scorecard',
    children: [
      heading('Passed', 1),
      el('div', 'pass:0:No obfuscated code detected.', {
        children: [
          el('span', null, { children: 'No obfuscated code detected.' }),
        ],
      }),
      heading('Warnings', 3),
      el('details', 'medium:0:Unsafe call of an `error` or `any` typed value', {
        children: [
          el('ul', null, {
            children: [
              el('li', '@typescript-eslint/no-unsafe-call', {
                children: '@typescript-eslint/no-unsafe-call',
              }),
            ],
          }),
          el('ul', null, {
            children: [
              el('li', '0', {
                children: link(
                  'src/extension.ts',
                  'L249',
                  'src/extension.ts:249'
                ),
              }),
              '$L1f',
            ],
          }),
        ],
      }),
      el('details', 'medium:1:Returns unsafe values from typed code', {
        children: [
          el('li', '0', {
            children: link('src/extension.ts', 'L577', 'src/extension.ts:577'),
          }),
        ],
      }),
      heading('Other', 1),
      el('details', 'info:0:Release contains extra unsupported files', {
        children: [
          el('li', 'plugin-1.0.0.zip', { children: 'plugin-1.0.0.zip' }),
        ],
      }),
    ],
  });

  const rows = [
    `0:${JSON.stringify(['$', 'html', null, { children: 'unrelated' }])}`,
    '2:I["chunk.js","default"]',
    `1f:${JSON.stringify(
      el('li', '1', {
        children: link(
          'src/extension.ts',
          'L525-L527',
          'src/extension.ts:525-527'
        ),
      })
    )}`,
    ...(withScorecard ? [`3a:${JSON.stringify(scorecard)}`] : []),
    `4b:${JSON.stringify(
      el('div', null, {
        className: 'grid',
        children: [
          [
            el('div', null, { children: 'Current version' }),
            el('div', null, { children: '1.8.3' }),
          ],
          el('div', null, { children: 'Last updated' }),
          el('div', null, { children: '19 hours ago' }),
        ],
      })
    )}`,
  ].join('\n');

  const half = Math.floor(rows.length / 2);
  return [rows.slice(0, half), rows.slice(half)]
    .map(
      (chunk) =>
        `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`
    )
    .join('');
}

describe('parseScorecard', () => {
  it('reads each section with its count and items', () => {
    const scorecard = parseScorecard(page());

    assert.deepEqual(
      scorecard.map(({ heading, count, items }) => [
        heading,
        count,
        items.length,
      ]),
      [
        ['Passed', 1, 1],
        ['Warnings', 3, 2],
        ['Other', 1, 1],
      ]
    );
  });

  it('reads the rule and locations of a finding, referenced rows and line ranges included', () => {
    const [, warnings] = parseScorecard(page());
    const commit = 'eaeeb5d2d15bad9c4657dfe161adb9a9e69c2f7b';

    assert.deepEqual(warnings.items[0], {
      severity: 'medium',
      title: 'Unsafe call of an `error` or `any` typed value',
      rules: ['@typescript-eslint/no-unsafe-call'],
      locations: [
        { commit, path: 'src/extension.ts', line: 249, endLine: 249 },
        { commit, path: 'src/extension.ts', line: 525, endLine: 527 },
      ],
    });
  });

  it('returns null for a page with no scorecard', () => {
    assert.equal(parseScorecard(page({ withScorecard: false })), null);
    assert.equal(parseScorecard('<html></html>'), null);
  });
});

describe('currentVersion', () => {
  it('reads the version the page lists as current', () => {
    assert.equal(currentVersion(page()), '1.8.3');
  });

  it('is null for a page without one', () => {
    assert.equal(currentVersion('<html></html>'), null);
  });
});

describe('findings', () => {
  it('leaves out passed checks and disclosures', () => {
    const found = findings(parseScorecard(page()));

    assert.deepEqual(
      found.map((item) => item.rules),
      [['@typescript-eslint/no-unsafe-call'], []]
    );
  });
});

describe('annotation', () => {
  it('anchors at the first location and lists them all on escaped lines', () => {
    const [item] = findings(parseScorecard(page()));

    assert.equal(
      annotation(item),
      '::error file=src/extension.ts,line=249,endLine=249,' +
        'title=@typescript-eslint/no-unsafe-call::' +
        'Unsafe call of an `error` or `any` typed value, reported against ' +
        'eaeeb5d, so lines may have moved since:%0A' +
        'src/extension.ts:249%0Asrc/extension.ts:525-527'
    );
  });

  it('escapes the characters that end a property in the title', () => {
    const line = annotation({
      severity: 'high',
      title: 'Something',
      rules: ['a:b', 'c'],
      locations: [],
    });

    assert.equal(line, '::error title=a%3Ab%2C c::Something');
  });
});
