import {
  App,
  ButtonComponent,
  ColorComponent,
  DropdownComponent,
  ExtraButtonComponent,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  SettingDefinitionRender,
  TextComponent,
  debounce,
  setIcon,
  setTooltip,
} from 'obsidian';

import { allIconIds, searchIcons } from './iconSearch';
import { ConfirmImportModal, LEGACY_PLUGIN_NAME } from './import';
import type ListCalloutsPlugin from './main';
import { Callout, HighlightSettings, calloutColorStyle } from './settings';

// Build a static CM6 list line with callout markup applied
export function buildSettingCallout(root: HTMLElement, callout: Callout) {
  root.empty();
  root.createDiv(
    {
      cls: 'markdown-source-view cm-s-obsidian mod-cm6 is-readable-line-width is-live-preview',
    },
    (mockSrcView) => {
      mockSrcView.createDiv(
        {
          cls: 'HyperMD-list-line HyperMD-list-line-1 lc-list-callout cm-line',
          attr: {
            style: `text-indent: -8px; padding-left: 12px; ${calloutColorStyle(callout)}`,
          },
        },
        (mockListLine) => {
          mockListLine.createSpan(
            {
              cls: 'cm-formatting cm-formatting-list cm-formatting-list-ul cm-list-1',
            },
            (span) => {
              span.createSpan({ cls: 'list-bullet', text: '-' });
              span.appendText(' ');
            }
          );
          mockListLine.createSpan({ cls: 'lc-list-bg' });
          mockListLine.createSpan({ cls: 'lc-list-marker' }, (span) => {
            if (callout.icon) {
              setIcon(span, callout.icon);
            } else {
              span.appendText(callout.char);
            }
          });
          mockListLine.createSpan({
            cls: 'cm-list-1',
            text: ' Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
          });
        }
      );
    }
  );
}

/**
 * How many icons the picker adds to its list at a time: a couple of screens,
 * so a flick of the wheel does not run into the end, and still cheap to
 * build.
 */
const ICON_PAGE_SIZE = 120;

