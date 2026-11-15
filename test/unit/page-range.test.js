import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PAGE_NUMBER, describePages, hasRange, parsePageNumber, playedPages } from '../../src/lib/page-range.js';

test('parsePageNumber: blank means not set, whole numbers pass, everything else is refused', () => {
  for (const blank of [null, undefined, '', '   ']) assert.equal(parsePageNumber(blank), null);
  assert.equal(parsePageNumber(3), 3);
  assert.equal(parsePageNumber(' 21 '), 21);
  assert.equal(parsePageNumber(MAX_PAGE_NUMBER), MAX_PAGE_NUMBER);
  for (const bad of [0, -1, 2.5, '2.5', 'two', MAX_PAGE_NUMBER + 1, NaN, Infinity, true, {}, []]) {
    assert.throws(() => parsePageNumber(bad, 'First page'), /First page must be a whole number/, String(bad));
  }
});

test('with no range a deck plays from page 1, capped by Max slides, exactly as before', () => {
  assert.deepEqual(playedPages({}, 20, 20), { first: 1, last: 20, count: 20, wanted: 20, capped: false, empty: false });
  assert.deepEqual(playedPages({ firstPage: null, lastPage: null }, 26, 20), { first: 1, last: 20, count: 20, wanted: 26, capped: true, empty: false });
  assert.deepEqual(playedPages(undefined, 3, 20), { first: 1, last: 3, count: 3, wanted: 3, capped: false, empty: false });
  assert.equal(playedPages({}, 0, 20).count, 0);
  assert.equal(playedPages({}, 0, 20).empty, false); // an unreadable PDF is a different problem
});

test('a first page skips the start; Max slides still caps the length', () => {
  assert.deepEqual(playedPages({ firstPage: 2 }, 21, 20), { first: 2, last: 21, count: 20, wanted: 20, capped: false, empty: false });
  assert.deepEqual(playedPages({ firstPage: 2 }, 26, 20), { first: 2, last: 21, count: 20, wanted: 25, capped: true, empty: false });
  assert.deepEqual(playedPages({ firstPage: 5 }, 8, 20), { first: 5, last: 8, count: 4, wanted: 4, capped: false, empty: false });
});

test('a last page stops early; one beyond the end of the PDF means "to the end"', () => {
  assert.deepEqual(playedPages({ lastPage: 15 }, 20, 20), { first: 1, last: 15, count: 15, wanted: 15, capped: false, empty: false });
  assert.deepEqual(playedPages({ firstPage: 2, lastPage: 15 }, 20, 20), { first: 2, last: 15, count: 14, wanted: 14, capped: false, empty: false });
  assert.deepEqual(playedPages({ firstPage: 2, lastPage: 99 }, 20, 20), { first: 2, last: 20, count: 19, wanted: 19, capped: false, empty: false });
  assert.deepEqual(playedPages({ firstPage: 3, lastPage: 3 }, 20, 20), { first: 3, last: 3, count: 1, wanted: 1, capped: false, empty: false });
  assert.deepEqual(playedPages({ firstPage: 2, lastPage: 40 }, 30, 5), { first: 2, last: 6, count: 5, wanted: 29, capped: true, empty: false });
});

test('a range entirely outside the PDF plays nothing and says so', () => {
  const r = playedPages({ firstPage: 30 }, 26, 20);
  assert.deepEqual([r.count, r.wanted, r.empty], [0, 0, true]);
  assert.ok(r.last < r.first);
  assert.equal(playedPages({ firstPage: 9, lastPage: 4 }, 20, 20).empty, true); // a backwards range from an old file
});

test('odd inputs never throw and never produce negative counts', () => {
  for (const item of [{ firstPage: 0 }, { firstPage: -3 }, { firstPage: 2.5 }, { firstPage: 'x', lastPage: 'y' }, { lastPage: 0 }]) {
    const r = playedPages(item, 10, 20);
    assert.deepEqual([r.first, r.count], [1, 10], JSON.stringify(item));
  }
  for (const [pages, max] of [[NaN, 20], [10, NaN], [undefined, undefined], [-5, 20], [10, -1]]) {
    assert.equal(playedPages({ firstPage: 2 }, pages, max).count, 0);
  }
});

test('hasRange and describePages', () => {
  assert.equal(hasRange({}), false);
  assert.equal(hasRange({ firstPage: 1, lastPage: null }), false);
  assert.equal(hasRange({ firstPage: 2 }), true);
  assert.equal(hasRange({ lastPage: 15 }), true);
  assert.equal(hasRange(null), false);
  assert.equal(describePages(playedPages({ firstPage: 2 }, 26, 20)), 'pages 2–21');
  assert.equal(describePages(playedPages({ firstPage: 3, lastPage: 3 }, 20, 20)), 'page 3');
  assert.equal(describePages(playedPages({ firstPage: 30 }, 26, 20)), '');
  assert.equal(describePages(null), '');
});
