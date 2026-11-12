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