function attachIconMenu(
  btn: ButtonComponent,
  onSelect: (icon: null | string) => void
) {
  let menuRef: HTMLDivElement = null;
  const btnEl = btn.buttonEl;

  btn.onClick((e) => {
    e.preventDefault();
    // The settings tab has a scrolling pane around the row; a dialog
    // (NewCalloutModal) does not, and the two position the menu differently.
    const inDialog = !btnEl.closest('.vertical-tab-content');
    const destroyEventHandlers = () => {
      btnEl.win.removeEventListener('click', clickOutside);
    };
    const clickOutside = (e: MouseEvent) => {
      if (menuRef) {
        if (!menuRef.contains(e.targetNode)) {
          menuRef.detach();
          menuRef = null;
          destroyEventHandlers();
        }
      } else {
        destroyEventHandlers();
      }
    };

    // The menu is a sibling of the button, positioned within the same
    // .lc-input-container, so the button's offsets are the menu's
    // coordinates as they are. That container scrolls with the rest of the
    // settings tab, and the menu along with it -- there is nothing to
    // correct for the tab's scroll position, and no need to follow it.
    const calcMenuPos = () => {
      if (inDialog) {
        // A dialog clips whatever overflows it (.modal is overflow: auto),
        // and the menu is taller than what sits under the button in one. So
        // in a dialog the menu is fixed to the viewport instead, which
        // nothing between it and the window can clip, and positioned from
        // the button's on-screen rect rather than its offsets. (Not in the
        // settings tab: on a phone its pane has will-change: transform,
        // which would make the pane the containing block for fixed too.)
        const b = btnEl.getBoundingClientRect();
        const bound = btnEl.closest('.modal')?.getBoundingClientRect();
        const root = btnEl.doc.documentElement;
        const GAP = 2;

        // Under the button when the screen has room there, else over it:
        // fixed to the viewport, the menu can no longer be scrolled into
        // view, so off the bottom edge would mean unreachable. A window too
        // short for either side gets it at the top, whole, over the button.
        const height = menuRef.offsetHeight;
        const fitsBelow = b.bottom + GAP + height <= root.clientHeight;
        const top = fitsBelow
          ? b.bottom + GAP
          : Math.max(b.top - GAP - height, 0);

        // Same left-or-right choice as below, bounded by the dialog's edge.
        const fitsToTheRight =
          b.left + menuRef.offsetWidth <= (bound?.right ?? Infinity);
        const side = fitsToTheRight
          ? `left: ${b.left}px;`
          : `right: ${root.clientWidth - b.right}px;`;

        menuRef.style.cssText = `position: fixed; top: ${top}px; ${side}`;
        return;
      }

      let pos = `top: ${btnEl.offsetTop + btnEl.offsetHeight + 2}px;`;
      // Hang the menu from the button's left edge when it fits, else from its
      // right edge. Which one that is depends on where the button landed in
      // its row: the inputs wrap, so on a narrow (mobile) settings pane the
      // button can sit at either side.
      const parentWidth = btnEl.offsetParent.clientWidth;
      const fitsToTheRight =
        btnEl.offsetLeft + menuRef.offsetWidth <= parentWidth;
      if (fitsToTheRight) {
        pos += ` left: ${btnEl.offsetLeft}px;`;
      } else {
        pos += ` right: ${
          parentWidth - (btnEl.offsetLeft + btnEl.offsetWidth)
        }px;`;
      }
      menuRef.style.cssText = pos;
    };

    if (menuRef) {
      destroyEventHandlers();
      menuRef.detach();
      menuRef = null;
      return;
    }

    createDiv('lc-menu', (menu) => {
      menuRef = menu;
      btnEl.after(menuRef);
      calcMenuPos();

      // Obsidian registers a couple of thousand icons and the list shows
      // about fifty of them at a time, so an element is only built when its
      // icon comes into view -- building an SVG for each of them up front
      // stalled the picker for a noticeable moment every time it opened.
      // Built elements are kept for the life of the menu so a search that
      // brings one back does not build it twice.
      const iconEls: Record<string, HTMLDivElement> = {};
      const iconEl = (icon: string) =>
        (iconEls[icon] ??= createDiv(
          {
            cls: 'clickable-icon',
            attr: {
              'data-icon': icon,
            },
          },
          (item) => {
            setIcon(item, icon);
            // The id, not a prettier form of it: it is what search matches
            // on and what the callout stores, so what you read is what you
            // would type. Shown at once -- the picker is a wall of small
            // glyphs, and a hover is a question about one of them. A delay
            // of 1 rather than 0: Obsidian treats 0 as "not set" and falls
            // back to its default second of hover.
            setTooltip(item, icon, { delay: 1 });
            item.onClickEvent(() => {
              btn.buttonEl.empty();
              btn.setIcon(icon);
              onSelect(icon);
              destroyEventHandlers();
              menuRef.detach();
              menuRef = null;
            });
          }
        ));

      // The icons still to be added to the list, in display order.
      let pending: string[] = [];

      const showMore = () => {
        pending
          .splice(0, ICON_PAGE_SIZE)
          .forEach((icon) => iconList.append(iconEl(icon)));
      };

      // Keep adding pages until the list can scroll, or runs out: a
      // handful of hits from a search, or a wide list on a large screen, may
      // not fill the box, and then there is no scroll to ask for more.
      const fill = () => {
        while (
          pending.length &&
          iconList.scrollHeight <= iconList.clientHeight
        ) {
          showMore();
        }
      };

      const showIcons = (icons: string[]) => {
        iconList.empty();
        iconList.scrollTop = 0;
        pending = icons.slice();
        showMore();
        fill();
      };

      menu.createDiv('lc-menu-search', (el) => {
        el.createEl(
          'input',
          {
            attr: {
              type: 'text',
              placeholder: 'Search...',
            },
          },
          (input) => {
            activeWindow.setTimeout(() => {
              input.focus();
            });
            const handler = debounce(
              () => showIcons(searchIcons(input.value)),
              250,
              true
            );
            input.addEventListener('input', handler);
          }
        );
      });

      const iconList = menu.createDiv('lc-menu-icons');

      iconList.addEventListener('scroll', () => {
        const { scrollTop, clientHeight, scrollHeight } = iconList;
        // Within a screen of the end: add the next page before it is reached.
        if (scrollHeight - scrollTop - clientHeight < clientHeight) {
          showMore();
        }
      });

      showIcons(allIconIds());
    });

    btnEl.win.setTimeout(() => {
      btnEl.win.addEventListener('click', clickOutside);
    }, 10);
  });
}

function parseRgb(color: string) {
  const [r, g, b] = color.split(',').map((v) => parseInt(v.trim(), 10));
  return { r, g, b };
}

