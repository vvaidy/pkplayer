// Electron main process: windows, the app:// protocol, IPC and persistence.

import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, protocol, screen, shell } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRACTICE_EVENT_ID, Store, isPdfFile } from './src/main/store.js';
import { buildHelpMenu, openHelpLink } from './src/main/help-menu.js';
import { exportTheme, isCustomThemeId, parseThemeFile, themeVars } from './src/lib/themes.js';
import { parseSpeedrun } from './src/lib/speedrun.js';
import { playedPages } from './src/lib/page-range.js';
import { mergePdfs, rewritePdf } from './src/main/pdf-edit.js';
import { DOWNLOAD_URL, checkIsDue } from './src/lib/update-check.js';
import { checkForUpdate } from './src/main/update-check.js';
import electronUpdater from 'electron-updater';
import { SelfUpdater, createSimulatedUpdater, selfUpdateSupport } from './src/main/self-update.js';
import { debug } from './src/lib/debug.js';

// ---------- app parameters ----------
const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PKPLAY_DATA_DIR || path.join(app.getPath('userData'), 'data');
const EDITOR_URL = 'app://bundle/src/renderer/editor.html';
const PLAYER_URL = 'app://bundle/src/renderer/player.html';
const READER_URL = 'app://bundle/src/renderer/reader.html';
const DEBUG_QUERY = process.env.PKPLAY_DEBUG === '1' ? '&debug=1' : '';
/** Tests point this at a local JSON file so the update check never touches the network. */
const UPDATE_FEED_FILE = process.env.PKPLAY_UPDATE_FEED || null;
/** With an isolated data folder (tests, experiments) the app does not phone GitHub on its own. */
const AUTO_UPDATE_CHECK_ALLOWED = !process.env.PKPLAY_DATA_DIR || Boolean(UPDATE_FEED_FILE);
const UPDATE_CHECK_DELAY_MS = 4000; // let the window settle first
/** Tests set this to "ok" or "fail" to walk through an in-app update with nothing downloaded or installed. */
const UPDATE_SIMULATE = process.env.PKPLAY_UPDATE_SIMULATE || null;
const THEME_FILE_MAX_BYTES = 512 * 1024; // theme files are a few KB; refuse anything that is clearly not one
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let store;
let editorWin = null;
let playerWin = null;
let sleepBlockerId = null;
/** eventId -> itemId to resume from when playback was stopped mid-event. */
const resumePoints = new Map();
let playerSession = null; // { eventId, itemId }
/** Open reader windows. */
const readerWins = new Set();
/** token -> absolute path of a PDF the user picked to read. Only these outside files are ever served. */
const externalFiles = new Map();

// ---------- app:// protocol ----------
// app://bundle/<path>          -> files inside the app
// app://bundle/library/<file>  -> imported PDFs in the user's library
// app://bundle/external/<token> -> a PDF the user chose with the Open dialog, for the reader

function resolveAppUrl(urlString) {
  const url = new URL(urlString);
  if (url.host !== 'bundle') return null;
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel.startsWith('library/')) {
    return store.libraryPath(rel.slice('library/'.length));
  }
  if (rel.startsWith('external/')) {
    return externalFiles.get(rel.slice('external/'.length)) || null; // unknown tokens get nothing
  }
  const full = path.normalize(path.join(APP_ROOT, rel));
  return full.startsWith(APP_ROOT + path.sep) ? full : null;
}

async function handleAppProtocol(request) {
  try {
    const file = resolveAppUrl(request.url);
    if (!file) return new Response('Forbidden', { status: 403 });
    const body = await fs.promises.readFile(file); // asar-aware in packaged builds
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
  } catch (err) {
    if (err.code !== 'ENOENT') debug('protocol', `failed to serve ${request.url}`, err);
    else debug('protocol', `404 ${request.url}`);
    return new Response('Not found', { status: 404 });
  }
}

// ---------- displays ----------

function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId,
  }));
}

