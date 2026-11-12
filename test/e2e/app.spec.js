// End-to-end tests: drive the real Electron app with Playwright.
import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const SHOTS = path.join(ROOT, 'test/screens');
const fx = (name) => path.join(FIXTURES, name);

let dataDir;

test.beforeAll(() => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/make-fixtures.js'), FIXTURES]);
  fs.mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-e2e-'));
});

test.afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function launch() {
  // PK_E2E_EXECUTABLE=dist/mac-arm64/PK Player.app/Contents/MacOS/PK Player tests the packaged build.
  const exe = process.env.PK_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(exe ? { executablePath: path.resolve(ROOT, exe), args: [] } : { args: [ROOT] }),
    env: { ...process.env, PKPLAY_DATA_DIR: dataDir, PKPLAY_DEBUG: '1' },
  });
  const editor = await app.firstWindow();
  await editor.waitForSelector('body[data-ready="1"]');
  return { app, editor };
}

/** Make the native "Add PDFs" dialog return the given paths. */
async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p });
  }, paths);
}

async function setupEvent(app, editor, { time = '1', max = '4', files }) {
  await editor.click('#newEvent');
  await editor.fill('#eventName', 'Test Night');
  await editor.press('#eventName', 'Enter');
  await editor.fill('#timePerSlide', time);
  await editor.press('#timePerSlide', 'Enter');
  await editor.fill('#maxSlides', max);
  await editor.press('#maxSlides', 'Enter');
  await stubOpenDialog(app, files);
  await editor.click('#addPdfs');
  await expect(editor.locator('.row')).toHaveCount(files.filter((f) => !f.includes('not-a-pdf')).length);
}

const rowNames = (editor) => editor.locator('.row .file').allTextContents();

async function openPlayer(app, editor, trigger = () => editor.click('#playBtn')) {
  const [player] = await Promise.all([app.waitForEvent('window'), trigger()]);
  await player.waitForSelector('body[data-phase]');
  return player;
}

test('editor: create event, set properties, import, reorder, remove, persist', async () => {
  const { app, editor } = await launch();
  await expect(editor.locator('#emptyState')).toBeVisible();

  await setupEvent(app, editor, {
    files: [fx('alpha-5-slides.pdf'), fx('bravo-25-slides.pdf'), fx('not-a-pdf.pdf'), fx('charlie-3-slides.pdf')],
  });
  await expect(editor.locator('.toast.error')).toContainText('not-a-pdf.pdf: Not a PDF file');
  expect(await rowNames(editor)).toEqual(['alpha-5-slides.pdf', 'bravo-25-slides.pdf', 'charlie-3-slides.pdf']);

  // Thumbnails and page counts load; long deck gets a warning badge.
  await expect(editor.locator('.row .thumb img')).toHaveCount(3);
  await expect(editor.locator('.row').nth(1)).toContainText('25 pages');
  await expect(editor.locator('.row').nth(1).locator('.badge.warn')).toHaveText('only first 4 play');
  await expect(editor.locator('#summary')).toContainText('11 slides'); // 4 + 4 + 3
  await expect(editor.locator('.event-item.selected .name')).toHaveText('Test Night');
  await editor.screenshot({ path: path.join(SHOTS, 'editor.png') });

  // Invalid value is rejected and reverted.
  await editor.fill('#maxSlides', '0');
  await editor.press('#maxSlides', 'Enter');
  await expect(editor.locator('.toast.error').last()).toContainText('Max slides must be between');
  await expect(editor.locator('#maxSlides')).toHaveValue('4');

  // Keyboard reorder: Alt+Down on first row.
  await editor.locator('.row').first().focus();
  await editor.keyboard.press('Alt+ArrowDown');
  expect(await rowNames(editor)).toEqual(['bravo-25-slides.pdf', 'alpha-5-slides.pdf', 'charlie-3-slides.pdf']);

  // Mouse drag reorder: drag charlie above bravo.
  await editor.locator('.row').nth(2).dragTo(editor.locator('.row').nth(0), { targetPosition: { x: 40, y: 5 } });
  await expect.poll(() => rowNames(editor)).toEqual(['charlie-3-slides.pdf', 'bravo-25-slides.pdf', 'alpha-5-slides.pdf']);

  // Delete key removes the focused row.
  await editor.locator('.row').nth(1).focus();
  await editor.keyboard.press('Delete');
  await expect.poll(() => rowNames(editor)).toEqual(['charlie-3-slides.pdf', 'alpha-5-slides.pdf']);

  // Everything persists across restarts; removed PDF's library copy is gone.
  await app.close();
  const { app: app2, editor: editor2 } = await launch();
  expect(await rowNames(editor2)).toEqual(['charlie-3-slides.pdf', 'alpha-5-slides.pdf']);
  await expect(editor2.locator('#timePerSlide')).toHaveValue('1');
  await expect(editor2.locator('#maxSlides')).toHaveValue('4');
  await expect(editor2.locator('#eventName')).toHaveValue('Test Night');
  expect(fs.readdirSync(path.join(dataDir, 'library')).length).toBe(2);

  // Duplicate and delete events.
  await editor2.click('#duplicateEvent');
  await expect(editor2.locator('.event-item')).toHaveCount(2);
  await expect(editor2.locator('#eventName')).toHaveValue('Test Night copy');
  editor2.once('dialog', (d) => d.accept());
  await editor2.click('#deleteEvent');
  await expect(editor2.locator('.event-item')).toHaveCount(1);
  await app2.close();
});

