// Color themes for the editor and the player's own controls (slides are never tinted).
// Pure data and color math, shared by the main process, both windows and the unit tests.
//
// A theme is six base colors. Everything else (cards, borders, dim text, hover
// states, text on the accent) is derived from them, and nudged where needed so
// text stays readable. A theme may pin any derived value with `exact`.

export const DEFAULT_THEME_ID = 'midnight-teal';
export const LEGACY_THEME_ID = 'vibe-with-claude'; // the look PK Player shipped with up to 1.0.2

// ---------- color math ----------

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function isHexColor(value) {
  return typeof value === 'string' && HEX.test(value);
}

/** Blend two #rrggbb colors: amount 0 gives `a`, 1 gives `b`. */
export function mix(a, b, amount) {
  const A = rgb(a);
  const B = rgb(b);
  const t = Math.min(1, Math.max(0, amount));
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Move `color` toward `toward` in small steps until it has at least `min` contrast against `against`. */
export function ensureContrast(color, against, min, toward) {
  let out = color;
  for (let step = 1; step <= 20 && contrast(out, against) < min; step += 1) out = mix(color, toward, step * 0.05);
  return out;
}

// ---------- the library ----------

const theme = (id, name, mode, base, extra = {}) => ({ id, name, mode, base, ...extra });

/**
 * Every theme here is original to PK Player: the names and the color values were
 * made for this app and are not taken from any other project's color scheme.
 * Keep it that way, so the library never needs third-party credits or licences.
 *
 * base: bg (window background), text, accent (Play and selection), warn, danger, ok.
 */
export const THEMES = [
  theme('midnight-teal', 'Midnight Teal', 'dark',
    { bg: '#0e1519', text: '#e6f1f2', accent: '#2dd4bf', warn: '#f2c14e', danger: '#ff6b7a', ok: '#5fd39a' }),
  theme('blueprint', 'Blueprint', 'dark',
    { bg: '#0d1730', text: '#e9eefb', accent: '#5aa9ff', warn: '#ffd166', danger: '#ff7b8a', ok: '#6bd6a8' }),
  theme('aubergine', 'Aubergine', 'dark',
    { bg: '#1a1220', text: '#f1e9f5', accent: '#f472b6', warn: '#f5c26b', danger: '#ff6b81', ok: '#6fd3a5' }),
  theme('forest', 'Forest', 'dark',
    { bg: '#101a14', text: '#e8f2ea', accent: '#7bd88f', warn: '#e9c46a', danger: '#f2777a', ok: '#8fd3c1' }),
  theme('lagoon', 'Lagoon', 'dark',
    { bg: '#07272e', text: '#e4f0ee', accent: '#4cc9f0', warn: '#f4b942', danger: '#ff7f8a', ok: '#69d6a0' }),
  theme('graphite', 'Graphite', 'dark',
    { bg: '#17181c', text: '#ececf1', accent: '#a78bfa', warn: '#f2c14e', danger: '#ff6b7a', ok: '#5fd39a' }),
  theme('projector', 'Projector (high contrast)', 'dark',
    { bg: '#000000', text: '#ffffff', accent: '#b6f24a', warn: '#ffd23f', danger: '#ff5f6d', ok: '#4ade80' }),
  theme('paper', 'Paper', 'light',
    { bg: '#f6f4ee', text: '#1f2328', accent: '#2f5bea', warn: '#835800', danger: '#b22a35', ok: '#177244' }),
  theme('sage', 'Sage', 'light',
    { bg: '#eef2ea', text: '#1f2a24', accent: '#2f7d5b', warn: '#7a5a00', danger: '#b3303c', ok: '#1c6983' }),
  theme('blossom', 'Blossom', 'light',
    { bg: '#fbf1f3', text: '#2b1f26', accent: '#c2417a', warn: '#855a00', danger: '#b3261e', ok: '#177244' }),
  theme(LEGACY_THEME_ID, 'Vibe with Claude', 'dark',
    { bg: '#14161a', text: '#e8eaee', accent: '#ff5a36', warn: '#f5b948', danger: '#ff5d6c', ok: '#46c88a' },
    {
      // Pinned to the exact values of the original stylesheet.
      exact: {
        '--bg-elev': '#1b1e24', '--bg-elev-2': '#23272f', '--border': '#2d323b', '--border-hover': '#3b414c',
        '--btn-hover': '#2a2f38', '--text-dim': '#9aa1ad', '--text-faint': '#5b6270', '--well': '#0c0d10',
        '--shade': '#0a0b0e', '--accent-hover': '#ff7556', '--on-accent': '#ffffff',
      },
    }),
];

export function isThemeId(id) {
  return THEMES.some((t) => t.id === id);
}

/** The theme with this id, or the default theme for anything unknown. */
export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME_ID);
}

