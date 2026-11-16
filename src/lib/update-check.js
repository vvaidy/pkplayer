// Update notice: decide whether a newer version of PK Player has been released.
// This only ever TELLS the user; it never downloads or installs anything.
// Pure functions, shared by the main process and the unit tests.

export const RELEASES_API_URL = 'https://api.github.com/repos/vvaidy/pkplayer/releases/latest';
export const DOWNLOAD_URL = 'https://github.com/vvaidy/pkplayer/releases/latest';
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // at most one automatic check a day
export const CHECK_TIMEOUT_MS = 8000;

/** "1.4.0" or "v1.4.0" -> [1, 4, 0]; anything else (including pre-releases such as 1.4.0-beta.1) -> null. */
export function parseVersion(value) {
  const m = typeof value === 'string' ? /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(value.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True only when both are plain versions and `latest` is higher than `current`. */
export function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * The version named by GitHub's "latest release" answer, or null if the answer is not
 * a published, plain release. Only the version number is taken from it: the download
 * address is always our own DOWNLOAD_URL, never one supplied by the answer.
 */
export function versionFromRelease(release) {
  if (!release || typeof release !== 'object' || release.draft === true || release.prerelease === true) return null;
  const parts = parseVersion(release.tag_name);
  return parts ? parts.join('.') : null;
}

/** Whether an automatic check is due, given when the last one ran (an ISO date string, or nothing). */
export function checkIsDue(lastCheck, now = Date.now(), interval = CHECK_INTERVAL_MS) {
  const last = typeof lastCheck === 'string' ? Date.parse(lastCheck) : NaN;
  if (!Number.isFinite(last)) return true;
  if (last > now) return true; // a clock that went backwards must not silence checks for ever
  return now - last >= interval;
}
