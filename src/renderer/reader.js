// Reader window: read one PDF in a normal window. All pages in a scrolling column,
// zoom, page thumbnails, selectable text and text search. Read-only: it never changes the file.
import { debug } from '../lib/debug.js';
import {
  FIT_PAGE, FIT_WIDTH, POINT_TO_PIXEL, ZOOM_STEPS, clampZoom, findInDocument, fitZoom, matchRanges, nextZoom,
  normalizeQuery, stepHit,
} from '../lib/reader.js';
import { describePages, playedPages } from '../lib/page-range.js';
import {
  describePlan, initialPlan, isChanged, keepOnly, movePage, planToPages, rotatePage, toggleRemoved,
} from '../lib/page-edit.js';
import { TextLayer, openPdfAt } from './pdf.js';

// ---------- reader parameters ----------
const RENDER_MARGIN = '700px 0px'; // draw pages a little before they scroll into view
const MAX_CANVAS_PIXELS = 24e6; // above this a page is drawn at lower density instead of exhausting memory
const THUMB_WIDTH = 132;
const GRID_WIDTH = 236; // width of one page in the grid view
const PAGE_GUTTER = 36; // space left and right of a page at fit-to-width
const FIND_DELAY_MS = 220;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const SRC = params.get('src') || '';
const NAME = params.get('name') || 'PDF';
/** Max slides of the event this deck was opened from, or null for a PDF opened on its own. */
const MAX_SLIDES = Number.parseInt(params.get('max'), 10) > 0 ? Number.parseInt(params.get('max'), 10) : null;
/** The deck's own page range in that event (first and last page to play), when it has one. */
const pageParam = (name) => (Number.parseInt(params.get(name), 10) > 0 ? Number.parseInt(params.get(name), 10) : null);
const RANGE = { firstPage: pageParam('first'), lastPage: pageParam('last') };
/** Set when this deck was opened from an event's playlist: only then can its pages be edited. */
const EVENT_ID = params.get('event');
const ITEM_ID = params.get('item');
const CAN_EDIT = Boolean(EVENT_ID && ITEM_ID && window.pk);
const ALREADY_EDITED = params.get('edited') === '1';

let doc = null;
/** One entry per page: { el, size: {width, height} in points, drawnAt: zoom|null, task, textLayer } */
const pages = [];
let zoomMode = FIT_WIDTH; // FIT_WIDTH, FIT_PAGE, or a number (1 = 100%)
let zoom = 1;
let currentPage = 0;
const find = { query: '', hits: [], perPage: [], index: -1, texts: null, timer: null, token: 0 };

function fail(message, err) {
  debug('reader', message, err);
  $('readerStatus').hidden = false;
  $('readerStatus').classList.add('error');
  $('readerStatusText').textContent = message;
}

// ---------- layout and zoom ----------

function widestPage() {
  return pages.reduce((best, p) => (p.size.width > best.width ? p.size : best), pages[0].size);
}

function computeZoom() {
  if (typeof zoomMode === 'number') return clampZoom(zoomMode);
  const box = { width: $('pages').clientWidth - PAGE_GUTTER, height: $('pages').clientHeight - 36 };
  return fitZoom(zoomMode, zoomMode === FIT_PAGE ? pages[currentPage].size : widestPage(), box);
}

/** Size every page box for the current zoom, keeping the page being read in view. */
function layout() {
  if (!pages.length) return;
  const scroller = $('pages');
  const anchor = pages[currentPage].el;
  const offsetInPage = anchor.offsetHeight ? (scroller.scrollTop - anchor.offsetTop) / anchor.offsetHeight : 0;
  zoom = computeZoom();
  const scale = zoom * POINT_TO_PIXEL;
  for (const p of pages) {
    p.el.style.width = `${Math.floor(p.size.width * scale)}px`;
    p.el.style.height = `${Math.floor(p.size.height * scale)}px`;
    p.el.style.setProperty('--scale-factor', String(scale));
    if (p.drawnAt !== null && p.drawnAt !== zoom) clearPage(p); // redrawn sharp when next in view
  }
  scroller.scrollTop = anchor.offsetTop + offsetInPage * anchor.offsetHeight;
  renderZoomControl();
  refreshVisible();
}