/** Every CSS variable the stylesheets read, in the order they are documented in common.css. */
export const THEME_VARS = [
  '--bg', '--bg-elev', '--bg-elev-2', '--border', '--border-hover', '--btn-hover', '--well', '--shade',
  '--text', '--text-dim', '--text-faint', '--contrast',
  '--accent', '--accent-hover', '--on-accent', '--danger', '--warn', '--ok',
];

/**
 * All CSS variables for a theme.
 * @returns {Record<string, string>} variable name -> #rrggbb
 */
export function themeVars(t) {
  const { bg } = t.base;
  const dark = t.mode !== 'light';
  const pole = dark ? '#ffffff' : '#000000'; // the strongest possible contrast with the background
  const text = ensureContrast(t.base.text, bg, 7, pole);
  const bgElev = dark ? mix(bg, text, 0.04) : mix(bg, '#ffffff', 0.65);
  const bgElev2 = dark ? mix(bg, text, 0.08) : mix(bg, text, 0.07);
  const accent = ensureContrast(t.base.accent, bg, 3, pole);
  const ink = mix(accent, '#000000', 0.85);
  // Status colors are used as small text on a tinted badge, so they must stay readable there.
  const status = (c) => ensureContrast(c, mix(bgElev, c, 0.16), 4.5, pole);
  const vars = {
    '--bg': bg,
    '--bg-elev': bgElev,
    '--bg-elev-2': bgElev2,
    '--border': mix(bg, text, dark ? 0.14 : 0.18),
    '--border-hover': mix(bg, text, dark ? 0.22 : 0.3),
    '--btn-hover': mix(bg, text, dark ? 0.11 : 0.11),
    '--well': dark ? mix(bg, '#000000', 0.4) : mix(bg, text, 0.1),
    '--shade': dark ? mix(bg, '#000000', 0.5) : mix(text, '#000000', 0.4),
    '--text': text,
    '--text-dim': ensureContrast(mix(text, bg, 0.38), bgElev2, 4.5, text),
    '--text-faint': ensureContrast(mix(text, bg, 0.62), bgElev, 3, text),
    '--contrast': pole,
    '--accent': accent,
    '--accent-hover': dark ? mix(accent, '#ffffff', 0.16) : mix(accent, '#000000', 0.14),
    '--on-accent': contrast(ink, accent) >= contrast('#ffffff', accent) ? ink : '#ffffff',
    '--danger': status(t.base.danger),
    '--warn': status(t.base.warn),
    '--ok': status(t.base.ok),
    ...(t.exact || {}),
  };
  return vars;
}

// ---------- custom themes ----------

export const CUSTOM_THEME_PREFIX = 'custom-';
export const BASE_COLOR_KEYS = ['bg', 'text', 'accent', 'warn', 'danger', 'ok'];
export const BASE_COLOR_LABELS = {
  bg: 'Background', text: 'Text', accent: 'Accent (Play and selection)', warn: 'Warning', danger: 'Error', ok: 'OK',
};
export const THEME_NAME_MAX = 60;
export const THEME_FILE_MARKER = 'pkplayer-theme';

export function isCustomThemeId(id) {
  return typeof id === 'string' && id.startsWith(CUSTOM_THEME_PREFIX) && /^[a-z0-9-]+$/.test(id);
}

/** "#1A2B3C", "1a2b3c" -> "#1a2b3c"; anything else -> null. */
export function toHexColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const hex = v.startsWith('#') ? v : `#${v}`;
  return HEX.test(hex) ? hex : null;
}

/** dark or light, judged from the background color. */
export function modeFor(bg) {
  return luminance(bg) < 0.4 ? 'dark' : 'light';
}

