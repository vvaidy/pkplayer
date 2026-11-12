// Editor window: manage Events, their settings and PDF playlists.
import { debug } from '../lib/debug.js';
import { slidesToPlay } from '../lib/player-controller.js';
import { CUSTOM_PRESET_ID, PRESETS, presetById, presetIdFor } from '../lib/presets.js';
import { openPdf, renderPage } from './pdf.js';

const pk = window.pk;
const $ = (id) => document.getElementById(id);
const ITEM_MIME = 'application/x-pk-item';
const THUMB_W = 224; // 2x the CSS size for crisp thumbnails
const THUMB_H = 126;

const state = {
  events: [],
  selectedId: null,
  displays: [],
  settings: { displayId: null },
  resumeItemId: null,
};

/** file -> { pageCount, thumb } once resolved, or { error } */
const pdfInfo = new Map();
const pdfInfoPending = new Map();

// ---------- helpers ----------

function toast(message, kind = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

async function guarded(label, fn) {
  try {
    return await fn();
  } catch (err) {
    debug('editor', label, err);
    toast(`${label}: ${err.message}`, 'error', 6000);
    return undefined;
  }
}

function showBusy(text) {
  $('busyText').textContent = text;
  $('busy').hidden = false;
}
function hideBusy() {
  $('busy').hidden = true;
}

function fmtDuration(totalSec) {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const selected = () => state.events.find((e) => e.id === state.selectedId) || null;

function replaceEvent(ev) {
  const i = state.events.findIndex((e) => e.id === ev.id);
  if (i >= 0) state.events[i] = ev;
  else state.events.push(ev);
}

function isTyping(target) {
  return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
}

// ---------- PDF info / thumbnails ----------

function loadPdfInfo(file) {
  if (pdfInfo.has(file)) return Promise.resolve(pdfInfo.get(file));
  if (pdfInfoPending.has(file)) return pdfInfoPending.get(file);
  const p = (async () => {
    let doc;
    try {
      doc = await openPdf(file);
      const canvas = await renderPage(doc, 1, THUMB_W, THUMB_H, { dpr: 1 });
      const info = { pageCount: doc.numPages, thumb: canvas.toDataURL('image/jpeg', 0.85) };
      pdfInfo.set(file, info);
      return info;
    } catch (err) {
      const info = { error: err.message || 'Could not read PDF' };
      pdfInfo.set(file, info);
      return info;
    } finally {
      pdfInfoPending.delete(file);
      doc?.destroy();
    }
  })();
  pdfInfoPending.set(file, p);
  return p;
}

/** Load info for each item, persisting page counts the store doesn't know yet. */
function hydrateItems(ev) {
  for (const it of ev.items) {
    loadPdfInfo(it.file).then(async (info) => {
      if (info.pageCount != null && it.pageCount !== info.pageCount) {
        const updated = await guarded('Saving page count', () => pk.setPageCount(ev.id, it.id, info.pageCount));
        if (updated) it.pageCount = updated.pageCount;
      }
      if (state.selectedId === ev.id) {
        updateRow(it);
        renderSummary();
      }
      renderSidebar();
    });
  }
}

// ---------- sidebar ----------

function renderSidebar() {
  const list = $('eventList');
  list.replaceChildren(
    ...state.events.map((ev) => {
      const li = document.createElement('li');
      li.className = `event-item${ev.id === state.selectedId ? ' selected' : ''}`;
      li.dataset.id = ev.id;
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = ev.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      const n = ev.items.length;
      meta.textContent = `${n} PDF${n === 1 ? '' : 's'} · ${ev.timePerSlide}s × ${ev.maxSlides}`;
      li.append(name, meta);
      li.addEventListener('click', () => selectEvent(ev.id));
      // Drop PDFs straight onto an event in the sidebar.
      li.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.add('drop-target');
      });
      li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
      li.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.remove('drop-target');
        clearDragUi();
        importFiles(ev.id, droppedPaths(e));
      });
      return li;
    }),
  );
}

// ---------- event view ----------

async function selectEvent(id) {
  state.selectedId = id;
  state.resumeItemId = id ? (await guarded('Loading resume point', () => pk.getResume(id))) ?? null : null;
  renderSidebar();
  renderEvent();
}

function renderEvent() {
  const ev = selected();
  $('eventView').hidden = !ev;
  if (!ev) {
    $('emptyState').hidden = false;
    return;
  }
  $('emptyState').hidden = true;
  if (document.activeElement !== $('eventName')) $('eventName').value = ev.name;
  renderSettings(ev);
  renderPlaylist();
  renderSummary();
  hydrateItems(ev);
}

