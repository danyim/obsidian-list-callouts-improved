/**
 * Swap the plugin installed in a vault between the released build and this
 * repository's local build, so a change can be tried in a real vault without
 * waiting for a release.
 *
 *   npm run swap              toggle, asking for confirmation first
 *   npm run swap -- --local   install the local build (rerun to refresh it)
 *   npm run swap -- --release put the release back
 *   npm run swap -- --configure
 *                             ask for the vault path again
 *
 * The vault path is asked for on first run and cached in
 * `.swap-installed-plugin.json` at the repo root (gitignored).
 *
 * While the local build is installed the release assets sit in `.backup/`
 * inside the plugin folder; its presence is what tells the two states apart.
 * `data.json` (the plugin's settings) is never touched. Obsidian doesn't
 * notice the swap on its own -- toggle the plugin off and on, or use Hot
 * Reload.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const REPO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const CACHE_FILE = path.join(REPO_DIR, '.swap-installed-plugin.json');

/** The files Obsidian loads a plugin from. `data.json` is settings; left alone. */
export const ASSETS = ['main.js', 'manifest.json', 'styles.css'];

/** Where the release build sits while the local build is installed. */
export const BACKUP_DIR = '.backup';

/**
 * Turn whatever the user typed -- the vault root, its `.obsidian` folder, or
 * the plugin folder itself -- into the plugin directory. Throws if the plugin
 * isn't installed there.
 */
export function resolvePluginDir(input, pluginId) {
  const base = path.resolve(input);
  const candidates = [
    path.join(base, '.obsidian', 'plugins', pluginId),
    path.join(base, 'plugins', pluginId),
    base,
  ];
  const found = candidates.find(
    (dir) =>
      path.basename(dir) === pluginId &&
      existsSync(path.join(dir, 'manifest.json'))
  );
  if (!found) {
    throw new Error(`No installed plugin "${pluginId}" found under ${base}.`);
  }
  return found;
}

/** True when the local build is installed, i.e. a backup of the release exists. */
export function isLocalInstalled(pluginDir) {
  return existsSync(path.join(pluginDir, BACKUP_DIR));
}

/**
 * Install the repo's build into the vault. The first time, the release assets
 * are moved into `.backup/`; after that the backup is left alone so rerunning
 * just refreshes the local build.
 */
export function swapToLocal({ repoDir, pluginDir }) {
  const missing = ASSETS.filter(
    (asset) => !existsSync(path.join(repoDir, asset))
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')} in ${repoDir} -- run \`npm run build\` first.`
    );
  }

  const backupDir = path.join(pluginDir, BACKUP_DIR);
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir);
    for (const asset of ASSETS) {
      renameSync(path.join(pluginDir, asset), path.join(backupDir, asset));
    }
  }
  for (const asset of ASSETS) {
    copyFileSync(path.join(repoDir, asset), path.join(pluginDir, asset));
  }
}

/**
 * Put the release build back: drop the local assets, move the backup into
 * place and delete `.backup/`. Returns false (and changes nothing) when no
 * backup exists, i.e. the release is already installed.
 */
export function swapToRelease({ pluginDir }) {
  const backupDir = path.join(pluginDir, BACKUP_DIR);
  if (!existsSync(backupDir)) return false;

  for (const asset of ASSETS) {
    rmSync(path.join(pluginDir, asset), { force: true });
    renameSync(path.join(backupDir, asset), path.join(pluginDir, asset));
  }
  rmSync(backupDir, { recursive: true });
  return true;
}

const USAGE = `Usage: npm run swap -- [--local | --release] [--configure]

  (no flag)    toggle between the release and the local build, after confirming
  --local      install this repo's build; rerun to refresh it after a rebuild
  --release    put the release build back and remove the backup
  --configure  ask for the vault path again (can be combined with a mode)
  --help       show this
`;

export function parseArgs(argv) {
  const opts = { mode: 'toggle', configure: false, help: false };
  for (const arg of argv) {
    switch (arg) {
      case '--local':
      case '--release': {
        const mode = arg.slice(2);
        if (opts.mode !== 'toggle' && opts.mode !== mode) {
          throw new Error('--local and --release are mutually exclusive.');
        }
        opts.mode = mode;
        break;
      }
      case '--configure':
        opts.configure = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown flag ${arg}.\n\n${USAGE}`);
    }
  }
  return opts;
}

export function loadCachedVault(file) {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')).vault;
}

export function saveCachedVault(file, vault) {
  writeFileSync(file, JSON.stringify({ vault }, null, 2) + '\n');
}

// One interface for the whole run, read through its async iterator rather
// than `rl.question()`: `question()` only catches the next line emitted after
// it is called, so with piped input (`printf 'vault\ny\n' | npm run swap`)
// the second answer arrives while nobody is listening and is dropped. The
// iterator buffers lines instead.
let rl;
let lines;
async function ask(question) {
  rl ??= createInterface({ input: process.stdin });
  lines ??= rl[Symbol.asyncIterator]();
  process.stdout.write(question);
  const { value, done } = await lines.next();
  if (done) throw new Error('No answer given (stdin closed).');
  return value.trim();
}

/** Ask for the vault, resolve it and cache it. Loops until it resolves. */
async function configureVault(pluginId) {
  for (;;) {
    const input = await ask(
      'Path to your Obsidian vault (or its .obsidian folder): '
    );
    if (!input) continue;
    try {
      const pluginDir = resolvePluginDir(input, pluginId);
      saveCachedVault(CACHE_FILE, path.resolve(input));
      console.log(`Saved to ${path.relative(REPO_DIR, CACHE_FILE)}.`);
      return pluginDir;
    } catch (err) {
      console.error(err.message);
    }
  }
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const pluginId = JSON.parse(
    readFileSync(path.join(REPO_DIR, 'manifest.json'), 'utf8')
  ).id;

  let pluginDir;
  const cached = opts.configure ? undefined : loadCachedVault(CACHE_FILE);
  if (cached === undefined) {
    pluginDir = await configureVault(pluginId);
  } else {
    try {
      pluginDir = resolvePluginDir(cached, pluginId);
    } catch (err) {
      throw new Error(
        `${err.message} Rerun with --configure to pick a different vault.`
      );
    }
  }

  let mode = opts.mode;
  if (mode === 'toggle') {
    mode = isLocalInstalled(pluginDir) ? 'release' : 'local';
    const what =
      mode === 'local'
        ? 'Install the LOCAL build (backing up the release)'
        : 'Restore the RELEASE build (removing the local one)';
    const answer = await ask(`${what} in ${pluginDir}? [y/N] `);
    if (!/^y(es)?$/i.test(answer)) {
      console.log('Nothing changed.');
      return;
    }
  }

  if (mode === 'local') {
    const refresh = isLocalInstalled(pluginDir);
    swapToLocal({ repoDir: REPO_DIR, pluginDir });
    console.log(
      refresh
        ? `Refreshed the local build in ${pluginDir}.`
        : `Installed the local build in ${pluginDir}; release backed up to ${BACKUP_DIR}/.`
    );
  } else if (swapToRelease({ pluginDir })) {
    console.log(`Restored the release build in ${pluginDir}.`);
  } else {
    console.log(`The release build is already installed in ${pluginDir}.`);
    return;
  }
  console.log('Toggle the plugin off and on in Obsidian to load it.');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => rl?.close());
}
