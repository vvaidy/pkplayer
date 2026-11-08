import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController, PHASE, slidesToPlay } from '../../src/lib/player-controller.js';

const make = (pageCounts, opts = {}) =>
  new PlayerController({ pageCounts, timePerSlide: 20, maxSlides: 20, ...opts });

test('slidesToPlay caps at page count and max slides', () => {
  assert.equal(slidesToPlay(5, 20), 5);
  assert.equal(slidesToPlay(30, 20), 20);
  assert.equal(slidesToPlay(20, 20), 20);
  assert.equal(slidesToPlay(0, 20), 0);
  assert.equal(slidesToPlay(null, 20), 0);
  assert.equal(slidesToPlay(NaN, 20), 0);
});

test('constructor validates input', () => {
  assert.throws(() => new PlayerController({ pageCounts: 'x', timePerSlide: 20, maxSlides: 20 }), TypeError);
  assert.throws(() => make([1], { timePerSlide: 0 }), RangeError);
  assert.throws(() => make([1], { maxSlides: 0 }), RangeError);
});

test('starts waiting on the first deck', () => {
  const c = make([3, 3]);
  assert.deepEqual(c.view(), { phase: PHASE.WAITING, deckIndex: 0, slideIndex: 0, slideCount: 3 });
  assert.equal(c.tick(1e9), false, 'time does not pass while waiting');
});

test('each slide shows for exactly timePerSlide, then the deck stops at the next deck', () => {
  const c = make([3, 2]);
  c.play(1000);
  assert.equal(c.tick(1000 + 19999), false);
  assert.equal(c.view().slideIndex, 0);
  assert.equal(c.tick(1000 + 20000), true);
  assert.equal(c.view().slideIndex, 1);
  c.tick(1000 + 40000);
  assert.equal(c.view().slideIndex, 2);
  c.tick(1000 + 59999);
  assert.equal(c.view().slideIndex, 2);
  c.tick(1000 + 60000);
  assert.deepEqual(c.view(), { phase: PHASE.WAITING, deckIndex: 1, slideIndex: 0, slideCount: 2 });
});

test('never shows more than maxSlides: extra pages are skipped', () => {
  const c = make([25, 4], { maxSlides: 20 });
  assert.equal(c.view().slideCount, 20);
  c.play(0);
  c.tick(19 * 20000);
  assert.equal(c.view().slideIndex, 19);
  c.tick(20 * 20000);
  assert.equal(c.view().deckIndex, 1);
  assert.equal(c.view().phase, PHASE.WAITING);
});

test('ends after the last deck', () => {
  const c = make([1]);
  c.play(0);
  c.tick(20000);
  assert.equal(c.view().phase, PHASE.ENDED);
  assert.equal(c.peekNext(), null);
  assert.equal(c.play(30000), false);
  assert.equal(c.nextDeck(), false);
});

test('deadline-based timing does not drift with late frames', () => {
  const c = make([5], { timePerSlide: 1 });
  c.play(0);
  c.tick(1016); // first frame noticed 16ms late
  assert.equal(c.view().slideIndex, 1);
  assert.equal(c.slideStart, 1000, 'next slide is scheduled from the deadline, not the late frame');
  c.tick(1999);
  assert.equal(c.view().slideIndex, 1);
  c.tick(2000);
  assert.equal(c.view().slideIndex, 2);
});

test('a long stall catches up through multiple slides', () => {
  const c = make([5], { timePerSlide: 1 });
  c.play(0);
  c.tick(3500);
  assert.equal(c.view().slideIndex, 3);
  assert.equal(c.progress(3500), 0.5);
});

test('pause freezes the clock and resume continues from the same point', () => {
  const c = make([3]);
  c.play(0);
  c.tick(5000);
  assert.equal(c.togglePause(5000), true);
  assert.equal(c.view().phase, PHASE.PAUSED);
  assert.equal(c.tick(100000), false);
  assert.equal(c.progress(100000), 0.25);
  c.togglePause(100000);
  assert.equal(c.view().phase, PHASE.PLAYING);
  c.tick(100000 + 14999);
  assert.equal(c.view().slideIndex, 0);
  c.tick(100000 + 15000);
  assert.equal(c.view().slideIndex, 1);
});

test('togglePause does nothing while waiting or ended', () => {
  const c = make([1]);
  assert.equal(c.togglePause(0), false);
  c.play(0);
  c.tick(20000);
  assert.equal(c.togglePause(20000), false);
});

test('nextSlide / prevSlide restart the slide timer', () => {
  const c = make([3, 1]);
  c.play(0);
  c.tick(15000);
  c.nextSlide(15000);
  assert.equal(c.view().slideIndex, 1);
  assert.equal(c.progress(15000), 0);
  c.tick(34999);
  assert.equal(c.view().slideIndex, 1);
  c.prevSlide(34999);
  assert.equal(c.view().slideIndex, 0);
  c.prevSlide(36000);
  assert.equal(c.view().slideIndex, 0, 'prev on first slide stays and restarts');
  assert.equal(c.progress(36000), 0);
});

test('nextSlide on the last slide moves to the next deck and waits', () => {
  const c = make([2, 3]);
  c.play(0);
  c.nextSlide(1);
  c.nextSlide(2);
  assert.deepEqual(c.view(), { phase: PHASE.WAITING, deckIndex: 1, slideIndex: 0, slideCount: 3 });
});

test('skipping while paused stays paused with a fresh timer', () => {
  const c = make([3]);
  c.play(0);
  c.togglePause(10000);
  c.nextSlide(50000);
  assert.equal(c.view().phase, PHASE.PAUSED);
  assert.equal(c.view().slideIndex, 1);
  assert.equal(c.progress(90000), 0);
  c.togglePause(90000);
  c.tick(90000 + 20000);
  assert.equal(c.view().slideIndex, 2);
});

test('arrow keys are ignored while waiting', () => {
  const c = make([3]);
  assert.equal(c.nextSlide(0), false);
  assert.equal(c.prevSlide(0), false);
});

test('nextDeck skips to the next deck from any state', () => {
  const c = make([3, 3, 3]);
  c.nextDeck();
  assert.equal(c.view().deckIndex, 1);
  c.play(0);
  c.tick(25000);
  c.nextDeck();
  assert.deepEqual(c.view(), { phase: PHASE.WAITING, deckIndex: 2, slideIndex: 0, slideCount: 3 });
  c.nextDeck();
  assert.equal(c.view().phase, PHASE.ENDED);
});

test('decks with zero playable pages are skipped', () => {
  const c = make([0, 2, 0, 0, 1]);
  assert.equal(c.view().deckIndex, 1);
  c.play(0);
  assert.deepEqual(c.peekNext(), { deckIndex: 1, slideIndex: 1 });
  c.tick(20000);
  assert.deepEqual(c.peekNext(), { deckIndex: 4, slideIndex: 0 });
  c.tick(40000);
  assert.equal(c.view().deckIndex, 4);
});

test('empty or all-unplayable playlist is ended immediately', () => {
  assert.equal(make([]).view().phase, PHASE.ENDED);
  assert.equal(make([0, 0]).view().phase, PHASE.ENDED);
});

test('startDeck starts at the given deck and is clamped', () => {
  assert.equal(make([1, 1, 1], { startDeck: 2 }).view().deckIndex, 2);
  assert.equal(make([1, 1], { startDeck: 9 }).view().phase, PHASE.ENDED);
  assert.equal(make([1, 1], { startDeck: -3 }).view().deckIndex, 0);
});
