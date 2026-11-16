import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describePlan, initialPlan, isChanged, keepOnly, movePage, planToPages, rotatePage, toggleRemoved, validatePages,
} from '../../src/lib/page-edit.js';

const srcs = (plan) => plan.map((e) => e.src);

test('a fresh plan keeps every page in order and changes nothing', () => {
  const plan = initialPlan(3);
  assert.deepEqual(plan, [{ src: 0, rotate: 0, removed: false }, { src: 1, rotate: 0, removed: false }, { src: 2, rotate: 0, removed: false }]);
  assert.equal(isChanged(plan), false);
  assert.equal(describePlan(plan), 'No changes yet');
  assert.deepEqual(planToPages(plan), [{ page: 1, rotate: 0 }, { page: 2, rotate: 0 }, { page: 3, rotate: 0 }]);
  for (const bad of [0, -1, 2.5, NaN, null, 'x']) assert.deepEqual(initialPlan(bad), []);
});

test('every edit returns a new plan and leaves the old one alone', () => {
  const plan = initialPlan(3);
  const frozen = JSON.stringify(plan);
  movePage(plan, 0, 2);
  rotatePage(plan, 1);
  toggleRemoved(plan, 2);
  keepOnly(plan, 2, 2);
  assert.equal(JSON.stringify(plan), frozen);
});

test('movePage reorders, clamps the target, and ignores nonsense', () => {
  const plan = initialPlan(5);
  assert.deepEqual(srcs(movePage(plan, 4, 0)), [4, 0, 1, 2, 3]);
  assert.deepEqual(srcs(movePage(plan, 0, 2)), [1, 2, 0, 3, 4]);
  assert.deepEqual(srcs(movePage(plan, 1, 99)), [0, 2, 3, 4, 1]);
  assert.deepEqual(srcs(movePage(plan, 1, -5)), [1, 0, 2, 3, 4]);
  for (const [from, to] of [[9, 0], [-1, 0], [1.5, 0], [0, 'x']]) assert.deepEqual(srcs(movePage(plan, from, to)), [0, 1, 2, 3, 4]);
  assert.equal(isChanged(movePage(plan, 4, 0)), true);
});

test('rotatePage turns in quarter turns and comes back round', () => {
  let plan = initialPlan(2);
  plan = rotatePage(plan, 0);
  assert.equal(plan[0].rotate, 90);
  plan = rotatePage(rotatePage(rotatePage(plan, 0), 0), 0);
  assert.equal(plan[0].rotate, 0);
  assert.equal(isChanged(plan), false);
  assert.equal(rotatePage(initialPlan(2), 1, -1)[1].rotate, 270);
  assert.deepEqual(rotatePage(initialPlan(2), 7), initialPlan(2));
});

test('toggleRemoved removes and restores; removed pages are not written', () => {
  let plan = toggleRemoved(initialPlan(3), 1);
  assert.deepEqual(planToPages(plan), [{ page: 1, rotate: 0 }, { page: 3, rotate: 0 }]);
  assert.equal(describePlan(plan), '1 page removed · 2 pages will remain');
  plan = toggleRemoved(plan, 1);
  assert.equal(isChanged(plan), false);
});

test('keepOnly keeps a range of ORIGINAL pages even after reordering', () => {
  const plan = movePage(initialPlan(6), 5, 0); // original page 6 moved to the front
  const kept = keepOnly(plan, 2, 4);
  assert.deepEqual(planToPages(kept).map((p) => p.page), [2, 3, 4]);
  // A page removed by hand stays removed.
  assert.deepEqual(planToPages(keepOnly(toggleRemoved(initialPlan(5), 1), 1, 3)).map((p) => p.page), [1, 3]);
});

test('describePlan names each kind of change', () => {
  let plan = initialPlan(5);
  plan = toggleRemoved(toggleRemoved(plan, 0), 1);
  plan = rotatePage(plan, 2);
  plan = movePage(plan, 4, 2);
  assert.equal(describePlan(plan), '2 pages removed, 1 rotated, order changed · 3 pages will remain');
  assert.equal(describePlan(toggleRemoved(initialPlan(1), 0)), '1 page removed · 0 pages will remain');
  // Rotating a page that is then removed is not counted as a rotation.
  assert.equal(describePlan(toggleRemoved(rotatePage(initialPlan(2), 0), 0)), '1 page removed · 1 page will remain');
});

test('validatePages accepts a sound list and returns a clean copy', () => {
  const input = [{ page: 3, rotate: 90, junk: true }, { page: 1 }, { page: '2', rotate: '180' }];
  assert.deepEqual(validatePages(input, 3), [{ page: 3, rotate: 90 }, { page: 1, rotate: 0 }, { page: 2, rotate: 180 }]);
  assert.deepEqual(validatePages([{ page: 1 }, { page: 1 }], 1), [{ page: 1, rotate: 0 }, { page: 1, rotate: 0 }]); // a page may repeat
});

test('validatePages refuses anything unsound, with a readable message', () => {
  assert.throws(() => validatePages([], 5), /at least one page/);
  assert.throws(() => validatePages(null, 5), /at least one page/);
  assert.throws(() => validatePages('all', 5), /at least one page/);
  assert.throws(() => validatePages([{ page: 6 }], 5), /pages 1 to 5/);
  assert.throws(() => validatePages([{ page: 0 }], 5), /pages 1 to 5/);
  assert.throws(() => validatePages([{ page: 1.5 }], 5), /pages 1 to 5/);
  assert.throws(() => validatePages([null], 5), /pages 1 to 5/);
  assert.throws(() => validatePages([{ page: 1, rotate: 45 }], 5), /quarter turns/);
  assert.throws(() => validatePages([{ page: 1, rotate: -90 }], 5), /quarter turns/);
  assert.throws(() => validatePages(Array.from({ length: 2001 }, () => ({ page: 1 })), 5), /at most 2000/);
});
