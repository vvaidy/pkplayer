import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SelfUpdater, createSimulatedUpdater, describeUpdateError, selfUpdateSupport } from '../../src/main/self-update.js';

const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {}; // expected error logs
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

/** A hand-driven stand-in for electron-updater, so each step can be checked on its own. */
function fakeUpdater({ version = '1.5.0' } = {}) {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = async () => { u.calls.push('check'); return version ? { updateInfo: { version } } : null; };
  u.downloadUpdate = () => { u.calls.push('download'); return new Promise((resolve, reject) => { u.finish = resolve; u.abort = reject; }); };
  u.quitAndInstall = () => { u.calls.push('install'); };
  return u;
}
const tick = () => new Promise((r) => setImmediate(r));

test('in-app update is offered only on a packaged Apple-silicon Mac app in an Applications folder', () => {
  const ok = { platform: 'darwin', arch: 'arm64', isPackaged: true, inApplicationsFolder: true };
  assert.deepEqual(selfUpdateSupport(ok), { supported: true });
  for (const change of [{ isPackaged: false }, { platform: 'win32' }, { platform: 'linux' }, { arch: 'x64' }, { inApplicationsFolder: false }]) {
    const res = selfUpdateSupport({ ...ok, ...change });
    assert.equal(res.supported, false, JSON.stringify(change));
    assert.equal(typeof res.reason, 'string');
  }
});

test('nothing downloads or installs on its own: both automatic switches are turned off', () => {
  const u = fakeUpdater();
  u.autoDownload = true;
  u.autoInstallOnAppQuit = true;
  const s = new SelfUpdater({ updater: u, currentVersion: '1.4.0', send: () => {} });
  assert.equal(u.autoDownload, false);
  assert.equal(u.autoInstallOnAppQuit, false);
  assert.equal(s.state, 'idle');
  assert.deepEqual(u.calls, []);
});

test('Update now checks, downloads with progress, and stops at "ready" without installing', async () => {
  const u = fakeUpdater();
  const sent = [];
  const s = new SelfUpdater({ updater: u, currentVersion: '1.4.0', send: (m) => sent.push(m) });
  const run = s.start();
  await tick();
  assert.deepEqual(sent.map((m) => m.state), ['checking', 'downloading']);
  assert.deepEqual(sent[1], { state: 'downloading', version: '1.5.0', percent: 0 });
  u.emit('download-progress', { percent: 41.6 });
  u.emit('download-progress', { percent: 250 }); // nonsense from the library is clamped
  assert.deepEqual(sent.slice(2).map((m) => m.percent), [42, 100]);
  // A second click while busy does nothing.
  assert.equal(await s.start(), 'downloading');
  assert.deepEqual(u.calls, ['check', 'download']);
  u.emit('update-downloaded', {});
  u.finish([]);
  assert.equal(await run, 'ready');
  assert.deepEqual(sent.at(-1), { state: 'ready', version: '1.5.0' });
  assert.equal(sent.filter((m) => m.state === 'ready').length, 1);
  assert.ok(!u.calls.includes('install'), 'downloading must never install');
});

test('Restart to finish installs only when ready, and never while something is in the way', async () => {
  const u = fakeUpdater();
  let playing = true;
  const s = new SelfUpdater({
    updater: u, currentVersion: '1.4.0', send: () => {},
    blockInstall: () => (playing ? 'Stop the presentation first.' : null),
  });
  assert.deepEqual(s.install(), { ok: false, message: 'The update has not finished downloading.' });
  const run = s.start();
  await tick();
  assert.equal(s.install().ok, false); // still downloading
  u.finish([]);
  await run;
  assert.deepEqual(s.install(), { ok: false, message: 'Stop the presentation first.' });
  assert.ok(!u.calls.includes('install'));
  playing = false;
  assert.deepEqual(s.install(), { ok: true });
  assert.deepEqual(u.calls, ['check', 'download', 'install']);
});

test('failures at every step end in "error" with a sentence the user can act on, and can be retried', async () => {
  await quiet(async () => {
    // Nothing newer, nothing at all, or an older version: never downloads.
    for (const version of ['1.4.0', '1.3.0', null, 'garbage']) {
      const u = fakeUpdater({ version });
      const sent = [];
      const s = new SelfUpdater({ updater: u, currentVersion: '1.4.0', send: (m) => sent.push(m) });
      assert.equal(await s.start(), 'error', String(version));
      assert.deepEqual(u.calls, ['check']);
      assert.match(sent.at(-1).message, /download page/);
    }
    // The check itself throws.
    const u1 = fakeUpdater();
    u1.checkForUpdates = async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); };
    const s1 = new SelfUpdater({ updater: u1, currentVersion: '1.4.0', send: () => {} });
    assert.equal(await s1.start(), 'error');
    // The download fails part-way; a later try starts again from the check.
    const u2 = fakeUpdater();
    const sent2 = [];
    const s2 = new SelfUpdater({ updater: u2, currentVersion: '1.4.0', send: (m) => sent2.push(m) });
    const run = s2.start();
    await tick();
    u2.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    u2.abort(new Error('net::ERR_INTERNET_DISCONNECTED'));
    assert.equal(await run, 'error');
    assert.equal(sent2.filter((m) => m.state === 'error').length, 1); // reported once, not twice
    assert.match(sent2.at(-1).message, /internet connection/);
    assert.equal(s2.install().ok, false);
    const again = s2.start();
    await tick();
    u2.finish([]);
    assert.equal(await again, 'ready');
  });
});

test('describeUpdateError explains the common failures and never leaks a raw error', () => {
  assert.match(describeUpdateError(new Error('Cannot update while running on a read-only volume')), /Applications folder/);
  assert.match(describeUpdateError(new Error('ZIP file not provided')), /cannot be installed from inside the app/);
  assert.match(describeUpdateError(new Error('Cannot find latest-mac.yml in the latest release artifacts: HttpError: 404')), /download page/);
  assert.match(describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')), /internet connection/);
  assert.match(describeUpdateError(new Error('Code signature at URL did not pass validation')), /signature check/);
  for (const odd of [null, undefined, '', {}, new Error('something nobody expected: 0xDEADBEEF at /Users/x/secret')]) {
    const msg = describeUpdateError(odd);
    assert.match(msg, /download page/);
    assert.ok(!/0xDEADBEEF|secret/.test(msg));
  }
});

test('the test stand-in walks through the same steps and installs nothing real', async () => {
  const sim = createSimulatedUpdater('9.9.9', { stepMs: 5 });
  const sent = [];
  const s = new SelfUpdater({ updater: sim, currentVersion: '1.4.0', send: (m) => sent.push(m) });
  assert.equal(await s.start(), 'ready');
  assert.deepEqual(sent.filter((m) => m.state === 'downloading').map((m) => m.percent), [0, 25, 50, 75, 100]);
  assert.equal(sim.installed, false);
  assert.deepEqual(s.install(), { ok: true });
  assert.equal(sim.installed, true);
  const failing = new SelfUpdater({ updater: createSimulatedUpdater('9.9.9', { fail: true, stepMs: 5 }), currentVersion: '1.4.0', send: () => {} });
  assert.equal(await quiet(() => failing.start()), 'error');
});
