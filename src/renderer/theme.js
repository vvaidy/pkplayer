// Applies the chosen color theme to this window. Loaded before the page's own script,
// and the theme id arrives in the URL, so the first paint is already in the right colors.
import { themeById, themeVars } from '../lib/themes.js';
import { debug } from '../lib/debug.js';

/** Set every theme variable on the page. Unknown ids fall back to the default theme. Returns the theme used. */
export function applyTheme(id) {
  const theme = themeById(id);
  try {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(themeVars(theme))) root.style.setProperty(name, value);
    root.style.colorScheme = theme.mode === 'light' ? 'light' : 'dark'; // native controls follow the theme
    root.dataset.theme = theme.id;
  } catch (err) {
    debug('theme', `could not apply theme ${id}`, err); // the stylesheet's default colors stay in place
  }
  return theme;
}

applyTheme(new URLSearchParams(window.location.search).get('theme'));