function renderZoomControl() {
  const sel = $('zoomSelect');
  const percent = `${Math.round(zoom * 100)}%`;
  const options = [new Option('Fit width', FIT_WIDTH), new Option('Fit page', FIT_PAGE), ...ZOOM_STEPS.map((z) => new Option(`${Math.round(z * 100)}%`, String(z)))];
  const value = typeof zoomMode === 'number' ? String(zoomMode) : zoomMode;
  if (!options.some((o) => o.value === value)) options.push(new Option(percent, value));
  sel.replaceChildren(...options);
  sel.value = value;
  sel.title = `Zoom: ${percent}`;
  document.body.dataset.zoom = percent;
}

function setZoom(mode) {
  zoomMode = typeof mode === 'number' ? clampZoom(mode) : mode;
  layout();
}

// ---------- drawing pages ----------

function clearPage(p) {
  p.task?.cancel();
  p.task = null;
  p.textLayer?.cancel();
  p.textLayer = null;
  p.drawnAt = null;
  p.el.replaceChildren();
  delete p.el.dataset.drawn;
}

async function drawPage(index) {
  const p = pages[index];
  if (p.drawnAt === zoom || p.drawing === zoom) return;
  clearPage(p);
  const at = zoom;
  p.drawing = at;
  try {
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: at * POINT_TO_PIXEL });
    let density = window.devicePixelRatio || 1;
    const pixels = viewport.width * viewport.height * density * density;
    if (pixels > MAX_CANVAS_PIXELS) density *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * density));
    canvas.height = Math.max(1, Math.floor(viewport.height * density));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    p.task = page.render({ canvasContext: ctx, viewport, transform: [density, 0, 0, density, 0, 0] });
    await p.task.promise;
    if (zoom !== at) return; // zoom changed while drawing: layout() will ask again
    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';
    p.el.replaceChildren(canvas, textDiv);
    p.textLayer = new TextLayer({ textContentSource: await page.getTextContent(), container: textDiv, viewport });
    await p.textLayer.render();
    if (zoom !== at) return;
    p.drawnAt = at;
    p.el.dataset.drawn = '1';
    markPage(index);
    page.cleanup();
  } catch (err) {
    if (err?.name === 'RenderingCancelledException' || err?.name === 'AbortException') return;
    debug('reader', `could not draw page ${index + 1}`, err);
    const msg = document.createElement('div');
    msg.className = 'page-error';
    msg.textContent = `Page ${index + 1} could not be drawn`;
    p.el.replaceChildren(msg);
    p.drawnAt = at;
  } finally {
    if (p.drawing === at) p.drawing = null;
  }
}

let visible = new Set();
const pageObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const i = Number(e.target.dataset.page);
    if (e.isIntersecting) {
      visible.add(i);
      drawPage(i);
    } else {
      visible.delete(i);
      if (pages[i].drawnAt !== null) clearPage(pages[i]); // far from view: give the memory back
    }
  }
}, { root: document.getElementById('pages'), rootMargin: RENDER_MARGIN });

function refreshVisible() {
  for (const i of visible) drawPage(i);
}

// ---------- current page ----------

function updateCurrentPage() {
  const scroller = $('pages');
  // While the grid is showing, the page column is hidden and has no positions to measure:
  // a late scroll event must not move the reading position to the last page.
  if (document.body.dataset.view === 'grid' || scroller.clientHeight === 0) return;
  const line = scroller.scrollTop + scroller.clientHeight * 0.35;
  let found = 0;
  for (let i = 0; i < pages.length; i += 1) {
    if (pages[i].el.offsetTop <= line) found = i;
    else break;
  }
  if (found === currentPage && $('pageInput').value) return;
  currentPage = found;
  renderPageControl();
}

