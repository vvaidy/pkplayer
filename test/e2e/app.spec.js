// End-to-end tests: drive the real Electron app with Playwright.
import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';

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

/** Make the native "Export theme" dialog save to the given path. */
async function stubSaveDialog(app, filePath) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, filePath);
}

const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const GHOSTTY_THEME = [
  'palette = 1=#ee5566', 'palette = 2=#55cc88', 'palette = 3=#ddbb55', 'palette = 4=#5599ee',
  'background = #0c1014', 'foreground = #d8e0e6', '',
].join('\n');

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

test('editor: pre-flight flags short decks and the odd-shaped deck', async () => {
  const { app, editor } = await launch();
  await editor.click('#newEvent');
  await editor.fill('#eventName', 'Preflight Night');
  await editor.press('#eventName', 'Enter');
  await editor.fill('#maxSlides', '5');
  await editor.press('#maxSlides', 'Enter');
  await expect(editor.locator('#preset')).toHaveValue('custom');
  await stubOpenDialog(app, [
    fx('alpha-5-slides.pdf'),
    fx('bravo-25-slides.pdf'),
    fx('delta-4x3-4-slides.pdf'),
    fx('charlie-3-slides.pdf'),
  ]);
  await editor.click('#addPdfs');
  await expect(editor.locator('.row')).toHaveCount(4);
  const warns = (i) => editor.locator('.row').nth(i).locator('.badge.warn');

  // Custom format: Max slides is only a cap, so short decks are fine. The 4:3 deck is the odd one out.
  await expect(warns(2)).toHaveText(['4:3, most are 16:9']);
  await expect(warns(0)).toHaveCount(0);
  await expect(warns(1)).toHaveText(['only first 5 play']);
  await expect(warns(3)).toHaveCount(0);
  await expect(editor.locator('#summary .attention')).toHaveText('2 decks need a look');

  // A named format expects full decks, so short ones are flagged too.
  await editor.selectOption('#preset', 'pechakucha');
  await expect(warns(0)).toHaveText(['only 5 slides']);
  await expect(warns(1)).toHaveText(['only first 20 play']);
  await expect(warns(2)).toHaveText(['only 4 slides', '4:3, most are 16:9']);
  await expect(warns(3)).toHaveText(['only 3 slides']);
  await expect(editor.locator('#summary .attention')).toHaveText('4 decks need a look');
  await editor.screenshot({ path: path.join(SHOTS, 'editor-preflight.png') });

  // Back to a cap with nothing over it: only the shape warning is left.
  await editor.fill('#maxSlides', '30');
  await editor.press('#maxSlides', 'Enter');
  await expect(editor.locator('#summary .attention')).toHaveText('1 deck needs a look');

  // With one 16:9 deck and one 4:3 deck there is no majority, so neither is flagged.
  for (const name of ['bravo-25-slides.pdf', 'charlie-3-slides.pdf']) {
    await editor.locator('.row', { hasText: name }).focus();
    await editor.keyboard.press('Delete');
    await expect(editor.locator('.row', { hasText: name })).toHaveCount(0);
  }
  expect(await rowNames(editor)).toEqual(['alpha-5-slides.pdf', 'delta-4x3-4-slides.pdf']);
  await expect(editor.locator('.badge.warn')).toHaveCount(0);
  await expect(editor.locator('#summary .attention')).toHaveCount(0);
  await app.close();
});

test('editor: presenter and talk title default from the PDF, can be edited and cleared, and persist', async () => {
  const { app, editor } = await launch();
  await editor.click('#newEvent');
  await editor.fill('#eventName', 'Names Night');
  await editor.press('#eventName', 'Enter');
  await stubOpenDialog(app, [fx('alpha-5-slides.pdf'), fx('bravo-25-slides.pdf'), fx('delta-4x3-4-slides.pdf')]);
  await editor.click('#addPdfs');
  await expect(editor.locator('.row')).toHaveCount(3);
  const field = (page, i, key) => page.locator('.row').nth(i).locator(`.who-input.${key}`);

  // Defaults: real properties are used, missing ones and office placeholders are not.
  await expect(field(editor, 2, 'presenter')).toHaveValue('Dana Lee');
  await expect(field(editor, 2, 'title')).toHaveValue('Delta Talk');
  await expect(field(editor, 0, 'presenter')).toHaveValue('');
  await expect(field(editor, 0, 'title')).toHaveValue('');
  await expect(field(editor, 1, 'presenter')).toHaveValue('');
  await expect(field(editor, 1, 'title')).toHaveValue('');
  await editor.screenshot({ path: path.join(SHOTS, 'editor-names.png') });

  // Typing saves on Enter; Escape puts the saved value back.
  await field(editor, 0, 'presenter').fill('  Asha   Rao ');
  await field(editor, 0, 'presenter').press('Enter');
  await expect(field(editor, 0, 'presenter')).toHaveValue('Asha Rao');
  await field(editor, 0, 'presenter').fill('Someone Else');
  await field(editor, 0, 'presenter').press('Escape');
  await expect(field(editor, 0, 'presenter')).toHaveValue('Asha Rao');

  // Typing in a field must not trigger row shortcuts (Delete removes a row, F plays).
  await field(editor, 0, 'title').fill('Fx');
  await field(editor, 0, 'title').press('Backspace');
  await field(editor, 0, 'title').press('Delete');
  await field(editor, 0, 'title').press('Enter');
  await expect(editor.locator('.row')).toHaveCount(3);
  await expect(field(editor, 0, 'title')).toHaveValue('F');
  expect(app.windows().length).toBe(1);

  // Clearing a default sticks.
  await field(editor, 2, 'title').fill('');
  await field(editor, 2, 'title').press('Enter');

  // A reorder rebuilds the rows: values follow their decks.
  await editor.locator('.row').first().focus();
  await editor.keyboard.press('Alt+ArrowDown');
  expect(await rowNames(editor)).toEqual(['bravo-25-slides.pdf', 'alpha-5-slides.pdf', 'delta-4x3-4-slides.pdf']);
  await expect(field(editor, 1, 'presenter')).toHaveValue('Asha Rao');

  // Everything persists across a restart, and the cleared default does not come back.
  await app.close();
  const { app: app2, editor: editor2 } = await launch();
  await expect(editor2.locator('.row')).toHaveCount(3);
  await expect(field(editor2, 1, 'presenter')).toHaveValue('Asha Rao');
  await expect(field(editor2, 1, 'title')).toHaveValue('F');
  await expect(field(editor2, 2, 'presenter')).toHaveValue('Dana Lee');
  await expect(field(editor2, 2, 'title')).toHaveValue('');
  await expect(field(editor2, 0, 'presenter')).toHaveValue('');
  await app2.close();
});

