// Page edits: a plan for rebuilding a deck's PDF with pages removed, reordered or rotated.
// The plan is built up in the reader and only becomes a file when the user saves.
// Pure functions, shared by the reader, the main process and the unit tests.

export const MAX_EDIT_PAGES = 2000;
const TURNS = [0, 90, 180, 270];

/**
 * A fresh plan for a PDF with `pageCount` pages: every page kept, in order, not rotated.
 * A plan is an array of entries { src, rotate, removed }: `src` is the page's 0-based index
 * in the original file, `rotate` is extra clockwise rotation in degrees (0, 90, 180, 270).
 */
export function initialPlan(pageCount) {
  const n = Number.isInteger(pageCount) && pageCount > 0 ? Math.min(pageCount, MAX_EDIT_PAGES) : 0;
  return Array.from({ length: n }, (_, src) => ({ src, rotate: 0, removed: false }));
}

const copy = (plan) => plan.map((e) => ({ ...e }));
const valid = (plan, index) => Number.isInteger(index) && index >= 0 && index < plan.length;

/** Move the entry at `from` so that it ends up at position `to`. Out-of-range moves change nothing. */
export function movePage(plan, from, to) {
  const next = copy(plan);
  if (!valid(plan, from) || !Number.isInteger(to)) return next;
  const target = Math.min(plan.length - 1, Math.max(0, to));
  const [entry] = next.splice(from, 1);
  next.splice(target, 0, entry);
  return next;
}

/** Turn a page a quarter turn clockwise (or counter-clockwise with dir < 0). */
export function rotatePage(plan, index, dir = 1) {
  const next = copy(plan);
  if (valid(plan, index)) next[index].rotate = (next[index].rotate + (dir < 0 ? 270 : 90)) % 360;
  return next;
}

/** Mark a page as removed, or bring a removed page back. */
export function toggleRemoved(plan, index) {
  const next = copy(plan);
  if (valid(plan, index)) next[index].removed = !next[index].removed;
  return next;
}

/**
 * Remove every page except the original pages `first` to `last` (1-based, inclusive).
 * Used for "keep only the pages that play". Pages already removed stay removed.
 */
export function keepOnly(plan, first, last) {
  return plan.map((e) => ({ ...e, removed: e.removed || e.src + 1 < first || e.src + 1 > last }));
}

/** True when saving the plan would produce a different file. */
export function isChanged(plan) {
  return plan.some((e, i) => e.removed || e.rotate !== 0 || e.src !== i);
}

/** The pages that would be written, in order: [{ page (1-based, in the original), rotate }]. */
export function planToPages(plan) {
  return plan.filter((e) => !e.removed).map((e) => ({ page: e.src + 1, rotate: e.rotate }));
}

/** A one-line description of what a plan changes, for the reader's status line. */
export function describePlan(plan) {
  const removed = plan.filter((e) => e.removed).length;
  const kept = plan.filter((e) => !e.removed);
  const rotated = kept.filter((e) => e.rotate !== 0).length;
  const reordered = kept.some((e, i) => i > 0 && e.src < kept[i - 1].src);
  const parts = [];
  if (removed) parts.push(`${removed} page${removed === 1 ? '' : 's'} removed`);
  if (rotated) parts.push(`${rotated} rotated`);
  if (reordered) parts.push('order changed');
  if (!parts.length) return 'No changes yet';
  return `${parts.join(', ')} · ${kept.length} page${kept.length === 1 ? '' : 's'} will remain`;
}

/**
 * Check a list of pages before a PDF is written from it. Used by the main process on
 * whatever a window sends, so nothing here trusts its input.
 * @param {unknown} pages expected [{ page, rotate }]
 * @param {number} pageCount pages in the source PDF
 * @returns {Array<{page: number, rotate: number}>} a clean copy
 * @throws {Error} with a message fit to show the user
 */
export function validatePages(pages, pageCount) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('A deck must keep at least one page.');
  if (pages.length > MAX_EDIT_PAGES) throw new Error(`A deck can have at most ${MAX_EDIT_PAGES} pages.`);
  return pages.map((p, i) => {
    const page = Number(p?.page);
    const rotate = Number(p?.rotate ?? 0);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Entry ${i + 1} names page ${p?.page}, but the PDF has pages 1 to ${pageCount}.`);
    }
    if (!TURNS.includes(rotate)) throw new Error(`Entry ${i + 1} has a rotation of ${p?.rotate}; only quarter turns are possible.`);
    return { page, rotate };
  });
}
