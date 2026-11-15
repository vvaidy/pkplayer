// Reader window: read one PDF in a normal window. All pages in a scrolling column,
// zoom, page thumbnails, selectable text and text search. Read-only: it never changes the file.
import { debug } from '../lib/debug.js';
import {
  FIT_PAGE, FIT_WIDTH, POINT_TO_PIXEL, ZOOM_STEPS, clampZoom, findInDocument, fitZoom, matchRanges, nextZoom,
  normalizeQuery, stepHit,
} from '../lib/reader.js';
import { TextLayer, openPdfAt } from './pdf.js';

// ---------- reader parameters ----------
const RENDER_MARGIN = '700px 0px'; // draw pages a little before they scroll into view
const MAX_CANVAS_PIXELS = 24e6; // above this a page is drawn at lower density instead of exhausting memory
const THUMB_WIDTH = 132;
const PAGE_GUTTER = 36; // space left and right of a page at fit-to-width
const FIND_DELAY_MS = 220;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const SRC = params.get('src') || '';
const NAME = params.get('name') || 'PDF';

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
  for (const el of $('thumbs').children) el.classList.toggle('current', Number(el.dataset.page) === currentPage);
  const cur = $('thumbs').children[currentPage];
  if (cur && !$('thumbs').hidden) cur.scrollIntoView({ block: 'nearest' });
}

function goToPage(index, { top = true } = {}) {
  const i = Math.min(pages.length - 1, Math.max(0, index));
  const scroller = $('pages');
  if (top) scroller.scrollTop = pages[i].el.offsetTop - 12;
  currentPage = i;
  renderPageControl();
}

// ---------- thumbnails ----------

function buildThumbs() {
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      drawThumb(Number(e.target.dataset.page), e.target.querySelector('.thumb-box'));
    }
  }, { root: $('thumbs'), rootMargin: '300px 0px' });
  $('thumbs').replaceChildren(...pages.map((p, i) => {
    const item = document.createElement('button');
    item.className = 'thumb-item';
    item.dataset.page = String(i);
    item.title = `Go to page ${i + 1}`;
    const box = document.createElement('div');
    box.className = 'thumb-box';
    box.style.width = `${THUMB_WIDTH}px`;
    box.style.height = `${Math.round(THUMB_WIDTH * p.size.height / p.size.width)}px`;
    const label = document.createElement('span');
    label.className = 'thumb-label';
    label.textContent = String(i + 1);
    item.append(box, label);
    item.addEventListener('click', () => goToPage(i));
    observer.observe(item);
    return item;
  }));
}

async function drawThumb(index, box) {
  try {
    const page = await doc.getPage(index + 1);
    const density = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (THUMB_WIDTH / pages[index].size.width) * density });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${THUMB_WIDTH}px`;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    box.replaceChildren(canvas);
  } catch (err) {
    debug('reader', `could not draw thumbnail ${index + 1}`, err);
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
  [...$('thumbs').children].forEach((el, i) => {
    el.querySelector('.hits')?.remove();
    if (find.perPage[i]) {
      const tag = document.createElement('span');
      tag.className = 'hits';
      tag.textContent = `${find.perPage[i]} match${find.perPage[i] === 1 ? '' : 'es'}`;
      el.append(tag);
    }
  });
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
  if (!hit) return;
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
      if (typeof zoomMode !== 'number') layout();
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
    if (mod && (e.key === 'f' || e.key === 'F')) {
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
  document.body.dataset.ready = '1';
  container.focus();
}

window.addEventListener('beforeunload', () => doc?.destroy());

init().catch((err) => fail(`Could not open this PDF: ${err.message}`, err));
