import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPEEDRUN_FACTOR, MIN_SPEEDRUN_SLIDE_SECONDS, SPEEDRUN_FACTORS, parseSpeedrun, speedrunDuration,
  speedrunReport, speedrunSlideSeconds,
} from '../../src/lib/speedrun.js';

test('only the fixed speeds are accepted: nothing slower than normal, nothing arbitrary', () => {
  assert.deepEqual([...SPEEDRUN_FACTORS], [5, 10, 20]);
  assert.ok(SPEEDRUN_FACTORS.includes(DEFAULT_SPEEDRUN_FACTOR));
  for (const ok of [5, 10, 20, '5', '10', ' 20 ']) assert.equal(parseSpeedrun(ok), Number(ok));
  for (const bad of [null, undefined, '', 0, 1, '1', 0.5, '0.5', 2, 7, 100, -10, '10x', 'fast', NaN, Infinity, true, {}, []]) {
    assert.equal(parseSpeedrun(bad), null, String(bad));
  }
  assert.ok(SPEEDRUN_FACTORS.every((f) => f > 1));
  assert.throws(() => { SPEEDRUN_FACTORS.push(1000); }); // the list cannot be extended at run time
});

test('slide time is divided by the speed, with a floor so every slide can be seen', () => {
  assert.equal(speedrunSlideSeconds(20, 10), 2);
  assert.equal(speedrunSlideSeconds(20, 5), 4);
  assert.equal(speedrunSlideSeconds(20, 20), 1);
  assert.equal(speedrunSlideSeconds(15, 10), 1.5);
  assert.equal(speedrunSlideSeconds(1, 20), MIN_SPEEDRUN_SLIDE_SECONDS);
  assert.equal(speedrunSlideSeconds(0.5, 5), MIN_SPEEDRUN_SLIDE_SECONDS);
});

test('duration estimate counts slides and one Play screen per deck', () => {
  assert.equal(speedrunDuration({ slides: 80, decks: 4, timePerSlide: 20, factor: 10 }), 164); // 80 x 2 s + 4 x 1 s
  assert.equal(speedrunDuration({ slides: 240, decks: 12, timePerSlide: 20, factor: 20 }), 252);
  assert.equal(speedrunDuration({ slides: 0, decks: 0, timePerSlide: 20, factor: 10 }), 0);
});

test('report: a clean run passes', () => {
  const r = speedrunReport({
    decks: [{ name: 'a.pdf', expected: 20, shown: 20, unreadable: false }, { name: 'b.pdf', expected: 20, shown: 20, unreadable: false }],
    problems: [],
  });
  assert.deepEqual(r, { ok: true, headline: 'Speedrun passed', summary: '2 of 2 decks opened · 40 of 40 slides drawn', lines: [] });
});

test('report: unreadable decks, failed slides and slow slides are each named', () => {
  const r = speedrunReport({
    decks: [
      { name: 'good.pdf', expected: 3, shown: 2, unreadable: false },
      { name: 'broken.pdf', expected: 0, shown: 0, unreadable: true },
      { name: 'slow.pdf', expected: 2, shown: 2, unreadable: false },
    ],
    problems: [{ deck: 0, slide: 2, reason: 'failed' }, { deck: 2, slide: 0, reason: 'slow' }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.headline, 'Speedrun finished with problems');
  assert.equal(r.summary, '2 of 3 decks opened · 4 of 5 slides drawn');
  assert.deepEqual(r.lines, [
    'Deck 2 “broken.pdf” could not be opened and would be skipped.',
    'Deck 1 “good.pdf”, slide 3 could not be drawn.',
    'Deck 3 “slow.pdf”, slide 1 took more than 10 seconds to draw.',
  ]);
});

test('report: skipping ahead is not called a pass', () => {
  const r = speedrunReport({ decks: [{ name: 'a.pdf', expected: 20, shown: 12, unreadable: false }], problems: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, ['8 slides were not shown because the run was skipped ahead or stopped early.']);
  const one = speedrunReport({ decks: [{ name: 'a.pdf', expected: 2, shown: 1, unreadable: false }], problems: [] });
  assert.deepEqual(one.lines, ['1 slide was not shown because the run was skipped ahead or stopped early.']);
  assert.equal(one.summary, '1 of 1 deck opened · 1 of 2 slides drawn');
});

test('report: an empty event does not crash', () => {
  const r = speedrunReport({ decks: [], problems: [] });
  assert.equal(r.summary, '0 of 0 decks opened · 0 of 0 slides drawn');
});
