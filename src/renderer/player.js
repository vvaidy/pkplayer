// Fullscreen player: shows each deck behind a big Play button, then advances
// every `timePerSlide` seconds with a discreet progress bar.
import { debug } from '../lib/debug.js';
import { PHASE, PlayerController } from '../lib/player-controller.js';
import { deckLabel } from '../lib/deck-label.js';
import {
  SPEEDRUN_DRAW_TIMEOUT_MS, SPEEDRUN_PLAY_SCREEN_MS, parseSpeedrun, speedrunReport, speedrunSlideSeconds,
} from '../lib/speedrun.js';
import { openPdf, renderPage } from './pdf.js';

const pk = window.pk;
const $ = (id) => document.getElementById(id);
const CURSOR_IDLE_MS = 2000;
const FLASH_MS = 700;

const params = new URLSearchParams(location.search);
const EVENT_ID = params.get('event');
const START_ITEM_ID = params.get('start');
/**
 * Speedrun test: 5, 10 or 20 when this window was opened for one, otherwise null.
 * It comes only from this window's URL and is never saved, so a normal run is always null.
 * Every speedrun-only line below is behind `if (SPEEDRUN)`.
 */
const SPEEDRUN = parseSpeedrun(params.get('speedrun'));

let ev = null;
let docs = [];
let controller = null;
let lastDeckReported = null;
/** "deck:slide" -> Promise<HTMLCanvasElement|null> */
const slideCache = new Map();

const slideKey = (d, s) => `${d}:${s}`;

// ---------- clock ----------
// In a normal run this is exactly performance.now(). In a speedrun the clock stops while the
// current slide is still being drawn, so a slow page gets its full time on screen and cannot
// slip past unseen.
let heldMs = 0;
const clock = () => performance.now() - heldMs;

/** Speedrun bookkeeping: which slides were drawn, and which could not be. */
const run = { shown: new Set(), problems: new Map(), holdKey: null, holdStart: 0, autoStartDeck: null, autoStartTimer: null };

// ---------- rendering ----------

function getSlide(d, s) {
  const k = slideKey(d, s);
  if (!slideCache.has(k)) {
    const doc = docs[d];
    const p = doc
      ? renderPage(doc, s + 1, window.innerWidth, window.innerHeight).catch((err) => {
        debug('player', `render failed deck ${d} slide ${s + 1}`, err);
        return null;
      })
      : Promise.resolve(null);
    slideCache.set(k, p);
  }
  return slideCache.get(k);
}

function pruneCache(keep) {
  for (const k of slideCache.keys()) if (!keep.has(k)) slideCache.delete(k);
}

async function showCurrent() {
  const v = controller.view();
  if (v.phase === PHASE.ENDED) return;
  const want = slideKey(v.deckIndex, v.slideIndex);
  const next = controller.peekNext();
  const keep = new Set([want]);
  if (v.slideIndex > 0) keep.add(slideKey(v.deckIndex, v.slideIndex - 1));
  if (next) keep.add(slideKey(next.deckIndex, next.slideIndex));
  pruneCache(keep);

  const canvas = await getSlide(v.deckIndex, v.slideIndex);
  const now = controller.view();
  if (slideKey(now.deckIndex, now.slideIndex) !== want || now.phase === PHASE.ENDED) return; // moved on meanwhile
  if (canvas) {
    $('stage').replaceChildren(canvas);
    if (SPEEDRUN) run.shown.add(want);
  } else {
    if (SPEEDRUN) run.problems.set(want, 'failed');
    const err = document.createElement('div');
    err.className = 'hint';
    err.textContent = `Could not render slide ${v.slideIndex + 1}`;
    $('stage').replaceChildren(err);
  }
  document.body.dataset.shown = want;
  // Pre-render the next slide so advancing is instant.
  if (next) getSlide(next.deckIndex, next.slideIndex);
}

// ---------- UI state ----------