/**
 * Show the event's two settings, and the preset they match (or "Custom").
 * With keepFocused, a field the user is typing in is left alone, so a typed
 * edit whose save finishes late never overwrites what they typed next.
 */
function renderSettings(ev, { keepFocused = false } = {}) {
  for (const key of ['timePerSlide', 'maxSlides']) {
    if (!keepFocused || document.activeElement !== $(key)) $(key).value = ev[key];
  }
  $('preset').value = presetIdFor(ev.timePerSlide, ev.maxSlides);
}

function itemStats(ev, it) {
  const info = pdfInfo.get(it.file);
  const pages = info?.pageCount ?? it.pageCount;
  if (info?.error) return { pages: null, plays: 0, error: info.error };
  if (pages == null) return { pages: null, plays: null };
  return { pages, plays: slidesToPlay(pages, ev.maxSlides) };
}

function renderSummary() {
  const ev = selected();
  if (!ev) return;
  let slides = 0;
  let unknown = false;
  for (const it of ev.items) {
    const s = itemStats(ev, it);
    if (s.plays == null) unknown = true;
    else slides += s.plays;
  }
  const n = ev.items.length;
  const parts = [
    `<strong>${n}</strong> PDF${n === 1 ? '' : 's'}`,
    `<strong>${slides}${unknown ? '+' : ''}</strong> slides`,
    `<strong>${fmtDuration(slides * ev.timePerSlide)}</strong> of slides`,
  ];
  $('summary').innerHTML = parts.join(' · ');
  renderPlayButton();
}

function renderPlayButton() {
  const ev = selected();
  if (!ev) return;
  const idx = state.resumeItemId ? ev.items.findIndex((it) => it.id === state.resumeItemId) : -1;
  $('playBtn').disabled = ev.items.length === 0;
  $('playLabel').textContent = idx > 0 ? `Play from #${idx + 1}` : 'Play';
  $('playBtn').title = idx > 0 ? `Resume at “${ev.items[idx].name}” (F)` : 'Play (F)';
  $('playFromStart').hidden = !(idx > 0);
}

function renderPlaylist() {
  const ev = selected();
  const list = $('playlist');
  list.replaceChildren(...ev.items.map((it, i) => buildRow(ev, it, i)));
  $('dropHint').classList.toggle('compact', ev.items.length > 0);
}

function buildRow(ev, it, i) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = it.id;
  li.tabIndex = 0;
  li.draggable = true;
  li.innerHTML = `
    <div class="handle" aria-hidden="true">⋮⋮</div>
    <div class="index"></div>
    <div class="thumb"></div>
    <div class="info"><div class="file"></div><div class="detail"></div></div>
    <div class="row-actions">
      <button class="icon-btn play-here" title="Play from this PDF">▶</button>
      <button class="icon-btn move-up" title="Move up (⌥↑)">↑</button>
      <button class="icon-btn move-down" title="Move down (⌥↓)">↓</button>
      <button class="icon-btn remove" title="Remove (Delete)">✕</button>
    </div>`;
  li.querySelector('.index').textContent = String(i + 1);
  li.querySelector('.file').textContent = it.name;
  li.querySelector('.file').title = it.name;
  fillRowInfo(li, ev, it);

  li.querySelector('.play-here').addEventListener('click', (e) => {
    e.stopPropagation();
    play(it.id);
  });
  li.querySelector('.move-up').addEventListener('click', (e) => {
    e.stopPropagation();
    moveItem(it.id, -1);
  });
  li.querySelector('.move-down').addEventListener('click', (e) => {
    e.stopPropagation();
    moveItem(it.id, 1);
  });
  li.querySelector('.remove').addEventListener('click', (e) => {
    e.stopPropagation();
    removeItem(it.id);
  });
  li.addEventListener('keydown', (e) => {
    if (e.target !== li) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeItem(it.id, true);
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveItem(it.id, -1);
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveItem(it.id, 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const sib = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
      sib?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      play(it.id);
    }
  });
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(ITEM_MIME, it.id);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    clearDragUi();
  });
  return li;
}

