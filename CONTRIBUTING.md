# Contributing

Thanks for wanting to help. List Callouts, Improved is a small plugin with a
small surface area, so most contributions are small too — and that's the intent.

## Reporting a bug or asking for a feature

Open an issue and the form will ask for what's needed. The two things worth
knowing up front:

- **Include the Obsidian version and the plugin version.** The plugin supports
  Obsidian back to 1.13.0, so behavior can genuinely differ between versions.
- **Check which plugin you're running.** List Callouts, Improved is a fork of
  [obsidian-list-callouts](https://github.com/mgmeyers/obsidian-list-callouts).
  The two can be installed side by side and don't share state, so a bug in the
  original belongs in [its tracker](https://github.com/mgmeyers/obsidian-list-callouts/issues).

If a change is large or would alter how callouts render, open an issue before
writing the code. It's a cheaper place to disagree than a pull request.

## Getting set up

You need Node 24 — that's what CI runs — and npm.

```bash
git clone https://github.com/danyim/obsidian-list-callouts-improved
cd obsidian-list-callouts-improved
npm install
npm run dev     # rebuild main.js on change
```

To try it in a real vault, symlink or copy the repository into
`<vault>/.obsidian/plugins/list-callouts-improved` and enable it. It needs
`main.js`, `manifest.json` and `styles.css` present, which `npm run dev`
takes care of. Obsidian doesn't pick up a rebuilt `main.js` on its own; use
the [Hot Reload](https://github.com/pjeby/hot-reload) plugin, or toggle the
plugin off and on.

## How the code is laid out

Everything lives in `src/`:

| File | What it does |
| --- | --- |
| `main.ts` | Plugin entry point: settings, the editor extension, the post processor, and the commands are all wired up here. |
| `settings.ts` | The settings shape, the defaults, and `buildEditorConfig`, which compiles the callout characters into the regex both renderers use. |
| `settingsTab.ts` | The settings UI, implemented via `getSettingDefinitions()`. |
| `extension.ts` | CodeMirror 6 extension — the live preview / source mode rendering. |
| `postProcessor.ts` | The markdown post processor — reading mode rendering. |
| `commands.ts` | Editor commands: *Remove callout*, *Next callout*, *Previous callout*. |
| `customIcons.ts` | Reads SVGs out of the vault's `.obsidian/icons` folder and registers them with Obsidian. |
| `iconSearch.ts` | Fuzzy search behind the icon picker. |
| `iconAliases.ts` | **Generated** by `npm run icons` from `lucide-static`. Don't edit it by hand. |
| `import.ts` | Reads settings from the original List Callouts plugin so they can be imported. |

The two renderers are separate implementations of the same rules, so a change to
how a callout is detected or drawn usually needs to land in both `extension.ts`
and `postProcessor.ts`.

## Style

Formatting and linting are enforced, not advisory:

```bash
npm run lint          # eslint, including eslint-plugin-obsidianmd
npm run lint:fix
npm run prettier      # format src/
npm run clean         # prettier + lint:fix together
npm run check-types   # tsc --noEmit
```

Comments in this codebase explain *why* something is the way it is — a
constraint, a workaround, an Obsidian quirk — rather than restating what the
line does. Please match that. If a piece of code needs no explanation, it needs
no comment.

## Tests

The suite is end-to-end: it drives real copies of Obsidian via
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service),
which downloads and sandboxes them itself.

```bash
npm test                                  # 1.13.4 and latest, desktop and mobile UI
OBSIDIAN_VERSIONS="latest/latest" npm test  # faster while iterating
xvfb-run -a npm test                      # Linux needs a display
```

The first run downloads Obsidian, so give it a minute. Specs live in
`test/specs/`, and the vaults they open live in `test/vaults/`. New behavior
should come with a spec; a bug fix should come with one that fails without the
fix.

Both Obsidian versions are covered deliberately — 1.13.4 confirms the floor
still works and `latest` catches regressions against current Obsidian. If a
change touches `settingsTab.ts`, run against both before opening the PR.

Each run writes renderings into `test/screenshots/`, which CI uploads as
artifacts. The README's images are separate and come from `npm run screenshots`;
regenerate them if you change how callouts look.

## Pull requests

- Branch off `main`.
- Keep the change focused. Unrelated cleanups are welcome, but as their own PR.
- Make sure `npm run lint`, `npm run check-types` and `npm test` pass. CI runs
  all three, on any target branch, so a PR stacked on another branch still gets
  checked.
- Don't commit a rebuilt `main.js` unless the change is to the build itself —
  it's a build artifact and it makes diffs unreadable.
- Don't bump the version. Releases are cut separately (see below).
- Write the description for someone who wasn't in your head: what changed, and
  why. The PR template asks for exactly that.

Review is usually quick. If a PR goes quiet, a nudge on the thread is fine.

## Releases

For maintainers. `npm version <x.y.z>` does the whole bump: it updates
`package.json`, runs the `version` script to sync `manifest.json` and
`versions.json`, commits, tags, and (via `postversion`) pushes the branch and
the tag. The pushed tag triggers the release workflow, which builds the
plugin, attests the release assets, and creates a **draft** GitHub release
with notes generated from the commits since the last tag. The assets are the
three loose files the community catalog installs from (`main.js`,
`manifest.json`, `styles.css`) plus `list-callouts-improved-<version>.zip`,
which wraps them in a `list-callouts-improved/` folder for manual installs.

Check the draft over on GitHub -- assets and generated notes -- then publish
it from there. Nothing goes out to users until you do.

`minAppVersion` in `manifest.json` is the floor the tests are pinned against, so
raising it means updating `config/wdio.conf.mts` too.

## Licence

List Callouts, Improved is GPL-3.0-or-later, inherited from the plugin it was
forked from. By contributing you agree your contribution is licensed the same way.
