import * as path from 'path';
import { env } from 'process';
import { obsidianBetaAvailable, parseObsidianVersions } from 'wdio-obsidian-service';

// wdio-obsidian-service downloads Obsidian versions into this directory.
const cacheDir = path.resolve('.obsidian-cache');

// Our minAppVersion is 1.13.0, but 1.13.0 through 1.13.3 were insiders-only
// releases with no public installer, so wdio's "earliest" can't be downloaded
// without Catalyst credentials. 1.13.4 is the oldest public build at or above
// our floor.
const OLDEST_PUBLIC_VERSION = '1.13.4';

// Pinned so a new upstream release can't change what the tests exercise.
const LEGACY_PLUGIN_VERSION = '1.2.9';

let defaultVersions = `${OLDEST_PUBLIC_VERSION}/latest latest/latest`;
if (await obsidianBetaAvailable({ cacheDir })) {
  defaultVersions += ' latest-beta/latest';
}

const desktopVersions = await parseObsidianVersions(
  env.OBSIDIAN_VERSIONS ?? defaultVersions,
  { cacheDir }
);

if (env.CI) {
  // Printed so the workflow can key its Obsidian download cache on it.
  console.log('obsidian-cache-key:', JSON.stringify(desktopVersions));
}

// The plugin this one was forked from, installed but left off so most specs
// don't see it. The coexistence spec turns it on to check that the import
// reads what the real plugin actually writes, not just a hand-made data.json.
const plugins = [
  '..',
  {
    repo: 'mgmeyers/obsidian-list-callouts',
    version: LEGACY_PLUGIN_VERSION,
    enabled: false,
  },
];

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',

  specs: ['../test/specs/**/*.e2e.ts'],

  maxInstances: Number(env.WDIO_MAX_INSTANCES || 4),

  capabilities: [
    ...desktopVersions.map<WebdriverIO.Capabilities>(
      ([appVersion, installerVersion]) => ({
        browserName: 'obsidian',
        'wdio:obsidianOptions': {
          appVersion,
          installerVersion,
          plugins,
          vault: '../test/vaults/callouts',
        },
      })
    ),
    // The icon picker positions itself differently on mobile (Platform.isMobile
    // in settingsTab.ts), so cover the emulated mobile UI too.
    ...desktopVersions.map<WebdriverIO.Capabilities>(
      ([appVersion, installerVersion]) => ({
        browserName: 'obsidian',
        'wdio:obsidianOptions': {
          appVersion,
          installerVersion,
          emulateMobile: true,
          plugins,
          vault: '../test/vaults/callouts',
        },
        'goog:chromeOptions': {
          mobileEmulation: {
            deviceMetrics: { width: 390, height: 844 },
          },
        },
      })
    ),
  ],

  services: ['obsidian'],
  reporters: ['obsidian'],

  mochaOpts: {
    ui: 'bdd',
    // reloadObsidian reboots the app, which is slow enough on a loaded CI box
    // that a 60s ceiling trips on hooks that use it.
    timeout: 120 * 1000,
  },

  waitforInterval: 250,
  waitforTimeout: 5 * 1000,
  logLevel: 'warn',

  cacheDir: cacheDir,

  injectGlobals: false,
};