function renderPageControl() {
  if (document.activeElement !== $('pageInput')) $('pageInput').value = String(currentPage + 1);
  $('prevPage').disabled = currentPage === 0;
  $('nextPage').disabled = currentPage >= pages.length - 1;
  document.body.dataset.page = String(currentPage + 1);
  markCurrentTiles();
  const cur = $('thumbs').children[currentPage];
  if (cur && !$('thumbs').hidden) cur.scrollIntoView({ block: 'nearest' });
}

function goToPage(index, { top = true } = {}) {
  const i = Math.min(pages.length - 1, Math.max(0, index));
  const scroller = $('pages');
  if (top) scroller.scrollTop = pages[i].el.offsetTop - 12;
  currentPage = i;
  renderPageControl();
  if (document.body.dataset.view === 'grid') $('gridTiles').children[i]?.scrollIntoView({ block: 'nearest' });
}

// ---------- thumbnails ----------

/** The pages the event would play ({ first, last, count }), or null when the PDF was not opened from an event. */
function playedRange() {
  return MAX_SLIDES ? playedPages(RANGE, pages.length, MAX_SLIDES) : null;
}

/**
 * Fill a container with one small picture per page, drawn only when scrolled near.
 * Used for the thumbnail strip and for the grid view. Pages the event would not play are marked.
 */
function buildTiles(container, width, onPick) {
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      drawThumb(Number(e.target.dataset.page), e.target.querySelector('.thumb-box'), width);
    }
  }, { root: container, rootMargin: '300px 0px' });
  const played = playedRange();
  container.replaceChildren(...pages.map((p, i) => {
    const item = document.createElement('button');
    const beyond = played !== null && (i + 1 < played.first || i + 1 > played.last);
    item.className = `thumb-item${beyond ? ' beyond' : ''}`;
    item.dataset.page = String(i);
    item.title = beyond ? `Page ${i + 1}: outside the pages this event plays` : `Go to page ${i + 1}`;
    const box = document.createElement('div');
    box.className = 'thumb-box';
    box.style.width = `${width}px`;
    box.style.height = `${Math.round(width * p.size.height / p.size.width)}px`;
    const label = document.createElement('span');
    label.className = 'thumb-label';
    label.textContent = beyond ? `${i + 1} · not played` : String(i + 1);
    item.append(box, label);
    item.addEventListener('click', () => onPick(i));
    observer.observe(item);
    return item;
  }));
}

function buildThumbs() {
  buildTiles($('thumbs'), THUMB_WIDTH, (i) => goToPage(i));
}

// ---------- grid view ----------

let gridBuilt = false;
/** The page-edit plan while "Edit pages" is on (see src/lib/page-edit.js); null otherwise. */
let plan = null;
/** original page index -> Promise<canvas>, so a page is drawn once however often the tiles are rebuilt */
const editThumbs = new Map();

/** Switch between reading pages and the grid: every page at once, like a contact sheet. */
function setView(view) {
  const grid = view === 'grid';
  if (!grid && plan) {
    if (isChanged(plan) && !window.confirm('Leave without saving your page edits?')) return;
    stopEditing();
  }
  document.body.dataset.view = grid ? 'grid' : 'pages';
  $('toggleGrid').setAttribute('aria-pressed', String(grid));
  $('gridView').hidden = !grid;
  $('readerBody').hidden = grid;
  for (const id of ['zoomOut', 'zoomIn', 'zoomSelect', 'toggleThumbs']) $(id).disabled = grid; // these act on the page view
  if (grid) {
    if (!gridBuilt) {
      buildTiles($('gridTiles'), GRID_WIDTH, (i) => {
        setView('pages');
        goToPage(i);
      });
      gridBuilt = true;
      $('gridActions').hidden = !CAN_EDIT;
      $('restorePages').hidden = !ALREADY_EDITED;
      const played = playedRange();
      const n = pages.length;
      const total = `${n} page${n === 1 ? '' : 's'}`;
      const rest = played ? n - played.count : 0;
      if (!played) $('gridInfo').textContent = total;
      else if (rest === 0) $('gridInfo').textContent = `${total} · all of them play in this event`;
      else if (played.count === 0) $('gridInfo').textContent = `${total} · none of them play: this deck's page range starts past the end`;
      else {
        const which = played.first === 1 ? `the first ${played.count}` : describePages(played);
        $('gridInfo').textContent = `${total} · this event plays ${which}; ${rest} more ${rest === 1 ? 'is' : 'are'} not played`;
      }
    }
    renderFind(); // match counts on the tiles
    markCurrentTiles();
    $('gridTiles').children[currentPage]?.scrollIntoView({ block: 'center' });
    $('gridView').focus();
  } else {
    layout(); // the page column was hidden, so its size could not be measured until now
    goToPage(currentPage); // and it lost its scroll position while hidden
    $('pages').focus();
  }
}