function fillRowInfo(li, ev, it) {
  const info = pdfInfo.get(it.file);
  const thumb = li.querySelector('.thumb');
  if (!info) {
    thumb.innerHTML = '<div class="spinner sm"></div>';
  } else if (info.error) {
    thumb.innerHTML = '<div class="err">Unreadable PDF</div>';
  } else if (!thumb.querySelector('img')) {
    const img = document.createElement('img');
    img.src = info.thumb;
    img.alt = '';
    thumb.replaceChildren(img);
  }
  const s = itemStats(ev, it);
  const detail = li.querySelector('.detail');
  detail.replaceChildren();
  const badge = (text, cls = '') => {
    const b = document.createElement('span');
    b.className = `badge ${cls}`;
    b.textContent = text;
    detail.appendChild(b);
  };
  if (s.error) {
    badge('Cannot read this PDF — it will be skipped', 'err');
  } else if (s.pages == null) {
    badge('Reading…');
  } else {
    badge(`${s.pages} page${s.pages === 1 ? '' : 's'}`);
    if (s.pages > ev.maxSlides) badge(`only first ${ev.maxSlides} play`, 'warn');
    badge(fmtDuration(s.plays * ev.timePerSlide));
  }
}

function updateRow(it) {
  const ev = selected();
  const li = $('playlist').querySelector(`[data-id="${CSS.escape(it.id)}"]`);
  if (ev && li) fillRowInfo(li, ev, it);
}

// ---------- actions ----------

async function refreshEvents() {
  const events = await guarded('Loading events', () => pk.listEvents());
  if (!events) return;
  state.events = events;
  if (!state.events.some((e) => e.id === state.selectedId)) state.selectedId = state.events[0]?.id ?? null;
}

async function newEvent(name) {
  const ev = await guarded('Creating event', () => pk.createEvent(name));
  if (!ev) return null;
  state.events.push(ev);
  await selectEvent(ev.id);
  if (!name) {
    $('eventName').focus();
    $('eventName').select();
  }
  return ev;
}

async function saveEventPatch(patch, inputEl) {
  const ev = selected();
  if (!ev) return;
  try {
    const updated = await pk.updateEvent(ev.id, patch);
    replaceEvent(updated);
    inputEl?.classList.remove('invalid');
    renderSidebar();
    if ('maxSlides' in patch || 'timePerSlide' in patch) {
      renderSettings(updated, { keepFocused: Boolean(inputEl) });
      for (const it of updated.items) updateRow(it);
      renderSummary();
    }
  } catch (err) {
    debug('editor', 'update event failed', err);
    toast(err.message, 'error');
    if (inputEl) {
      inputEl.classList.remove('invalid');
      void inputEl.offsetWidth; // restart animation
      inputEl.classList.add('invalid');
      const key = Object.keys(patch)[0];
      inputEl.value = ev[key];
    } else if ('maxSlides' in patch || 'timePerSlide' in patch) {
      renderSettings(ev); // a preset that could not be saved: show the real settings again
    }
  }
}

async function importFiles(eventId, paths) {
  if (!paths.length) return;
  let targetId = eventId;
  if (!targetId) {
    const first = paths[0].split(/[\\/]/).pop().replace(/\.pdf$/i, '');
    const ev = await newEvent(paths.length === 1 ? first : 'New Event');
    if (!ev) return;
    targetId = ev.id;
  }
  showBusy(`Importing ${paths.length} file${paths.length === 1 ? '' : 's'}…`);
  try {
    const res = await guarded('Importing PDFs', () => pk.addPdfs(targetId, paths, dropIndexForImport));
    if (!res) return;
    if (res.rejected.length) {
      const names = res.rejected.map((r) => `• ${r.path.split(/[\\/]/).pop()}: ${r.reason}`).join('\n');
      toast(`Skipped ${res.rejected.length} file(s):\n${names}`, 'error', 7000);
    }
    if (res.added.length) toast(`Added ${res.added.length} PDF${res.added.length === 1 ? '' : 's'}`, 'ok', 2000);
    const ev = await guarded('Reloading event', () => pk.getEvent(targetId));
    if (ev) replaceEvent(ev);
    if (state.selectedId !== targetId) await selectEvent(targetId);
    else {
      renderSidebar();
      renderEvent();
    }
  } finally {
    dropIndexForImport = undefined;
    hideBusy();
  }
}

async function addPdfsViaDialog() {
  const paths = await guarded('Opening file dialog', () => pk.pickPdfs());
  if (paths?.length) importFiles(state.selectedId, paths);
}