function targetDisplay() {
  const { displayId } = store.getSettings();
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

// ---------- windows ----------

const secureWebPrefs = {
  preload: path.join(APP_ROOT, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

/** The chosen theme's window background, so a window never flashes another color while it loads. */
function themeBackground() {
  return themeVars(store.currentTheme())['--bg'];
}

/**
 * URL parameters that tell a window which theme to paint itself in. A built-in
 * theme travels as its id; a custom theme also carries its definition, so the
 * window has its colors before it has asked the main process for anything.
 */
function themeParams() {
  const theme = store.currentTheme();
  const params = { theme: theme.id };
  if (isCustomThemeId(theme.id)) params.themeDef = JSON.stringify(theme);
  return params;
}

function createEditorWindow() {
  editorWin = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: 'PK Player',
    backgroundColor: themeBackground(),
    show: false,
    webPreferences: secureWebPrefs,
  });
  editorWin.loadURL(`${EDITOR_URL}?${new URLSearchParams(themeParams())}${DEBUG_QUERY}`);
  editorWin.once('ready-to-show', () => editorWin.show());
  editorWin.on('closed', () => {
    editorWin = null;
    if (playerWin) playerWin.close();
    for (const w of [...readerWins]) w.close();
  });
  // Dropping a file outside the drop handlers must never navigate the editor away.
  editorWin.webContents.on('will-navigate', (e) => e.preventDefault());
  editorWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** The address of a reader page for one PDF. `extra` adds parameters such as { view: 'grid' }. */
function readerUrl(src, name, played = {}, extra = {}) {
  const query = new URLSearchParams({ src, name, ...themeParams(), ...extra });
  for (const [param, value] of [['max', played.maxSlides], ['first', played.firstPage], ['last', played.lastPage]]) {
    if (Number.isInteger(value) && value > 0) query.set(param, String(value));
  }
  return `${READER_URL}?${query}${DEBUG_QUERY}`;
}

/** Everything a reader window needs to show one of an event's decks, including what it may edit. */
function readerItemArgs(event, item) {
  return [
    `library/${item.file}`,
    item.name,
    { maxSlides: event.maxSlides, firstPage: item.firstPage, lastPage: item.lastPage },
    { event: event.id, item: item.id, ...(item.originalFile ? { edited: '1' } : {}) },
  ];
}

/**
 * Open a PDF in a reader window: an ordinary, resizable window for reading, not presenting.
 * @param {string} src "library/<file>" or "external/<token>"
 * @param {string} name shown in the title bar
 * @param {object} [played] for a deck opened from an event: { maxSlides, firstPage, lastPage }, so the
 *   reader can mark the pages that event will not play
 */
function openReader(src, name, played = {}, extra = {}) {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    title: `${name} — PK Player Reader`,
    backgroundColor: themeBackground(),
    show: false,
    webPreferences: secureWebPrefs,
  });
  readerWins.add(win);
  win.loadURL(readerUrl(src, name, played, extra));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // links inside a PDF open nothing
  win.on('closed', () => {
    readerWins.delete(win);
    if (src.startsWith('external/')) externalFiles.delete(src.slice('external/'.length));
  });
  debug('reader', `opened ${src} (${name})`);
  return true;
}

/**
 * Open the fullscreen player. `speedrun` (5, 10 or 20) makes this one window a speedrun test;
 * it is passed in the window's URL only and is never stored, so the next Play is a normal one.
 */
async function openPlayer(eventId, startItemId, { speedrun = null } = {}) {
  store.getEvent(eventId); // throws if the event does not exist
  if (playerWin) await closePlayer();
  const display = targetDisplay();
  const { x, y, width, height } = display.bounds;
  debug('player', `opening event ${eventId} on display ${display.id} (${width}x${height})`);

  const session = { eventId, itemId: startItemId || null, speedrun };
  // Which practice deck this window is showing, so closing it ends that practice and no other.
  if (eventId === PRACTICE_EVENT_ID) session.practiceToken = store.getEvent(eventId).items[0].id;
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    backgroundColor: '#000000',
    title: 'PK Player — Presenting',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: secureWebPrefs,
  });
  playerWin = win;
  playerSession = session;
  const q = new URLSearchParams({ event: eventId, ...themeParams() });
  if (startItemId) q.set('start', startItemId);
  if (speedrun) q.set('speedrun', String(speedrun));
  win.loadURL(`${PLAYER_URL}?${q}${DEBUG_QUERY}`);
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.setBounds(display.bounds);
    win.show();
    win.setFullScreen(true);
    win.focus();
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (sleepBlockerId === null) sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  win.on('closed', () => {
    if (session.speedrun) {
      // A speedrun is a test: it leaves the event's resume point exactly as it was.
    } else if (session.eventId === PRACTICE_EVENT_ID) {
      resumePoints.delete(session.eventId); // practice never resumes
      store.endPractice(session.practiceToken); // and leaves nothing behind
    } else if (session.itemId) resumePoints.set(session.eventId, session.itemId);
    else resumePoints.delete(session.eventId);
    if (playerWin !== win) return; // a newer player already replaced this one
    playerWin = null;
    playerSession = null;
    if (sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
    }
    if (editorWin) {
      editorWin.webContents.send('player:closed', { eventId: session.eventId });
      editorWin.focus();
    }
  });
}

