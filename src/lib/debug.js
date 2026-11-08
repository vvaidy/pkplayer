// Single debug/logging helper shared by main process, renderer and tests.
// Toggle with PKPLAY_DEBUG=1 (main process) or ?debug=1 (renderer pages).
// Errors are always printed; debug messages only when enabled.

let DEBUG_ENABLED = false;

try {
  if (typeof process !== 'undefined' && process.env && process.env.PKPLAY_DEBUG === '1') {
    DEBUG_ENABLED = true;
  }
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1') {
    DEBUG_ENABLED = true;
  }
} catch {
  // Environment detection must never break the app.
}

export function setDebug(on) {
  DEBUG_ENABLED = Boolean(on);
}

export function isDebug() {
  return DEBUG_ENABLED;
}

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

/**
 * debug(scope, message, [errorOrDetail])
 * - If the third argument is an Error, it is always printed (with stack) as an error.
 * - Otherwise the message is printed only when debugging is enabled.
 */
export function debug(scope, message, detail) {
  const prefix = `[${stamp()}] [pk:${scope}]`;
  if (detail instanceof Error) {
    console.error(`${prefix} ERROR: ${message} — ${detail.message}`);
    if (DEBUG_ENABLED && detail.stack) console.error(detail.stack);
    return;
  }
  if (!DEBUG_ENABLED) return;
  if (detail === undefined) console.log(`${prefix} ${message}`);
  else console.log(`${prefix} ${message}`, detail);
}
