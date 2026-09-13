import {
  App,
  ButtonComponent,
  ColorComponent,
  ExtraButtonComponent,
  Modal,
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  SettingDefinitionRender,
  TextComponent,
  debounce,
  setIcon,
} from 'obsidian';

import { allIconIds, searchIcons } from './iconSearch';
import { ConfirmImportModal, LEGACY_PLUGIN_NAME } from './import';
import type ListCalloutsPlugin from './main';
import { Callout, HighlightSettings } from './settings';

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
            style: `text-indent: -8px; padding-left: 12px; --lc-callout-color: ${callout.color}`,
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

function attachIconMenu(
  btn: ButtonComponent,
  onSelect: (icon: null | string) => void
) {
  let menuRef: HTMLDivElement = null;
  const btnEl = btn.buttonEl;

  btn.onClick((e) => {
    e.preventDefault();
    const scrollParent = btnEl.closest('.vertical-tab-content');
    const destroyEventHandlers = () => {
      btnEl.win.removeEventListener('click', clickOutside);
      scrollParent?.removeEventListener('scroll', scroll);
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

    const calcMenuPos = () => {
      let pos = `top: ${
        btnEl.offsetTop +
        btnEl.offsetHeight +
        2 -
        (scrollParent?.scrollTop ?? 0)
      }px;`;
      if (Platform.isMobile) {
        pos += ` right: ${
          btnEl.offsetParent.clientWidth -
          (btnEl.offsetLeft + btnEl.offsetWidth)
        }px;`;
      } else {
        pos += ` left: ${btnEl.offsetLeft}px;`;
      }
      menuRef.style.cssText = pos;
    };

    const scroll = () => {
      if (menuRef) {
        calcMenuPos();
      } else {
        destroyEventHandlers();
      }
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

      const iconEls: Record<string, HTMLDivElement> = {};

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
              () => {
                iconList.empty();

                searchIcons(input.value).forEach((icon) => {
                  if (iconEls[icon]) {
                    iconList.append(iconEls[icon]);
                  }
                });
              },
              250,
              true
            );
            input.addEventListener('input', handler);
          }
        );
      });

      const iconList = menu.createDiv('lc-menu-icons', (el) => {
        // Menu
        allIconIds().forEach((icon) => {
          el.createDiv(
            {
              cls: 'clickable-icon',
              attr: {
                'data-icon': icon,
              },
            },
            (item) => {
              iconEls[icon] = item;
              setIcon(item, icon);
              item.onClickEvent(() => {
                btn.buttonEl.empty();
                btn.setIcon(icon);
                onSelect(icon);
                destroyEventHandlers();
                menuRef.detach();
                menuRef = null;
              });
            }
          );
        });
      });
    });

    btnEl.win.setTimeout(() => {
      btnEl.win.addEventListener('click', clickOutside);
      scrollParent?.addEventListener('scroll', scroll);
    }, 10);
  });
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

    // Color selection.
    const [r, g, b] = callout.color
      .split(',')
      .map((v) => parseInt(v.trim(), 10));

    const color = new ColorComponent(inputContainer)
      .setValueRgb({ r, g, b })
      .onChange(() => {
        const { r, g, b } = color.getValueRgb();
        plugin.settings[index].color = `${r}, ${g}, ${b}`;

        void plugin.saveSettings();
        redrawPreview();
      });
  });
}

/**
 * Collects the character, icon and color for a new custom callout.
 */
export class NewCalloutModal extends Modal {
  private callout: Callout = {
    char: '',
    color: '158, 158, 158',
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

    const color = new ColorComponent(inputContainer)
      .setValueRgb({ r: 158, g: 158, b: 158 })
      .onChange(() => {
        const { r, g, b } = color.getValueRgb();
        this.callout.color = `${r}, ${g}, ${b}`;
        redraw();
      });

    const errorEl = this.contentEl.createDiv({ cls: 'lc-error' });

    let submit: ButtonComponent;

    new Setting(this.contentEl)
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
  'Replace your callouts with the seven built-in ones. Callouts you have added, and any changes to the built-in ones, are permanently lost.';

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
          text: 'Note: using +, *, -, >, or # as the callout character can disrupt reading mode.',
        })
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
      f.appendText('On, only ');
      f.append(createEl('code', { text: '==& text==' }));
      f.appendText(' is a callout, matching how list callouts work. Off, ');
      f.append(createEl('code', { text: '==&text==' }));
      f.appendText(
        ' works too and a space after the character is optional. Turn this off for shorter markup; leave it on so highlights like '
      );
      f.append(createEl('code', { text: '==!important==' }));
      f.appendText(' keep their normal look.');
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
      name: callout.char ? `Callout ${callout.char}` : 'Callout',
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

    // Omitted outright rather than hidden with `visible`: a hidden definition
    // still renders into the DOM and carries its text into settings search,
    // and there's nothing to reveal later -- legacyDataAvailable is resolved
    // once during load.
    if (this.plugin.legacyDataAvailable) {
      definitions.push({
        name: `Import from ${LEGACY_PLUGIN_NAME}`,
        desc: `Settings from ${LEGACY_PLUGIN_NAME} (legacy plugin) were found in your vault. This is a one-time action that will replace your current callouts.`,
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
    }

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
