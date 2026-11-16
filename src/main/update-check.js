// Ask GitHub whether a newer PK Player has been released. Runs in the main process.
// It sends no information about the user: one request for a public page, identified
// only as "PK-Player/<version>". It never downloads or installs anything.

import fs from 'node:fs';
import { debug } from '../lib/debug.js';
import { CHECK_TIMEOUT_MS, RELEASES_API_URL, isNewer, parseVersion, versionFromRelease } from '../lib/update-check.js';

/**
 * @param {object} opts
 * @param {string} opts.currentVersion this app's version
 * @param {Function} [opts.fetchImpl] fetch to use (injected by tests)
 * @param {string} [opts.feedFile] read the release answer from this local JSON file instead of the network (tests)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{kind: 'newer'|'current'|'error', current: string, latest?: string, message?: string}>}
 *   Never throws: every failure is reported as kind "error" with a message fit to show the user.
 */
export async function checkForUpdate({ currentVersion, fetchImpl = globalThis.fetch, feedFile, timeoutMs = CHECK_TIMEOUT_MS }) {
  const current = String(currentVersion);
  const fail = (message, err) => {
    debug('update', message, err);
    return { kind: 'error', current, message };
  };
  if (!parseVersion(current)) return { kind: 'current', current }; // a test or beta build: nothing to compare against
  let release;
  if (feedFile) {
    try {
      release = JSON.parse(await fs.promises.readFile(feedFile, { encoding: 'utf-8' }));
    } catch (err) {
      return fail('The update information could not be read.', err);
    }
  } else {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetchImpl(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `PK-Player/${current}` },
        signal: abort.signal,
        redirect: 'error',
      });
      if (!res.ok) return fail(`GitHub answered with an error (${res.status}). Try again later.`, new Error(`HTTP ${res.status}`));
      release = await res.json();
    } catch (err) {
      return fail(err?.name === 'AbortError' ? 'GitHub did not answer in time.' : 'GitHub could not be reached. Check your internet connection.', err);
    } finally {
      clearTimeout(timer);
    }
  }
  const latest = versionFromRelease(release);
  if (!latest) return fail('The answer from GitHub did not name a version.', new Error('no usable tag_name'));
  return { kind: isNewer(latest, current) ? 'newer' : 'current', current, latest };
}