/** Leave fullscreen (so macOS doesn't leave an empty black Space behind), then close. Resolves when closed. */
function closePlayer() {
  const win = playerWin;
  if (!win || win.isDestroyed()) return Promise.resolve();
  if (win.closing) return win.closing;
  win.closing = new Promise((resolve) => {
    win.once('closed', resolve);
    const doClose = () => {
      if (!win.isDestroyed()) win.close();
    };
    if (!win.isFullScreen()) {
      doClose();
      return;
    }
    let scheduled = false;
    // Never destroy the window from inside AppKit's exit-fullscreen notification:
    // that is a use-after-free in AppKit (SIGSEGV). Defer to a later tick.
    const finish = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(doClose, 120);
    };
    win.once('leave-full-screen', finish);
    setTimeout(finish, 1500); // fallback if the event never fires
    win.setFullScreen(false);
  });
  return win.closing;
}

// ---------- update notice ----------

let latestKnownVersion = null;
let selfUpdater = null;

/** True when this copy of the app can download and install an update itself (see selfUpdateSupport). */
function canSelfUpdate() {
  if (UPDATE_SIMULATE) return true;
  try {
    return selfUpdateSupport({
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      inApplicationsFolder: process.platform === 'darwin' && app.isInApplicationsFolder(),
    }).supported;
  } catch (err) {
    debug('self-update', 'could not tell whether in-app update is possible', err);
    return false;
  }
}

/** The in-app updater, created the first time the user asks for an update and not before. */
function getSelfUpdater() {
  if (selfUpdater) return selfUpdater;
  let updater;
  if (UPDATE_SIMULATE) {
    updater = createSimulatedUpdater(latestKnownVersion || '99.0.0', { fail: UPDATE_SIMULATE === 'fail' });
    updater.quitAndInstall = () => { globalThis.pkSimulatedInstalled = true; };
  } else {
    updater = electronUpdater.autoUpdater;
    updater.logger = {
      info: (m) => debug('self-update', String(m)),
      warn: (m) => debug('self-update', `warning: ${m}`),
      error: (m) => debug('self-update', 'updater reported an error', m instanceof Error ? m : new Error(String(m))),
      debug: () => {},
    };
  }
  selfUpdater = new SelfUpdater({
    updater,
    currentVersion: app.getVersion(),
    send: (status) => editorWin?.webContents.send('update:progress', status),
    // Restarting would end a presentation that is on screen, so it waits.
    blockInstall: () => (playerWin ? 'Stop the presentation first, then restart to finish updating.' : null),
  });
  return selfUpdater;
}

/**
 * Ask whether a newer version exists and tell the editor. It only ever tells: nothing is
 * downloaded or installed. `manual` is true when the user chose "Check for Updates…",
 * in which case "you are up to date" and errors are reported too; automatic checks stay silent.
 */
async function runUpdateCheck({ manual }) {
  const result = await checkForUpdate({ currentVersion: app.getVersion(), feedFile: UPDATE_FEED_FILE });
  if (result.kind === 'newer') latestKnownVersion = result.latest;
  try {
    if (result.kind !== 'error') store.updateSettings({ lastUpdateCheck: new Date().toISOString() });
  } catch (err) {
    debug('update', 'could not record the update check', err);
  }
  debug('update', `check (${manual ? 'manual' : 'automatic'}): ${result.kind}${result.latest ? ` ${result.latest}` : ''}`);
  if (manual || result.kind === 'newer') editorWin?.webContents.send('update:status', { ...result, manual, canSelfUpdate: canSelfUpdate() });
  return result;
}

