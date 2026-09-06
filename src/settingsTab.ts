import {
  ButtonComponent,
  ColorComponent,
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
import { CUSTOM_CALLOUT_OFFSET, Callout } from './settings';

/**
 * `setWarning()` was deprecated in favour of `setDestructive()` in Obsidian
 * 1.13. We still support older versions, so pick whichever exists.
 */
function styleDestructive(btn: ButtonComponent): ButtonComponent {
  return typeof btn.setDestructive === 'function'
    ? btn.setDestructive()
    : // eslint-disable-next-line @typescript-eslint/no-deprecated -- pre-1.13 fallback
      btn.setWarning();
}

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
            text: ' Sed eu nisl rhoncus, consectetur mi quis, scelerisque enim.',
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
        btnEl.offsetTop + btnEl.offsetHeight + 2 - (scrollParent?.scrollTop ?? 0)
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
 * Fill `containerEl` with one callout's preview and controls.
 *
 * Shared by both settings paths: the declarative definitions render it into a
 * Setting's control element, and the pre-1.13 `display()` fallback renders it
 * into a plain container. `onDelete` is only supplied by the fallback, since
 * the declarative list draws its own delete affordance.
 */
export function buildCalloutRow(
  containerEl: HTMLElement,
  plugin: ListCalloutsPlugin,
  index: number,
  callout: Callout,
  onDelete?: (index: number) => void
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
    if (callout.custom) {
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
    }

    // Delete button, for the pre-1.13 fallback only.
    if (callout.custom && onDelete) {
      const rightAlign = inputContainer.createDiv({
        cls: 'lc-input-right-align',
      });
      new ButtonComponent(rightAlign)
        .setButtonText('Delete')
        .then(styleDestructive)
        .onClick(() => onDelete(index));
    }
  });
}

/**
 * Collects the character, icon and colour for a new custom callout.
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
        value && conflict ? `"${value}" is already used by another callout.` : ''
      );
      submit.setDisabled(!value || conflict);
    };

    redraw();
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
    const [moved] = settings.splice(CUSTOM_CALLOUT_OFFSET + oldIndex, 1);
    settings.splice(CUSTOM_CALLOUT_OFFSET + newIndex, 0, moved);
    void this.plugin.saveSettings();
    this.refresh();
  }

  private addCallout(callout: Callout): void {
    this.plugin.settings.push(callout);
    void this.plugin.saveSettings();
    this.refresh();
  }

  /**
   * Re-read the settings into the tab. Obsidian 1.13 caches the definitions
   * returned by getSettingDefinitions(), so anything that changes the callouts
   * structurally has to ask for a refresh; `update()` only exists on 1.13+.
   */
  refresh(): void {
    if (typeof this.update === 'function') {
      this.update();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- pre-1.13 fallback
      this.display();
    }
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

  /**
   * Declarative settings, used by Obsidian 1.13 and later. Returning a
   * non-empty array here means `display()` is not called.
   */
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
        desc: `Settings from ${LEGACY_PLUGIN_NAME}, the plugin this one was forked from, were found in this vault. Importing replaces your current callouts.`,
        action: () => {
          new ConfirmImportModal(this.plugin.app, () => {
            void this.runImport();
          }).open();
        },
      });
    }

    definitions.push(
      {
        name: 'Style settings',
        desc: this.styleSettingsDesc(),
      },
      {
        type: 'group',
        heading: 'Built-in callouts',
        items: settings
          .slice(0, CUSTOM_CALLOUT_OFFSET)
          .map((callout, i) => this.calloutDefinition(callout, i)),
      },
      {
        type: 'list',
        heading: 'Custom callouts',
        emptyState: 'No custom callouts yet.',
        items: settings
          .slice(CUSTOM_CALLOUT_OFFSET)
          .map((callout, i) =>
            this.calloutDefinition(callout, CUSTOM_CALLOUT_OFFSET + i)
          ),
        onDelete: (index: number) =>
          this.deleteCallout(CUSTOM_CALLOUT_OFFSET + index),
        onReorder: (oldIndex: number, newIndex: number) =>
          this.reorderCallout(oldIndex, newIndex),
        addItem: {
          name: 'Add callout',
          action: () => {
            new NewCalloutModal(this.plugin, (callout) =>
              this.addCallout(callout)
            ).open();
          },
        },
      }
    );

    return definitions;
  }

  /**
   * Imperative fallback for Obsidian versions older than 1.13, which have no
   * declarative settings API.
   */
  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    if (this.plugin.legacyDataAvailable) {
      new Setting(containerEl)
        .setName(`Import from ${LEGACY_PLUGIN_NAME}`)
        .setDesc(
          `Settings from ${LEGACY_PLUGIN_NAME}, the plugin this one was forked from, were found in this vault. Importing replaces your current callouts.`
        )
        .addButton((btn) =>
          btn
            .setButtonText('Import')
            .setCta()
            .onClick(() => {
              new ConfirmImportModal(this.plugin.app, () => {
                void this.runImport();
              }).open();
            })
        );
    }

    new Setting(containerEl).setDesc(this.styleSettingsDesc());

    this.plugin.settings.forEach((callout, index) => {
      containerEl.createDiv({ cls: 'lc-setting' }, (el) => {
        buildCalloutRow(el, this.plugin, index, callout, (indexToDelete) =>
          this.deleteCallout(indexToDelete)
        );
      });
    });

    new Setting(containerEl)
      .setName('Add callout')
      .setDesc('Create an additional list callout style.')
      .addButton((btn) =>
        btn
          .setButtonText('Add')
          .setCta()
          .onClick(() => {
            new NewCalloutModal(this.plugin, (callout) =>
              this.addCallout(callout)
            ).open();
          })
      );
  }
}