function formatRgb({ r, g, b }: { r: number; g: number; b: number }) {
  return `${r}, ${g}, ${b}`;
}

/**
 * A color picker wrapped so it can be labeled, found and removed as a unit:
 * ColorComponent does not expose its input element.
 */
function colorPicker(
  container: HTMLElement,
  cls: string,
  label: string,
  color: string,
  onPick: (color: string) => void
) {
  const wrapper = container.createSpan({ cls });
  const picker = new ColorComponent(wrapper)
    .setValueRgb(parseRgb(color))
    .onChange(() => onPick(formatRgb(picker.getValueRgb())));
  wrapper.querySelector('input')?.setAttribute('aria-label', label);
  return wrapper;
}

/**
 * The color controls of a callout: its color, and a dropdown that either
 * leaves the marker on that color or opens a second picker for it. Edits
 * `callout` in place and calls `onChange` after each one.
 *
 * Switching to "custom" stores the callout's current color as the marker
 * color straight away, so the preview does not change until a color is
 * picked -- and so the dropdown reads "custom" again when the tab is reopened
 * even if none ever is.
 */
function buildColorControls(
  container: HTMLElement,
  callout: Callout,
  onChange: () => void
) {
  colorPicker(container, 'lc-color', 'Color', callout.color, (color) => {
    callout.color = color;
    onChange();
  });

  let markerPicker: HTMLElement | null = null;

  const showMarkerPicker = () => {
    markerPicker = colorPicker(
      container,
      'lc-marker-color',
      'Marker color',
      callout.markerColor,
      (color) => {
        callout.markerColor = color;
        onChange();
      }
    );
  };

  new DropdownComponent(container)
    .addOptions({
      default: 'Default marker color',
      custom: 'Custom marker color',
    })
    .setValue(callout.markerColor ? 'custom' : 'default')
    .onChange((mode) => {
      if (mode === 'custom') {
        callout.markerColor = callout.color;
        showMarkerPicker();
      } else {
        delete callout.markerColor;
        markerPicker?.remove();
        markerPicker = null;
      }
      onChange();
    })
    .selectEl.addClass('lc-marker-color-mode');

  if (callout.markerColor) showMarkerPicker();
}

/**
 * Fill `containerEl` with one callout's preview and controls, rendered into
 * the control element of a declarative `list` setting definition.
 */
export function buildCalloutRow(
  containerEl: HTMLElement,
  plugin: ListCalloutsPlugin,
  index: number,
  callout: Callout
) {
  const calloutContainer = containerEl.createDiv({
    cls: 'lc-callout-container',
  });

  buildSettingCallout(calloutContainer, callout);

  containerEl.createDiv({ cls: 'lc-input-container' }, (inputContainer) => {
    const redrawPreview = () =>
      buildSettingCallout(calloutContainer, plugin.settings[index]);

    // Character input
    new TextComponent(inputContainer)
      .setValue(callout.char)
      .onChange((value) => {
        if (!value) return;

        plugin.settings[index].char = value;
        void plugin.saveSettings();

        redrawPreview();
      });

    // Icon select menu
    const iconBtn = new ButtonComponent(inputContainer).then((btn) => {
      if (callout.icon) {
        btn.setIcon(callout.icon);
      } else {
        btn.setButtonText('Set icon');
      }

      attachIconMenu(btn, (icon) => {
        if (icon == null) {
          delete plugin.settings[index].icon;
        } else {
          plugin.settings[index].icon = icon;
        }

        void plugin.saveSettings();
        redrawPreview();
      });
    });

    new ButtonComponent(inputContainer).then((btn) => {
      btn.setButtonText('Clear icon');
      btn.onClick(() => {
        delete plugin.settings[index].icon;
        iconBtn.buttonEl.empty();
        iconBtn.setButtonText('Set icon');
        void plugin.saveSettings();
        redrawPreview();
      });
    });

    buildColorControls(inputContainer, plugin.settings[index], () => {
      void plugin.saveSettings();
      redrawPreview();
    });
  });
}

/**
 * Collects the character, icon and color for a new custom callout.
 */
export class NewCalloutModal extends Modal {
  // A muted yellow rather than the gray of the built-in `%` callout, so a
  // callout added without touching the picker still stands apart from it.
  private callout: Callout = {
    char: '',
    color: '201, 180, 88',
    custom: true,
  };

