import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_THEME_ID, LEGACY_THEME_ID, THEMES, THEME_VARS, contrast, ensureContrast, isHexColor, isThemeId,
  luminance, mix, themeById, themeVars,
} from '../../src/lib/themes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

test('color math: mix, luminance and contrast', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#ff0000', '#0000ff', 2), '#0000ff'); // amount is clamped
  assert.equal(luminance('#000000'), 0);
  assert.equal(Math.round(luminance('#ffffff') * 1000), 1000);
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#123456', '#123456'), 1);
  assert.ok(isHexColor('#a1B2c3'));
  for (const bad of ['#fff', 'red', '#12345g', '', null, 5]) assert.ok(!isHexColor(bad), String(bad));
});

test('ensureContrast leaves good colors alone and fixes poor ones', () => {
  assert.equal(ensureContrast('#ffffff', '#000000', 7, '#ffffff'), '#ffffff');
  const fixed = ensureContrast('#444444', '#000000', 4.5, '#ffffff');
  assert.notEqual(fixed, '#444444');
  assert.ok(contrast(fixed, '#000000') >= 4.5, fixed);
  // When the target cannot be reached it stops at the far end instead of looping.
  assert.equal(ensureContrast('#777777', '#808080', 4.5, '#ffffff'), '#ffffff');
});

test('the library has unique ids and names, a default, and the legacy look', () => {
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  assert.equal(new Set(THEMES.map((t) => t.name)).size, THEMES.length);
  assert.ok(isThemeId(DEFAULT_THEME_ID));
  assert.ok(isThemeId(LEGACY_THEME_ID));
  assert.ok(THEMES.some((t) => t.mode === 'light'));
  for (const t of THEMES) {
    assert.match(t.id, /^[a-z0-9-]+$/);
    assert.ok(['dark', 'light'].includes(t.mode), t.id);
    for (const key of ['bg', 'text', 'accent', 'warn', 'danger', 'ok']) assert.ok(isHexColor(t.base[key]), `${t.id}.${key}`);
  }
});

test('themeById falls back to the default for unknown ids', () => {
  assert.equal(themeById('forest').id, 'forest');
  for (const bad of ['nope', '', null, undefined, 42]) assert.equal(themeById(bad).id, DEFAULT_THEME_ID);
  assert.ok(!isThemeId('nope'));
});

test('every theme defines every variable as a hex color', () => {
  for (const t of THEMES) {
    const vars = themeVars(t);
    assert.deepEqual(Object.keys(vars).sort(), [...THEME_VARS].sort(), t.id);
    for (const [name, value] of Object.entries(vars)) assert.ok(isHexColor(value), `${t.id} ${name}=${value}`);
  }
});

test('every theme is readable: text, dim text, accent, text on the accent, and status badges', () => {
  for (const t of THEMES) {
    const v = themeVars(t);
    const c = (a, b) => contrast(v[a], v[b]);
    assert.ok(c('--text', '--bg') >= 7, `${t.id} text on background ${c('--text', '--bg').toFixed(2)}`);
    assert.ok(c('--text', '--bg-elev') >= 7 || t.mode === 'dark', `${t.id} text on cards`);
    assert.ok(c('--text-dim', '--bg-elev-2') >= 4.5, `${t.id} dim text ${c('--text-dim', '--bg-elev-2').toFixed(2)}`);
    // The legacy look is pinned to its original values, including two that fall short of these targets.
    if (t.id !== LEGACY_THEME_ID) assert.ok(c('--text-faint', '--bg-elev') >= 3, `${t.id} faint text`);
    assert.ok(c('--accent', '--bg') >= 3, `${t.id} accent on background ${c('--accent', '--bg').toFixed(2)}`);
    assert.ok(contrast(v['--accent'], '#000000') >= 3, `${t.id} Play button against a black screen`);
    if (t.id !== LEGACY_THEME_ID) {
      assert.ok(c('--on-accent', '--accent') >= 4.5, `${t.id} text on accent ${c('--on-accent', '--accent').toFixed(2)}`);
    }
    for (const s of ['--warn', '--danger', '--ok']) {
      const badge = mix(v['--bg-elev'], v[s], 0.16);
      assert.ok(contrast(v[s], badge) >= 4, `${t.id} ${s} on its badge ${contrast(v[s], badge).toFixed(2)}`);
    }
    assert.equal(v['--contrast'], t.mode === 'light' ? '#000000' : '#ffffff');
  }
});

test('"Vibe with Claude" is exactly the original look', () => {
  assert.deepEqual(themeVars(themeById(LEGACY_THEME_ID)), {
    '--bg': '#14161a', '--bg-elev': '#1b1e24', '--bg-elev-2': '#23272f', '--border': '#2d323b',
    '--border-hover': '#3b414c', '--btn-hover': '#2a2f38', '--well': '#0c0d10', '--shade': '#0a0b0e',
    '--text': '#e8eaee', '--text-dim': '#9aa1ad', '--text-faint': '#5b6270', '--contrast': '#ffffff',
    '--accent': '#ff5a36', '--accent-hover': '#ff7556', '--on-accent': '#ffffff',
    '--danger': '#ff5d6c', '--warn': '#f5b948', '--ok': '#46c88a',
  });
});

test('no theme other than the legacy one uses an orange accent', () => {
  for (const t of THEMES.filter((x) => x.id !== LEGACY_THEME_ID)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(themeVars(t)['--accent'].slice(i, i + 2), 16));
    const orange = r > 200 && g > 60 && g < 170 && b < 110;
    assert.ok(!orange, `${t.id} accent ${themeVars(t)['--accent']} reads as orange`);
  }
});

test('the stylesheet defaults are the default theme, and no stylesheet hard-codes the old orange', () => {
  const css = read('src/renderer/common.css');
  for (const [name, value] of Object.entries(themeVars(themeById(DEFAULT_THEME_ID)))) {
    assert.ok(css.includes(`${name}: ${value};`), `common.css should set ${name}: ${value}`);
  }
  for (const file of ['common.css', 'editor.css', 'player.css']) {
    const text = read(`src/renderer/${file}`);
    assert.ok(!/255,\s*90,\s*54|#ff5a36/i.test(text), `${file} still hard-codes the old accent`);
  }
});

test('both windows load the theme before their own script', () => {
  for (const page of ['editor', 'player']) {
    const html = read(`src/renderer/${page}.html`);
    const theme = html.indexOf('src="theme.js"');
    assert.ok(theme > 0 && theme < html.indexOf(`src="${page}.js"`), page);
  }
});
