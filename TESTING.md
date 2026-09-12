# Testing

End-to-end tests run against real Obsidian via
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service),
which downloads and sandboxes its own copies of the app.

```bash
npm test
```

By default this runs against Obsidian 1.1.8 and `latest`, on both the desktop and
emulated-mobile UI. Override with:

```bash
OBSIDIAN_VERSIONS="latest/latest" npm test
```

The two versions matter: Obsidian 1.13 replaced the imperative settings API with
declarative setting definitions. The plugin implements both, so the older version
exercises the `display()` fallback and `latest` exercises `getSettingDefinitions()`.

1.1.8 rather than wdio's `earliest`, which resolves to the `minAppVersion` of 1.1.1:
Obsidian 1.1.1 through 1.1.7 were insiders-only releases with no public installer, so
downloading them needs Catalyst credentials. 1.1.8 is the oldest publicly available
build at or above the floor.

Each run writes a rendering of live preview and reading mode per Obsidian version and
platform into `test/screenshots/`. CI uploads them as build artifacts, so a version bump
that changes how callouts look is visible without reproducing it locally.

A scheduled workflow re-runs the suite whenever a new Obsidian version ships. To include
Obsidian beta builds, add `OBSIDIAN_EMAIL` and `OBSIDIAN_PASSWORD` repository secrets for
an Insiders account with 2FA disabled.

On Linux, Obsidian needs a display; CI uses Xvfb with a window manager, and locally you
can do the same:

```bash
xvfb-run -a npm test
```