function scheduleAutomaticUpdateCheck() {
  if (!AUTO_UPDATE_CHECK_ALLOWED) return;
  setTimeout(() => {
    const { checkUpdates, lastUpdateCheck } = store.getSettings();
    if (!checkUpdates || !checkIsDue(lastUpdateCheck)) return;
    runUpdateCheck({ manual: false }).catch((err) => debug('update', 'automatic check failed', err));
  }, UPDATE_CHECK_DELAY_MS);
}

// ---------- IPC ----------

/** One deck of a real event (never the practice deck), or an error fit to show the user. */
function findDeck(eventId, itemId) {
  if (eventId === PRACTICE_EVENT_ID) throw new Error('A practice deck cannot be edited.');
  const event = store.getEvent(eventId);
  const item = event.items.find((it) => it.id === itemId);
  if (!item) throw new Error('That deck is no longer in the playlist.');
  return { event, item };
}

/** After a deck's pages changed: tell the editor, and show the reader window the new file, back on its grid. */
function afterPagesChanged(win, eventId, itemId) {
  const { event, item } = findDeck(eventId, itemId);
  editorWin?.webContents.send('items:changed', { eventId });
  if (win && !win.isDestroyed() && readerWins.has(win)) {
    const [src, name, played, extra] = readerItemArgs(event, item);
    win.loadURL(readerUrl(src, name, played, { ...extra, view: 'grid' }));
  }
  return { pageCount: item.pageCount };
}

/** Like handle(), but `fn` also receives the window that asked, as its first argument. */
function handleFrom(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return { ok: true, value: await fn(BrowserWindow.fromWebContents(e.sender), ...args) };
    } catch (err) {
      debug('ipc', `${channel} failed`, err);
      return { ok: false, error: err.message };
    }
  });
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      debug('ipc', `${channel} failed`, err);
      return { ok: false, error: err.message };
    }
  });
}