test('editor: Format preset sets both settings, follows manual edits, and persists', async () => {
  const { app, editor } = await launch();
  await editor.click('#newEvent');
  await editor.fill('#eventName', 'Preset Night');
  await editor.press('#eventName', 'Enter');

  // A new event is 20 x 20, which is the PechaKucha preset.
  await expect(editor.locator('#preset')).toHaveValue('pechakucha');
  await expect(editor.locator('#preset option')).toHaveText(['PechaKucha', 'Ignite', 'Custom']);

  // Choosing Ignite sets both fields and the sidebar summary.
  await editor.selectOption('#preset', 'ignite');
  await expect(editor.locator('#timePerSlide')).toHaveValue('15');
  await expect(editor.locator('#maxSlides')).toHaveValue('20');
  await expect(editor.locator('.event-item.selected .meta')).toContainText('15s × 20');

  // Editing a field by hand moves the preset to Custom, and back when it matches again.
  await editor.fill('#maxSlides', '12');
  await editor.press('#maxSlides', 'Enter');
  await expect(editor.locator('#preset')).toHaveValue('custom');
  await editor.fill('#maxSlides', '20');
  await editor.press('#maxSlides', 'Enter');
  await expect(editor.locator('#preset')).toHaveValue('ignite');

  // Choosing Custom changes nothing and puts the cursor in Time per slide.
  await editor.selectOption('#preset', 'custom');
  await expect(editor.locator('#timePerSlide')).toBeFocused();
  await expect(editor.locator('#timePerSlide')).toHaveValue('15');
  await expect(editor.locator('#maxSlides')).toHaveValue('20');

  // Back to PechaKucha, and it survives a restart.
  await editor.selectOption('#preset', 'pechakucha');
  await expect(editor.locator('#timePerSlide')).toHaveValue('20');
  await editor.screenshot({ path: path.join(SHOTS, 'editor-preset.png') });
  await editor.selectOption('#preset', 'ignite');
  await expect(editor.locator('#timePerSlide')).toHaveValue('15');
  await app.close();
  const { app: app2, editor: editor2 } = await launch();
  await expect(editor2.locator('#preset')).toHaveValue('ignite');
  await expect(editor2.locator('#timePerSlide')).toHaveValue('15');
  await app2.close();
});

test('player: waits for Play, times slides exactly, caps at max slides, stops at each deck', async () => {
  const { app, editor } = await launch();
  await setupEvent(app, editor, { files: [fx('bravo-25-slides.pdf'), fx('charlie-3-slides.pdf')] });
  const player = await openPlayer(app, editor);

  // Waiting on deck 1 with the big Play button; time does not pass.
  await expect(player.locator('#bigPlay')).toBeVisible();
  await expect(player.locator('#deckLabel')).toHaveText('PDF 1 of 2 · bravo-25-slides.pdf · 4 slides');
  await expect(player.locator('body')).toHaveAttribute('data-shown', '0:0');
  await player.waitForTimeout(1300);
  await expect(player.locator('body')).toHaveAttribute('data-phase', 'waiting');
  await player.screenshot({ path: path.join(SHOTS, 'player-waiting.png') });

  // Record when each slide change happens.
  await player.evaluate(() => {
    window.__changes = [];
    new MutationObserver(() => {
      window.__changes.push({ t: performance.now(), deck: document.body.dataset.deck, slide: document.body.dataset.slide, phase: document.body.dataset.phase });
    }).observe(document.body, { attributes: true, attributeFilter: ['data-slide', 'data-deck', 'data-phase'] });
  });
  await player.keyboard.press('Space');
  await expect(player.locator('#progress')).toBeVisible();
  await expect(player.locator('#counter')).toHaveText('1 / 4');
  await player.waitForTimeout(500);
  await player.screenshot({ path: path.join(SHOTS, 'player-playing.png') });

  // 4 slides x 1s, then deck 2 waits (pages 5..25 of bravo never shown).
  await expect(player.locator('body')).toHaveAttribute('data-phase', 'waiting', { timeout: 6000 });
  await expect(player.locator('body')).toHaveAttribute('data-deck', '1');
  await expect(player.locator('#deckLabel')).toContainText('PDF 2 of 2 · charlie-3-slides.pdf');
  const changes = await player.evaluate(() => window.__changes);
  const start = changes.find((c) => c.phase === 'playing').t;
  const steps = changes.filter((c) => c.t > start).map((c) => ({ ...c, at: c.t - start }));
  const slideTimes = steps.map((s) => Math.round(s.at));
  console.log('slide change times (ms after Play):', slideTimes);
  expect(steps.map((s) => `${s.deck}:${s.slide}`)).toEqual(['0:1', '0:2', '0:3', '1:0']);
  steps.forEach((s, i) => {
    expect(Math.abs(s.at - (i + 1) * 1000)).toBeLessThan(60); // within ~3 frames, no drift
  });

  // Last deck plays to the end.
  await player.click('#bigPlay');
  await expect(player.locator('body')).toHaveAttribute('data-phase', 'ended', { timeout: 5000 });
  await expect(player.locator('#ended')).toBeVisible();
  await player.screenshot({ path: path.join(SHOTS, 'player-ended.png') });

  // Esc returns to the editor.
  const closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;
  await expect(editor.locator('#playLabel')).toHaveText('Play');
  await app.close();
});

