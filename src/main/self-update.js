// In-app update: download and install a newer PK Player from inside the app.
// Nothing here runs by itself. The user clicks "Update now" to download, and
// "Restart to finish" to install; until that second click the running app is untouched.
//
// The real work is done by electron-updater (Squirrel on the Mac), which only
// installs an update signed by the same developer as the running app.

import { EventEmitter } from 'node:events';
import { debug } from '../lib/debug.js';
import { isNewer } from '../lib/update-check.js';

/**
 * Whether this copy of the app can update itself, and if not, why not (for the manual and logs).
 * In-app update is offered only where it has been built and tried: a packaged, signed
 * Apple-silicon Mac build running from an Applications folder.
 */
export function selfUpdateSupport({ platform, arch, isPackaged, inApplicationsFolder }) {
  if (!isPackaged) return { supported: false, reason: 'not a packaged build' };
  if (platform !== 'darwin') return { supported: false, reason: 'in-app update is Mac only' };
  if (arch !== 'arm64') return { supported: false, reason: 'in-app update is for Apple-silicon Macs only' };
  if (!inApplicationsFolder) return { supported: false, reason: 'the app is not in an Applications folder' };
  return { supported: true };
}

/** Turn whatever went wrong into one sentence a person can act on. */
export function describeUpdateError(err) {
  const text = String(err?.message || err || '').toLowerCase();
  if (/read-only|readonly|not writable|eacces|eperm|permission/.test(text)) {
    return 'PK Player cannot replace itself where it is. Move it to your Applications folder, or use the download page.';
  }
  if (/zip file not provided|cannot find.*latest|latest-mac\.yml|404|not found/.test(text)) {
    return 'This release cannot be installed from inside the app. Use the download page instead.';
  }
  if (/net::|enotfound|econn|etimedout|network|offline|internet|socket|getaddrinfo/.test(text)) {
    return 'The update could not be downloaded. Check your internet connection and try again.';
  }
  if (/code signature|signature|not signed|could not validate/.test(text)) {
    return 'The update did not pass its signature check, so it was not installed. Use the download page instead.';
  }
  return 'The update could not be installed from inside the app. Use the download page instead.';
}

/**
 * Drives one in-app update from the user's two clicks.
 * States: idle -> checking -> downloading -> ready, or error from any of them.
 */
export class SelfUpdater {
  /**
   * @param {object} opts
   * @param {object} opts.updater electron-updater's autoUpdater (or a stand-in with the same calls and events)
   * @param {string} opts.currentVersion
   * @param {function(object): void} opts.send called with every status: { state, version?, percent?, message? }
   * @param {function(): (string|null)} [opts.blockInstall] returns a reason not to restart right now, or null
   */
  constructor({ updater, currentVersion, send, blockInstall = () => null }) {
    this.updater = updater;
    this.currentVersion = currentVersion;
    this.send = send;
    this.blockInstall = blockInstall;
    this.state = 'idle';
    this.version = null;
    // The user decides both steps: nothing downloads on its own and nothing installs when the app quits.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('download-progress', (p) => {
      if (this.state === 'downloading') this.#set('downloading', { percent: Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0))) });
    });
    updater.on('update-downloaded', () => {
      if (this.state === 'downloading') this.#set('ready');
    });
    updater.on('error', (err) => {
      if (this.state === 'checking' || this.state === 'downloading') this.#fail(err);
    });
  }

  #set(state, extra = {}) {
    this.state = state;
    this.send({ state, version: this.version, ...extra });
  }

  #fail(err) {
    debug('self-update', 'update failed', err instanceof Error ? err : new Error(String(err)));
    this.#set('error', { message: describeUpdateError(err) });
  }

  /** "Update now": find the newer version and download it. Safe to call twice; the second call is ignored while busy. */
  async start() {
    if (this.state === 'checking' || this.state === 'downloading') return this.state;
    if (this.state === 'ready') {
      this.#set('ready');
      return this.state;
    }
    this.#set('checking');
    try {
      const found = await this.updater.checkForUpdates();
      const version = found?.updateInfo?.version;
      if (!version || !isNewer(version, this.currentVersion)) throw new Error('cannot find a newer version to install (404)');
      this.version = version;
      this.#set('downloading', { percent: 0 });
      await this.updater.downloadUpdate();
      if (this.state === 'downloading') this.#set('ready'); // in case the event came first, or not at all
    } catch (err) {
      if (this.state !== 'error') this.#fail(err);
    }
    return this.state;
  }

  /**
   * "Restart to finish": quit, install and reopen. Only after a completed download, and
   * never while something is in the way (a presentation on screen).
   * @returns {{ok: boolean, message?: string}}
   */
  install() {
    if (this.state !== 'ready') return { ok: false, message: 'The update has not finished downloading.' };
    const reason = this.blockInstall();
    if (reason) return { ok: false, message: reason };
    debug('self-update', `installing ${this.version}`);
    this.updater.quitAndInstall();
    return { ok: true };
  }
}

/**
 * A stand-in for electron-updater used by the tests (PKPLAY_UPDATE_SIMULATE): it walks
 * through the same steps without downloading or installing anything.
 * @param {string} version the version it pretends to find
 * @param {{fail?: boolean, stepMs?: number}} [opts]
 */
export function createSimulatedUpdater(version, { fail = false, stepMs = 120 } = {}) {
  const sim = new EventEmitter();
  sim.installed = false;
  sim.checkForUpdates = async () => ({ updateInfo: { version } });
  sim.downloadUpdate = () => new Promise((resolve, reject) => {
    let percent = 0;
    const timer = setInterval(() => {
      percent += 25;
      sim.emit('download-progress', { percent });
      if (fail && percent >= 50) {
        clearInterval(timer);
        reject(new Error('net::ERR_INTERNET_DISCONNECTED'));
      } else if (percent >= 100) {
        clearInterval(timer);
        sim.emit('update-downloaded', { version });
        resolve([]);
      }
    }, stepMs);
  });
  sim.quitAndInstall = () => { sim.installed = true; };
  return sim;
}