function registerIpc() {
  handle('events:list', () => store.listEvents());
  handle('events:get', (id) => store.getEvent(id));
  handle('events:create', (name) => store.createEvent(name));
  handle('events:update', (id, patch) => store.updateEvent(id, patch));
  handle('events:delete', (id) => {
    resumePoints.delete(id);
    return store.deleteEvent(id);
  });
  handle('events:duplicate', (id) => store.duplicateEvent(id));
  handle('items:add', (eventId, paths, index) => store.addPdfs(eventId, paths, index));
  handle('items:remove', (eventId, itemId) => store.removeItem(eventId, itemId));
  handle('items:reorder', (eventId, ids) => store.reorderItems(eventId, ids));
  handle('items:move', (eventId, itemId, toIndex) => store.moveItem(eventId, itemId, toIndex));
  handle('items:update', (eventId, itemId, patch) => store.updateItem(eventId, itemId, patch));
  handle('items:pageCount', (eventId, itemId, n) => store.setItemPageCount(eventId, itemId, n));
  handle('settings:get', () => store.getSettings());
  const syncWindowColor = () => {
    if (editorWin) editorWin.setBackgroundColor(themeBackground());
  };
  handle('settings:update', (patch) => {
    const settings = store.updateSettings(patch);
    if (patch && 'theme' in patch) syncWindowColor();
    return settings;
  });
  handle('update:openDownload', () => openHelpLink(DOWNLOAD_URL, (url) => shell.openExternal(url)));
  // "Update now": download the newer version. It reports its progress through 'update:progress'.
  handle('update:start', () => {
    if (!canSelfUpdate()) throw new Error('This copy of PK Player cannot update itself. Use the download page.');
    getSelfUpdater().start().catch((err) => debug('self-update', 'update failed', err));
    return true;
  });
  // "Restart to finish": quit, install and reopen. Refused with a reason when it must wait.
  handle('update:install', () => {
    const res = getSelfUpdater().install();
    if (!res.ok) throw new Error(res.message);
    return true;
  });
  handle('themes:list', () => store.listThemes());
  handle('themes:save', (theme) => {
    const saved = store.saveTheme(theme);
    syncWindowColor(); // the theme in use may be the one that changed
    return saved;
  });
  handle('themes:delete', (id) => {
    const settings = store.deleteTheme(id);
    syncWindowColor();
    return settings;
  });
  // Pick a theme file (PK Player, Ghostty or iTerm2), save it as a new custom theme. Returns null if cancelled.
  handle('themes:import', async () => {
    const res = await dialog.showOpenDialog(editorWin, {
      title: 'Import theme',
      properties: ['openFile'],
      filters: [{ name: 'Theme files', extensions: ['json', 'itermcolors', 'txt', 'conf', '*'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    const { size } = await fs.promises.stat(file);
    if (size > THEME_FILE_MAX_BYTES) throw new Error('That file is too large to be a theme.');
    const text = await fs.promises.readFile(file, { encoding: 'utf-8' });
    return store.saveTheme(parseThemeFile(text, file));
  });
  // Write a custom theme to a file the user chooses. Returns the path, or null if cancelled.
  handle('themes:export', async (id) => {
    const theme = store.listThemes().find((t) => t.id === id);
    if (!theme) throw new Error('Only your own themes can be exported.');
    const safeName = theme.name.replace(/[^\w .-]+/g, ' ').trim() || 'theme';
    const res = await dialog.showSaveDialog(editorWin, {
      title: 'Export theme',
      defaultPath: `${safeName}.pkplayer-theme.json`,
      filters: [{ name: 'PK Player theme', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fs.promises.writeFile(res.filePath, exportTheme(theme), { encoding: 'utf-8' });
    return res.filePath;
  });
  handle('displays:list', () => listDisplays());
  handle('resume:get', (eventId) => resumePoints.get(eventId) || null);
  handle('resume:clear', (eventId) => resumePoints.delete(eventId));
  handle('dialog:openPdfs', async () => {
    const res = await dialog.showOpenDialog(editorWin, {
      title: 'Add PDFs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    return res.canceled ? [] : res.filePaths;
  });
  handle('player:open', (eventId, startItemId) => openPlayer(eventId, startItemId));
  // Reader: one of an event's decks...
  handle('reader:openItem', (eventId, itemId) => {
    const { event, item } = findDeck(eventId, itemId);
    const [src, name, played, extra] = readerItemArgs(event, item);
    return openReader(src, name, played, extra);
  });
  // Page edits. The deck's PDF is rebuilt as a NEW library file; the copy it was added with is kept.
  handleFrom('pages:apply', async (win, eventId, itemId, pages) => {
    const { item } = findDeck(eventId, itemId);
    const newFile = store.newLibraryFile();
    const dest = store.libraryPath(newFile);
    const { pageCount } = await rewritePdf(store.libraryPath(item.file), dest, pages);
    try {
      store.replaceItemFile(eventId, itemId, newFile, pageCount);
    } catch (err) {
      await fs.promises.rm(dest, { force: true }).catch(() => {});
      throw err;
    }
    return afterPagesChanged(win, eventId, itemId);
  });
  handleFrom('pages:restore', (win, eventId, itemId) => {
    findDeck(eventId, itemId);
    store.restoreItemOriginal(eventId, itemId);
    return afterPagesChanged(win, eventId, itemId);
  });
  // One PDF of everything the event plays: each deck's page range, capped by Max slides, in playlist order.
  handle('events:exportPdf', async (eventId) => {
    if (eventId === PRACTICE_EVENT_ID) throw new Error('Practice has nothing to export.');
    const event = store.getEvent(eventId);
    if (!event.items.length) throw new Error('Add at least one PDF before exporting.');
    const safeName = event.name.replace(/[^\w .-]+/g, ' ').trim() || 'event';
    const res = await dialog.showSaveDialog(editorWin, {
      title: 'Export Event as One PDF',
      defaultPath: `${safeName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    if (path.dirname(path.resolve(res.filePath)) === path.resolve(store.libraryDir)) {
      throw new Error("Choose a folder other than PK Player's own library.");
    }
    const parts = event.items.map((item) => ({
      path: store.libraryPath(item.file),
      pages: (count) => {
        const played = playedPages(item, count, event.maxSlides);
        return Array.from({ length: played.count }, (_, i) => ({ page: played.first + i }));
      },
    }));
    const { pageCount, skipped } = await mergePdfs(parts, res.filePath, { title: event.name });
    return { file: res.filePath, pageCount, skipped: skipped.length };
  });
  // ...or any PDF the user picks. Returns false if the file dialog was cancelled.
  handle('reader:openFile', async () => {
    const res = await dialog.showOpenDialog(editorWin, {
      title: 'Open PDF in Reader',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePaths.length) return false;
    const file = res.filePaths[0];
    if (!isPdfFile(file)) throw new Error('Not a PDF file');
    const token = crypto.randomUUID();
    externalFiles.set(token, file);
    return openReader(`external/${token}`, path.basename(file));
  });
  // Speedrun test: the whole event from deck 1, fast. Only the three fixed speeds are accepted.
  handle('player:speedrun', (eventId, factor) => {
    const speedrun = parseSpeedrun(factor);
    if (!speedrun) throw new Error(`Speedrun speed must be 5, 10 or 20 (got ${factor})`);
    if (eventId === PRACTICE_EVENT_ID) throw new Error('Speedrun is for events, not practice.');
    return openPlayer(eventId, null, { speedrun });
  });
  // Practice: pick one PDF and play it with the timer, without creating or saving an event.
  // Returns the file's name, or null if the file dialog was cancelled.
  handle('practice:start', async (opts) => {
    const res = await dialog.showOpenDialog(editorWin, {
      title: 'Practice a PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    await closePlayer(); // ends any practice already running before the new one is set up
    const ev = store.startPractice(res.filePaths[0], opts || {});
    try {
      await openPlayer(ev.id);
    } catch (err) {
      store.endPractice(ev.items[0].id);
      throw err;
    }
    return ev.items[0].name;
  });
  handle('player:close', () => closePlayer());
  handle('player:fullscreen', () => {
    if (playerWin && !playerWin.isFullScreen()) playerWin.setFullScreen(true);
    return true;
  });
  handle('player:position', (itemId) => {
    if (playerSession) playerSession.itemId = itemId || null;
    return true;
  });
}

// ---------- menu ----------

/** The Help menu, with the two update items on top. */
function helpMenuWithUpdates() {
  const help = buildHelpMenu((url) => shell.openExternal(url));
  help.submenu.unshift(
    { label: 'Check for Updates…', click: () => runUpdateCheck({ manual: true }).catch((err) => debug('update', 'manual check failed', err)) },
    {
      label: 'Check for Updates Automatically',
      type: 'checkbox',
      checked: store.getSettings().checkUpdates,
      click: (item) => {
        try {
          store.updateSettings({ checkUpdates: item.checked });
        } catch (err) {
          debug('update', 'could not save the update setting', err);
        }
      },
    },
    { type: 'separator' },
  );
  return help;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Event', accelerator: 'CmdOrCtrl+N', click: () => editorWin?.webContents.send('menu:newEvent') },
        { label: 'Add PDFs…', accelerator: 'CmdOrCtrl+O', click: () => editorWin?.webContents.send('menu:addPdfs') },
        { label: 'Open PDF in Reader…', accelerator: 'CmdOrCtrl+Shift+O', click: () => editorWin?.webContents.send('menu:openReader') },
        { label: 'Export Event as One PDF…', click: () => editorWin?.webContents.send('menu:exportEvent') },
        { type: 'separator' },
        { label: 'Practice a PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: () => editorWin?.webContents.send('menu:practice') },
        // No keyboard shortcut on purpose: a speedrun should never start by accident.
        { label: 'Speedrun Test…', click: () => editorWin?.webContents.send('menu:speedrun') },
        { type: 'separator' },
        { label: 'Reveal Library Folder', click: () => shell.openPath(store.libraryDir) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
    helpMenuWithUpdates(),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- lifecycle ----------

const gotLock = process.env.PKPLAY_DATA_DIR ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (editorWin) {
      if (editorWin.isMinimized()) editorWin.restore();
      editorWin.focus();
    }
  });

  app.whenReady().then(() => {
    try {
      store = new Store(DATA_DIR);
      debug('main', `data dir: ${DATA_DIR}`);
    } catch (err) {
      debug('main', 'could not open data directory', err);
      dialog.showErrorBox('PK Player', `Could not open the data folder:\n${DATA_DIR}\n\n${err.message}`);
      app.quit();
      return;
    }
    protocol.handle('app', handleAppProtocol);
    registerIpc();
    buildMenu();
    createEditorWindow();
    scheduleAutomaticUpdateCheck();

    const notifyDisplays = () => editorWin?.webContents.send('displays:changed', listDisplays());
    screen.on('display-added', notifyDisplays);
    screen.on('display-removed', notifyDisplays);

    app.on('activate', () => {
      if (!editorWin) createEditorWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