test('player: pause, skip slides, skip deck, exit keys and resume point', async () => {
  const { app, editor } = await launch();
  await setupEvent(app, editor, {
    time: '2',
    files: [fx('alpha-5-slides.pdf'), fx('bravo-25-slides.pdf'), fx('charlie-3-slides.pdf')],
  });
  let player = await openPlayer(app, editor, () => editor.keyboard.press('f'));
  const body = player.locator('body');

  // N while waiting skips to the next deck.
  await player.keyboard.press('n');
  await expect(body).toHaveAttribute('data-deck', '1');
  await player.keyboard.press('Space');
  await expect(body).toHaveAttribute('data-phase', 'playing');

  // Pause holds the slide well past its time.
  await player.keyboard.press('Space');
  await expect(body).toHaveAttribute('data-phase', 'paused');
  await expect(player.locator('#pauseBadge')).toBeVisible();
  await player.waitForTimeout(2500);
  await expect(body).toHaveAttribute('data-slide', '0');

  // Arrows skip while paused; past the last slide moves to the next deck.
  await player.keyboard.press('ArrowRight');
  await player.keyboard.press('ArrowRight');
  await expect(body).toHaveAttribute('data-slide', '2');
  await expect(player.locator('#counter')).toHaveText('3 / 4');
  await player.keyboard.press('ArrowLeft');
  await expect(body).toHaveAttribute('data-slide', '1');
  await expect(body).toHaveAttribute('data-shown', '1:1');
  await player.keyboard.press('Space'); // resume
  await expect(body).toHaveAttribute('data-phase', 'playing');

  // X exits mid-deck; editor offers to resume at that PDF.
  let closed = player.waitForEvent('close');
  await player.keyboard.press('x');
  await closed;
  await expect(editor.locator('#playLabel')).toHaveText('Play from #2');
  await expect(editor.locator('#playFromStart')).toBeVisible();

  // Resume starts at deck 2 slide 1; Backspace (Mac "delete") also exits.
  player = await openPlayer(app, editor);
  await expect(player.locator('body')).toHaveAttribute('data-deck', '1');
  await expect(player.locator('body')).toHaveAttribute('data-slide', '0');
  closed = player.waitForEvent('close');
  await player.keyboard.press('Backspace');
  await closed;

  // Play from a specific row via its ▶ button.
  player = await openPlayer(app, editor, () => editor.locator('.row').nth(2).locator('.play-here').click());
  await expect(player.locator('body')).toHaveAttribute('data-deck', '2');
  closed = player.waitForEvent('close');
  await player.keyboard.press('Delete');
  await closed;
  await app.close();
});

test('player window is fullscreen on the chosen display', async () => {
  const { app, editor } = await launch();
  await setupEvent(app, editor, { files: [fx('charlie-3-slides.pdf')] });
  const options = await editor.locator('#displaySelect option').allTextContents();
  console.log('display options:', options);
  expect(options[0]).toBe('Main display (automatic)');
  expect(options.length).toBeGreaterThan(1);
  // Pick the last display (an external one when connected).
  const lastIndex = options.length - 1;
  await editor.selectOption('#displaySelect', { index: lastIndex });
  const chosenId = Number(await editor.locator('#displaySelect').inputValue());
  const player = await openPlayer(app, editor);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('Presenting'));
    return w ? w.isFullScreen() : null;
  }), { timeout: 5000 }).toBe(true);
  const onDisplay = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('Presenting'));
    return screen.getDisplayMatching(w.getBounds()).id;
  });
  expect(onDisplay).toBe(chosenId);
  await player.waitForTimeout(800);
  await player.screenshot({ path: path.join(SHOTS, 'player-on-chosen-display.png') });
  // F re-enters fullscreen after leaving it.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('Presenting')).setFullScreen(false);
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('Presenting')).isFullScreen()), { timeout: 5000 }).toBe(false);
  await player.keyboard.press('f');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('Presenting')).isFullScreen()), { timeout: 5000 }).toBe(true);
  const closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;
  await app.close();
});