// ---------- editing pages ----------

function startEditing() {
  plan = initialPlan(pages.length);
  document.body.dataset.editing = '1';
  $('gridActions').hidden = true;
  $('editBar').hidden = false;
  const played = playedRange();
  $('editKeepPlayed').hidden = !(played && played.count > 0 && played.count < pages.length);
  renderEdit();
}

/** Leave edit mode without saving and show the ordinary grid again. */
function stopEditing() {
  plan = null;
  delete document.body.dataset.editing;
  $('editBar').hidden = true;
  gridBuilt = false;
  if (document.body.dataset.view === 'grid') setView('grid');
}

function editThumb(src) {
  if (!editThumbs.has(src)) editThumbs.set(src, thumbCanvas(src, GRID_WIDTH));
  return editThumbs.get(src);
}

function renderEdit(message, isError = false) {
  const kept = planToPages(plan).length;
  const status = $('editStatus');
  status.classList.toggle('error', isError || kept === 0);
  status.textContent = message || (kept === 0 ? 'A deck must keep at least one page.' : describePlan(plan));
  $('editSave').disabled = !isChanged(plan) || kept === 0;
  $('editReset').disabled = !isChanged(plan);
  document.body.dataset.editKept = String(kept);
  $('gridTiles').replaceChildren(...plan.map((entry, pos) => {
    const size = pages[entry.src].size;
    const tile = document.createElement('div');
    tile.className = `edit-tile${entry.removed ? ' removed' : ''}`;
    tile.draggable = true;
    tile.dataset.pos = String(pos);
    tile.dataset.src = String(entry.src);
    const box = document.createElement('div');
    box.className = 'thumb-box';
    const boxHeight = Math.round(GRID_WIDTH * size.height / size.width);
    box.style.width = `${GRID_WIDTH}px`;
    box.style.height = `${boxHeight}px`;
    editThumb(entry.src).then((canvas) => {
      if (!canvas || !tile.isConnected) return;
      // A sideways page is shrunk to fit the same box.
      const fit = entry.rotate % 180 ? Math.min(GRID_WIDTH / boxHeight, boxHeight / GRID_WIDTH) : 1;
      canvas.style.transform = entry.rotate ? `rotate(${entry.rotate}deg) scale(${fit})` : '';
      box.replaceChildren(canvas);
    });
    const label = document.createElement('span');
    label.className = 'edit-label';
    label.textContent = entry.removed ? `Page ${entry.src + 1} · removed` : `Page ${entry.src + 1}`;
    const tools = document.createElement('div');
    tools.className = 'edit-tools';
    const button = (cls, text, title, act) => {
      const b = document.createElement('button');
      b.className = `tool ${cls}`;
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', `${title} (page ${entry.src + 1})`);
      b.addEventListener('click', () => {
        plan = act();
        renderEdit();
      });
      tools.append(b);
      return b;
    };
    button('move-left', '←', 'Move earlier', () => movePage(plan, pos, pos - 1)).disabled = pos === 0;
    button('move-right', '→', 'Move later', () => movePage(plan, pos, pos + 1)).disabled = pos === plan.length - 1;
    button('rotate', '↻', 'Rotate a quarter turn', () => rotatePage(plan, pos));
    button('remove', entry.removed ? 'Keep' : '✕', entry.removed ? 'Keep this page after all' : 'Remove this page', () => toggleRemoved(plan, pos));
    tile.append(box, label, tools);

    tile.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-pk-page', String(pos));
      e.dataTransfer.effectAllowed = 'move';
      tile.classList.add('dragging');
    });
    tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
    tile.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-pk-page')) return;
      e.preventDefault();
      tile.classList.add('drop-target');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-target'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('application/x-pk-page'));
      if (Number.isInteger(from) && from !== pos) plan = movePage(plan, from, pos);
      renderEdit();
    });
    return tile;
  }));
}

