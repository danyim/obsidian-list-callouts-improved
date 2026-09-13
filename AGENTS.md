# List Callouts, Improved — agent instructions

Adapted from the [Obsidian sample plugin's `AGENTS.md`](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/AGENTS.md)
for this project's actual conventions. For anything not covered here, see
[`CONTRIBUTING.md`](CONTRIBUTING.md) (human-facing, more detail) and
[`docs/TESTING.md`](docs/TESTING.md).

## Project overview

- Obsidian community plugin (TypeScript → bundled JavaScript), a maintained
  fork of [obsidian-list-callouts](https://github.com/mgmeyers/obsidian-list-callouts).
- Entry point: `src/main.ts`, bundled to `main.js` by esbuild and loaded by
  Obsidian.
- Release artifacts: `main.js`, `manifest.json`, `styles.css`.
- Makes no network requests. Settings are the only persisted state, stored via
  `loadData()`/`saveData()` (`data.json` in the plugin's config folder).

## Environment & tooling

- Node: 24.x (what CI runs — see `.github/workflows/test.yaml`).
- Package manager: npm.
- Bundler: esbuild, configured in `config/esbuild.config.mjs`.
- Types: `obsidian` (devDependency, kept close to current — see its version in
  `package.json`).

```bash
npm install
npm run dev            # esbuild watch mode
npm run build           # tsc --noEmit + production esbuild
npm run check-types      # tsc --noEmit only
```

## Linting & formatting

- ESLint (`eslint.config.mts`) includes `eslint-plugin-obsidianmd`, which
  checks (among other things) that APIs used are available at the declared
  `minAppVersion`.
- Prettier formats `src/**/*.ts` with import sorting
  (`@trivago/prettier-plugin-sort-imports`); config lives inline in
  `package.json`.

```bash
npm run lint          # eslint .
npm run lint:fix
npm run prettier      # format src/
npm run clean         # prettier + lint:fix together
```

CI (`.github/workflows/test.yaml`) runs lint, type-check, and the e2e suite on
every push and PR.

## File & folder conventions

Everything importable lives in `src/`, one module per responsibility:

| File | What it does |
| --- | --- |
| `main.ts` | Plugin entry point: settings, the editor extension, the post processor, and the commands are wired up here. |
| `settings.ts` | The settings shape, defaults, and `buildEditorConfig`, which compiles the callout characters into the regex both renderers use. |
| `settingsTab.ts` | The settings UI, implemented via `getSettingDefinitions()`. |
| `extension.ts` | CodeMirror 6 extension — live preview / source mode rendering. |
| `postProcessor.ts` | The markdown post processor — reading mode rendering. |
| `commands.ts` | Editor commands: *Remove callout*, *Next callout*, *Previous callout*. |
| `customIcons.ts` | Reads SVGs out of the vault's `.obsidian/icons` folder and registers them with Obsidian. |
| `iconSearch.ts` | Fuzzy search behind the icon picker. |
| `iconAliases.ts` | **Generated** by `npm run icons` from `lucide-static`. Don't edit by hand. |
| `import.ts` | Reads settings from the original List Callouts plugin so they can be imported. |

The two renderers (`extension.ts`, `postProcessor.ts`) are separate
implementations of the same rules — a change to how a callout is detected or
drawn usually needs to land in both.

Other top-level directories:

- `config/` — build and test tool configs (`esbuild.config.mjs`,
  `wdio.conf.mts`, `wdio.screenshots.mts`).
- `scripts/` — `version-bump.mjs` (release tooling) and
  `make-icon-list.mjs` (generates `iconAliases.ts`).
- `test/` — e2e specs (`test/specs/**/*.e2e.ts`) and the vault fixtures they
  open (`test/vaults/`).
- `docs/` — project docs beyond the README (currently `TESTING.md`).

`styles.css` and `manifest.json` are committed source files, hand-maintained
at the repo root — they are not generated. `main.js` is a build artifact and
is gitignored; never commit a rebuilt copy.

## Manifest rules (`manifest.json`)

- `id` is `list-callouts-improved` — never change it; it's the plugin's
  stable identity in the community catalog.
- `minAppVersion` must stay accurate for whatever Obsidian APIs the code
  actually uses. `eslint-plugin-obsidianmd`'s `no-unsupported-api` rule
  enforces this against the declared value — raising `minAppVersion` when a
  newer API is genuinely needed is expected and correct, not a workaround to
  avoid.
- `authorUrl` must point to the author's own profile, not this repo.
- See the canonical requirements:
  https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

The suite is end-to-end, driving real copies of Obsidian via
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service):

```bash
npm test                                    # default version matrix, desktop + mobile UI
OBSIDIAN_VERSIONS="latest/latest" npm test  # faster while iterating
xvfb-run -a npm test                        # Linux needs a display
```

The default matrix (defined in `config/wdio.conf.mts`) runs against the
oldest public build at or above `minAppVersion` and against `latest`. If you
raise `minAppVersion`, update that file's floor version too — see the comment
there for why it isn't just `minAppVersion` verbatim (some early patch
releases are insiders-only).

New behavior should come with a spec in `test/specs/`; a bug fix should come
with one that fails without the fix. Full detail, including how screenshots
and the beta-build matrix work, is in [`docs/TESTING.md`](docs/TESTING.md).

## Commands & settings

- Commands are added in `main.ts`'s `onload()` via `this.addCommand(...)`,
  with stable, never-renamed ids (`remove-callout`, `next-callout`,
  `previous-callout`).
- Settings render through `PluginSettingTab.getSettingDefinitions()` in
  `settingsTab.ts` — there is no imperative `display()` fallback; the
  declarative settings API is required (`minAppVersion` is 1.13.0+).
- Settings persist via `this.loadData()` / `this.saveData()`, called from
  `loadSettings()`/`saveSettings()` in `main.ts`.

## Versioning & releases

For maintainers, not something an agent should do unprompted:

```bash
npm version <x.y.z> --no-git-tag-version   # bump package.json (+ lockfile)
npm run bump                                # sync manifest.json + versions.json, git add
npm run release                             # commit, tag, push, push --tags
```

Pushing the tag triggers `.github/workflows/release.yml`, which builds the
plugin, generates GitHub artifact attestations for `main.js` and
`styles.css` (`actions/attest-build-provenance`), and creates the GitHub
release with those files attached.

## Security, privacy, and compliance

Follow Obsidian's [Developer Policies](https://docs.obsidian.md/Developer+policies)
and [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
Specific to this plugin:

- It makes zero network requests today. Keep it that way — don't add any
  without an obvious user-facing reason, explicit opt-in, and documentation
  in the README and settings UI.
- The only vault access is reading the configured icon folder
  (`customIcons.ts`) and this plugin's own settings/data file. Don't widen
  that without a clear reason.
- No telemetry, analytics, or remote code execution.

## Coding conventions

- TypeScript, but not maximally strict: `noImplicitAny` is on,
  `strictNullChecks` is off (see `tsconfig.json`). Match the existing style
  rather than opportunistically tightening types in unrelated code.
- Comments explain *why*, not *what* — a constraint, a workaround, an
  Obsidian API quirk. If a line needs no explanation, it needs no comment.
- Keep `main.ts` focused on plugin lifecycle (load/unload, wiring up
  commands, the settings tab, the editor extension); delegate feature logic
  to the other modules in `src/`.
- Bundle everything into `main.js` — no unbundled runtime dependencies.
- `isDesktopOnly` is `false`: avoid Node/Electron-only APIs, and be mindful
  of mobile (`settingsTab.ts`'s icon-menu positioning already branches on
  `Platform.isMobile` where desktop and mobile genuinely need different
  layout).

## Agent do/don't

**Do**

- Keep command ids and the plugin `id` stable — never rename once released.
- Run `npm run lint` and `npm run check-types` before considering a change
  done; both are part of CI and are cheap to run locally.
- When touching `settingsTab.ts`, run the e2e suite against both versions in
  the default matrix (see Testing above) — the mobile and desktop settings UI
  differ.
- Raise `minAppVersion` deliberately (and update `config/wdio.conf.mts`) when
  a change genuinely needs a newer API, rather than working around a lint
  error with a runtime guard.

**Don't**

- Introduce network calls, telemetry, or remote code execution.
- Commit `main.js` or other build output.
- Bump the plugin version yourself unless asked — releases are cut
  separately (see Versioning & releases).

## Troubleshooting

- **Plugin doesn't load after a manual install**: `main.js`, `manifest.json`
  and `styles.css` must sit at the top level of
  `<vault>/.obsidian/plugins/list-callouts-improved/`.
- **`main.js` missing or stale**: run `npm run build` or `npm run dev`.
  Obsidian doesn't hot-reload a rebuilt `main.js` on its own — use the
  [Hot Reload](https://github.com/pjeby/hot-reload) plugin, or toggle the
  plugin off and on.
- **`no-unsupported-api` lint failures**: the API used requires a newer
  Obsidian than `minAppVersion` declares. Either avoid the API, or raise
  `minAppVersion` (and update the test matrix floor) if the newer API is the
  right call.
- **e2e tests hang or fail to download Obsidian**: the first run downloads
  real Obsidian binaries and needs a display on Linux
  (`scripts/xvfb-wm.sh`, or `xvfb-run -a npm test`). See
  [`docs/TESTING.md`](docs/TESTING.md) for the Catalyst-credentials caveat on
  some early patch versions.

## References

- Obsidian API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
- This repo's [`CONTRIBUTING.md`](CONTRIBUTING.md) and
  [`docs/TESTING.md`](docs/TESTING.md) for full detail beyond what an agent
  needs at a glance.