function updateUi() {
  const v = controller.view();
  const body = document.body;
  body.dataset.phase = v.phase;
  body.dataset.deck = String(v.deckIndex);
  body.dataset.slide = String(v.slideIndex);
  body.classList.toggle('paused', v.phase === PHASE.PAUSED);

  const active = v.phase === PHASE.PLAYING || v.phase === PHASE.PAUSED;
  $('waiting').hidden = v.phase !== PHASE.WAITING;
  $('ended').hidden = v.phase !== PHASE.ENDED;
  $('progress').hidden = !active;
  $('counter').hidden = !active;
  $('pauseBadge').hidden = v.phase !== PHASE.PAUSED;

  if (v.phase === PHASE.WAITING) {
    const it = ev.items[v.deckIndex];
    const label = deckLabel(it, v.deckIndex, ev.items.length, v.slideCount);
    $('deckPresenter').textContent = label.presenter;
    $('deckPresenter').hidden = !label.presenter;
    $('deckTitle').textContent = label.title;
    $('deckTitle').hidden = !label.title;
    $('deckLabel').textContent = label.meta;
    $('bigPlay').focus();
  }
  if (active) $('counter').textContent = `${v.slideIndex + 1} / ${v.slideCount}`;

  if (SPEEDRUN) updateSpeedrun(v);

  const itemId = v.phase === PHASE.ENDED ? null : ev.items[v.deckIndex]?.id ?? null;
  if (itemId !== lastDeckReported) {
    lastDeckReported = itemId;
    pk.reportPosition(itemId).catch((err) => debug('player', 'report position failed', err));
  }
}

/** Speedrun only: start each deck by itself after a short look at its Play screen, and report at the end. */
function updateSpeedrun(v) {
  if (v.phase === PHASE.WAITING && run.autoStartDeck !== v.deckIndex) {
    run.autoStartDeck = v.deckIndex;
    clearTimeout(run.autoStartTimer);
    run.autoStartTimer = setTimeout(() => {
      const cur = controller.view();
      if (cur.phase === PHASE.WAITING && cur.deckIndex === v.deckIndex) startDeck();
    }, SPEEDRUN_PLAY_SCREEN_MS);
  }
  if (v.phase === PHASE.ENDED && !document.body.dataset.speedrunDone) {
    const decks = ev.items.map((it, d) => ({
      name: it.name,
      expected: controller.slideCounts[d],
      shown: [...run.shown].filter((k) => k.startsWith(`${d}:`)).length,
      unreadable: !docs[d],
    }));
    const problems = [...run.problems].map(([key, reason]) => {
      const [deck, slide] = key.split(':').map(Number);
      return { deck, slide, reason };
    }).sort((a, b) => a.deck - b.deck || a.slide - b.slide);
    const report = speedrunReport({ decks, problems });
    debug('player', `speedrun ${SPEEDRUN}x: ${report.headline} — ${report.summary}`);
    document.querySelector('.ended-title').textContent = report.headline;
    $('speedReportSummary').textContent = report.summary;
    $('speedReportLines').replaceChildren(...report.lines.slice(0, 12).map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
    if (report.lines.length > 12) {
      const more = document.createElement('li');
      more.textContent = `…and ${report.lines.length - 12} more.`;
      $('speedReportLines').append(more);
    }
    $('speedReport').hidden = false;
    document.body.dataset.speedrunDone = report.ok ? 'ok' : 'problems';
  }
}

function onStateChange() {
  updateUi();
  showCurrent();
}

function updateProgress(now) {
  $('progressFill').style.transform = `scaleX(${controller.progress(now)})`;
}

/** Speedrun only: stop the clock while the slide that should be on screen is still being drawn. */
function holdForDrawing(real, sinceLastFrame) {
  const v = controller.view();
  const key = slideKey(v.deckIndex, v.slideIndex);
  if (v.phase !== PHASE.PLAYING || document.body.dataset.shown === key) {
    run.holdKey = null;
    return;
  }
  if (run.holdKey !== key) {
    run.holdKey = key;
    run.holdStart = real;
  }
  if (real - run.holdStart > SPEEDRUN_DRAW_TIMEOUT_MS) {
    run.problems.set(key, 'slow'); // give up waiting: report it and let the run carry on
    return;
  }
  heldMs += sinceLastFrame;
}

let lastFrame = performance.now();
function loop() {
  const real = performance.now();
  if (SPEEDRUN) holdForDrawing(real, real - lastFrame);
  lastFrame = real;
  const now = clock();
  if (controller.tick(now)) onStateChange();
  updateProgress(now);
  requestAnimationFrame(loop);
}

let flashTimer;
function flash(text) {
  const el = $('flash');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.hidden = true;
  }, FLASH_MS);
}

function hideFlash() {
  clearTimeout(flashTimer);
  $('flash').hidden = true;
}

// ---------- input ----------

function exitPlayer() {
  pk.closePlayer().catch((err) => {
    debug('player', 'close failed', err);
    window.close();
  });
}

