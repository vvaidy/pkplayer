import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contrast, exportTheme, isCustomThemeId, modeFor, normalizeTheme, parseThemeFile, themeVars, toHexColor,
} from '../../src/lib/themes.js';

const BASE = { bg: '#101418', text: '#eef2f5', accent: '#44ccaa', warn: '#f2c14e', danger: '#ff6b7a', ok: '#5fd39a' };

test('toHexColor accepts six-digit hex with or without #, in any case', () => {
  assert.equal(toHexColor('#1A2B3C'), '#1a2b3c');
  assert.equal(toHexColor(' 1a2b3c '), '#1a2b3c');
  for (const bad of ['#fff', 'red', '#1a2b3', '#1a2b3cc', 'rgb(1,2,3)', '', null, 7, {}]) assert.equal(toHexColor(bad), null, String(bad));
});

test('normalizeTheme tidies a good theme and keeps only what a custom theme may have', () => {
  const t = normalizeTheme({ id: 'custom-abc', name: '  My   Night \n theme ', base: { ...BASE, bg: '101418', accent: '#44CCAA' }, exact: { '--bg': 'red' }, extra: 1 });
  assert.deepEqual(t, { name: 'My Night theme', mode: 'dark', base: BASE, id: 'custom-abc' });
  assert.equal(normalizeTheme({ base: BASE }).name, 'My theme');
  assert.equal(normalizeTheme({ base: BASE, name: 'x'.repeat(200) }).name.length, 60);
  assert.equal(normalizeTheme({ base: { ...BASE, bg: '#fafafa', text: '#111111' } }).mode, 'light');
  assert.equal(normalizeTheme({ base: BASE, mode: 'light' }).mode, 'light'); // an explicit choice wins
  assert.equal(normalizeTheme({ base: BASE, mode: 'sideways' }).mode, 'dark');
});

test('normalizeTheme never accepts a built-in or malformed id, so custom themes cannot replace built-in ones', () => {
  for (const id of ['midnight-teal', 'vibe-with-claude', 'custom-A B', 'custom-<script>', 42, null]) {
    assert.equal('id' in normalizeTheme({ id, base: BASE }), false, String(id));
  }
  assert.ok(isCustomThemeId('custom-1f0c'));
  assert.ok(!isCustomThemeId('paper'));
});

test('normalizeTheme rejects bad input with a message that names the color', () => {
  assert.throws(() => normalizeTheme(null), /not a theme/);
  assert.throws(() => normalizeTheme({}), /Background color must look like/);
  assert.throws(() => normalizeTheme({ base: { ...BASE, accent: 'url(javascript:1)' } }), /Accent/);
  assert.throws(() => normalizeTheme({ base: { ...BASE, danger: '#12' } }), /Error color/);
});

test('any custom theme still gets a readable palette', () => {
  // Deliberately awful picks: grey text on grey, an accent that matches the background.
  const v = themeVars(normalizeTheme({ base: { bg: '#777777', text: '#808080', accent: '#777777', warn: '#787878', danger: '#767676', ok: '#797979' } }));
  assert.ok(contrast(v['--text'], v['--bg']) >= 4.4, 'text');
  assert.ok(contrast(v['--accent'], v['--bg']) >= 3, 'accent');
  assert.ok(contrast(v['--on-accent'], v['--accent']) >= 4.5, 'text on accent');
  assert.equal(modeFor('#777777'), 'dark');
});

test('exportTheme and parseThemeFile round-trip a theme', () => {
  const original = normalizeTheme({ id: 'custom-1', name: 'Harbor Lights', base: BASE });
  const text = exportTheme(original);
  assert.match(text, /"format": "pkplayer-theme"/);
  assert.deepEqual(parseThemeFile(text, 'whatever.json'), { name: 'Harbor Lights', mode: 'dark', base: BASE }); // no id: an import is new
});

test('parseThemeFile reads a Ghostty theme file', () => {
  const file = [
    '# a comment', 'palette = 0=#000000', 'palette = 1=#ee5566', 'palette = 2=#55cc88', 'palette = 3=#ddbb55',
    'palette = 4=#5599ee', 'palette = 5=#bb77dd', 'background = 0c1014', 'foreground = #D8E0E6', 'cursor-color = #ffffff', '',
  ].join('\n');
  assert.deepEqual(parseThemeFile(file, '/Users/x/themes/My Terminal Look'), {
    name: 'My Terminal Look',
    mode: 'dark',
    base: { bg: '#0c1014', text: '#d8e0e6', accent: '#5599ee', warn: '#ddbb55', danger: '#ee5566', ok: '#55cc88' },
  });
});

test('parseThemeFile reads an iTerm2 .itermcolors file', () => {
  const entry = (key, r, g, b) => `<key>${key}</key>\n<dict>\n<key>Alpha Component</key><real>1</real>\n<key>Blue Component</key>\n<real>${b}</real>\n<key>Color Space</key><string>sRGB</string>\n<key>Green Component</key>\n<real>${g}</real>\n<key>Red Component</key>\n<real>${r}</real>\n</dict>`;
  const file = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${[
    entry('Ansi 1 Color', 1, 0, 0), entry('Ansi 2 Color', 0, 1, 0), entry('Ansi 3 Color', 1, 1, 0), entry('Ansi 4 Color', 0, 0.5, 1),
    entry('Background Color', 1, 1, 1), entry('Foreground Color', 0.2, 0.2, 0.2),
  ].join('\n')}\n</dict>\n</plist>`;
  assert.deepEqual(parseThemeFile(file, 'Daylight.itermcolors'), {
    name: 'Daylight',
    mode: 'light',
    base: { bg: '#ffffff', text: '#333333', accent: '#0080ff', warn: '#ffff00', danger: '#ff0000', ok: '#00ff00' },
  });
});

test('a terminal file with a partial palette falls back to default status colors', () => {
  const t = parseThemeFile('background = #101010\nforeground = #f0f0f0\n', 'bare');
  assert.equal(t.base.bg, '#101010');
  for (const key of ['accent', 'warn', 'danger', 'ok']) assert.match(t.base[key], /^#[0-9a-f]{6}$/);
});

test('parseThemeFile rejects files that are not themes, with a clear message', () => {
  assert.throws(() => parseThemeFile('', 'a'), /empty/);
  assert.throws(() => parseThemeFile('   \n', 'a'), /empty/);
  assert.throws(() => parseThemeFile('{ not json', 'a.json'), /not valid JSON/);
  assert.throws(() => parseThemeFile('{"hello": 1}', 'a.json'), /not a PK Player theme/);
  assert.throws(() => parseThemeFile('{"format":"pkplayer-theme","base":{"bg":"nope"}}', 'a.json'), /Background color/);
  assert.throws(() => parseThemeFile('just some notes\nabout nothing', 'notes.txt'), /no background and text colors/);
  assert.throws(() => parseThemeFile('<plist version="1.0"><dict></dict></plist>', 'x.itermcolors'), /no background and text colors/);
  assert.throws(() => parseThemeFile(null, 'x'), /empty/);
});
