/**
 * Config for regenerating the README screenshots (`npm run screenshots`).
 *
 * Separate from wdio.conf.mts because this is a documentation task, not a
 * test: it runs against one Obsidian version on desktop only, and writes into
 * screenshots/ rather than asserting anything.
 */
import * as path from 'path';
import { env } from 'process';
import { parseObsidianVersions } from 'wdio-obsidian-service';

const cacheDir = path.resolve('.obsidian-cache');

const versions = await parseObsidianVersions(
  env.OBSIDIAN_VERSIONS ?? 'latest/latest',
  { cacheDir }
);

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',

  specs: ['./test/capture/**/*.capture.ts'],

  maxInstances: 1,

  capabilities: versions.map<WebdriverIO.Capabilities>(
    ([appVersion, installerVersion]) => ({
      browserName: 'obsidian',
      'wdio:obsidianOptions': {
        appVersion,
        installerVersion,
        plugins: ['.'],
        vault: 'test/vaults/readme',
      },
    })
  ),

  services: ['obsidian'],
  reporters: ['obsidian'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60 * 1000,
  },

  waitforInterval: 250,
  waitforTimeout: 5 * 1000,
  logLevel: 'warn',

  cacheDir: cacheDir,

  injectGlobals: false,
};
