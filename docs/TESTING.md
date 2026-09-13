# Testing

End-to-end tests run against real Obsidian via
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service),
which downloads and sandboxes its own copies of the app.

```bash
npm test
```

Both `npm test` and `npm run screenshots` build `main.js` first, so a fresh pull is
enough -- Obsidian loads whatever build is in the checkout, and a stale one silently
tests or captures the wrong code.

By default this runs against Obsidian 1.13.4 and `latest`, on both the desktop and
emulated-mobile UI. Override with:

```bash
OBSIDIAN_VERSIONS="latest/latest" npm test
```

The two versions matter: `latest` catches regressions against current Obsidian,
while the floor build confirms the plugin still works on the oldest version it
declares support for.

1.13.4 rather than wdio's `earliest`, which resolves to the `minAppVersion` of
1.13.0: Obsidian 1.13.0 through 1.13.3 were insiders-only releases with no public
installer, so downloading them needs Catalyst credentials. 1.13.4 is the oldest
publicly available build at or above the floor.

Each run writes a rendering of live preview and reading mode per Obsidian version and
platform into `test/screenshots/`. CI uploads them as build artifacts, so a version bump
that changes how callouts look is visible without reproducing it locally.

A scheduled workflow re-runs the suite whenever a new Obsidian version ships. To include
Obsidian beta builds, add `OBSIDIAN_EMAIL` and `OBSIDIAN_PASSWORD` repository secrets for
an Insiders account with 2FA disabled.

On Linux, Obsidian needs a display. `npm test` handles this itself: `scripts/xvfb-wm.sh`
starts Xvfb with a window manager (matching CI's "Set up virtual graphics" step) whenever
`DISPLAY` isn't already set, then runs the suite under it. Nothing extra to run -- just
`npm test`.
