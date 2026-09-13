/**
 * Tests for `scripts/swap-installed-plugin.mjs`. Run with
 * `npm run test:scripts` (plain `node --test`, no extra tooling).
 *
 * Every test builds a throwaway "repo" and "vault" under a temp directory so
 * the real vault is never touched.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  ASSETS,
  isLocalInstalled,
  loadCachedVault,
  parseArgs,
  resolvePluginDir,
  saveCachedVault,
  swapToLocal,
  swapToRelease,
} from './swap-installed-plugin.mjs';

const PLUGIN_ID = 'list-callouts-improved';

let tmp;
let repoDir;
let pluginDir;

function write(dir, name, contents) {
  writeFileSync(path.join(dir, name), contents);
}
function read(dir, name) {
  return readFileSync(path.join(dir, name), 'utf8');
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'swap-installed-plugin-'));
  repoDir = path.join(tmp, 'repo');
  pluginDir = path.join(tmp, 'vault', '.obsidian', 'plugins', PLUGIN_ID);
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(pluginDir, { recursive: true });
  for (const asset of ASSETS) {
    write(repoDir, asset, `local ${asset}`);
    write(pluginDir, asset, `release ${asset}`);
  }
  write(pluginDir, 'data.json', '{"settings":true}');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('swapToLocal', () => {
  it('backs up the release assets and installs the local build', () => {
    swapToLocal({ repoDir, pluginDir });

    for (const asset of ASSETS) {
      assert.equal(read(pluginDir, asset), `local ${asset}`);
      assert.equal(
        read(path.join(pluginDir, '.backup'), asset),
        `release ${asset}`
      );
    }
    assert.equal(isLocalInstalled(pluginDir), true);
  });

  it('leaves data.json alone', () => {
    swapToLocal({ repoDir, pluginDir });
    assert.equal(read(pluginDir, 'data.json'), '{"settings":true}');
    assert.equal(
      existsSync(path.join(pluginDir, '.backup', 'data.json')),
      false
    );
  });

  it('refreshes the local build without clobbering the release backup', () => {
    swapToLocal({ repoDir, pluginDir });
    write(repoDir, 'main.js', 'local main.js v2');

    swapToLocal({ repoDir, pluginDir });

    assert.equal(read(pluginDir, 'main.js'), 'local main.js v2');
    assert.equal(
      read(path.join(pluginDir, '.backup'), 'main.js'),
      'release main.js'
    );
  });

  it('fails before touching the vault when the repo has no build', () => {
    rmSync(path.join(repoDir, 'main.js'));

    assert.throws(() => swapToLocal({ repoDir, pluginDir }), /npm run build/);
    assert.equal(read(pluginDir, 'main.js'), 'release main.js');
    assert.equal(isLocalInstalled(pluginDir), false);
  });
});

describe('swapToRelease', () => {
  it('restores the release assets and removes the backup', () => {
    swapToLocal({ repoDir, pluginDir });

    const restored = swapToRelease({ pluginDir });

    assert.equal(restored, true);
    for (const asset of ASSETS) {
      assert.equal(read(pluginDir, asset), `release ${asset}`);
    }
    assert.equal(existsSync(path.join(pluginDir, '.backup')), false);
    assert.equal(read(pluginDir, 'data.json'), '{"settings":true}');
  });

  it('is a no-op when the release is already installed', () => {
    const restored = swapToRelease({ pluginDir });

    assert.equal(restored, false);
    for (const asset of ASSETS) {
      assert.equal(read(pluginDir, asset), `release ${asset}`);
    }
  });
});

describe('resolvePluginDir', () => {
  it('accepts the vault root', () => {
    assert.equal(
      resolvePluginDir(path.join(tmp, 'vault'), PLUGIN_ID),
      pluginDir
    );
  });

  it('accepts the .obsidian directory', () => {
    assert.equal(
      resolvePluginDir(path.join(tmp, 'vault', '.obsidian'), PLUGIN_ID),
      pluginDir
    );
  });

  it('accepts the plugin directory itself', () => {
    assert.equal(resolvePluginDir(pluginDir, PLUGIN_ID), pluginDir);
  });

  it('rejects a path with no such plugin installed', () => {
    assert.throws(
      () => resolvePluginDir(tmp, PLUGIN_ID),
      new RegExp(PLUGIN_ID)
    );
  });
});

describe('parseArgs', () => {
  it('defaults to toggling with confirmation', () => {
    assert.deepEqual(parseArgs([]), {
      mode: 'toggle',
      configure: false,
      help: false,
    });
  });

  it('reads the force flags', () => {
    assert.equal(parseArgs(['--local']).mode, 'local');
    assert.equal(parseArgs(['--release']).mode, 'release');
  });

  it('combines --configure with a mode', () => {
    assert.deepEqual(parseArgs(['--configure', '--local']), {
      mode: 'local',
      configure: true,
      help: false,
    });
  });

  it('rejects both force flags at once', () => {
    assert.throws(
      () => parseArgs(['--local', '--release']),
      /--local and --release/
    );
  });

  it('rejects unknown flags', () => {
    assert.throws(() => parseArgs(['--vault']), /--vault/);
  });
});

describe('config cache', () => {
  it('round-trips the vault path', () => {
    const file = path.join(tmp, 'cache.json');
    assert.equal(loadCachedVault(file), undefined);

    saveCachedVault(file, '/some/vault');

    assert.equal(loadCachedVault(file), '/some/vault');
  });
});