function startDeck() {
  if (controller.play(clock())) onStateChange();
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey) return; // leave system shortcuts alone
  const now = clock();
  const k = e.key;
  if (k === 'Escape' || k === 'x' || k === 'X' || k === 'Delete' || k === 'Backspace') {
    e.preventDefault();
    exitPlayer();
    return;
  }
  if (k === 'f' || k === 'F') {
    e.preventDefault();
    pk.enterFullscreen().catch((err) => debug('player', 'fullscreen failed', err));
    return;
  }
  if (!controller) return;
  const phase = controller.view().phase;
  if (k === ' ' || k === 'Spacebar') {
    e.preventDefault();
    if (e.repeat) return;
    if (phase === PHASE.WAITING) startDeck();
    else if (controller.togglePause(now)) {
      flash(controller.view().phase === PHASE.PAUSED ? 'Paused' : 'Resumed');
      onStateChange();
    }
  } else if (k === 'Enter') {
    e.preventDefault();
    if (phase === PHASE.WAITING) startDeck();
  } else if (k === 'ArrowRight') {
    e.preventDefault();
    if (controller.nextSlide(now)) onStateChange();
  } else if (k === 'ArrowLeft') {
    e.preventDefault();
    if (controller.prevSlide(now)) onStateChange();
  } else if (k === 'n' || k === 'N') {
    e.preventDefault();
    if (e.repeat) return;
    if (controller.nextDeck()) {
      if (controller.view().phase !== PHASE.ENDED) flash('Next PDF ⏭');
      else hideFlash(); // "End of event" speaks for itself; drop any flash from an earlier press
      onStateChange();
    }
  }
}

function setupCursorHiding() {
  let t;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(t);
    t = setTimeout(() => document.body.classList.add('idle'), CURSOR_IDLE_MS);
  };
  window.addEventListener('mousemove', wake);
  wake();
}

function setupResize() {
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!controller) return;
      slideCache.clear();
      showCurrent();
    }, 150);
  });
}

// ---------- startup ----------

async function init() {
  window.addEventListener('keydown', onKey);
  $('bigPlay').addEventListener('click', startDeck);
  setupCursorHiding();
  setupResize();

  ev = await pk.getEvent(EVENT_ID);
  if (ev.practice) document.querySelector('.ended-title').textContent = 'End of practice';
  $('loadingText').textContent = `Loading ${ev.items.length} PDF${ev.items.length === 1 ? '' : 's'}…`;
  const results = await Promise.allSettled(ev.items.map((it) => openPdf(it.file)));
  docs = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  const pageCounts = docs.map((d) => (d ? d.numPages : 0));

  const failed = ev.items.filter((_, i) => !docs[i]);
  if (failed.length) debug('player', `skipping unreadable PDFs: ${failed.map((f) => f.name).join(', ')}`, new Error('unreadable PDF'));
  ev.items.forEach((it, i) => {
    if (docs[i] && it.pageCount !== pageCounts[i]) {
      pk.setPageCount(ev.id, it.id, pageCounts[i]).catch((err) => debug('player', 'save page count failed', err));
    }
  });

  const startDeckIndex = Math.max(0, ev.items.findIndex((it) => it.id === START_ITEM_ID));
  if (SPEEDRUN) {
    document.body.dataset.speedrun = String(SPEEDRUN);
    document.title = 'PK Player — Presenting (speed test)';
    $('speedBanner').textContent = `SPEED TEST ${SPEEDRUN}× — not a real run`;
    $('speedBanner').hidden = false;
  }
  controller = new PlayerController({
    pageCounts,
    timePerSlide: SPEEDRUN ? speedrunSlideSeconds(ev.timePerSlide, SPEEDRUN) : ev.timePerSlide,
    maxSlides: ev.maxSlides,
    startDeck: startDeckIndex,
  });
  debug('player', `ready: ${pageCounts.length} decks, ${ev.timePerSlide}s/slide, max ${ev.maxSlides}`);

  await showCurrent();
  updateUi();
  $('loading').hidden = true;
  if (failed.length) flash(`Skipping ${failed.length} unreadable PDF${failed.length === 1 ? '' : 's'}`);
  requestAnimationFrame(loop);
}

window.addEventListener('beforeunload', () => {
  for (const d of docs) d?.destroy();
});

init().catch((err) => {
  debug('player', 'startup failed', err);
  $('loadingText').textContent = `Could not start: ${err.message} — press Esc`;
  document.querySelector('#loading .spinner')?.remove();
});
