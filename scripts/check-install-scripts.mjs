/**
 * Fails when package-lock.json installs a package with an install script that
 * package.json's `allowScripts` neither approves nor denies.
 *
 * npm 12 blocks dependency install scripts unless `allowScripts` lists them,
 * and with `strict-allow-scripts` an unlisted one fails the whole install
 * (ESTRICTALLOWSCRIPTS). Obsidian's plugin scanner could not install 1.8.3's
 * dependencies ("Source review dependency installation failed"), which is
 * that failure: npm ci on npm 11 and in CI, where no such policy applies,
 * installed it fine. Run by `npm run lint`; after a dependency change, list
 * what needs a decision with `npx npm@12 install-scripts ls`.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Whether an `allowScripts` key, `name` or `name@range`, names `name`. */
function names(key, name) {
  return key === name || key.startsWith(`${name}@`);
}

/**
 * Each locked package with an install script that `allowScripts` does not
 * cover, with its version. Every platform's packages count, fsevents
 * included: the install runs somewhere, even if not here.
 */
export function uncoveredInstallScripts(lock, allowScripts = {}) {
  const keys = Object.keys(allowScripts);

  return Object.entries(lock.packages ?? {})
    .filter(([path, pkg]) => path !== '' && pkg.hasInstallScript)
    .map(([path, pkg]) => ({
      name: pkg.name ?? path.replace(/^.*node_modules\//, ''),
      version: pkg.version,
    }))
    .filter(({ name }) => !keys.some((key) => names(key, name)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const { allowScripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  const found = uncoveredInstallScripts(lock, allowScripts);

  if (found.length > 0) {
    console.error(
      'These dependencies have install scripts that allowScripts in ' +
        "package.json does not cover, so npm 12's strict install, and " +
        "Obsidian's plugin scanner with it, fails:\n"
    );
    for (const { name, version } of found) {
      console.error(`  ${name}@${version}`);
    }
    console.error(
      '\nAdd each to allowScripts: false if the package works without its ' +
        'script, true (or name@version) if it needs it to run.'
    );
    process.exit(1);
  }
}
