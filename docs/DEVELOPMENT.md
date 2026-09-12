# Development

```bash
npm install
npm run dev     # rebuild on change
npm run build   # type-check and produce main.js
npm run lint
```

`npm run screenshots` regenerates the images above from a real Obsidian render, so
the README always shows what the current code actually produces. Each image is a
composite of the same view in light and dark mode. It writes into `screenshots/`,
needs a display like the tests do (see [TESTING.md](TESTING.md) -- on Linux this is
handled automatically), and renders in Inter:

```bash
sudo apt-get install fonts-inter
```

The capture fails rather than falling back to another typeface, so the images stay
consistent between runs on different machines.

`npm run icons` regenerates `src/iconAliases.ts` from the `lucide-static` package.
That table only supplies *search aliases* for the icon picker. The icons themselves
come from whatever Obsidian registers at runtime, so the picker stays current even when
this file doesn't.

See [TESTING.md](TESTING.md) for running the end-to-end test suite.
