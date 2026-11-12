import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonShape, preflight, sameShape, shapeName } from '../../src/lib/preflight.js';

const W = 16 / 9;
const S = 4 / 3;
const texts = (map, id) => (map.get(id) || []).map((w) => w.text);

test('shapeName names common slide and paper shapes, landscape and portrait', () => {
  assert.equal(shapeName(1920 / 1080), '16:9');
  assert.equal(shapeName(1280 / 800), '16:10');
  assert.equal(shapeName(1024 / 768), '4:3');
  assert.equal(shapeName(842 / 595), 'A4');
  assert.equal(shapeName(792 / 612), 'Letter');
  assert.equal(shapeName(1), '1:1');
  assert.equal(shapeName(1080 / 1920), '9:16');
  assert.equal(shapeName(595 / 842), 'A4 portrait');
  assert.equal(shapeName(612 / 792), 'Letter portrait');
});

test('shapeName falls back to a ratio, and never throws on bad input', () => {
  assert.equal(shapeName(2.39), '2.39:1');
  assert.equal(shapeName(1 / 2.39), '1:2.39');
  for (const bad of [0, -1, NaN, Infinity, null, undefined, 'x']) assert.equal(shapeName(bad), 'unknown shape');
});

test('sameShape tolerates rounding but separates real slide shapes', () => {
  assert.ok(sameShape(W, 1279 / 720));
  assert.ok(sameShape(S, 792 / 612)); // Letter vs 4:3: bars too thin to matter
  assert.ok(!sameShape(W, 16 / 10));
  assert.ok(!sameShape(W, S));
  assert.ok(!sameShape(W, null));
  assert.ok(!sameShape(NaN, NaN));
});

test('commonShape needs a clear biggest group of at least two decks', () => {
  assert.equal(commonShape([]), null);
  assert.equal(commonShape([W]), null);
  assert.equal(commonShape([W, S]), null); // 1 + 1
  assert.equal(commonShape([W, W, S, S]), null); // 2 + 2
  assert.equal(commonShape([W, S, W]), W);
  assert.equal(commonShape([S, W, 1, S]), S); // 2 + 1 + 1
  assert.equal(commonShape([W, null, undefined, NaN, W]), W); // unknown shapes are ignored
  assert.equal(commonShape([null, null]), null);
});

test('preflight flags the deck whose shape differs from most', () => {
  const decks = [
    { id: 'a', pages: 20, aspect: W },
    { id: 'b', pages: 20, aspect: S },
    { id: 'c', pages: 20, aspect: W },
  ];
  const res = preflight(decks, { maxSlides: 20, expectFullDecks: true });
  assert.deepEqual([...res.keys()], ['b']);
  assert.deepEqual(res.get('b'), [{ kind: 'shape', text: '4:3, most are 16:9' }]);
});

test('preflight flags no shapes when there is no majority or a shape is still loading', () => {
  const two = [
    { id: 'a', pages: 20, aspect: W },
    { id: 'b', pages: 20, aspect: S },
  ];
  assert.equal(preflight(two, { maxSlides: 20, expectFullDecks: true }).size, 0);
  const loading = [
    { id: 'a', pages: 20, aspect: W },
    { id: 'b', pages: 20, aspect: W },
    { id: 'c', pages: null, aspect: null },
  ];
  assert.equal(preflight(loading, { maxSlides: 20, expectFullDecks: true }).size, 0);
});

test('preflight flags short decks only when full decks are expected', () => {
  const decks = [
    { id: 'a', pages: 17, aspect: W },
    { id: 'b', pages: 1, aspect: W },
    { id: 'c', pages: 20, aspect: W },
    { id: 'd', pages: 26, aspect: W }, // too long is reported elsewhere
    { id: 'e', pages: null, aspect: W },
    { id: 'f', pages: 0, aspect: W },
  ];
  const full = preflight(decks, { maxSlides: 20, expectFullDecks: true });
  assert.deepEqual([...full.keys()], ['a', 'b']);
  assert.deepEqual(texts(full, 'a'), ['only 17 slides']);
  assert.deepEqual(texts(full, 'b'), ['only 1 slide']);
  assert.equal(preflight(decks, { maxSlides: 20, expectFullDecks: false }).size, 0);
});

test('a deck can be both short and the odd shape', () => {
  const decks = [
    { id: 'a', pages: 20, aspect: W },
    { id: 'b', pages: 20, aspect: W },
    { id: 'c', pages: 12, aspect: S },
  ];
  const res = preflight(decks, { maxSlides: 20, expectFullDecks: true });
  assert.deepEqual(res.get('c').map((w) => w.kind), ['short', 'shape']);
});
