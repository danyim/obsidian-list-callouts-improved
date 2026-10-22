/**
 * Tests for `scripts/check-install-scripts.mjs`. Run with
 * `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { uncoveredInstallScripts } from './check-install-scripts.mjs';

function lock(packages) {
  return {
    lockfileVersion: 3,
    packages: { '': { name: 'root', hasInstallScript: true }, ...packages },
  };
}

describe('uncoveredInstallScripts', () => {
  it('passes packages without install scripts', () => {
    const found = uncoveredInstallScripts(
      lock({ 'node_modules/obsidian': { version: '1.13.1' } })
    );

    assert.deepEqual(found, []);
  });

  it('reports an install script allowScripts does not list, nested ones included', () => {
    const found = uncoveredInstallScripts(
      lock({
        'node_modules/esbuild': { version: '0.28.2', hasInstallScript: true },
        'node_modules/a/node_modules/@scope/b': {
          version: '1.0.0',
          hasInstallScript: true,
        },
      })
    );

    assert.deepEqual(found, [
      { name: 'esbuild', version: '0.28.2' },
      { name: '@scope/b', version: '1.0.0' },
    ]);
  });

  it('counts a denial as covered, as well as an approval', () => {
    const found = uncoveredInstallScripts(
      lock({
        'node_modules/esbuild': { version: '0.28.2', hasInstallScript: true },
        'node_modules/geckodriver': {
          version: '6.1.1',
          hasInstallScript: true,
        },
      }),
      { esbuild: true, geckodriver: false }
    );

    assert.deepEqual(found, []);
  });

  it('matches a versioned key, and not a package whose name it starts', () => {
    const found = uncoveredInstallScripts(
      lock({
        'node_modules/esbuild': { version: '0.28.2', hasInstallScript: true },
        'node_modules/esbuild-wasm': {
          version: '0.28.2',
          hasInstallScript: true,
        },
      }),
      { 'esbuild@0.28.2': true }
    );

    assert.deepEqual(found, [{ name: 'esbuild-wasm', version: '0.28.2' }]);
  });

  it('counts a package locked for another platform', () => {
    const found = uncoveredInstallScripts(
      lock({
        'node_modules/fsevents': {
          version: '2.3.3',
          hasInstallScript: true,
          optional: true,
          os: ['darwin'],
        },
      })
    );

    assert.deepEqual(found, [{ name: 'fsevents', version: '2.3.3' }]);
  });
});
