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

Characters, icons and colours are all configurable, and you can add your own callouts. **Set icon** opens a searchable picker of every icon the running copy of Obsidian knows about, so it stays current as Obsidian adds icons:

![The plugin settings tab with the icon picker open, in light and dark mode](screenshots/settings-icon-picker.png)

The padding of the callouts can be adjusted using the Style Settings plugin.

## Commands

Commands take a hotkey like any other, from Settings → Hotkeys.

| Command | What it does |
| --- | --- |
| Remove callout | Strips the callout character from the line the cursor is on, leaving the list item behind. With text selected, it clears every line the selection touches, skipping any that aren't callouts, and one undo puts them all back. |

## Custom icons

Any SVG in your vault's `.obsidian/icons` folder is registered as an icon and appears in the picker alongside the ones Obsidian ships. A file named `My Fancy Icon.svg` takes the icon name `my-fancy-icon`.

That is the same folder [Iconize](https://github.com/FlorianWoelki/obsidian-iconize) uses, so a vault already keeping icons there needs no changes.

Icons are read when the plugin loads, so restart Obsidian or toggle the plugin after adding files. A name that an Obsidian icon already uses is skipped rather than replacing it, and a file that is not usable SVG is skipped with a note in the console.

## Coming from [List Callouts](https://github.com/mgmeyers/obsidian-list-callouts)

Because this fork uses a new plugin id, Obsidian treats it as a separate plugin and your existing List Callouts settings won't carry over on their own.

If the original plugin's settings are still in your vault, the settings tab offers an **Import from List Callouts** button that copies them across, recolored built-ins and custom callouts alike. Importing replaces the current callouts, so it asks for confirmation first. The button only appears when there's something to import.

Once migrated, you should disable or delete the other plugin.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for building the plugin and [docs/TESTING.md](docs/TESTING.md) for running the test suite.

## License

[GPL-3.0](LICENSE.md)

If this plugin is useful to you, consider [buying me a coffee](https://buymeacoffee.com/danyim).

