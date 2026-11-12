import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_PRESET_ID, PRESETS, presetById, presetIdFor } from '../../src/lib/presets.js';
import { DEFAULT_MAX_SLIDES, DEFAULT_TIME_PER_SLIDE } from '../../src/lib/player-controller.js';
import { Store } from '../../src/main/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('presets have unique ids and labels, and none is called "custom"', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(PRESETS.map((p) => p.label)).size, PRESETS.length);
  assert.ok(!ids.includes(CUSTOM_PRESET_ID));
});

test('PechaKucha is 20 x 20 and Ignite is 20 slides x 15 s', () => {
  assert.deepEqual(
    { t: presetById('pechakucha').timePerSlide, m: presetById('pechakucha').maxSlides },
    { t: 20, m: 20 },
  );
  assert.deepEqual({ t: presetById('ignite').timePerSlide, m: presetById('ignite').maxSlides }, { t: 15, m: 20 });
});

test('a new event starts on the PechaKucha preset', () => {
  assert.equal(presetIdFor(DEFAULT_TIME_PER_SLIDE, DEFAULT_MAX_SLIDES), 'pechakucha');
});

test('presetIdFor matches exact settings only, and accepts numeric strings', () => {
  assert.equal(presetIdFor(15, 20), 'ignite');
  assert.equal(presetIdFor('15', '20'), 'ignite');
  assert.equal(presetIdFor(15, 19), CUSTOM_PRESET_ID);
  assert.equal(presetIdFor(20.5, 20), CUSTOM_PRESET_ID);
  assert.equal(presetIdFor(undefined, undefined), CUSTOM_PRESET_ID);
  assert.equal(presetIdFor('abc', 20), CUSTOM_PRESET_ID);
});

test('presetById returns null for custom and unknown ids', () => {
  assert.equal(presetById(CUSTOM_PRESET_ID), null);
  assert.equal(presetById('nope'), null);
  assert.equal(presetById(undefined), null);
});

test('the store accepts every preset in one update', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-presets-'));
  try {
    const store = new Store(dir);
    const ev = store.createEvent('Preset check');
    for (const p of PRESETS) {
      const updated = store.updateEvent(ev.id, { timePerSlide: p.timePerSlide, maxSlides: p.maxSlides });
      assert.equal(presetIdFor(updated.timePerSlide, updated.maxSlides), p.id);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
