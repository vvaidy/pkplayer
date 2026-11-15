// Reader view helpers: zoom levels and text search. Pure functions, shared by
// the reader window and the unit tests.

/** PDF pages are measured in points (72 per inch); screens in CSS pixels (96 per inch). 100% zoom is this scale. */
export const POINT_TO_PIXEL = 96 / 72;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;
/** The stops used by the zoom buttons and menu, as fractions (1 = 100%). */
export const ZOOM_STEPS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
export const FIT_WIDTH = 'fit-width';
export const FIT_PAGE = 'fit-page';

export function clampZoom(zoom) {
  const z = typeof zoom === 'number' || (typeof zoom === 'string' && zoom.trim() !== '') ? Number(zoom) : NaN;
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** The next zoom stop above (dir > 0) or below (dir < 0) the current zoom. Stays put at either end. */
export function nextZoom(current, dir) {
  const z = clampZoom(current);
  const eps = 0.001;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + eps) ?? Math.max(z, ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  return [...ZOOM_STEPS].reverse().find((s) => s < z - eps) ?? Math.min(z, ZOOM_STEPS[0]);
}

/**
 * Zoom (1 = 100%) that fits a page into a box.
 * @param {string} mode FIT_WIDTH or FIT_PAGE
 * @param {{width: number, height: number}} page size in PDF points
 * @param {{width: number, height: number}} box space available in CSS pixels
 */
export function fitZoom(mode, page, box) {
  if (!(page?.width > 0) || !(page?.height > 0) || !(box?.width > 0) || !(box?.height > 0)) return 1;
  const byWidth = box.width / (page.width * POINT_TO_PIXEL);
  const byHeight = box.height / (page.height * POINT_TO_PIXEL);
  return clampZoom(mode === FIT_PAGE ? Math.min(byWidth, byHeight) : byWidth);
}

const fold = (s) => String(s ?? '').toLowerCase();

/** A search query ready to match: trimmed and lower-cased; "" means "no search". */
export function normalizeQuery(query) {
  return fold(query).trim();
}

/**
 * Where a query occurs in one piece of text, ignoring case.
 * @returns {Array<[number, number]>} [start, end) pairs, in order, never overlapping
 */
export function matchRanges(text, query) {
  const q = normalizeQuery(query);
  if (!q) return [];
  const hay = fold(text);
  const out = [];
  for (let at = hay.indexOf(q); at !== -1; at = hay.indexOf(q, at + q.length)) out.push([at, at + q.length]);
  return out;
}

/**
 * Search a whole document. Each page is the list of text runs pdf.js reports for it;
 * a match must sit inside one run (a phrase broken across two lines is not found).
 * @param {string[][]} pages text runs of each page, in reading order
 * @returns {{hits: Array<{page: number, nth: number}>, perPage: number[]}}
 *   hits in document order: `page` is 0-based, `nth` is the match's position among that page's matches
 */
export function findInDocument(pages, query) {
  const hits = [];
  const perPage = [];
  (pages || []).forEach((runs, page) => {
    let n = 0;
    for (const run of runs || []) n += matchRanges(run, query).length;
    perPage.push(n);
    for (let nth = 0; nth < n; nth += 1) hits.push({ page, nth });
  });
  return { hits, perPage };
}

/** Step through hits with wrap-around. Returns -1 when there are none. */
export function stepHit(index, count, dir) {
  if (!(count > 0)) return -1;
  if (index < 0 || index >= count) return dir < 0 ? count - 1 : 0;
  return (index + (dir < 0 ? -1 : 1) + count) % count;
}
