// Capture the screenshots used in docs/manual/ by driving the real app.
// Opens windows and goes FULLSCREEN — don't run while you're using the computer.
// Usage: node scripts/capture-docs-screens.js     (writes docs/manual/img/*.png)
//        PK_DOCS_EDITOR_ONLY=1 node scripts/capture-docs-screens.js
//          only the editor screenshots (01-06): one normal window, nothing fullscreen
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEMO = path.join(ROOT, 'samples/demo');
const OUT = path.join(ROOT, 'docs/manual/img');
const EDITOR_SIZE = { width: 1280, height: 800 };
const MAX_WIDTH = 1600; // downscale retina captures to keep the repo small
const EDITOR_ONLY = process.env.PK_DOCS_EDITOR_ONLY === '1';

const log = (msg) => console.log(`[docs-screens] ${msg}`);

async function shot(target, name, opts = {}) {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file, ...opts });
  log(`saved ${name}`);
}

async function openPlayer(app, trigger) {
  const [player] = await Promise.all([app.waitForEvent('window'), trigger()]);
  await player.waitForSelector('body[data-phase]');
  return player;
}

async function closePlayer(player) {
  const closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;
}

async function main() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/make-demo-decks.js'), DEMO]);
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-docs-'));
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PKPLAY_DATA_DIR: dataDir } });
  try {
    const editor = await app.firstWindow();
    await editor.waitForSelector('body[data-ready="1"]');
    await app.evaluate(({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(size.width, size.height);
      w.center();
    }, EDITOR_SIZE);
    await editor.waitForTimeout(400);
    await shot(editor, '01-empty.png');

    // Build the tutorial event.
    await editor.click('#newEvent');
    await editor.fill('#eventName', 'Friday PechaKucha Night');
    await editor.press('#eventName', 'Enter');
    const files = fs.readdirSync(DEMO).filter((f) => f.endsWith('.pdf')).sort().map((f) => path.join(DEMO, f));
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p });
    }, files);
    await editor.click('#addPdfs');
    await editor.locator('.row .thumb img').nth(files.length - 1).waitFor();
    await editor.locator('.toast').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await editor.evaluate(() => document.activeElement?.blur());
    await editor.waitForTimeout(300);
    await shot(editor, '02-event.png');
    await shot(editor.locator('.props'), '03-settings.png');
    await shot(editor.locator('.row').nth(3), '04-row-warning.png');
    await shot(editor.locator('.sidebar-foot'), '05-present-on.png');

    // Drop overlay (normally shown while dragging files over the window).
    await editor.evaluate(() => { document.getElementById('dropOverlay').hidden = false; });
    await editor.waitForTimeout(400); // let the fade-in finish
    await shot(editor, '06-drop.png');
    await editor.evaluate(() => { document.getElementById('dropOverlay').hidden = true; });

    if (EDITOR_ONLY) log('editor only: skipping the player screens (07-11)');
    else await capturePlayerScreens(app, editor);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  downscale();
}

/** The fullscreen player screenshots (07-10) and the resume bar (11). */
async function capturePlayerScreens(app, editor) {
  // Player screens.
  let player = await openPlayer(app, () => editor.click('#playBtn'));
  await player.waitForTimeout(1500); // let fullscreen + entrance animation settle
  await shot(player, '07-player-waiting.png');
  await player.keyboard.press('Space');
  await player.keyboard.press('ArrowRight');
  await player.keyboard.press('ArrowRight');
  await player.waitForTimeout(8000); // ~40% through a 20 s slide
  await shot(player, '08-player-playing.png');
  await player.keyboard.press('Space');
  await player.waitForTimeout(1500);
  await shot(player, '09-player-paused.png');
  for (let i = 0; i < 4; i += 1) await player.keyboard.press('n');
  await player.locator('#ended').waitFor();
  await player.waitForTimeout(500);
  await shot(player, '10-player-ended.png');
  await closePlayer(player);

  // Stop mid-event to show the resume button.
  player = await openPlayer(app, () => editor.click('#playBtn'));
  await player.keyboard.press('n');
  await player.keyboard.press('n');
  await closePlayer(player);
  await editor.locator('#playFromStart').waitFor();
  await editor.waitForTimeout(300);
  await shot(editor.locator('.props'), '11-resume.png');
}

/** Downscale large captures. */
function downscale() {
  for (const f of fs.readdirSync(OUT)) {
    try {
      execFileSync('magick', ['mogrify', '-resize', `${MAX_WIDTH}x>`, '-strip', path.join(OUT, f)]);
    } catch (err) {
      log(`could not downscale ${f} (ImageMagick missing?): ${err.message}`);
    }
  }
  log(`done → ${OUT}`);
}

main().catch((err) => {
  console.error('[docs-screens] failed:', err);
  process.exit(1);
});