test('editor: Theme menu recolors the window, lists the library, and persists', async () => {
  const { app, editor } = await launch();
  const windowBg = (a) => a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase());

  // A fresh install starts on the default theme, with no orange anywhere.
  await expect(editor.locator('#themeSelect')).toHaveValue('midnight-teal');
  expect(await cssVar(editor, '--accent')).toBe('#2dd4bf');
  expect(await windowBg(app)).toBe('#0e1519');
  await expect(editor.locator('#themeSelect option')).toHaveCount(11);
  await expect(editor.locator('#themeSelect optgroup')).toHaveCount(2);

  await editor.click('#newEvent');
  await editor.fill('#eventName', 'Theme Night');
  await editor.press('#eventName', 'Enter');
  await stubOpenDialog(app, [fx('alpha-5-slides.pdf'), fx('bravo-25-slides.pdf'), fx('delta-4x3-4-slides.pdf')]);
  await editor.click('#addPdfs');
  await expect(editor.locator('.row')).toHaveCount(3);
  await editor.locator('.toast').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});

  // The old look is still there, exactly.
  await editor.selectOption('#themeSelect', 'vibe-with-claude');
  expect(await cssVar(editor, '--accent')).toBe('#ff5a36');
  expect(await cssVar(editor, '--bg')).toBe('#14161a');
  expect(await windowBg(app)).toBe('#14161a');
  await expect(editor.locator('#playBtn')).toHaveCSS('background-color', 'rgb(255, 90, 54)');

  // Every theme applies and sets the page's light/dark mode.
  for (const id of ['midnight-teal', 'blueprint', 'graphite', 'projector', 'sage', 'paper']) {
    await editor.selectOption('#themeSelect', id);
    await expect(editor.locator('html')).toHaveAttribute('data-theme', id);
    await editor.waitForTimeout(300); // let the 0.12 s color transitions finish before the picture
    await editor.screenshot({ path: path.join(SHOTS, `theme-${id}.png`) });
  }
  expect(await editor.evaluate(() => document.documentElement.style.colorScheme)).toBe('light');
  await expect(editor.locator('body')).toHaveCSS('background-color', 'rgb(246, 244, 238)');
  await expect(editor.locator('#playBtn')).toHaveCSS('background-color', 'rgb(47, 91, 234)');

  // The choice survives a restart, and the window opens in the right color.
  await app.close();
  const { app: app2, editor: editor2 } = await launch();
  await expect(editor2.locator('#themeSelect')).toHaveValue('paper');
  await expect(editor2.locator('html')).toHaveAttribute('data-theme', 'paper');
  expect(await windowBg(app2)).toBe('#f6f4ee');
  await app2.close();
});

test('editor: customize a theme with live preview, cancel, save, edit and delete', async () => {
  const { app, editor } = await launch();
  const dialog = editor.locator('#themeDialog');
  const windowBg = (a) => a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase());

  // Customizing a built-in theme starts a copy; the built-in one is never changed.
  await editor.click('#themeCustomize');
  await expect(dialog).toBeVisible();
  await expect(editor.locator('#themeDialogTitle')).toHaveText('New theme from Midnight Teal');
  await expect(editor.locator('#themeName')).toHaveValue('Midnight Teal copy');
  await expect(editor.locator('#themeHex-accent')).toHaveValue('#2dd4bf');
  await expect(editor.locator('#themeDelete')).toBeHidden();
  await expect(editor.locator('#themeExport')).toBeHidden();

  // Typing a color repaints the window at once, and the picker follows the hex field.
  await editor.fill('#themeHex-accent', '#ff00aa');
  expect(await cssVar(editor, '--accent')).toBe('#ff00aa');
  await expect(editor.locator('#themeColor-accent')).toHaveValue('#ff00aa');
  // A half-typed color is marked and ignored, not applied.
  await editor.fill('#themeHex-bg', '#12');
  await expect(editor.locator('#themeHex-bg')).toHaveClass(/invalid/);
  expect(await cssVar(editor, '--bg')).toBe('#0e1519');
  await expect(editor.locator('#themeNote')).toContainText('not valid');
  await editor.click('#themeSave'); // refused: the dialog stays open and nothing is saved
  await expect(dialog).toBeVisible();
  await expect(editor.locator('#themeNote')).toContainText('not valid');
  await expect(editor.locator('#themeSelect optgroup')).toHaveCount(2);
  await editor.screenshot({ path: path.join(SHOTS, 'theme-editor.png') });

  // The Play shortcut is off while the dialog is open.
  await editor.locator('#themeCancel').focus();
  await editor.keyboard.press('f');
  expect(app.windows().length).toBe(1);

  // Cancel (and Esc) throw the changes away.
  await editor.click('#themeCancel');
  await expect(dialog).toBeHidden();
  expect(await cssVar(editor, '--accent')).toBe('#2dd4bf');
  await expect(editor.locator('#themeSelect optgroup')).toHaveCount(2);
  await editor.click('#themeCustomize');
  await editor.fill('#themeHex-accent', '#00ff00');
  await editor.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await cssVar(editor, '--accent')).toBe('#2dd4bf');

  // Save makes a new theme under "Your themes" and selects it.
  await editor.click('#themeCustomize');
  await editor.fill('#themeName', 'Harbor Lights');
  await editor.fill('#themeHex-accent', '#ff00aa');
  await editor.fill('#themeHex-bg', '#101020');
  await editor.click('#themeSave');
  await expect(dialog).toBeHidden();
  await expect(editor.locator('#themeSelect optgroup')).toHaveCount(3);
  await expect(editor.locator('#themeSelect optgroup[label="Your themes"] option')).toHaveText(['Harbor Lights']);
  await expect(editor.locator('#themeSelect option:checked')).toHaveText('Harbor Lights');
  expect(await cssVar(editor, '--accent')).toBe('#ff00aa');
  expect(await windowBg(app)).toBe('#101020');

  // A light background turns the whole theme light.
  await editor.click('#themeCustomize');
  await expect(editor.locator('#themeDialogTitle')).toHaveText('Customize theme');
  await expect(editor.locator('#themeDelete')).toBeVisible();
  await editor.fill('#themeHex-bg', '#f4f4f0');
  await editor.fill('#themeHex-text', '#202020');
  expect(await editor.evaluate(() => document.documentElement.style.colorScheme)).toBe('light');
  // A poor pick is shown adjusted, and says so.
  await editor.fill('#themeHex-accent', '#f0f0e8');
  await expect(editor.locator('#themeNote')).toContainText('Accent');
  expect(await cssVar(editor, '--accent')).not.toBe('#f0f0e8');
  await editor.fill('#themeHex-accent', '#b0005a');
  // The yellow, red and green picked for a dark background are still being adjusted for the light one.
  await expect(editor.locator('#themeNote')).not.toContainText('Accent');
  await expect(editor.locator('#themeNote')).toContainText('Warning');
  await editor.click('#themeSave');
  await expect(editor.locator('#themeSelect option')).toHaveCount(12); // edited in place, not duplicated

  // It survives a restart, and the window opens already in its colors.
  await app.close();
  const { app: app2, editor: editor2 } = await launch();
  await expect(editor2.locator('#themeSelect option:checked')).toHaveText('Harbor Lights');
  expect(await cssVar(editor2, '--accent')).toBe('#b0005a');
  expect(await windowBg(app2)).toBe('#f4f4f0');
  expect(new URL(editor2.url()).searchParams.get('themeDef')).toContain('Harbor Lights');

  // Built-in themes are still there and unchanged; switching away and back works.
  await editor2.selectOption('#themeSelect', 'midnight-teal');
  expect(await cssVar(editor2, '--accent')).toBe('#2dd4bf');
  await editor2.selectOption('#themeSelect', { label: 'Harbor Lights' });
  expect(await cssVar(editor2, '--accent')).toBe('#b0005a');

  // Delete asks first, then falls back to the default theme.
  await editor2.click('#themeCustomize');
  editor2.once('dialog', (d) => d.dismiss());
  await editor2.click('#themeDelete');
  await expect(editor2.locator('#themeDialog')).toBeVisible();
  editor2.once('dialog', (d) => d.accept());
  await editor2.click('#themeDelete');
  await expect(editor2.locator('#themeDialog')).toBeHidden();
  await expect(editor2.locator('#themeSelect')).toHaveValue('midnight-teal');
  await expect(editor2.locator('#themeSelect optgroup')).toHaveCount(2);
  expect(await cssVar(editor2, '--accent')).toBe('#2dd4bf');
  await app2.close();
});

