// Electron main process: windows, the app:// protocol, IPC and persistence.

import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, protocol, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './src/main/store.js';
import { buildHelpMenu } from './src/main/help-menu.js';
import { themeById, themeVars } from './src/lib/themes.js';
import { debug } from './src/lib/debug.js';

// ---------- app parameters ----------
const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PKPLAY_DATA_DIR || path.join(app.getPath('userData'), 'data');
const EDITOR_URL = 'app://bundle/src/renderer/editor.html';
const PLAYER_URL = 'app://bundle/src/renderer/player.html';
const DEBUG_QUERY = process.env.PKPLAY_DEBUG === '1' ? '&debug=1' : '';
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

// ---------- app:// protocol ----------
// app://bundle/<path>          -> files inside the app
// app://bundle/library/<file>  -> imported PDFs in the user's library

function resolveAppUrl(urlString) {
  const url = new URL(urlString);
  if (url.host !== 'bundle') return null;
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel.startsWith('library/')) {
    return store.libraryPath(rel.slice('library/'.length));
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
  return themeVars(themeById(store.getSettings().theme))['--bg'];
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
  editorWin.loadURL(`${EDITOR_URL}?theme=${encodeURIComponent(store.getSettings().theme)}${DEBUG_QUERY}`);
  editorWin.once('ready-to-show', () => editorWin.show());
  editorWin.on('closed', () => {
    editorWin = null;
    if (playerWin) playerWin.close();
  });
  // Dropping a file outside the drop handlers must never navigate the editor away.
  editorWin.webContents.on('will-navigate', (e) => e.preventDefault());
  editorWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function openPlayer(eventId, startItemId) {
  store.getEvent(eventId); // throws if the event does not exist
  if (playerWin) await closePlayer();
  const display = targetDisplay();
  const { x, y, width, height } = display.bounds;
  debug('player', `opening event ${eventId} on display ${display.id} (${width}x${height})`);

  const session = { eventId, itemId: startItemId || null };
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
  const q = new URLSearchParams({ event: eventId, theme: store.getSettings().theme });
  if (startItemId) q.set('start', startItemId);
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
    if (session.itemId) resumePoints.set(session.eventId, session.itemId);
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

// ---------- IPC ----------

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
  handle('settings:update', (patch) => {
    const settings = store.updateSettings(patch);
    if (patch && 'theme' in patch && editorWin) editorWin.setBackgroundColor(themeBackground());
    return settings;
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

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Event', accelerator: 'CmdOrCtrl+N', click: () => editorWin?.webContents.send('menu:newEvent') },
        { label: 'Add PDFs…', accelerator: 'CmdOrCtrl+O', click: () => editorWin?.webContents.send('menu:addPdfs') },
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
    buildHelpMenu((url) => shell.openExternal(url)),
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

