import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIT_PAGE, FIT_WIDTH, POINT_TO_PIXEL, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, clampZoom, findInDocument, fitZoom,
  matchRanges, nextZoom, normalizeQuery, stepHit,
} from '../../src/lib/reader.js';

test('zoom is clamped and bad values fall back to 100%', () => {
  assert.equal(clampZoom(1.5), 1.5);
  assert.equal(clampZoom(0.01), ZOOM_MIN);
  assert.equal(clampZoom(99), ZOOM_MAX);
  for (const bad of [NaN, 'x', '', undefined, null, Infinity, {}]) assert.equal(clampZoom(bad), 1, String(bad));
  assert.equal(clampZoom('2'), 2);
});

test('zoom buttons move to the next stop and stop at the ends', () => {
  assert.equal(nextZoom(1, 1), 1.25);
  assert.equal(nextZoom(1, -1), 0.75);
  assert.equal(nextZoom(0.87, 1), 1); // from a fit-to-width value to the next round stop
  assert.equal(nextZoom(0.87, -1), 0.75);
  assert.equal(nextZoom(4, 1), 4);
  assert.equal(nextZoom(0.5, -1), 0.5);
  assert.equal(nextZoom(0.3, -1), 0.3); // already below the lowest stop: stay
  assert.equal(nextZoom(4.5, 1), 4.5);
  assert.ok(ZOOM_STEPS.includes(1));
});

test('fit to width and fit to page', () => {
  const page = { width: 960, height: 540 }; // points; 1280 x 720 px at 100%
  assert.equal(fitZoom(FIT_WIDTH, page, { width: 1280, height: 400 }), 1);
  assert.equal(fitZoom(FIT_WIDTH, page, { width: 640, height: 4000 }), 0.5);
  assert.equal(fitZoom(FIT_PAGE, page, { width: 1280, height: 360 }), 0.5); // height is the limit
  assert.equal(fitZoom(FIT_PAGE, page, { width: 640, height: 4000 }), 0.5); // width is the limit
  assert.equal(fitZoom(FIT_WIDTH, page, { width: 1e6, height: 1e6 }), ZOOM_MAX);
  for (const bad of [[null, { width: 1, height: 1 }], [page, null], [{ width: 0, height: 5 }, { width: 5, height: 5 }], [page, { width: 0, height: 0 }]]) {
    assert.equal(fitZoom(FIT_WIDTH, bad[0], bad[1]), 1);
  }
  assert.equal(Math.round(POINT_TO_PIXEL * 72), 96);
});

test('search ignores case and surrounding spaces, and an empty query finds nothing', () => {
  assert.equal(normalizeQuery('  Night Trains '), 'night trains');
  assert.deepEqual(matchRanges('Night trains and night TRAINS', 'night trains'), [[0, 12], [17, 29]]);
  assert.deepEqual(matchRanges('aaaa', 'aa'), [[0, 2], [2, 4]]); // matches never overlap
  assert.deepEqual(matchRanges('anything', ''), []);
  assert.deepEqual(matchRanges('anything', '   '), []);
  assert.deepEqual(matchRanges('', 'x'), []);
  assert.deepEqual(matchRanges(null, 'x'), []);
  assert.deepEqual(matchRanges('Zoë Müller', 'MÜLLER'), [[4, 10]]);
});

test('findInDocument lists hits in order with their position on the page', () => {
  const pages = [['slide 1 of 3', 'alpha'], [], ['slide 3 of 3', 'see slide 1 and slide 2']];
  const r = findInDocument(pages, 'slide');
  assert.deepEqual(r.perPage, [1, 0, 3]);
  assert.deepEqual(r.hits, [{ page: 0, nth: 0 }, { page: 2, nth: 0 }, { page: 2, nth: 1 }, { page: 2, nth: 2 }]);
  assert.deepEqual(findInDocument(pages, 'zebra'), { hits: [], perPage: [0, 0, 0] });
  assert.deepEqual(findInDocument(pages, ''), { hits: [], perPage: [0, 0, 0] });
  assert.deepEqual(findInDocument([], 'x'), { hits: [], perPage: [] });
  assert.deepEqual(findInDocument([null, ['x']], 'x').perPage, [0, 1]);
});

test('stepping through hits wraps around', () => {
  assert.equal(stepHit(-1, 3, 1), 0);
  assert.equal(stepHit(-1, 3, -1), 2);
  assert.equal(stepHit(0, 3, 1), 1);
  assert.equal(stepHit(2, 3, 1), 0);
  assert.equal(stepHit(0, 3, -1), 2);
  assert.equal(stepHit(0, 0, 1), -1);
  assert.equal(stepHit(5, 3, 1), 0);
});
