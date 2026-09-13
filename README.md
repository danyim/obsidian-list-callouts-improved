# List Callouts, Improved

Create customized callouts in any list in Obsidian.

> [!NOTE]
> **This project is a fork of [obsidian-list-callouts](https://github.com/mgmeyers/obsidian-list-callouts) by [@mgmeyers](https://github.com/mgmeyers)**, who deserves all the credit for the original plugin and its design. 
>
> That project has unfortunately seen no releases or commits since [**September 2024**](https://github.com/mgmeyers/obsidian-list-callouts/releases/tag/1.2.9) and appears to be abandoned, with issues and pull requests going unanswered.
>
> This fork picks up maintenance so the plugin keeps working with current versions of Obsidian. Just like the original, it remains licensed under GPL-3.0.

Typing a configurable character at the beginning of a list item will turn the item into a highlighted callout:

![A note with each built-in callout character applied to a list item, shown in light and dark mode](screenshots/callout-characters.png)

The characters can also be replaced with icons:

![The same note with each callout character replaced by an icon, shown in light and dark mode](screenshots/callout-icons.png)

Characters, icons and colors are all configurable, and you can add your own callouts. **Set icon** opens a searchable picker of every icon the running copy of Obsidian knows about, so it stays current as Obsidian adds icons:

![The plugin settings tab with the icon picker open, in light and dark mode](screenshots/settings-icon-picker.png)

A callout's color paints both its marker and its background. When the two need to differ — a background that is too faint to read the marker against, say — switch **Default marker color** to **Custom marker color** and pick one for the marker alone. The background keeps the callout's color, and the same marker color is used for that callout's highlights.

The padding of the callouts and the intensity of their backgrounds can be adjusted using the Style Settings plugin.

## Highlights

The same characters work inside Obsidian's `==highlight==` syntax. Start a highlight with a callout character and a space, and it takes that callout's color — and its icon, if one is set:

![A paragraph with several inline highlights, each in a different callout color and led by that callout's icon, shown in light and dark mode](screenshots/highlights.png)

A highlight that runs across a line break is colored as one, in both the editor and reading view — including a list item's continuation line — and highlights inside callout blocks and tables work too:

![A paragraph, a list, a callout block and a table, each holding highlights in different callout colors, two of them running across a line break, shown in light and dark mode](screenshots/highlight-multiline.png)

Highlights and list items share one set of callouts, so `==& text==` is yellow because the `&` callout is yellow. The character and the space are hidden when the note is rendered and reappear in Live Preview while the cursor is inside the highlight, the same way the `==` markers do.

Two settings, under **Highlights** in the settings tab:

- **Highlight callouts** turns the feature on and off.
- **Require a space after the character** is on by default, so `==& text==` is a callout and `==!important==` is left alone. Turn it off and `==&text==` works too.

The intensity of the highlight color can be adjusted using the Style Settings plugin, alongside the callout padding.

## Managing callouts

Callouts are one list. A new vault starts with the seven shown above, and from there
any of them can be edited, reordered by dragging, or deleted — the built-in ones
included. Nothing is fixed, so a vault can end up with a completely different set, or
with none at all.

![The plugin's settings tab in full: the highlight toggles, then the seven built-in callouts each with a preview, character, icon and color, and the reset at the bottom, shown in light and dark mode](screenshots/settings.png)

**Reset to defaults**, at the bottom of the settings tab, puts the original seven
back. It replaces everything currently configured, so callouts you have added and
edits to the built-in ones are lost; it asks for confirmation first, and the change
can't be undone.

The order is worth caring about, because it's the order the cycling commands below
step through.

## Commands

Each of these takes a hotkey like any other command, from Settings → Hotkeys. All
three act on every line a selection touches — skipping lines that aren't list items —
and one undo puts them all back.

| Command | What it does |
| --- | --- |
| Next callout / Previous callout | Steps the line through the callout list, in the order the settings tab shows. A plain list item is part of that cycle rather than only its starting point: stepping off either end leaves a plain list item, so tapping past the callout you wanted comes back round instead of stranding the line, and the two directions are exact inverses. |
| Remove callout | Strips the callout character from the line the cursor is on, leaving the list item behind. |

## Custom icons

Any SVG in your vault's `.obsidian/icons` folder is registered as an icon and appears in the picker alongside the ones Obsidian ships. A file named `My Fancy Icon.svg` takes the icon name `my-fancy-icon`.

That is the same folder [Iconize](https://github.com/FlorianWoelki/obsidian-iconize) uses, so a vault already keeping icons there needs no changes.

Icons are read when the plugin loads, so restart Obsidian or toggle the plugin after adding files. A name that an Obsidian icon already uses is skipped rather than replacing it, and a file that is not usable SVG is skipped with a note in the console.

## Coming from [List Callouts](https://github.com/mgmeyers/obsidian-list-callouts)

Because this fork uses a new plugin id, Obsidian treats it as a separate plugin and your existing List Callouts settings won't carry over on their own.

If the original plugin's settings are still in your vault, the settings tab offers an **Import from List Callouts** button that copies them across, recolored built-ins and custom callouts alike. Importing replaces the current callouts, so it asks for confirmation first. The button only appears when there's something to import.

![The Import from List Callouts row at the top of the settings tab, shown in light and dark mode](screenshots/settings-import.png)

Once migrated, you should disable or delete the other plugin.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for building the plugin and [docs/TESTING.md](docs/TESTING.md) for running the test suite.

## License

[GPL-3.0](LICENSE.md)

If this plugin is useful to you, consider [buying me a coffee](https://buymeacoffee.com/danyim).

