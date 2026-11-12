// Applies a color theme to this window. Loaded before the page's own script, and the
// theme arrives in the URL, so the first paint is already in the right colors.
import { normalizeTheme, themeById, themeVars } from '../lib/themes.js';
import { debug } from '../lib/debug.js';

/**
 * Set every theme variable on the page.
 * @param {string|object} theme a built-in theme id, or a theme object (built-in or custom)
 * Unknown ids fall back to the default theme. Returns the theme used.
 */
export function applyTheme(theme) {
  const t = theme && typeof theme === 'object' ? theme : themeById(theme);
  try {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(themeVars(t))) root.style.setProperty(name, value);
    root.style.colorScheme = t.mode === 'light' ? 'light' : 'dark'; // native controls follow the theme
    root.dataset.theme = t.id || '';
  } catch (err) {
    debug('theme', 'could not apply theme', err); // the stylesheet's default colors stay in place
  }
  return t;
}

/** The theme named in this window's URL: a custom theme's definition if one was sent, else a built-in id. */
function themeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const def = params.get('themeDef');
  if (def) {
    try {
      return normalizeTheme(JSON.parse(def)); // checked again here: never trust colors just because they were in a URL
    } catch (err) {
      debug('theme', 'ignoring a bad theme definition in the URL', err);
    }
  }
  return params.get('theme');
}

applyTheme(themeFromUrl());
