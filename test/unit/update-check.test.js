import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHECK_INTERVAL_MS, DOWNLOAD_URL, RELEASES_API_URL, checkIsDue, isNewer, parseVersion, versionFromRelease,
} from '../../src/lib/update-check.js';
import { checkForUpdate } from '../../src/main/update-check.js';
import { REPO_URL } from '../../src/main/help-menu.js';

const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {}; // expected error logs
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};
const answer = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });

test('versions: only plain x.y.z is understood', () => {
  assert.deepEqual(parseVersion('1.4.0'), [1, 4, 0]);
  assert.deepEqual(parseVersion('v10.20.30'), [10, 20, 30]);
  for (const bad of ['1.4', '1.4.0-beta.1', 'v1.4.0.1', 'latest', '', ' ', null, undefined, 140, '1.4.x', '99999.0.0']) {
    assert.equal(parseVersion(bad), null, String(bad));
  }
});

test('isNewer compares numerically and is false whenever unsure', () => {
  assert.equal(isNewer('1.4.0', '1.3.0'), true);
  assert.equal(isNewer('1.10.0', '1.9.9'), true); // not a text comparison
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
  assert.equal(isNewer('1.3.1', '1.3.0'), true);
  assert.equal(isNewer('1.3.0', '1.3.0'), false);
  assert.equal(isNewer('1.2.9', '1.3.0'), false);
  assert.equal(isNewer('v1.4.0', '1.3.0'), true);
  for (const [a, b] of [['1.4.0-beta.1', '1.3.0'], ['junk', '1.3.0'], ['1.4.0', '1.2.0-beta.1'], [null, '1.3.0'], ['1.4.0', undefined]]) {
    assert.equal(isNewer(a, b), false, `${a} vs ${b}`);
  }
});

test('versionFromRelease takes only a version from a published, plain release', () => {
  assert.equal(versionFromRelease({ tag_name: 'v1.4.0', draft: false, prerelease: false }), '1.4.0');
  assert.equal(versionFromRelease({ tag_name: '1.4.0' }), '1.4.0');
  for (const bad of [null, 'v1.4.0', [], {}, { tag_name: 'v1.4.0', draft: true }, { tag_name: 'v1.4.0', prerelease: true },
    { tag_name: 'v1.4.0-rc.1' }, { tag_name: 'https://evil.example/v1.4.0' }, { tag_name: 14 }]) {
    assert.equal(versionFromRelease(bad), null, JSON.stringify(bad));
  }
});

test('the addresses used are GitHub and this project only', () => {
  assert.equal(RELEASES_API_URL, 'https://api.github.com/repos/vvaidy/pkplayer/releases/latest');
  assert.equal(DOWNLOAD_URL, `${REPO_URL}/releases/latest`);
});

test('an automatic check is due once a day, and after a clock change', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(checkIsDue(null, now), true);
  assert.equal(checkIsDue('not a date', now), true);
  assert.equal(checkIsDue(new Date(now - 60 * 1000).toISOString(), now), false);
  assert.equal(checkIsDue(new Date(now - CHECK_INTERVAL_MS + 1000).toISOString(), now), false);
  assert.equal(checkIsDue(new Date(now - CHECK_INTERVAL_MS).toISOString(), now), true);
  assert.equal(checkIsDue(new Date(now + 5 * CHECK_INTERVAL_MS).toISOString(), now), true); // "last check" in the future
});

test('checkForUpdate reports newer, current and every kind of failure without throwing', async () => {
  const calls = [];
  const fetchOk = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.4.0', draft: false, prerelease: false, html_url: 'https://evil.example/' }) };
  };
  assert.deepEqual(await checkForUpdate({ currentVersion: '1.3.0', fetchImpl: fetchOk }), { kind: 'newer', current: '1.3.0', latest: '1.4.0' });
  assert.deepEqual(await checkForUpdate({ currentVersion: '1.4.0', fetchImpl: fetchOk }), { kind: 'current', current: '1.4.0', latest: '1.4.0' });
  assert.deepEqual(await checkForUpdate({ currentVersion: '2.0.0', fetchImpl: fetchOk }), { kind: 'current', current: '2.0.0', latest: '1.4.0' });
  // What is sent: one GET to the fixed address, identified only by app name and version.
  assert.equal(calls[0].url, RELEASES_API_URL);
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Accept', 'User-Agent']);
  assert.equal(calls[0].init.headers['User-Agent'], 'PK-Player/1.3.0');
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(!('body' in calls[0].init) && !('method' in calls[0].init));

  await quiet(async () => {
    const http = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl: answer({}, { ok: false, status: 403 }) });
    assert.deepEqual([http.kind, /403/.test(http.message)], ['error', true]);
    const offline = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    assert.deepEqual([offline.kind, /could not be reached/.test(offline.message)], ['error', true]);
    const badJson = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }) });
    assert.equal(badJson.kind, 'error');
    const noTag = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl: answer({ message: 'Not Found' }) });
    assert.deepEqual([noTag.kind, /did not name a version/.test(noTag.message)], ['error', true]);
    const draft = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl: answer({ tag_name: 'v9.0.0', draft: true }) });
    assert.equal(draft.kind, 'error'); // a draft is never offered
  });
});

test('checkForUpdate gives up when GitHub does not answer in time', async () => {
  const never = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const res = await quiet(() => checkForUpdate({ currentVersion: '1.3.0', fetchImpl: never, timeoutMs: 30 }));
  assert.deepEqual([res.kind, /did not answer in time/.test(res.message)], ['error', true]);
});

test('checkForUpdate never contacts anything for a beta or odd build, and can read a local feed', async () => {
  let called = false;
  const res = await checkForUpdate({ currentVersion: '1.2.0-beta.1', fetchImpl: async () => { called = true; return {}; } });
  assert.deepEqual([res.kind, called], ['current', false]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-update-'));
  try {
    const feed = path.join(dir, 'latest.json');
    fs.writeFileSync(feed, JSON.stringify({ tag_name: 'v3.0.0' }), 'utf-8');
    assert.deepEqual(await checkForUpdate({ currentVersion: '1.3.0', feedFile: feed, fetchImpl: async () => { called = true; } }),
      { kind: 'newer', current: '1.3.0', latest: '3.0.0' });
    assert.equal(called, false);
    const missing = await quiet(() => checkForUpdate({ currentVersion: '1.3.0', feedFile: path.join(dir, 'nope.json') }));
    assert.equal(missing.kind, 'error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
