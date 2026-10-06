/**
 * Fails when package-lock.json installs anything from outside the npm
 * registry: a git repository, a tarball URL, a local path.
 *
 * Obsidian's plugin scanner lints the source with type-aware rules, and it
 * left a dependency installed from GitHub unresolved. Every import from that
 * package became `any` and each use was reported as unsafe, though lint was
 * clean here and in CI, where npm ci installs it fine. Run by `npm run lint`.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REGISTRY = 'https://registry.npmjs.org/';

/**
 * Each locked package that does not come from the registry, with where it
 * does come from. Workspace links and bundled dependencies carry no
 * `resolved` of their own and are not counted.
 */
export function nonRegistryPackages(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([name, pkg]) => name !== '' && !pkg.link && !pkg.inBundle)
    .filter(([, pkg]) => !pkg.resolved?.startsWith(REGISTRY))
    .map(([name, pkg]) => ({
      name: name.replace(/^.*node_modules\//, ''),
      resolved: pkg.resolved ?? '(no resolved URL)',
    }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const found = nonRegistryPackages(lock);

  if (found.length > 0) {
    console.error(
      'These dependencies are not installed from the npm registry, and ' +
        "Obsidian's plugin scanner may not resolve them:\n"
    );
    for (const { name, resolved } of found) {
      console.error(`  ${name}: ${resolved}`);
    }
    process.exit(1);
  }
}
