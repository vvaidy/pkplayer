// Editor window: manage Events, their settings and PDF playlists.
import { debug } from '../lib/debug.js';
import { slidesToPlay } from '../lib/player-controller.js';
import { CUSTOM_PRESET_ID, PRESETS, presetById, presetIdFor } from '../lib/presets.js';
import { preflight } from '../lib/preflight.js';
import { suggestFromMetadata } from '../lib/deck-label.js';
import { DEFAULT_SPEEDRUN_FACTOR, SPEEDRUN_FACTORS, speedrunDuration, speedrunSlideSeconds } from '../lib/speedrun.js';
import { openPdf, renderPage } from './pdf.js';
import { applyTheme } from './theme.js';
import {
  BASE_COLOR_KEYS, BASE_COLOR_LABELS, THEMES, isCustomThemeId, modeFor, normalizeTheme, themeById, themeVars, toHexColor,
} from '../lib/themes.js';

const pk = window.pk;
const $ = (id) => document.getElementById(id);
const ITEM_MIME = 'application/x-pk-item';
const THUMB_W = 224; // 2x the CSS size for crisp thumbnails
const THUMB_H = 126;

const state = {
  events: [],
  selectedId: null,
  displays: [],
  settings: { displayId: null, theme: null },
  themes: [], // the user's own themes; built-in ones come from THEMES
  resumeItemId: null,
};

/** file -> { pageCount, aspect, meta, thumb } once resolved, or { error }. aspect is page 1's width / height; meta is the PDF's own { title, author }. */
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
      const size = (await doc.getPage(1)).getViewport({ scale: 1 });
      const props = await doc.getMetadata().catch((err) => {
        debug('editor', `no properties readable in ${file}`, err);
        return null;
      });
      const info = {
        pageCount: doc.numPages,
        aspect: size.height > 0 ? size.width / size.height : null,
        meta: { title: props?.info?.Title, author: props?.info?.Author },
        thumb: canvas.toDataURL('image/jpeg', 0.85),
      };
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
        updateRows(); // every row: one deck's shape can change another deck's warning
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

/** Pre-flight warnings for the event's decks: deck id -> [{ kind, text }]. */
function deckWarnings(ev) {
  const decks = ev.items.map((it) => {
    const info = pdfInfo.get(it.file);
    return { id: it.id, pages: info?.error ? null : (info?.pageCount ?? it.pageCount), aspect: info?.aspect ?? null };
  });
  return preflight(decks, {
    maxSlides: ev.maxSlides,
    // A named format means every deck should be full length; under Custom, Max slides is only a cap.
    expectFullDecks: presetIdFor(ev.timePerSlide, ev.maxSlides) !== CUSTOM_PRESET_ID,
  });
}

function renderSummary() {
  const ev = selected();
  if (!ev) return;
  const warnings = deckWarnings(ev);
  let slides = 0;
  let unknown = false;
  let flagged = 0;
  for (const it of ev.items) {
    const s = itemStats(ev, it);
    if (s.plays == null) unknown = true;
    else slides += s.plays;
    if (s.error || (s.pages != null && s.pages > ev.maxSlides) || warnings.has(it.id)) flagged += 1;
  }
  const n = ev.items.length;
  const parts = [
    `<strong>${n}</strong> PDF${n === 1 ? '' : 's'}`,
    `<strong>${slides}${unknown ? '+' : ''}</strong> slides`,
    `<strong>${fmtDuration(slides * ev.timePerSlide)}</strong> of slides`,
  ];
  if (flagged) parts.push(`<span class="attention">${flagged} deck${flagged === 1 ? ' needs' : 's need'} a look</span>`);
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
  const warnings = deckWarnings(ev);
  list.replaceChildren(...ev.items.map((it, i) => buildRow(ev, it, i, warnings)));
  $('dropHint').classList.toggle('compact', ev.items.length > 0);
}