/**
 * Check and tidy a theme that came from outside the built-in library (a saved
 * custom theme, the theme editor, an imported file, the window URL).
 * Returns a clean { id?, name, mode, base } or throws an Error that says what is wrong.
 * Only the six base colors are kept, so a custom theme can never pin derived values.
 */
export function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('That is not a theme.');
  const base = {};
  for (const key of BASE_COLOR_KEYS) {
    const color = toHexColor(raw.base?.[key]);
    if (!color) throw new Error(`${BASE_COLOR_LABELS[key]} color must look like #1a2b3c.`);
    base[key] = color;
  }
  const name = (typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '').slice(0, THEME_NAME_MAX) || 'My theme';
  const mode = raw.mode === 'dark' || raw.mode === 'light' ? raw.mode : modeFor(base.bg);
  const theme = { name, mode, base };
  if (isCustomThemeId(raw.id)) theme.id = raw.id;
  return theme;
}

/** The text of a theme file that "Import theme" reads back. */
export function exportTheme(theme) {
  const t = normalizeTheme(theme);
  return `${JSON.stringify({ format: THEME_FILE_MARKER, version: 1, name: t.name, mode: t.mode, base: t.base }, null, 2)}\n`;
}

const nameFromFile = (fileName) => String(fileName || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '').trim();

/** Colors of a terminal color-scheme: background, foreground and the 16-color palette (index -> hex). */
function terminalToTheme({ background, foreground, palette }, fileName) {
  const bg = toHexColor(background);
  const text = toHexColor(foreground);
  if (!bg || !text) throw new Error('This file has no background and text colors.');
  const fallback = themeById(DEFAULT_THEME_ID).base;
  const pick = (index, key) => toHexColor(palette[index]) || fallback[key];
  // Terminal palettes number their colors: 1 red, 2 green, 3 yellow, 4 blue.
  return normalizeTheme({
    name: nameFromFile(fileName) || 'Imported theme',
    base: { bg, text, accent: pick(4, 'accent'), warn: pick(3, 'warn'), danger: pick(1, 'danger'), ok: pick(2, 'ok') },
  });
}

/** Ghostty theme file: lines such as "background = #1e1e2e" and "palette = 4=#89b4fa". */
function parseGhostty(text, fileName) {
  const out = { palette: {} };
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'background' || key === 'foreground') out[key] = value;
    else if (key === 'palette') {
      const p = /^(\d{1,2})\s*=\s*(\S+)$/.exec(value);
      if (p) out.palette[Number(p[1])] = p[2];
    }
  }
  return terminalToTheme(out, fileName);
}

/** iTerm2 .itermcolors file: an XML property list of colors given as 0-1 red, green and blue components. */
function parseIterm(text, fileName) {
  const color = (key) => {
    const dict = new RegExp(`<key>${key}</key>\\s*<dict>([\\s\\S]*?)</dict>`).exec(text);
    if (!dict) return null;
    const part = (name) => {
      const m = new RegExp(`<key>${name} Component</key>\\s*<real>([^<]+)</real>`).exec(dict[1]);
      const n = m ? Number(m[1]) : NaN;
      return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0') : null;
    };
    const [r, g, b] = [part('Red'), part('Green'), part('Blue')];
    return r && g && b ? `#${r}${g}${b}` : null;
  };
  const palette = {};
  for (let i = 0; i < 16; i += 1) palette[i] = color(`Ansi ${i} Color`);
  return terminalToTheme({ background: color('Background Color'), foreground: color('Foreground Color'), palette }, fileName);
}

/**
 * Read a theme from the text of a file: one exported by PK Player, a Ghostty
 * theme file, or an iTerm2 .itermcolors file. The result has no id (it is new).
 * Throws an Error that says what is wrong when the file is none of these.
 */
export function parseThemeFile(text, fileName = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty.');
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`The file is not valid JSON (${err.message}).`);
    }
    if (data?.format !== THEME_FILE_MARKER) throw new Error('This JSON file is not a PK Player theme.');
    return normalizeTheme({ name: data.name || nameFromFile(fileName), mode: data.mode, base: data.base });
  }
  if (/<plist[\s>]/.test(trimmed)) return parseIterm(trimmed, fileName);
  return parseGhostty(trimmed, fileName);
}