async function saveEdits() {
  const list = planToPages(plan);
  if (!list.length || !isChanged(plan)) return;
  for (const id of ['editSave', 'editCancel', 'editReset', 'editKeepPlayed']) $(id).disabled = true;
  $('editStatus').classList.remove('error');
  $('editStatus').textContent = 'Saving…';
  try {
    await window.pk.applyPages(EVENT_ID, ITEM_ID, list);
    // The main process now reloads this window on the new file.
  } catch (err) {
    debug('reader', 'saving page edits failed', err);
    $('editCancel').disabled = false;
    renderEdit(`Could not save: ${err.message}`, true);
  }
}

async function restoreOriginal() {
  if (!window.confirm('Restore this deck as it was added?\n\nEvery page you removed, moved or rotated comes back.')) return;
  try {
    await window.pk.restorePages(EVENT_ID, ITEM_ID); // the window reloads on the original file
  } catch (err) {
    debug('reader', 'restoring the original failed', err);
    $('gridInfo').textContent = `Could not restore the original: ${err.message}`;
  }
}

function markCurrentTiles() {
  if (plan) { // in edit mode the grid's tiles are plan entries, not pages in order
    for (const el of $('thumbs').children) el.classList.toggle('current', Number(el.dataset.page) === currentPage);
    return;
  }
  for (const container of [$('thumbs'), $('gridTiles')]) {
    for (const el of container.children) el.classList.toggle('current', Number(el.dataset.page) === currentPage);
  }
}

async function drawThumb(index, box, width) {
  const canvas = await thumbCanvas(index, width);
  if (canvas) box.replaceChildren(canvas);
}