test('editor: import a terminal theme file, export it, and import it back; bad files are refused', async () => {
  const { app, editor } = await launch();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-themes-'));
  try {
    const ghostty = path.join(work, 'My Terminal Look');
    fs.writeFileSync(ghostty, GHOSTTY_THEME, 'utf-8');
    await stubOpenDialog(app, [ghostty]);
    await editor.click('#themeImport');
    await expect(editor.locator('.toast.ok').last()).toContainText('Imported “My Terminal Look”');
    await expect(editor.locator('#themeSelect option:checked')).toHaveText('My Terminal Look');
    expect(await cssVar(editor, '--bg')).toBe('#0c1014');
    expect(await cssVar(editor, '--accent')).toBe('#5599ee');

    // Export writes a PK Player theme file.
    const out = path.join(work, 'exported.pkplayer-theme.json');
    await stubSaveDialog(app, out);
    await editor.click('#themeCustomize');
    await editor.click('#themeExport');
    await expect(editor.locator('.toast.ok').last()).toContainText('exported.pkplayer-theme.json');
    await editor.click('#themeCancel');
    const exported = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(exported.format).toBe('pkplayer-theme');
    expect(exported.base.accent).toBe('#5599ee');

    // Importing that file again adds a second theme with a distinct name.
    await stubOpenDialog(app, [out]);
    await editor.click('#themeImport');
    await expect(editor.locator('#themeSelect optgroup[label="Your themes"] option')).toHaveText(['My Terminal Look', 'My Terminal Look 2']);

    // Files that are not themes are refused with a message, and change nothing.
    const notes = path.join(work, 'notes.txt');
    fs.writeFileSync(notes, 'shopping list\nmilk\n', 'utf-8');
    await stubOpenDialog(app, [notes]);
    await editor.click('#themeImport');
    await expect(editor.locator('.toast.error').last()).toContainText('no background and text colors');
    const huge = path.join(work, 'huge.json');
    fs.writeFileSync(huge, 'x'.repeat(600 * 1024), 'utf-8');
    await stubOpenDialog(app, [huge]);
    await editor.click('#themeImport');
    await expect(editor.locator('.toast.error').last()).toContainText('too large');
    await expect(editor.locator('#themeSelect optgroup[label="Your themes"] option')).toHaveCount(2);

    // Cancelling the file dialog is not an error.
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    const errorsBefore = await editor.locator('.toast.error').count();
    await editor.click('#themeImport');
    await editor.waitForTimeout(300);
    expect(await editor.locator('.toast.error').count()).toBeLessThanOrEqual(errorsBefore);
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('editor: Practice a PDF is offered on the first screen, and cancelling it changes nothing', async () => {
  const { app, editor } = await launch();
  await expect(editor.locator('#emptyPractice')).toBeVisible();
  const menuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((i) => (i.submenu ? i.submenu.items.map((x) => x.label) : [])));
  expect(menuLabels).toContain('Practice a PDF…');

  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await editor.click('#emptyPractice');
  await editor.waitForTimeout(400);
  expect(app.windows().length).toBe(1);
  await expect(editor.locator('.toast.error')).toHaveCount(0);
  await expect(editor.locator('.event-item')).toHaveCount(0);
  expect(fs.readdirSync(path.join(dataDir, 'library'))).toEqual([]);

  // A file that is not a PDF is refused with a message, and still nothing is opened or kept.
  await stubOpenDialog(app, [fx('not-a-pdf.pdf')]);
  await editor.click('#emptyPractice');
  await expect(editor.locator('.toast.error').last()).toContainText('Not a PDF file');
  expect(app.windows().length).toBe(1);
  expect(fs.readdirSync(path.join(dataDir, 'library'))).toEqual([]);
  await app.close();
});

test('editor: Speedrun test asks first, offers only 5×, 10× and 20×, and cannot start by accident', async () => {
  const { app, editor } = await launch();
  const dialog = editor.locator('#speedDialog');

  // The menu item exists and has no keyboard shortcut.
  const item = await app.evaluate(({ Menu }) => {
    const found = Menu.getApplicationMenu().items.flatMap((i) => (i.submenu ? i.submenu.items : [])).find((x) => x.label === 'Speedrun Test…');
    return found ? { accelerator: found.accelerator || null } : null;
  });
  expect(item).toEqual({ accelerator: null });

  // With nothing to play there is nothing to test.
  await editor.click('#newEvent');
  await editor.fill('#eventName', 'Speed Night');
  await editor.press('#eventName', 'Enter');
  await editor.click('#speedrunOpen');
  await expect(editor.locator('.toast').last()).toContainText('Add at least one PDF');
  await expect(dialog).toBeHidden();

  await stubOpenDialog(app, [fx('alpha-5-slides.pdf'), fx('bravo-25-slides.pdf')]);
  await editor.click('#addPdfs');
  await expect(editor.locator('.row')).toHaveCount(2);
  await expect(editor.locator('.row').nth(1)).toContainText('25 pages');

  // The dialog says what it is, offers exactly three speeds, and starts on 10×.
  await editor.click('#speedrunOpen');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('This is a test, not a real run.');
  await expect(editor.locator('#speedChoices .speed-name')).toHaveText(['5×', '10×', '20×']);
  await expect(editor.locator('#speedChoices input:checked')).toHaveValue('10');
  await expect(editor.locator('#speedChoices label').nth(1)).toContainText('2 s per slide · about 0:52 for 25 slides'); // 5 + 20 slides
  await expect(editor.locator('#speedCancel')).toBeFocused();
  await editor.screenshot({ path: path.join(SHOTS, 'speedrun-dialog.png') });

  // Enter on a freshly opened dialog cancels; so do Cancel, Esc and the F key. Nothing starts.
  await editor.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await editor.click('#speedrunOpen');
  await editor.keyboard.press('f');
  await editor.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await editor.click('#speedrunOpen');
  await editor.locator('#speedChoices input[value="20"]').check();
  await editor.click('#speedCancel');
  await expect(dialog).toBeHidden();
  expect(app.windows().length).toBe(1);

  // The choice is not remembered: it opens on 10× again.
  await editor.click('#speedrunOpen');
  await expect(editor.locator('#speedChoices input:checked')).toHaveValue('10');
  await editor.click('#speedCancel');

  // The main process refuses any other speed, including normal and slow motion, and opens nothing.
  const eventId = await editor.evaluate(async () => (await window.pk.listEvents())[0].id);
  for (const bad of [1, 0.5, 2, 100, -10, 'fast', null]) {
    const message = await editor.evaluate(async ([id, f]) => window.pk.speedrun(id, f).then(() => 'opened', (e) => e.message), [eventId, bad]);
    expect(message).toContain('must be 5, 10 or 20');
  }
  expect(app.windows().length).toBe(1);

  // Nothing about speed is ever written to disk.
  const saved = fs.readFileSync(path.join(dataDir, 'events.json'), 'utf-8');
  expect(saved).not.toMatch(/speedrun|factor/i);
  await app.close();
});

test('reader: a deck opens with every page, thumbnails, zoom, selectable text and search', async () => {
  const { app, editor } = await launch();
  await setupEvent(app, editor, { files: [fx('alpha-5-slides.pdf'), fx('bravo-25-slides.pdf')] });
  const openReader = async (trigger) => {
    const [win] = await Promise.all([app.waitForEvent('window'), trigger()]);
    await win.waitForSelector('body[data-ready="1"]');
    return win;
  };

  const reader = await openReader(() => editor.locator('.row').nth(1).locator('.read').click());
  expect(await reader.title()).toBe('bravo-25-slides.pdf — PK Player Reader');
  await expect(reader.locator('#docName')).toHaveText('bravo-25-slides.pdf');
  await expect(reader.locator('html')).toHaveAttribute('data-theme', 'midnight-teal');

  // Every page is there, not just the 4 this event would play.
  await expect(reader.locator('#pageCount')).toHaveText('/ 25');
  await expect(reader.locator('.page')).toHaveCount(25);
  await expect(reader.locator('.thumb-item')).toHaveCount(25);
  await expect(reader.locator('.page').first()).toHaveAttribute('data-drawn', '1');
  await expect(reader.locator('.page').first().locator('canvas')).toHaveCount(1);
  // Only pages near the view are drawn; the far ones wait.
  await expect(reader.locator('.page').nth(24).locator('canvas')).toHaveCount(0);
  await expect(reader.locator('.thumb-item').first().locator('canvas')).toHaveCount(1);
  // The text is real text: it can be selected and copied.
  await expect(reader.locator('.page').first().locator('.textLayer span').filter({ hasText: 'slide 1 of 25' })).toHaveCount(1);

  // Page navigation: type a number, use the buttons, click a thumbnail, press keys.
  await expect(reader.locator('#pageInput')).toHaveValue('1');
  await expect(reader.locator('#prevPage')).toBeDisabled();
  await reader.fill('#pageInput', '7');
  await reader.press('#pageInput', 'Enter');
  await expect(reader.locator('body')).toHaveAttribute('data-page', '7');
  await expect(reader.locator('.page').nth(6)).toHaveAttribute('data-drawn', '1');
  await expect(reader.locator('.thumb-item').nth(6)).toHaveClass(/current/);
  await reader.click('#nextPage');
  await expect(reader.locator('#pageInput')).toHaveValue('8');
  await reader.locator('.thumb-item').nth(2).click();
  await expect(reader.locator('#pageInput')).toHaveValue('3');
  await reader.locator('#pages').focus();
  await reader.keyboard.press('ArrowRight');
  await expect(reader.locator('#pageInput')).toHaveValue('4');
  await reader.keyboard.press('End');
  await expect(reader.locator('#pageInput')).toHaveValue('25');
  await expect(reader.locator('#nextPage')).toBeDisabled();
  await reader.fill('#pageInput', '999'); // out of range: goes to the last page, never errors
  await reader.press('#pageInput', 'Enter');
  await expect(reader.locator('#pageInput')).toHaveValue('25');
  await reader.keyboard.press('Home');
  await expect(reader.locator('#pageInput')).toHaveValue('1');

  // Zoom: starts fitted to the window's width; the buttons and menu change it.
  const pageWidth = () => reader.locator('.page').first().evaluate((el) => el.getBoundingClientRect().width);
  await expect(reader.locator('#zoomSelect')).toHaveValue('fit-width');
  const fitted = await pageWidth();
  const room = await reader.locator('#pages').evaluate((el) => el.clientWidth);
  expect(fitted).toBeGreaterThan(room - 60);
  expect(fitted).toBeLessThanOrEqual(room);
  await reader.selectOption('#zoomSelect', '0.5');
  await expect(reader.locator('body')).toHaveAttribute('data-zoom', '50%');
  expect(Math.round(await pageWidth())).toBe(853); // the page is 1280 points wide: 1280 x 96/72 pixels at 100%, half that here
  await reader.click('#zoomIn');
  await expect(reader.locator('body')).toHaveAttribute('data-zoom', '75%');
  await reader.click('#zoomOut');
  await reader.click('#zoomOut');
  await expect(reader.locator('body')).toHaveAttribute('data-zoom', '50%'); // stops at the lowest step
  await reader.selectOption('#zoomSelect', 'fit-page');
  const box = await reader.locator('#pages').evaluate((el) => el.clientHeight);
  expect(await reader.locator('.page').first().evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(box);
  await expect(reader.locator('.page').first()).toHaveAttribute('data-drawn', '1'); // redrawn at the new size
  // Hiding the thumbnails gives the page more room.
  await reader.selectOption('#zoomSelect', 'fit-width');
  const withThumbs = await pageWidth();
  await reader.click('#toggleThumbs');
  await expect(reader.locator('#thumbs')).toBeHidden();
  expect(await pageWidth()).toBeGreaterThan(withThumbs + 100);
  await reader.click('#toggleThumbs');

  // Search: counts matches, jumps to them, highlights them, and wraps around.
  await reader.fill('#findInput', 'SLIDE 12 OF 25');
  await expect(reader.locator('#findCount')).toHaveText('1 of 1');
  await expect(reader.locator('body')).toHaveAttribute('data-page', '12');
  await expect(reader.locator('mark.current')).toHaveText('slide 12 of 25');
  await expect(reader.locator('.thumb-item').nth(11).locator('.hits')).toHaveText('1 match');
  await reader.fill('#findInput', 'of 25');
  await expect(reader.locator('#findCount')).toHaveText('12 of 25'); // starts from the page being read
  await reader.press('#findInput', 'Enter');
  await expect(reader.locator('#findCount')).toHaveText('13 of 25');
  await expect(reader.locator('body')).toHaveAttribute('data-page', '13');
  await reader.press('#findInput', 'Shift+Enter');
  await reader.click('#findPrev');
  await expect(reader.locator('#findCount')).toHaveText('11 of 25');
  for (let i = 0; i < 15; i += 1) await reader.click('#findNext');
  await expect(reader.locator('#findCount')).toHaveText('1 of 25'); // wrapped past the end
  await expect(reader.locator('body')).toHaveAttribute('data-page', '1');
  await expect(reader.locator('mark.current')).toHaveText('of 25'); // highlighted once the page is drawn
  await expect(reader.locator('.page').first().locator('mark')).toHaveCount(1);
  await reader.screenshot({ path: path.join(SHOTS, 'reader.png') });
  await reader.fill('#findInput', 'zebra crossing');
  await expect(reader.locator('#findCount')).toHaveText('No matches');
  await expect(reader.locator('mark')).toHaveCount(0);
  await expect(reader.locator('#findNext')).toBeDisabled();
  await reader.press('#findInput', 'Escape');
  await expect(reader.locator('#findCount')).toHaveText('');
  await expect(reader.locator('#findInput')).toHaveValue('');

  // Grid view: every page at once, with the pages this event will not play set apart.
  await expect(reader.locator('body')).toHaveAttribute('data-view', 'pages');
  await reader.fill('#pageInput', '6');
  await reader.press('#pageInput', 'Enter');
  await reader.click('#toggleGrid');
  await expect(reader.locator('body')).toHaveAttribute('data-view', 'grid');
  await expect(reader.locator('#readerBody')).toBeHidden();
  await expect(reader.locator('#gridTiles .thumb-item')).toHaveCount(25);
  await expect(reader.locator('#gridInfo')).toHaveText('25 pages · this event plays the first 4; 21 more are not played');
  await expect(reader.locator('#gridTiles .thumb-item.beyond')).toHaveCount(21);
  await expect(reader.locator('#gridTiles .thumb-item').nth(3)).not.toHaveClass(/beyond/);
  await expect(reader.locator('#gridTiles .thumb-item').nth(4)).toHaveClass(/beyond/);
  await expect(reader.locator('#gridTiles .thumb-item').nth(4).locator('.thumb-label')).toHaveText('5 · not played');
  await expect(reader.locator('#gridTiles .thumb-item').nth(5)).toHaveClass(/current/); // the page being read
  await expect(reader.locator('#gridTiles .thumb-item').first().locator('canvas')).toHaveCount(1);
  await expect(reader.locator('#zoomIn')).toBeDisabled(); // zoom belongs to the page view
  // The thumbnail strip marks the same pages.
  expect(await reader.locator('#thumbs .thumb-item.beyond').count()).toBe(21);
  // Search works from the grid: counts appear on the tiles, and Enter moves between pages.
  await reader.fill('#findInput', 'slide 20 of 25');
  await expect(reader.locator('#findCount')).toHaveText('1 of 1');
  await expect(reader.locator('#gridTiles .thumb-item').nth(19).locator('.hits')).toHaveText('1 match');
  await expect(reader.locator('#gridTiles .thumb-item').nth(19)).toHaveClass(/current/);
  await expect(reader.locator('body')).toHaveAttribute('data-view', 'grid'); // searching does not leave the grid
  await reader.screenshot({ path: path.join(SHOTS, 'reader-grid.png') });
  await reader.press('#findInput', 'Escape');
  // Clicking a page opens it in the page view.
  await reader.locator('#gridTiles .thumb-item').nth(8).click();
  await expect(reader.locator('body')).toHaveAttribute('data-view', 'pages');
  await expect(reader.locator('#pageInput')).toHaveValue('9');
  await expect(reader.locator('.page').nth(8)).toHaveAttribute('data-drawn', '1');
  await expect(reader.locator('#zoomIn')).toBeEnabled();
  expect(await pageWidth()).toBeGreaterThan(300); // the page column was laid out again at a real size
  // G toggles the grid; Esc goes back to the page that was being read.
  await reader.locator('#pages').focus();
  await reader.keyboard.press('g');
  await expect(reader.locator('body')).toHaveAttribute('data-view', 'grid');
  await reader.keyboard.press('Escape');
  await expect(reader.locator('body')).toHaveAttribute('data-view', 'pages');
  await expect(reader.locator('#pageInput')).toHaveValue('9');
  await reader.click('#toggleGrid');
  await reader.click('#toggleGrid');
  await expect(reader.locator('#pageInput')).toHaveValue('9');

  // The reader only ever gets the file it was opened for.
  expect(await reader.evaluate(() => fetch('app://bundle/external/not-a-real-token').then((r) => r.status))).toBeGreaterThanOrEqual(400);

  // File > Open PDF in Reader: any PDF from disk, without adding it to an event.
  const clickMenu = (label) => app.evaluate(({ Menu }, l) => {
    Menu.getApplicationMenu().items.flatMap((i) => (i.submenu ? i.submenu.items : [])).find((x) => x.label === l).click();
  }, label);
  await stubOpenDialog(app, [fx('charlie-3-slides.pdf')]);
  const second = await openReader(() => clickMenu('Open PDF in Reader…'));
  await expect(second.locator('#pageCount')).toHaveText('/ 3');
  // A PDF opened on its own belongs to no event, so no page is marked as not played.
  await second.click('#toggleGrid');
  await expect(second.locator('#gridInfo')).toHaveText('3 pages');
  await expect(second.locator('#gridTiles .thumb-item.beyond')).toHaveCount(0);
  await second.click('#toggleGrid');
  await expect(second.locator('.page').first()).toHaveAttribute('data-drawn', '1');
  expect(await second.title()).toBe('charlie-3-slides.pdf — PK Player Reader');
  expect(await rowNames(editor)).toEqual(['alpha-5-slides.pdf', 'bravo-25-slides.pdf']); // nothing was added
  expect(fs.readdirSync(path.join(dataDir, 'library')).length).toBe(2); // and nothing was copied

  // Not a PDF: refused with a message, no window.
  await stubOpenDialog(app, [fx('not-a-pdf.pdf')]);
  await clickMenu('Open PDF in Reader…');
  await expect(editor.locator('.toast.error').last()).toContainText('Not a PDF file');
  expect(app.windows().length).toBe(3);

  // Double-clicking a thumbnail in the playlist opens the reader too.
  const third = await openReader(() => editor.locator('.row').first().locator('.thumb').dblclick());
  await expect(third.locator('#pageCount')).toHaveText('/ 5');
  await third.keyboard.press('g');
  await expect(third.locator('#gridInfo')).toHaveText('5 pages · this event plays the first 4; 1 more is not played');

  // Reader windows close with the editor.
  await second.close();
  expect(app.windows().length).toBe(3);
  await app.close();
});

test('editor: a deck can play a page range, and counts, warnings and the reader follow it', async () => {
  const { app, editor } = await launch();
  // 1 s per slide, 4 slides max, Custom format: bravo has 25 pages, alpha 5.
  await setupEvent(app, editor, { files: [fx('bravo-25-slides.pdf'), fx('alpha-5-slides.pdf')] });
  const row = editor.locator('.row').first();
  const first = row.locator('.range-input.firstPage');
  const last = row.locator('.range-input.lastPage');
  const badges = () => row.locator('.badge').allTextContents();
  const set = async (input, value) => {
    await input.fill(value);
    await input.press('Enter');
  };

  // No range: from page 1, capped by Max slides, exactly as before.
  await expect(first).toHaveValue('');
  await expect(last).toHaveValue('');
  expect(await badges()).toEqual(['25 pages', 'only first 4 play', '0:04']);
  await expect(editor.locator('#summary')).toContainText('8 slides');

  // Start at page 3: still capped at 4 slides, and the badge names the pages.
  await set(first, '3');
  await expect(row.locator('.badge.warn')).toHaveText(['only pages 3–6 play']);
  await expect(editor.locator('#summary')).toContainText('8 slides');

  // Stop at page 5: three pages, under the cap, so it is information and not a warning.
  await set(last, '5');
  await expect.poll(badges).toEqual(['25 pages', 'plays pages 3–5', '0:03']);
  await expect(editor.locator('#summary')).toContainText('7 slides');
  await expect(editor.locator('#summary .attention')).toHaveText('1 deck needs a look'); // only the 5-page deck now

  // Bad values are refused with a message and the field goes back.
  await set(first, 'abc');
  await expect(editor.locator('.toast.error').last()).toContainText('First page must be a whole number');
  await expect(first).toHaveValue('3');
  await set(last, '2');
  await expect(editor.locator('.toast.error').last()).toContainText('must not be before the first page');
  await expect(last).toHaveValue('5');
  await set(first, '0');
  await expect(first).toHaveValue('3');
  // Typing in the fields never triggers the row's own keys (Delete removes a row, Enter plays).
  await first.press('Delete');
  await first.press('Backspace');
  await first.press('Escape');
  await expect(editor.locator('.row')).toHaveCount(2);
  await expect(first).toHaveValue('3');
  expect(app.windows().length).toBe(1);

  // A range that starts past the end plays nothing, and says so in red.
  await set(last, '');
  await set(first, '30');
  await expect(row.locator('.badge.err')).toHaveText('starts at page 30, past the end — nothing plays');
  await expect(editor.locator('#summary')).toContainText('4 slides');
  await expect(editor.locator('#summary .attention')).toHaveText('2 decks need a look');

  // Page 1 is the same as no first page; clearing both restores the plain deck.
  await set(first, '1');
  await expect(first).toHaveValue('');
  await expect.poll(badges).toEqual(['25 pages', 'only first 4 play', '0:04']);

  // The speedrun estimate follows the range too.
  await set(first, '2');
  await set(last, '3');
  await editor.click('#speedrunOpen');
  await expect(editor.locator('#speedChoices label').nth(1)).toContainText('for 6 slides'); // 2 + 4
  await editor.click('#speedCancel');

  // The range survives a restart...
  await app.close();
  const { app: app2, editor: editor2 } = await launch();
  const row2 = editor2.locator('.row').first();
  await expect(row2.locator('.range-input.firstPage')).toHaveValue('2');
  await expect(row2.locator('.range-input.lastPage')).toHaveValue('3');
  await expect(row2.locator('.badge').nth(1)).toHaveText('plays pages 2–3');

  // ...and the reader marks every page outside it as not played.
  const [reader] = await Promise.all([app2.waitForEvent('window'), row2.locator('.read').click()]);
  await reader.waitForSelector('body[data-ready="1"]');
  await reader.click('#toggleGrid');
  await expect(reader.locator('#gridInfo')).toHaveText('25 pages · this event plays pages 2–3; 23 more are not played');
  await expect(reader.locator('#gridTiles .thumb-item.beyond')).toHaveCount(23);
  await expect(reader.locator('#gridTiles .thumb-item').nth(0)).toHaveClass(/beyond/);
  await expect(reader.locator('#gridTiles .thumb-item').nth(1)).not.toHaveClass(/beyond/);
  await expect(reader.locator('#gridTiles .thumb-item').nth(2)).not.toHaveClass(/beyond/);
  await expect(reader.locator('#gridTiles .thumb-item').nth(3)).toHaveClass(/beyond/);
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


test('player: waiting screen shows presenter and talk title when set, file name when not', async () => {
  const { app, editor } = await launch();
  await setupEvent(app, editor, { files: [fx('delta-4x3-4-slides.pdf'), fx('alpha-5-slides.pdf')] });
  await expect(editor.locator('.row').first().locator('.who-input.presenter')).toHaveValue('Dana Lee');
  // A built-in theme first...
  await editor.selectOption('#themeSelect', 'blueprint');
  let themed = await openPlayer(app, editor);
  await expect(themed.locator('html')).toHaveAttribute('data-theme', 'blueprint');
  expect(await cssVar(themed, '--accent')).toBe('#5aa9ff');
  let themedClosed = themed.waitForEvent('close');
  await themed.keyboard.press('Escape');
  await themedClosed;

  // ...then one of the user's own, which travels to the player in its URL.
  const themeFile = path.join(dataDir, 'Stage Blue');
  fs.writeFileSync(themeFile, GHOSTTY_THEME, 'utf-8');
  await stubOpenDialog(app, [themeFile]);
  await editor.click('#themeImport');
  await expect(editor.locator('#themeSelect option:checked')).toHaveText('Stage Blue');
  const player = await openPlayer(app, editor);
  await expect(player.locator('html')).toHaveAttribute('data-theme', /^custom-/);
  expect(await cssVar(player, '--accent')).toBe('#5599ee');

  await expect(player.locator('#deckPresenter')).toHaveText('Dana Lee');
  await expect(player.locator('#deckTitle')).toHaveText('Delta Talk');
  await expect(player.locator('#deckLabel')).toHaveText('PDF 1 of 2 · 4 slides');
  await player.screenshot({ path: path.join(SHOTS, 'player-waiting-names.png') });

  await player.keyboard.press('n');
  await expect(player.locator('#deckLabel')).toHaveText('PDF 2 of 2 · alpha-5-slides.pdf · 4 slides');
  await expect(player.locator('#deckPresenter')).toBeHidden();
  await expect(player.locator('#deckTitle')).toBeHidden();
  await expect(player.locator('.deck-who')).toBeHidden();

  const closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;
  await app.close();
});

test('practice: plays one PDF with the timer, saves nothing, and uses the selected event\'s timing', async () => {
  const { app, editor } = await launch();
  const practiceFiles = () => fs.readdirSync(path.join(dataDir, 'library')).filter((f) => f.startsWith('practice-'));
  const closePlayer = async (player) => {
    const closed = player.waitForEvent('close');
    await player.keyboard.press('Escape');
    await closed;
  };

  // From the first screen, with no events at all: PechaKucha timing, capped at the deck's own 5 pages.
  await stubOpenDialog(app, [fx('alpha-5-slides.pdf')]);
  let player = await openPlayer(app, editor, () => editor.click('#emptyPractice'));
  await expect(player.locator('#deckLabel')).toHaveText('PDF 1 of 1 · alpha-5-slides.pdf · 5 slides');
  expect(practiceFiles().length).toBe(1);
  await expect(editor.locator('.event-item')).toHaveCount(0);
  await player.keyboard.press('n'); // skip the only deck
  await expect(player.locator('#ended')).toBeVisible();
  await expect(player.locator('.ended-title')).toHaveText('End of practice');
  await closePlayer(player);

  // Nothing is left behind: no event, no copy of the PDF, no resume point.
  await expect.poll(practiceFiles).toEqual([]);
  expect(fs.readdirSync(path.join(dataDir, 'library'))).toEqual([]);
  await expect(editor.locator('.event-item')).toHaveCount(0);
  await expect(editor.locator('#emptyState')).toBeVisible();

  // From the File menu with an event selected: that event's timing is used, and the event is untouched.
  await setupEvent(app, editor, { time: '1', max: '3', files: [fx('charlie-3-slides.pdf')] });
  await stubOpenDialog(app, [fx('bravo-25-slides.pdf')]);
  player = await openPlayer(app, editor, () => app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu().items.flatMap((i) => (i.submenu ? i.submenu.items : [])).find((x) => x.label === 'Practice a PDF…').click();
  }));
  await expect(player.locator('#deckLabel')).toHaveText('PDF 1 of 1 · bravo-25-slides.pdf · 3 slides');
  await player.keyboard.press('Space');
  await expect(player.locator('body')).toHaveAttribute('data-slide', '1', { timeout: 3000 }); // 1 s per slide, from the event
  await closePlayer(player);
  await expect.poll(practiceFiles).toEqual([]);
  await expect(editor.locator('.event-item')).toHaveCount(1);
  expect(await rowNames(editor)).toEqual(['charlie-3-slides.pdf']);
  await expect(editor.locator('#playFromStart')).toBeHidden(); // stopping practice mid-deck sets no resume point
  await app.close();
});

test('speedrun: runs every deck by itself at the chosen speed, reports, and leaves normal Play untouched', async () => {
  const { app, editor } = await launch();
  // 5 s per slide, 4 slides max: alpha plays 4, bravo 4, charlie 3 = 11 slides. At 10x that is 0.5 s each.
  await setupEvent(app, editor, { time: '5', max: '4', files: [fx('alpha-5-slides.pdf'), fx('bravo-25-slides.pdf'), fx('charlie-3-slides.pdf')] });

  await editor.click('#speedrunOpen');
  const started = Date.now();
  const player = await openPlayer(app, editor, () => editor.click('#speedStart'));
  await expect(player.locator('body')).toHaveAttribute('data-speedrun', '10');
  await expect(player.locator('#speedBanner')).toBeVisible();
  await expect(player.locator('#speedBanner')).toHaveText('SPEED TEST 10× — not a real run');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.getTitle().includes('speed test')))).toBe(true);

  // No key is pressed: it gets through all three decks and reports.
  await expect(player.locator('body')).toHaveAttribute('data-deck', '1', { timeout: 15000 });
  await expect(player.locator('#speedBanner')).toBeVisible(); // still labelled mid-run
  await player.screenshot({ path: path.join(SHOTS, 'speedrun-running.png') });
  await expect(player.locator('body')).toHaveAttribute('data-speedrun-done', 'ok', { timeout: 30000 });
  const took = Date.now() - started;
  await expect(player.locator('.ended-title')).toHaveText('Speedrun passed');
  await expect(player.locator('#speedReportSummary')).toHaveText('3 of 3 decks opened · 11 of 11 slides drawn');
  await expect(player.locator('#speedReportLines li')).toHaveCount(0);
  await expect(player.locator('#speedBanner')).toBeVisible();
  await player.screenshot({ path: path.join(SHOTS, 'speedrun-report.png') });
  console.log(`speedrun of 11 slides at 10x took ${took} ms (a normal run is at least 55000 ms)`);
  expect(took).toBeGreaterThan(11 * 500); // every slide had its time
  expect(took).toBeLessThan(30000); // and it really was fast

  let closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;

  // A speedrun leaves no resume point and changes no settings.
  await expect(editor.locator('#playFromStart')).toBeHidden();
  await expect(editor.locator('#timePerSlide')).toHaveValue('5');
  expect(fs.readFileSync(path.join(dataDir, 'events.json'), 'utf-8')).not.toMatch(/speedrun|factor/i);

  // Stopping a speedrun part-way does not set a resume point either.
  await editor.click('#speedrunOpen');
  const second = await openPlayer(app, editor, () => editor.click('#speedStart'));
  await expect(second.locator('body')).toHaveAttribute('data-deck', '1', { timeout: 15000 });
  closed = second.waitForEvent('close');
  await second.keyboard.press('Escape');
  await closed;
  await expect(editor.locator('#playFromStart')).toBeHidden();

  // The very next Play is a normal run: no banner, no auto-start, normal speed.
  const normal = await openPlayer(app, editor);
  expect(await normal.evaluate(() => document.body.dataset.speedrun)).toBeUndefined();
  await expect(normal.locator('#speedBanner')).toBeHidden();
  expect(new URL(normal.url()).searchParams.has('speedrun')).toBe(false);
  await normal.waitForTimeout(2500); // well past the 1 s a speedrun waits on a Play screen
  await expect(normal.locator('body')).toHaveAttribute('data-phase', 'waiting');
  await normal.keyboard.press('Space');
  await normal.waitForTimeout(2000); // a speedrun would be on slide 4 by now; a 5 s slide has not moved
  await expect(normal.locator('body')).toHaveAttribute('data-slide', '0');
  await expect(normal.locator('body')).toHaveAttribute('data-phase', 'playing');
  closed = normal.waitForEvent('close');
  await normal.keyboard.press('Escape');
  await closed;
  await app.close();
});