async function removeItem(itemId, keepFocus = false) {
  const ev = selected();
  if (!ev) return;
  const idx = ev.items.findIndex((it) => it.id === itemId);
  const updated = await guarded('Removing PDF', () => pk.removeItem(ev.id, itemId));
  if (!updated) return;
  replaceEvent(updated);
  renderSidebar();
  renderPlaylist();
  renderSummary();
  if (keepFocus) {
    const rows = $('playlist').children;
    rows[Math.min(idx, rows.length - 1)]?.focus();
  }
}

async function applyOrder(ids, focusId) {
  const ev = selected();
  const updated = await guarded('Reordering', () => pk.reorderItems(ev.id, ids));
  if (!updated) return;
  replaceEvent(updated);
  renderPlaylist();
  renderPlayButton();
  if (focusId) $('playlist').querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.focus();
}

function moveItem(itemId, delta) {
  const ev = selected();
  const ids = ev.items.map((it) => it.id);
  const from = ids.indexOf(itemId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(from, 1);
  ids.splice(to, 0, itemId);
  applyOrder(ids, itemId);
}

async function deleteSelectedEvent() {
  const ev = selected();
  if (!ev) return;
  if (!window.confirm(`Delete “${ev.name}”?\n\nIts imported PDF copies will be removed too. This cannot be undone.`)) return;
  const ok = await guarded('Deleting event', () => pk.deleteEvent(ev.id));
  if (!ok) return;
  state.events = state.events.filter((e) => e.id !== ev.id);
  await selectEvent(state.events[0]?.id ?? null);
}

async function duplicateSelectedEvent() {
  const ev = selected();
  if (!ev) return;
  const copy = await guarded('Duplicating event', () => pk.duplicateEvent(ev.id));
  if (!copy) return;
  state.events.splice(state.events.findIndex((e) => e.id === ev.id) + 1, 0, copy);
  await selectEvent(copy.id);
}

async function play(startItemId) {
  const ev = selected();
  if (!ev || ev.items.length === 0) {
    toast('Add at least one PDF to play this event.');
    return;
  }
  let start = startItemId;
  if (start === undefined) {
    start = ev.items.some((it) => it.id === state.resumeItemId) ? state.resumeItemId : ev.items[0].id;
  }
  await guarded('Opening player', () => pk.openPlayer(ev.id, start));
}

// ---------- drag & drop ----------

let dropIndexForImport;
let dragUiTimer = null;

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
const hasItem = (e) => Array.from(e.dataTransfer?.types || []).includes(ITEM_MIME);

function droppedPaths(e) {
  return Array.from(e.dataTransfer.files || [])
    .map((f) => {
      try {
        return pk.pathForFile(f);
      } catch (err) {
        debug('editor', `no path for dropped file ${f.name}`, err);
        return '';
      }
    })
    .filter(Boolean);
}

function computeDropIndex(clientY) {
  const rows = Array.from($('playlist').children);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return rows.length;
}

function showDropIndicator(index) {
  const rows = Array.from($('playlist').children);
  rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  if (!rows.length) return;
  if (index < rows.length) rows[index].classList.add('drop-before');
  else rows[rows.length - 1].classList.add('drop-after');
}

function clearDragUi() {
  $('dropOverlay').hidden = true;
  $('dropHint').classList.remove('active');
  for (const r of $('playlist').children) r.classList.remove('drop-before', 'drop-after');
  for (const li of $('eventList').children) li.classList.remove('drop-target');
}

function overPlaylistArea(e) {
  return Boolean(e.target instanceof Element && e.target.closest('#eventView'));
}

function setupDragAndDrop() {
  document.addEventListener('dragover', (e) => {
    const files = hasFiles(e);
    const item = hasItem(e);
    if (!files && !item) return;
    e.preventDefault();
    clearTimeout(dragUiTimer);
    dragUiTimer = setTimeout(clearDragUi, 200);
    if (item) {
      e.dataTransfer.dropEffect = 'move';
      if (overPlaylistArea(e)) showDropIndicator(computeDropIndex(e.clientY));
      return;
    }
    e.dataTransfer.dropEffect = 'copy';
    if (selected() && overPlaylistArea(e)) {
      $('dropOverlay').hidden = true;
      $('dropHint').classList.add('active');
      showDropIndicator(computeDropIndex(e.clientY));
    } else if (!(e.target instanceof Element && e.target.closest('.sidebar'))) {
      $('dropOverlay').hidden = false;
    }
  });

  document.addEventListener('drop', (e) => {
    if (!hasFiles(e) && !hasItem(e)) return;
    e.preventDefault();
    clearTimeout(dragUiTimer);
    const ev = selected();
    const index = ev && overPlaylistArea(e) ? computeDropIndex(e.clientY) : undefined;
    clearDragUi();
    if (hasItem(e)) {
      const id = e.dataTransfer.getData(ITEM_MIME);
      if (!ev || index === undefined) return;
      const ids = ev.items.map((it) => it.id);
      const from = ids.indexOf(id);
      if (from < 0) return;
      let to = index;
      if (from < to) to -= 1;
      if (from === to) return;
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      applyOrder(ids, id);
      return;
    }
    dropIndexForImport = index;
    importFiles(ev?.id ?? null, droppedPaths(e));
  });
}

// ---------- displays ----------

function renderDisplays() {
  const sel = $('displaySelect');
  const opts = [new Option('Main display (automatic)', '')];
  for (const d of state.displays) {
    opts.push(new Option(`${d.label} — ${d.width}×${d.height}${d.primary ? ' (main)' : ''}`, String(d.id)));
  }
  const missing = state.settings.displayId != null && !state.displays.some((d) => d.id === state.settings.displayId);
  if (missing) opts.push(new Option('Saved display (not connected — using main)', String(state.settings.displayId)));
  sel.replaceChildren(...opts);
  sel.value = state.settings.displayId == null ? '' : String(state.settings.displayId);
}

// ---------- wiring ----------

function wireControls() {
  $('newEvent').addEventListener('click', () => newEvent());
  $('emptyNew').addEventListener('click', () => newEvent());
  $('addPdfs').addEventListener('click', addPdfsViaDialog);
  $('dropHint').addEventListener('click', addPdfsViaDialog);
  $('deleteEvent').addEventListener('click', deleteSelectedEvent);
  $('duplicateEvent').addEventListener('click', duplicateSelectedEvent);
  $('playBtn').addEventListener('click', () => play());
  $('playFromStart').addEventListener('click', () => play(selected()?.items[0]?.id));

  let nameTimer;
  const name = $('eventName');
  name.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => saveEventPatch({ name: name.value }), 400);
  });
  name.addEventListener('change', () => {
    clearTimeout(nameTimer);
    saveEventPatch({ name: name.value });
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') name.blur();
  });

  for (const [id, key] of [['timePerSlide', 'timePerSlide'], ['maxSlides', 'maxSlides']]) {
    const el = $(id);
    el.addEventListener('change', () => saveEventPatch({ [key]: el.value }, el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
    });
  }

  const presetEl = $('preset');
  for (const p of [...PRESETS, { id: CUSTOM_PRESET_ID, label: 'Custom' }]) {
    presetEl.append(new Option(p.label, p.id));
  }
  presetEl.addEventListener('change', () => {
    const preset = presetById(presetEl.value);
    if (preset) {
      saveEventPatch({ timePerSlide: preset.timePerSlide, maxSlides: preset.maxSlides });
    } else {
      // "Custom" changes nothing by itself: hand over to the field to type in.
      $('timePerSlide').focus();
      $('timePerSlide').select();
    }
  });

  $('displaySelect').addEventListener('change', async (e) => {
    const v = e.target.value;
    const s = await guarded('Saving display', () => pk.updateSettings({ displayId: v === '' ? null : v }));
    if (s) state.settings = s;
  });

  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      play();
    }
  });

  pk.onMenu('newEvent', () => newEvent());
  pk.onMenu('addPdfs', () => (selected() ? addPdfsViaDialog() : toast('Create or select an event first.')));
  pk.onPlayerClosed(async ({ eventId }) => {
    await refreshEvents();
    if (eventId === state.selectedId) await selectEvent(eventId);
    else renderSidebar();
  });
  pk.onDisplaysChanged((displays) => {
    state.displays = displays;
    renderDisplays();
  });
}

async function init() {
  wireControls();
  setupDragAndDrop();
  const [settings, displays] = await Promise.all([
    guarded('Loading settings', () => pk.getSettings()),
    guarded('Listing displays', () => pk.listDisplays()),
  ]);
  if (settings) state.settings = settings;
  state.displays = displays || [];
  renderDisplays();
  await refreshEvents();
  await selectEvent(state.selectedId);
  document.body.dataset.ready = '1';
}

init().catch((err) => {
  debug('editor', 'init failed', err);
  toast(`Startup failed: ${err.message}`, 'error', 10000);
});