function buildRow(ev, it, i, warnings) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = it.id;
  li.tabIndex = 0;
  li.draggable = true;
  li.innerHTML = `
    <div class="handle" aria-hidden="true">⋮⋮</div>
    <div class="index"></div>
    <div class="thumb"></div>
    <div class="info">
      <div class="file"></div>
      <div class="who">
        <input class="who-input presenter" type="text" maxlength="200" spellcheck="false" placeholder="Presenter (optional)" aria-label="Presenter">
        <span class="who-sep" aria-hidden="true">·</span>
        <input class="who-input title" type="text" maxlength="200" placeholder="Talk title (optional)" aria-label="Talk title">
      </div>
      <div class="detail"></div>
    </div>
    <div class="row-actions">
      <button class="icon-btn play-here" title="Play from this PDF">▶</button>
      <button class="icon-btn move-up" title="Move up (⌥↑)">↑</button>
      <button class="icon-btn move-down" title="Move down (⌥↓)">↓</button>
      <button class="icon-btn remove" title="Remove (Delete)">✕</button>
    </div>`;
  li.querySelector('.index').textContent = String(i + 1);
  li.querySelector('.file').textContent = it.name;
  li.querySelector('.file').title = it.name;
  fillRowInfo(li, ev, it, warnings);

  for (const key of ['presenter', 'title']) {
    const input = li.querySelector(`.who-input.${key}`);
    const current = () => selected()?.items.find((x) => x.id === it.id)?.[key] || '';
    input.value = it[key] || '';
    // Press-and-drag on a field still drags the row. A plain click (or tabbing in) means
    // "edit": the row stops being draggable until the field loses focus, so the mouse can select text.
    let pressing = false;
    input.addEventListener('pointerdown', () => { pressing = true; });
    input.addEventListener('focus', () => { if (!pressing) li.draggable = false; });
    input.addEventListener('click', () => {
      pressing = false;
      li.draggable = false;
    });
    input.addEventListener('blur', () => {
      pressing = false;
      li.draggable = true;
    });
    input.addEventListener('change', () => saveItemText(it.id, key, input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = current();
        input.blur();
      }
    });
  }

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
    if (li.contains(document.activeElement)) document.activeElement.blur(); // a drag that began on a field is not an edit
    clearDragUi();
  });
  return li;
}

function fillRowInfo(li, ev, it, warnings) {
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
    for (const w of warnings.get(it.id) || []) badge(w.text, 'warn');
    badge(fmtDuration(s.plays * ev.timePerSlide));
  }
}

/** Refresh the badges and thumbnail of every row of the selected event. */
function updateRows() {
  const ev = selected();
  if (!ev) return;
  const warnings = deckWarnings(ev);
  for (const it of ev.items) {
    const li = $('playlist').querySelector(`[data-id="${CSS.escape(it.id)}"]`);
    if (li) fillRowInfo(li, ev, it, warnings);
  }
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
      updateRows();
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

/**
 * Give newly added decks a default presenter and talk title from the PDF's own
 * properties, when those look like real ones. Only ever runs at import, so it
 * never overwrites what the user typed or brings back a field they cleared.
 */
async function applyMetadataDefaults(eventId, added) {
  await Promise.all(added.map(async (it) => {
    try {
      const info = await loadPdfInfo(it.file);
      const defaults = suggestFromMetadata(info.meta, it.name);
      if (defaults.presenter || defaults.title) await pk.updateItem(eventId, it.id, defaults);
    } catch (err) {
      debug('editor', `could not set defaults for ${it.name}`, err); // the deck is still added, just without defaults
    }
  }));
}

/** Save one of a deck's text fields ("presenter" or "title") from its row input. */
async function saveItemText(itemId, key, input) {
  const ev = selected();
  const it = ev?.items.find((x) => x.id === itemId);
  if (!it) return;
  const label = key === 'presenter' ? 'Saving presenter' : 'Saving talk title';
  const updated = await guarded(label, () => pk.updateItem(ev.id, itemId, { [key]: input.value }));
  if (updated) {
    it.presenter = updated.presenter;
    it.title = updated.title;
  }
  if (document.activeElement !== input) input.value = it[key] || '';
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
    await applyMetadataDefaults(targetId, res.added);
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

/**
 * Practice: pick one PDF and play it with the timer, without creating an event.
 * It uses the selected event's timing when there is one, otherwise 20 x 20.
 */
async function practice() {
  const ev = selected();
  const opts = ev ? { timePerSlide: ev.timePerSlide, maxSlides: ev.maxSlides } : {};
  await guarded('Starting practice', () => pk.practice(opts));
}

// ---------- speedrun test ----------

/**
 * Ask before starting a speedrun: pick one of the fixed speeds, then confirm.
 * Nothing here is saved; the speed goes to that one player window and nowhere else.
 */
function openSpeedrunDialog() {
  const ev = selected();
  if (!ev || ev.items.length === 0) {
    toast('Add at least one PDF before running a speedrun test.');
    return;
  }
  let slides = 0;
  for (const it of ev.items) slides += itemStats(ev, it).plays || 0;
  $('speedChoices').replaceChildren(...SPEEDRUN_FACTORS.map((factor) => {
    const label = document.createElement('label');
    const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'speed', value: String(factor) });
    radio.checked = factor === DEFAULT_SPEEDRUN_FACTOR; // always starts on the default: the last choice is not remembered
    const name = Object.assign(document.createElement('span'), { className: 'speed-name', textContent: `${factor}×` });
    const secs = speedrunSlideSeconds(ev.timePerSlide, factor);
    const total = speedrunDuration({ slides, decks: ev.items.length, timePerSlide: ev.timePerSlide, factor });
    const time = Object.assign(document.createElement('span'), {
      className: 'speed-time',
      textContent: `${Number(secs.toFixed(1))} s per slide · about ${fmtDuration(total)} for ${slides} slides`,
    });
    label.append(radio, name, time);
    return label;
  }));
  $('speedDialog').showModal();
  $('speedCancel').focus(); // Enter cancels unless you move to Start on purpose
}