test('speedrun: an unreadable deck and skipping ahead are reported, not passed', async () => {
  const { app, editor } = await launch();
  await setupEvent(app, editor, { time: '5', max: '4', files: [fx('alpha-5-slides.pdf'), fx('charlie-3-slides.pdf')] });
  // Damage the library copy of the second deck after it was added, as a failing disk or a bad file would.
  const lib = path.join(dataDir, 'library');
  const second = JSON.parse(fs.readFileSync(path.join(dataDir, 'events.json'), 'utf-8')).events[0].items[1].file;
  fs.writeFileSync(path.join(lib, second), 'this is no longer a pdf', 'utf-8');

  await editor.click('#speedrunOpen');
  await editor.locator('#speedChoices input[value="20"]').check();
  const player = await openPlayer(app, editor, () => editor.click('#speedStart'));
  await expect(player.locator('#speedBanner')).toHaveText('SPEED TEST 20× — not a real run');
  await expect(player.locator('body')).toHaveAttribute('data-phase', 'playing', { timeout: 10000 });
  await player.keyboard.press('ArrowRight'); // skip one slide by hand
  await expect(player.locator('body')).toHaveAttribute('data-speedrun-done', 'problems', { timeout: 20000 });
  await expect(player.locator('.ended-title')).toHaveText('Speedrun finished with problems');
  await expect(player.locator('#speedReportSummary')).toContainText('1 of 2 decks opened');
  await expect(player.locator('#speedReportLines li').first()).toContainText('“charlie-3-slides.pdf” could not be opened');
  const closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;
  await app.close();
});