  constructor(
    private plugin: ListCalloutsPlugin,
    private onSubmit: (callout: Callout) => void
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    // Modal.setTitle() postdates our minAppVersion; titleEl does not.
    this.titleEl.setText('Add callout');

    const previewEl = this.contentEl.createDiv({
      cls: 'lc-callout-container',
    });

    const inputContainer = this.contentEl.createDiv({
      cls: 'lc-input-container',
    });

    const char = new TextComponent(inputContainer)
      .setPlaceholder('...')
      .onChange((value) => {
        this.callout.char = value;
        redraw();
      });

    const iconBtn = new ButtonComponent(inputContainer).setButtonText(
      'Set icon'
    );

    attachIconMenu(iconBtn, (icon) => {
      if (icon == null) {
        delete this.callout.icon;
      } else {
        this.callout.icon = icon;
      }
      redraw();
    });

    buildColorControls(inputContainer, this.callout, () => redraw());

    const errorEl = this.contentEl.createDiv({ cls: 'lc-error' });

    let submit: ButtonComponent;

    new Setting(this.contentEl)
      .setClass('lc-modal-buttons')
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close())
      )
      .addButton((btn) => {
        submit = btn
          .setButtonText('Add')
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(this.callout);
          });
      });

    const redraw = () => {
      buildSettingCallout(previewEl, this.callout);

      const value = char.getValue();
      const conflict = this.plugin.settings.some((c) => c.char === value);

      errorEl.setText(
        value && conflict
          ? `"${value}" is already used by another callout.`
          : ''
      );

      submit.setDisabled(!value || conflict);
    };

    redraw();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const RESET_DESC =
  "Replace ALL your callouts with the default items. Any callouts you've added (including any changes to the default) will be lost.";

/**
 * Resetting throws away every callout the user has configured, so confirm
 * first and say plainly that it does not come back.
 */
