// Page range of a deck: which pages of the PDF an event plays.
// A deck may start after page 1 (to skip a title page) and stop before the last page.
// Pure functions, shared by the store, the editor, the player, the reader and the unit tests.

export const MAX_PAGE_NUMBER = 9999;

/**
 * Check a first/last page typed by the user or read from disk.
 * @returns {number|null} a whole number from 1 to MAX_PAGE_NUMBER, or null for "not set" (null, undefined, "")
 * @throws {RangeError} for anything else, with a message fit to show the user
 */
export function parsePageNumber(value, label = 'Page') {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_NUMBER) {
    throw new RangeError(`${label} must be a whole number from 1 to ${MAX_PAGE_NUMBER} (got "${value}")`);
  }
  return n;
}

/** True when the deck has a range set (it does not simply start at page 1 and run to the end). */
export function hasRange(item) {
  return Boolean(item) && (Number(item.firstPage) > 1 || Number.isInteger(item.lastPage));
}

/**
 * The pages a deck plays.
 * @param {{firstPage?: number|null, lastPage?: number|null}} item the playlist item
 * @param {number} pageCount pages in the PDF
 * @param {number} maxSlides the event's Max slides
 * @returns {{first: number, last: number, count: number, wanted: number, capped: boolean, empty: boolean}}
 *   first/last: 1-based pages actually played (last < first when nothing plays);
 *   count: how many pages play; wanted: pages in the chosen range before the Max slides cap;
 *   capped: the cap cut the range short; empty: the range lies entirely outside the PDF.
 */
export function playedPages(item, pageCount, maxSlides) {
  const pages = Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0;
  const max = Number.isFinite(maxSlides) ? Math.max(0, Math.floor(maxSlides)) : 0;
  const first = Number.isInteger(item?.firstPage) && item.firstPage >= 1 ? item.firstPage : 1;
  const end = Number.isInteger(item?.lastPage) && item.lastPage >= 1 ? Math.min(item.lastPage, pages) : pages;
  const wanted = Math.max(0, end - first + 1);
  const count = Math.min(wanted, max);
  return { first, last: first + count - 1, count, wanted, capped: wanted > max, empty: pages > 0 && wanted === 0 };
}

/** "pages 2–21", "page 5", or "" when nothing plays. For badges and labels. */
export function describePages(played) {
  if (!played || played.count <= 0) return '';
  return played.count === 1 ? `page ${played.first}` : `pages ${played.first}–${played.last}`;
}