/** A small picture of one page, or null if it could not be drawn. */
async function thumbCanvas(index, width) {
  try {
    const page = await doc.getPage(index + 1);
    const density = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width / pages[index].size.width) * density });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${width}px`;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } catch (err) {
    debug('reader', `could not draw thumbnail ${index + 1}`, err);
    return null;
  }
}

// ---------- find ----------

async function loadTexts() {
  if (find.texts) return find.texts;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    try {
      const page = await doc.getPage(i);
      texts.push((await page.getTextContent()).items.map((it) => it.str || ''));
    } catch (err) {
      debug('reader', `could not read the text of page ${i}`, err);
      texts.push([]);
    }
  }
  find.texts = texts;
  return texts;
}

/** Highlight the query on one drawn page, and mark the current hit if it is on this page. */
function markPage(index) {
  const p = pages[index];
  if (!p?.textLayer || p.drawnAt === null) return;
  const current = find.index >= 0 ? find.hits[find.index] : null;
  let nth = 0;
  p.textLayer.textDivs.forEach((span, i) => {
    const text = p.textLayer.textContentItemsStr[i] ?? '';
    const ranges = matchRanges(text, find.query);
    if (!ranges.length) {
      if (span.firstElementChild) span.textContent = text; // remove marks from an earlier search
      return;
    }
    const parts = [];
    let at = 0;
    for (const [start, end] of ranges) {
      if (start > at) parts.push(text.slice(at, start));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(start, end);
      if (current && current.page === index && current.nth === nth) mark.className = 'current';
      parts.push(mark);
      nth += 1;
      at = end;
    }
    if (at < text.length) parts.push(text.slice(at));
    span.replaceChildren(...parts);
  });
}

function renderFind() {
  const count = $('findCount');
  const n = find.hits.length;
  count.classList.toggle('none', Boolean(find.query) && n === 0);
  count.textContent = !find.query ? '' : n === 0 ? 'No matches' : `${find.index + 1} of ${n}`;
  $('findPrev').disabled = n === 0;
  $('findNext').disabled = n === 0;
  document.body.dataset.findCount = String(n);
  for (const container of plan ? [$('thumbs')] : [$('thumbs'), $('gridTiles')]) {
    [...container.children].forEach((el, i) => {
      el.querySelector('.hits')?.remove();
      if (find.perPage[i]) {
        const tag = document.createElement('span');
        tag.className = 'hits';
        tag.textContent = `${find.perPage[i]} match${find.perPage[i] === 1 ? '' : 'es'}`;
        el.append(tag);
      }
    });
  }
  for (const i of visible) markPage(i);
}

async function runFind(raw) {
  const query = normalizeQuery(raw);
  const token = (find.token += 1);
  if (!query) {
    Object.assign(find, { query: '', hits: [], perPage: [], index: -1 });
    renderFind();
    return;
  }
  $('findCount').textContent = 'Searching…';
  const texts = await loadTexts();
  if (token !== find.token) return; // a newer search has started
  const { hits, perPage } = findInDocument(texts, query);
  // Start at the first match on or after the page being read.
  const from = hits.findIndex((h) => h.page >= currentPage);
  Object.assign(find, { query, hits, perPage, index: hits.length ? Math.max(0, from) : -1 });
  renderFind();
  showCurrentHit();
}

function showCurrentHit() {
  const hit = find.hits[find.index];
  if (!hit || plan) return;
  if (document.body.dataset.view === 'grid') { // in the grid, a match is shown by moving to its page's tile
    currentPage = hit.page;
    renderPageControl();
    $('gridTiles').children[hit.page]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const scroller = $('pages');
  const page = pages[hit.page].el;
  if (page.offsetTop < scroller.scrollTop || page.offsetTop + page.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
    goToPage(hit.page);
  }
  // Once the page is drawn, bring the exact match into view.
  let tries = 0;
  const reveal = () => {
    const mark = page.querySelector('mark.current');
    if (mark) mark.scrollIntoView({ block: 'center', inline: 'nearest' });
    else if ((tries += 1) < 40) setTimeout(reveal, 50);
  };
  reveal();
}

function stepFind(dir) {
  if (!find.hits.length) return;
  find.index = stepHit(find.index, find.hits.length, dir);
  renderFind();
  showCurrentHit();
}

// ---------- wiring ----------

function wire() {
  $('zoomSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    setZoom(v === FIT_WIDTH || v === FIT_PAGE ? v : Number(v));
    $('pages').focus();
  });
  $('zoomIn').addEventListener('click', () => setZoom(nextZoom(zoom, 1)));
  $('zoomOut').addEventListener('click', () => setZoom(nextZoom(zoom, -1)));
  $('prevPage').addEventListener('click', () => goToPage(currentPage - 1));
  $('nextPage').addEventListener('click', () => goToPage(currentPage + 1));
  $('pageInput').addEventListener('change', (e) => {
    const n = Number.parseInt(e.target.value, 10);
    if (Number.isInteger(n)) goToPage(n - 1);
    e.target.value = String(currentPage + 1);
    e.target.blur();
  });
  $('pageInput').addEventListener('focus', (e) => e.target.select());
  $('toggleGrid').addEventListener('click', () => setView(document.body.dataset.view === 'grid' ? 'pages' : 'grid'));
  $('editPages').addEventListener('click', startEditing);
  $('restorePages').addEventListener('click', restoreOriginal);
  $('editSave').addEventListener('click', saveEdits);
  $('editCancel').addEventListener('click', () => {
    if (isChanged(plan) && !window.confirm('Discard your page edits?')) return;
    stopEditing();
  });
  $('editReset').addEventListener('click', () => {
    plan = initialPlan(pages.length);
    renderEdit();
  });
  $('editKeepPlayed').addEventListener('click', () => {
    const played = playedRange();
    plan = keepOnly(plan, played.first, played.last);
    renderEdit();
  });
  $('toggleThumbs').addEventListener('click', () => {
    const show = $('thumbs').hidden;
    $('thumbs').hidden = !show;
    $('toggleThumbs').setAttribute('aria-pressed', String(show));
    layout(); // fit-to-width has more or less room now
  });
  $('findInput').addEventListener('input', (e) => {
    clearTimeout(find.timer);
    find.timer = setTimeout(() => runFind(e.target.value), FIND_DELAY_MS);
  });
  $('findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(find.timer);
      if (normalizeQuery(e.target.value) !== find.query) runFind(e.target.value);
      else stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.target.value = '';
      runFind('');
      $('pages').focus();
    }
  });
  $('findNext').addEventListener('click', () => stepFind(1));
  $('findPrev').addEventListener('click', () => stepFind(-1));

  let scrollQueued = false;
  $('pages').addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      updateCurrentPage();
    });
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (typeof zoomMode !== 'number' && document.body.dataset.view !== 'grid') layout();
    }, 120);
  });
  // Pinch on a trackpad, or Ctrl/Cmd + wheel, zooms.
  $('pages').addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(clampZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = e.target instanceof HTMLElement && e.target.matches('input, select');
    const grid = document.body.dataset.view === 'grid';
    if (plan) { // editing pages: Esc cancels; the reading shortcuts are off so a stray key cannot leave the screen
      if (e.key === 'Escape' && !typing) {
        e.preventDefault();
        $('editCancel').click();
      }
      return;
    }
    if (!typing && !mod && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      setView(grid ? 'pages' : 'grid');
    } else if (grid && !typing && (e.key === 'Escape' || e.key === 'Enter')) {
      e.preventDefault();
      setView('pages');
      goToPage(currentPage);
    } else if (grid && mod && ['=', '+', '-', '0'].includes(e.key)) {
      e.preventDefault(); // zoom belongs to the page view
    } else if (mod && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      $('findInput').focus();
      $('findInput').select();
    } else if (mod && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
    } else if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      setZoom(nextZoom(zoom, 1));
    } else if (mod && e.key === '-') {
      e.preventDefault();
      setZoom(nextZoom(zoom, -1));
    } else if (mod && e.key === '0') {
      e.preventDefault();
      setZoom(FIT_WIDTH);
    } else if (!typing && !mod && (e.key === 'ArrowRight' || e.key === 'PageDown')) {
      e.preventDefault();
      goToPage(currentPage + 1);
    } else if (!typing && !mod && (e.key === 'ArrowLeft' || e.key === 'PageUp')) {
      e.preventDefault();
      goToPage(currentPage - 1);
    } else if (!typing && !mod && e.key === 'Home') {
      e.preventDefault();
      goToPage(0);
    } else if (!typing && !mod && e.key === 'End') {
      e.preventDefault();
      goToPage(pages.length - 1);
    }
  });
}

async function init() {
  document.title = `${NAME} — PK Player Reader`;
  $('docName').textContent = NAME;
  $('docName').title = NAME;
  wire();
  if (!/^(library|external)\/[^/]+$/.test(SRC)) throw new Error('No document was given to the reader.');
  doc = await openPdfAt(`app://bundle/${SRC}`, NAME);
  $('pageCount').textContent = `/ ${doc.numPages}`;
  document.body.dataset.pages = String(doc.numPages);

  const container = $('pages');
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const v = page.getViewport({ scale: 1 });
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(i - 1);
    pages.push({ el, size: { width: v.width, height: v.height }, drawnAt: null, drawing: null, task: null, textLayer: null });
    container.append(el);
  }
  layout();
  buildThumbs();
  for (const p of pages) pageObserver.observe(p.el);
  renderPageControl();
  renderFind();
  $('readerStatus').hidden = true;
  document.body.dataset.view = 'pages';
  if (params.get('view') === 'grid') setView('grid'); // reopened after a page edit
  document.body.dataset.ready = '1';
  if (document.body.dataset.view !== 'grid') container.focus();
}

window.addEventListener('beforeunload', () => doc?.destroy());

init().catch((err) => fail(`Could not open this PDF: ${err.message}`, err));
