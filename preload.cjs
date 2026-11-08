// Preload bridge: exposes a small, explicit API to the renderer (contextIsolation on, sandboxed).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error(res?.error || `IPC ${channel} failed`);
  return res.value;
}

function on(channel, fn) {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('pk', {
  platform: process.platform,
  listEvents: () => call('events:list'),
  getEvent: (id) => call('events:get', id),
  createEvent: (name) => call('events:create', name),
  updateEvent: (id, patch) => call('events:update', id, patch),
  deleteEvent: (id) => call('events:delete', id),
  duplicateEvent: (id) => call('events:duplicate', id),
  addPdfs: (eventId, paths, index) => call('items:add', eventId, paths, index),
  removeItem: (eventId, itemId) => call('items:remove', eventId, itemId),
  reorderItems: (eventId, ids) => call('items:reorder', eventId, ids),
  moveItem: (eventId, itemId, toIndex) => call('items:move', eventId, itemId, toIndex),
  setPageCount: (eventId, itemId, n) => call('items:pageCount', eventId, itemId, n),
  getSettings: () => call('settings:get'),
  updateSettings: (patch) => call('settings:update', patch),
  listDisplays: () => call('displays:list'),
  getResume: (eventId) => call('resume:get', eventId),
  clearResume: (eventId) => call('resume:clear', eventId),
  pickPdfs: () => call('dialog:openPdfs'),
  openPlayer: (eventId, startItemId) => call('player:open', eventId, startItemId),
  closePlayer: () => call('player:close'),
  enterFullscreen: () => call('player:fullscreen'),
  reportPosition: (itemId) => call('player:position', itemId),
  /** Real filesystem path of a dropped File (Electron removed File.path). */
  pathForFile: (file) => webUtils.getPathForFile(file),
  onPlayerClosed: (fn) => on('player:closed', fn),
  onDisplaysChanged: (fn) => on('displays:changed', fn),
  onMenu: (name, fn) => on(`menu:${name}`, fn),
});