async function startSpeedrun() {
  const ev = selected();
  const factor = Number($('speedForm').elements.speed.value);
  $('speedDialog').close();
  if (!ev) return;
  await guarded('Starting speedrun test', () => pk.speedrun(ev.id, factor));
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

/** The saved theme with this id: one of the user's own, or a built-in one (the default if unknown). */
function themeFor(id) {
  return state.themes.find((t) => t.id === id) || themeById(id);
}

/** Show the saved theme: the Theme menu's entries and choice, and the colors on the page. */
function renderTheme() {
  const sel = $('themeSelect');
  const groups = [
    ['Dark', THEMES.filter((t) => t.mode === 'dark')],
    ['Light', THEMES.filter((t) => t.mode === 'light')],
    ['Your themes', state.themes],
  ];
  sel.replaceChildren(...groups.filter(([, list]) => list.length).map(([label, list]) => {
    const group = document.createElement('optgroup');
    group.label = label;
    group.append(...list.map((t) => new Option(t.name, t.id)));
    return group;
  }));
  sel.value = applyTheme(themeFor(state.settings.theme)).id;
}

// ---------- theme editor ----------

/** The theme being edited: { id?, name, base }. null when the editor is closed. */
let themeDraft = null;

/** Read the editor's fields into a checked theme, or return null (marking the bad field) if one is not a color. */
function readThemeDraft() {
  const base = {};
  let ok = true;
  for (const key of BASE_COLOR_KEYS) {
    const hexEl = $(`themeHex-${key}`);
    const color = toHexColor(hexEl.value);
    hexEl.classList.toggle('invalid', !color);
    if (color) base[key] = color;
    else ok = false;
  }
  if (!ok) return null;
  return normalizeTheme({ id: themeDraft.id, name: $('themeName').value, mode: modeFor(base.bg), base });
}

/** Preview the fields on the whole window and say which colors were nudged to stay readable. */
function previewThemeDraft() {
  const theme = readThemeDraft();
  const note = $('themeNote');
  note.classList.toggle('error', !theme);
  if (!theme) {
    // Said inside the dialog: a toast would sit underneath it.
    note.hidden = false;
    note.textContent = 'One of the colors is not valid yet. Use the form #1a2b3c.';
    return;
  }
  applyTheme(theme);
  const vars = themeVars(theme);
  const nudged = ['text', 'accent', 'warn', 'danger', 'ok'].filter((k) => vars[`--${k}`] !== theme.base[k]);
  note.hidden = nudged.length === 0;
  note.textContent = nudged.length
    ? `Shown slightly adjusted so it stays readable: ${nudged.map((k) => BASE_COLOR_LABELS[k].split(' (')[0]).join(', ')}.`
    : '';
}

function openThemeEditor() {
  const current = themeFor(state.settings.theme);
  const own = isCustomThemeId(current.id);
  // A built-in theme is never changed: editing one starts a copy that is saved as a new theme.
  themeDraft = own ? { id: current.id, name: current.name } : { name: `${current.name} copy` };
  $('themeDialogTitle').textContent = own ? 'Customize theme' : `New theme from ${current.name}`;
  $('themeName').value = themeDraft.name;
  for (const key of BASE_COLOR_KEYS) {
    $(`themeHex-${key}`).value = current.base[key];
    $(`themeColor-${key}`).value = current.base[key];
  }
  $('themeDelete').hidden = !own;
  $('themeExport').hidden = !own;
  previewThemeDraft();
  $('themeDialog').showModal();
  $('themeName').select();
}

function closeThemeEditor() {
  themeDraft = null;
  if ($('themeDialog').open) $('themeDialog').close();
  renderTheme(); // back to whatever is saved
}

async function saveThemeDraft() {
  const theme = readThemeDraft();
  if (!theme) {
    previewThemeDraft(); // shows which field is wrong, inside the dialog
    return;
  }
  const saved = await guarded('Saving theme', () => pk.saveTheme(theme));
  if (!saved) return;
  state.themes = [...state.themes.filter((t) => t.id !== saved.id), saved];
  const s = await guarded('Saving theme', () => pk.updateSettings({ theme: saved.id }));
  if (s) state.settings = s;
  closeThemeEditor();
}

async function deleteThemeDraft() {
  const id = themeDraft?.id;
  if (!id || !window.confirm(`Delete the theme “${themeFor(id).name}”? This cannot be undone.`)) return;
  const s = await guarded('Deleting theme', () => pk.deleteTheme(id));
  if (!s) return;
  state.settings = s;
  state.themes = state.themes.filter((t) => t.id !== id);
  closeThemeEditor();
}

async function exportThemeDraft() {
  const file = await guarded('Exporting theme', () => pk.exportTheme(themeDraft.id));
  if (file) toast(`Exported the saved theme to ${file.split(/[\\/]/).pop()}`, 'ok', 5000);
}

async function importTheme() {
  const theme = await guarded('Importing theme', () => pk.importTheme());
  if (!theme) return; // cancelled, or the error was already shown
  state.themes = [...state.themes, theme];
  const s = await guarded('Saving theme', () => pk.updateSettings({ theme: theme.id }));
  if (s) state.settings = s;
  renderTheme();
  toast(`Imported “${theme.name}”. Use Customize… to adjust it.`, 'ok', 5000);
}

function wireThemeEditor() {
  // One row per base color: a label, the system color picker, and a hex field. The two stay in step.
  $('themeColors').replaceChildren(...BASE_COLOR_KEYS.flatMap((key) => {
    const label = document.createElement('label');
    label.textContent = BASE_COLOR_LABELS[key];
    label.htmlFor = `themeHex-${key}`;
    const picker = Object.assign(document.createElement('input'), { type: 'color', id: `themeColor-${key}` });
    picker.setAttribute('aria-label', `${BASE_COLOR_LABELS[key]} color picker`);
    const hex = Object.assign(document.createElement('input'), {
      type: 'text', id: `themeHex-${key}`, className: 'input hex', maxLength: 7, spellcheck: false,
    });
    picker.addEventListener('input', () => {
      hex.value = picker.value;
      previewThemeDraft();
    });
    hex.addEventListener('input', () => {
      const color = toHexColor(hex.value);
      if (color) picker.value = color;
      previewThemeDraft();
    });
    return [label, picker, hex];
  }));
  $('themeCustomize').addEventListener('click', openThemeEditor);
  $('themeImport').addEventListener('click', importTheme);
  $('themeCancel').addEventListener('click', closeThemeEditor);
  $('themeDelete').addEventListener('click', deleteThemeDraft);
  $('themeExport').addEventListener('click', exportThemeDraft);
  $('themeForm').addEventListener('submit', (e) => {
    e.preventDefault(); // stay open until the save has worked
    saveThemeDraft();
  });
  // Esc puts the saved colors back at once ("cancel" fires before the dialog closes)...
  $('themeDialog').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeThemeEditor();
  });
  // ...and so does anything else that closes the dialog without saving.
  $('themeDialog').addEventListener('close', () => {
    if (themeDraft) closeThemeEditor();
  });
}

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
  $('emptyPractice').addEventListener('click', () => practice());
  $('speedrunOpen').addEventListener('click', openSpeedrunDialog);
  $('speedCancel').addEventListener('click', () => $('speedDialog').close());
  $('speedForm').addEventListener('submit', (e) => {
    e.preventDefault();
    startSpeedrun();
  });
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

  wireThemeEditor();
  const themeEl = $('themeSelect');
  themeEl.addEventListener('change', async () => {
    const s = await guarded('Saving theme', () => pk.updateSettings({ theme: themeEl.value }));
    if (s) state.settings = s;
    renderTheme();
  });

  $('displaySelect').addEventListener('change', async (e) => {
    const v = e.target.value;
    const s = await guarded('Saving display', () => pk.updateSettings({ displayId: v === '' ? null : v }));
    if (s) state.settings = s;
  });

  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || $('themeDialog').open || $('speedDialog').open) return; // no Play shortcut while typing or in a dialog
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      play();
    }
  });

  pk.onMenu('newEvent', () => newEvent());
  pk.onMenu('practice', () => practice());
  pk.onMenu('speedrun', () => openSpeedrunDialog());
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
  const [settings, displays, themes] = await Promise.all([
    guarded('Loading settings', () => pk.getSettings()),
    guarded('Listing displays', () => pk.listDisplays()),
    guarded('Loading themes', () => pk.listThemes()),
  ]);
  if (settings) state.settings = settings;
  state.themes = themes || [];
  state.displays = displays || [];
  renderDisplays();
  renderTheme();
  await refreshEvents();
  await selectEvent(state.selectedId);
  document.body.dataset.ready = '1';
}

init().catch((err) => {
  debug('editor', 'init failed', err);
  toast(`Startup failed: ${err.message}`, 'error', 10000);
});
