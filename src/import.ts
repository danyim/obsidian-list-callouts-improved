import { App, Modal, Setting, normalizePath } from 'obsidian';

import { Callout } from './settings';

/**
 * Plugin id of the upstream plugin this one was forked from. Its settings live
 * beside ours in the vault's plugin folder, so they can be read directly.
 */
export const LEGACY_PLUGIN_ID = 'obsidian-list-callouts';

export const LEGACY_PLUGIN_NAME = 'List Callouts';

export function legacyDataPath(app: App): string {
  return normalizePath(
    `${app.vault.configDir}/plugins/${LEGACY_PLUGIN_ID}/data.json`
  );
}

export function legacySettingsExist(app: App): Promise<boolean> {
  return app.vault.adapter.exists(legacyDataPath(app));
}

function parseCallout(value: unknown, index: number): Callout {
  const position = `Callout ${index + 1}`;

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${position} is not a callout.`);
  }

  const { char, color, icon, custom } = value as Record<string, unknown>;

  if (typeof char !== 'string' || char.length === 0) {
    throw new Error(`${position} is missing a character.`);
  }

  if (typeof color !== 'string' || color.length === 0) {
    throw new Error(`${position} is missing a color.`);
  }

  const callout: Callout = { char, color };

  if (typeof icon === 'string' && icon.length > 0) {
    callout.icon = icon;
  }

  if (custom === true) {
    callout.custom = true;
  }

  return callout;
}

/**
 * Parse the contents of List Callouts' `data.json`. Throws a message suitable
 * for display if the file isn't shaped the way we expect.
 */
export function parseLegacySettings(raw: string): Callout[] {
  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${LEGACY_PLUGIN_NAME}' settings are not valid JSON.`);
  }

  if (!Array.isArray(data)) {
    throw new Error(
      `${LEGACY_PLUGIN_NAME}' settings are not a list of callouts.`
    );
  }

  return data.map((value, index) => parseCallout(value, index));
}

export async function readLegacySettings(app: App): Promise<Callout[]> {
  const path = legacyDataPath(app);

  if (!(await app.vault.adapter.exists(path))) {
    throw new Error(
      `No ${LEGACY_PLUGIN_NAME} settings were found in this vault.`
    );
  }

  return parseLegacySettings(await app.vault.adapter.read(path));
}

/**
 * Importing replaces the current callouts outright, so confirm first.
 */
export class ConfirmImportModal extends Modal {
  constructor(app: App, private onConfirm: () => void) {
    super(app);
  }

  onOpen(): void {
    // Modal.setTitle() postdates our minAppVersion; titleEl does not.
    this.titleEl.setText(`Import from ${LEGACY_PLUGIN_NAME}`);

    this.contentEl.createEl('p', {
      text: `This replaces your current callouts with the ones saved by ${LEGACY_PLUGIN_NAME}. It can't be undone.`,
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText('Import')
          .setCta()
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
