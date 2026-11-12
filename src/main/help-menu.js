// Help menu: links to the online manual and the project page.
// Kept separate from main.js so it can be unit-tested without Electron.

import { debug } from '../lib/debug.js';

export const REPO_URL = 'https://github.com/vvaidy/pkplayer';
const MANUAL_URL = `${REPO_URL}/blob/main/docs/manual`;

// `doc` is the file under docs/manual/ (or the repo root for LICENSE) that the
// link points at; the unit tests check these files exist so links never rot.
export const HELP_LINKS = [
  { label: 'PK Player Manual', url: `${MANUAL_URL}/README.md`, doc: 'docs/manual/README.md' },
  { label: 'Tutorial: Your First Event', url: `${MANUAL_URL}/01-getting-started.md`, doc: 'docs/manual/01-getting-started.md' },
  { label: 'Tutorial: Running a Live Night', url: `${MANUAL_URL}/02-running-a-live-night.md`, doc: 'docs/manual/02-running-a-live-night.md' },
  { label: 'Keyboard Shortcuts', url: `${MANUAL_URL}/README.md#cheat-sheet`, doc: 'docs/manual/README.md', anchor: 'cheat-sheet' },
  { label: 'Preparing Decks (for Presenters)', url: `${MANUAL_URL}/05-preparing-decks.md`, doc: 'docs/manual/05-preparing-decks.md' },
  { label: 'Troubleshooting', url: `${MANUAL_URL}/07-troubleshooting.md`, doc: 'docs/manual/07-troubleshooting.md' },
  { type: 'separator' },
  { label: 'Download the Latest Version', url: `${REPO_URL}/releases/latest` },
  { label: 'PK Player on GitHub', url: REPO_URL },
  { label: 'License (MIT, No Warranty)', url: `${REPO_URL}/blob/main/LICENSE`, doc: 'LICENSE' },
];

/**
 * Open a link in the user's browser. Only our own https links are allowed.
 * Never throws: failures are logged and reported as false.
 */
export async function openHelpLink(url, openExternal) {
  try {
    if (typeof url !== 'string' || (url !== REPO_URL && !url.startsWith(`${REPO_URL}/`))) {
      throw new Error(`refusing to open non-project URL: ${url}`);
    }
    await openExternal(url);
    return true;
  } catch (err) {
    debug('help', `could not open ${url}`, err);
    return false;
  }
}

/** Build the Help menu template. `openExternal` is Electron's shell.openExternal. */
export function buildHelpMenu(openExternal) {
  return {
    role: 'help',
    submenu: HELP_LINKS.map((item) =>
      item.type === 'separator'
        ? { type: 'separator' }
        : { label: item.label, click: () => openHelpLink(item.url, openExternal) },
    ),
  };
}