test('player: the progress bar and slide counter show on white, grey and black slides', async () => {
  const { app, editor } = await launch();
  // Slides shaped exactly like this display, in flat white, grey and black. A 16:9 slide on a
  // 16:10 laptop leaves a black band under the slide, and the bar would sit on that band, so
  // ordinary test decks would never put the bar on top of a white slide.
  const display = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().size);
  const decks = [['white', 1], ['grey', 0.5], ['black', 0]];
  const files = [];
  for (const [name, level] of decks) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 2; i += 1) {
      doc.addPage([display.width, display.height]).drawRectangle({
        x: 0, y: 0, width: display.width, height: display.height, color: rgb(level, level, level),
      });
    }
    const file = path.join(dataDir, `flat-${name}.pdf`);
    fs.writeFileSync(file, await doc.save());
    files.push(file);
  }
  await setupEvent(app, editor, { time: '10', max: '2', files });
  const player = await openPlayer(app, editor);

  /**
   * Read real pixels from the player window: the average brightness (0-1, as the eye weighs it) of
   * small patches inside the filled and unfilled parts of the bar, the slide just above the bar,
   * and the counter chip. Measured by Electron itself, so it is what is actually on screen.
   */
  const measure = () => app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('Presenting'));
    const [width, height] = win.getContentSize();
    const strip = 60;
    const img = await win.webContents.capturePage({ x: 0, y: height - strip, width, height: strip });
    const buf = img.toBitmap();
    const scale = Math.sqrt(buf.length / 4 / (width * strip));
    const W = Math.round(width * scale);
    const lum = (x, y, w, h) => { // patch in window points, y measured up from the bottom edge
      let sum = 0;
      let n = 0;
      for (let py = Math.round((strip - y - h) * scale); py < Math.round((strip - y) * scale); py += 1) {
        for (let px = Math.round(x * scale); px < Math.round((x + w) * scale); px += 1) {
          const i = (py * W + px) * 4; // BGRA
          const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          sum += 0.0722 * lin(buf[i]) + 0.7152 * lin(buf[i + 1]) + 0.2126 * lin(buf[i + 2]);
          n += 1;
        }
      }
      return sum / n;
    };
    return {
      filled: lum(width * 0.03, 1, 30, 4), // the bar is 6 points tall; stay inside it
      unfilled: lum(width * 0.6, 1, 30, 4),
      slide: lum(width * 0.6, 12, 30, 20),
      chip: lum(width - 30, 17, 4, 2), // a corner of the counter chip, clear of the digits
    };
  });
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  const expectedSlide = { white: [0.9, 1.01], grey: [0.15, 0.3], black: [-0.01, 0.01] };
  for (const [deck, name] of [[0, 'white'], [1, 'grey'], [2, 'black']]) {
    await expect(player.locator('body')).toHaveAttribute('data-deck', String(deck));
    await player.keyboard.press('Space'); // start this deck
    await expect(player.locator('body')).toHaveAttribute('data-phase', 'playing');
    await expect(player.locator('body')).toHaveAttribute('data-shown', `${deck}:0`);
    await player.waitForTimeout(2500); // 10 s slide: the bar is about a quarter full
    const playing = await measure();
    await player.screenshot({ path: path.join(SHOTS, `progress-on-${name}.png`) });
    await player.keyboard.press('Space'); // pause: the fill turns amber
    await expect(player.locator('body')).toHaveAttribute('data-phase', 'paused');
    await player.waitForTimeout(900); // let the "Paused" flash clear
    const paused = await measure();
    console.log(`progress bar on ${name}: filled/unfilled ${ratio(playing.filled, playing.unfilled).toFixed(1)}, `
      + `bar/slide ${Math.max(ratio(playing.filled, playing.slide), ratio(playing.unfilled, playing.slide)).toFixed(1)}, `
      + `paused ${ratio(paused.filled, paused.unfilled).toFixed(1)}, counter chip/slide ${ratio(playing.chip, playing.slide).toFixed(1)}`);

    // First make sure this really measured the slide and not a letterbox band.
    expect(playing.slide, `${name}: slide brightness`).toBeGreaterThan(expectedSlide[name][0]);
    expect(playing.slide, `${name}: slide brightness`).toBeLessThan(expectedSlide[name][1]);
    // You can see how far the slide has run: the filled and unfilled parts differ clearly.
    expect(ratio(playing.filled, playing.unfilled), `${name}: filled vs unfilled`).toBeGreaterThan(3);
    // You can see the bar at all: at least one of its parts stands out from the slide.
    expect(Math.max(ratio(playing.filled, playing.slide), ratio(playing.unfilled, playing.slide)), `${name}: bar vs slide`).toBeGreaterThan(3);
    // The same holds while paused.
    expect(ratio(paused.filled, paused.unfilled), `${name}: paused fill vs unfilled`).toBeGreaterThan(2.5);
    // The counter's digits are light on a chip that is never bright, whatever the slide.
    expect(playing.chip, `${name}: counter chip is dark enough for light digits`).toBeLessThan(0.2);

    await player.keyboard.press('n'); // next deck (or the end)
  }
  await expect(player.locator('#ended')).toBeVisible();
  const closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;
  await app.close();
});