export class ConfirmResetModal extends Modal {
  constructor(
    app: App,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    // Modal.setTitle() postdates our minAppVersion; titleEl does not.
    this.titleEl.setText('Reset to defaults');

    this.contentEl.createEl('p', {
      text: `${RESET_DESC} This is permanent and can't be undone.`,
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText('Reset')
          .setDestructive()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ListCalloutSettingTab extends PluginSettingTab {
  plugin: ListCalloutsPlugin;

  constructor(plugin: ListCalloutsPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  private styleSettingsDesc(): DocumentFragment {
    return createFragment((f) => {
      f.appendText(
        'See the Style Settings plugin for additional configuration options.'
      );
      f.append(createEl('br'));
      f.append(
        createEl('strong', {
          text: 'Note:',
        })
      );
      f.appendText(
        ' using +, *, -, >, or # as the callout character can disrupt reading mode.'
      );
    });
  }

  private highlightsDesc(): DocumentFragment {
    return createFragment((f) => {
      f.appendText(
        'Color inline highlights that start with a callout character. '
      );
      f.append(createEl('code', { text: '==& text==' }));
      f.appendText(' becomes a highlight in the ');
      f.append(createEl('code', { text: '&' }));
      f.appendText(" callout's color, with its icon in front if one is set.");
    });
  }

  private requireSpaceDesc(): DocumentFragment {
    return createFragment((f) => {
      f.appendText('When toggled on, only ');
      f.append(createEl('code', { text: '==& text==' }));
      f.appendText(
        ' is a callout, matching how list callouts work. When off, '
      );
      f.append(createEl('code', { text: '==&text==' }));
      f.appendText(
        ' works too and a space after the character becomes optional.'
      );
    });
  }

  // The default implementations read and write `plugin.settings[key]`, which
  // here is the callout array; the toggles live on `plugin.highlights`.
  getControlValue(key: string): unknown {
    return this.plugin.highlights[key as keyof HighlightSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    this.plugin.highlights[key as keyof HighlightSettings] = value as boolean;
    await this.plugin.saveSettings();
  }

  private async runImport(): Promise<void> {
    try {
      const count = await this.plugin.importLegacySettings();
      new Notice(
        `Imported ${count} callout${count === 1 ? '' : 's'} from ${LEGACY_PLUGIN_NAME}.`
      );
      this.refresh();
    } catch (e) {
      new Notice(`Import failed. ${(e as Error).message}`);
    }
  }

  private deleteCallout(index: number): void {
    this.plugin.settings.splice(index, 1);
    void this.plugin.saveSettings();
    this.refresh();
  }

  private reorderCallout(oldIndex: number, newIndex: number): void {
    const settings = this.plugin.settings;
    const [moved] = settings.splice(oldIndex, 1);
    settings.splice(newIndex, 0, moved);
    void this.plugin.saveSettings();
    this.refresh();
  }

  private async runReset(): Promise<void> {
    await this.plugin.resetSettings();
    this.refresh();
  }

  private addCallout(callout: Callout): void {
    this.plugin.settings.push(callout);
    void this.plugin.saveSettings();
    this.refresh();
  }

  /**
   * Re-read the settings into the tab. Obsidian caches the definitions
   * returned by getSettingDefinitions(), so anything that changes the
   * callouts structurally has to ask for a refresh.
   */
  refresh(): void {
    this.update();
  }

  private calloutDefinition(
    callout: Callout,
    index: number
  ): SettingDefinitionRender {
    return {
      // Not worth showing: every row's own name would start with the same
      // "Callout " prefix, and the character itself already appears in the
      // row's own preview and character input right below.
      name: '',
      aliases: callout.icon ? [callout.icon] : undefined,
      render: (setting: Setting) => {
        setting.settingEl.addClass('lc-setting');
        buildCalloutRow(setting.controlEl, this.plugin, index, callout);
      },
    };
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    const definitions: SettingDefinitionItem[] = [];

    definitions.push({
      name: `Import from ${LEGACY_PLUGIN_NAME}`,
      desc: `Settings from ${LEGACY_PLUGIN_NAME} (legacy plugin) were found in your vault and can be imported. This will replace this plugin's currently configured callouts permanently.`,
      // Obsidian evaluates this on every render of the tab, and doesn't call
      // getSettingDefinitions() again once it has cached them, so this is the
      // one hook that runs each time the tab opens. That makes it the place
      // to look for the legacy file again -- the other plugin may have saved
      // its settings since we loaded. The check is async and this isn't, so
      // the row paints from the last answer and is toggled if that changed.
      visible: () => {
        void this.plugin.recheckLegacyData().then((changed) => {
          if (changed) this.refreshDomState();
        });
        return this.plugin.legacyDataAvailable;
      },
      render: (setting: Setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText('Import')
            .setCta()
            .onClick(() => {
              new ConfirmImportModal(this.plugin.app, () => {
                void this.runImport();
              }).open();
            })
        );
      },
    });

    definitions.push(
      {
        type: 'group',
        heading: 'Highlights',
        items: [
          {
            name: 'Highlight callouts',
            desc: this.highlightsDesc(),
            control: { type: 'toggle', key: 'enabled', defaultValue: true },
          },
          {
            name: 'Require a space after the character',
            desc: this.requireSpaceDesc(),
            control: {
              type: 'toggle',
              key: 'requireSpace',
              defaultValue: true,
            },
          },
        ],
      },
      {
        // The list below can hold only its rows, so the aside about the
        // callouts' padding, intensity and unsafe characters lives in a group
        // of its own that carries the heading -- and the add button, which
        // would otherwise sit on an empty header row of the headingless list.
        type: 'group',
        heading: 'Callouts',
        extraButtons: [
          (btn: ExtraButtonComponent) =>
            btn
              .setIcon('plus')
              .setTooltip('Add callout')
              .onClick(() => {
                new NewCalloutModal(this.plugin, (callout) =>
                  this.addCallout(callout)
                ).open();
              }),
        ],
        items: [
          {
            name: 'Style settings',
            desc: this.styleSettingsDesc(),
          },
        ],
      },
      {
        // One list rather than a built-in group and a custom one: every
        // callout can now be deleted and reordered, and the order is what the
        // next/previous commands step through, so a custom callout has to be
        // able to sit between two built-ins.
        type: 'list',
        emptyState:
          'No callouts. Reset to defaults to bring the built-in ones back.',
        items: settings.map((callout, i) => this.calloutDefinition(callout, i)),
        onDelete: (index: number) => this.deleteCallout(index),
        onReorder: (oldIndex: number, newIndex: number) =>
          this.reorderCallout(oldIndex, newIndex),
      },
      {
        name: 'Reset to defaults',
        desc: RESET_DESC,
        // A real button, styled as the destructive step it is, rather than
        // the link-like row an `action` definition renders as.
        render: (setting: Setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText('Reset')
              .setDestructive()
              .onClick(() => {
                new ConfirmResetModal(this.plugin.app, () => {
                  void this.runReset();
                }).open();
              })
          );
        },
      }
    );

    return definitions;
  }
}
