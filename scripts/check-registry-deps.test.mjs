/**
 * Tests for `scripts/check-registry-deps.mjs`. Run with
 * `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nonRegistryPackages } from './check-registry-deps.mjs';

function lock(packages) {
  return {
    lockfileVersion: 3,
    packages: { '': { name: 'root' }, ...packages },
  };
}

describe('nonRegistryPackages', () => {
  it('passes packages installed from the registry', () => {
    const found = nonRegistryPackages(
      lock({
        'node_modules/obsidian': {
          resolved: 'https://registry.npmjs.org/obsidian/-/obsidian-1.13.1.tgz',
        },
      })
    );

    assert.deepEqual(found, []);
  });

  it('reports a git dependency, nested ones included', () => {
    const found = nonRegistryPackages(
      lock({
        'node_modules/@codemirror/language': {
          resolved:
            'git+ssh://git@github.com/lishid/cm-language.git#1aadcc247f20ccfda76424a9f853dbb4ee203fdc',
        },
        'node_modules/a/node_modules/b': {
          resolved: 'https://codeload.github.com/x/b/tar.gz/abc',
        },
      })
    );

    assert.deepEqual(found, [
      {
        name: '@codemirror/language',
        resolved:
          'git+ssh://git@github.com/lishid/cm-language.git#1aadcc247f20ccfda76424a9f853dbb4ee203fdc',
      },
      { name: 'b', resolved: 'https://codeload.github.com/x/b/tar.gz/abc' },
    ]);
  });

  it('reports a package with no resolved URL, such as a local path', () => {
    const found = nonRegistryPackages(lock({ 'node_modules/local': {} }));

    assert.deepEqual(found, [{ name: 'local', resolved: '(no resolved URL)' }]);
  });

  it('skips the root, workspace links and bundled dependencies', () => {
    const found = nonRegistryPackages(
      lock({
        'node_modules/ws': { link: true, resolved: 'packages/ws' },
        'node_modules/x/node_modules/y': { inBundle: true },
      })
    );

    assert.deepEqual(found, []);
  });
});