test('player: a deck with a page range starts and stops on the chosen PDF pages', async () => {
  const { app, editor } = await launch();
  await setupEvent(app, editor, { time: '2', max: '4', files: [fx('bravo-25-slides.pdf'), fx('alpha-5-slides.pdf')] });
  const row = editor.locator('.row').first();
  await row.locator('.range-input.firstPage').fill('3');
  await row.locator('.range-input.firstPage').press('Enter');
  await row.locator('.range-input.lastPage').fill('5');
  await row.locator('.range-input.lastPage').press('Enter');
  await expect(row.locator('.badge').nth(1)).toHaveText('plays pages 3–5');

  const player = await openPlayer(app, editor);
  // Three slides, and the picture behind the Play button is already page 3.
  await expect(player.locator('#deckLabel')).toHaveText('PDF 1 of 2 · bravo-25-slides.pdf · 3 slides');
  await expect(player.locator('body')).toHaveAttribute('data-pdf-page', '3');
  await player.keyboard.press('Space');
  await expect(player.locator('#counter')).toHaveText('1 / 3');
  await expect(player.locator('body')).toHaveAttribute('data-pdf-page', '3');
  await player.keyboard.press('ArrowRight');
  await expect(player.locator('#counter')).toHaveText('2 / 3');
  await expect(player.locator('body')).toHaveAttribute('data-pdf-page', '4');
  await player.keyboard.press('ArrowRight');
  await expect(player.locator('body')).toHaveAttribute('data-pdf-page', '5');
  // The timer, not a key, ends the deck after its last page: the next deck waits on Play at ITS page 1.
  await expect(player.locator('body')).toHaveAttribute('data-deck', '1', { timeout: 6000 });
  await expect(player.locator('body')).toHaveAttribute('data-phase', 'waiting');
  await expect(player.locator('#deckLabel')).toHaveText('PDF 2 of 2 · alpha-5-slides.pdf · 4 slides');
  await expect(player.locator('body')).toHaveAttribute('data-pdf-page', '1');
  // Going back from slide 1 of a ranged deck never shows a page before the range.
  await player.keyboard.press('Space');
  await player.keyboard.press('ArrowLeft');
  await expect(player.locator('body')).toHaveAttribute('data-pdf-page', '1');
  const closed = player.waitForEvent('close');
  await player.keyboard.press('Escape');
  await closed;
  await app.close();
});
