import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRACTICE_EVENT_ID, Store, StoreError, isPdfFile } from '../../src/main/store.js';

let dir;
let src;

function fakePdf(name, body = 'x') {
  const p = path.join(src, name);
  fs.writeFileSync(p, `%PDF-1.4\n${body}\n%%EOF\n`, { encoding: 'utf-8' });
  return p;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-store-'));
  src = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-src-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(src, { recursive: true, force: true });
});

const libFiles = () => fs.readdirSync(path.join(dir, 'library')).sort();

test('creates events with PechaKucha defaults and persists them', () => {
  const s = new Store(dir);
  const ev = s.createEvent('Night 1');
  assert.equal(ev.name, 'Night 1');
  assert.equal(ev.timePerSlide, 20);
  assert.equal(ev.maxSlides, 20);
  assert.deepEqual(ev.items, []);
  const reloaded = new Store(dir);
  assert.deepEqual(reloaded.listEvents(), [ev]);
});

test('blank name gets a default', () => {
  const s = new Store(dir);
  assert.equal(s.createEvent('   ').name, 'Event 1');
});

test('updateEvent validates time and max slides', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  assert.equal(s.updateEvent(ev.id, { timePerSlide: 15, maxSlides: 10, name: 'New' }).timePerSlide, 15);
  assert.equal(s.getEvent(ev.id).name, 'New');
  assert.throws(() => s.updateEvent(ev.id, { timePerSlide: 0 }), StoreError);
  assert.throws(() => s.updateEvent(ev.id, { timePerSlide: 'abc' }), StoreError);
  assert.throws(() => s.updateEvent(ev.id, { maxSlides: 2.5 }), StoreError);
  assert.throws(() => s.updateEvent(ev.id, { maxSlides: 0 }), StoreError);
  assert.equal(s.getEvent(ev.id).maxSlides, 10, 'failed update leaves value unchanged');
  assert.throws(() => s.updateEvent('nope', {}), StoreError);
});

test('returned objects are copies, not live references', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  ev.name = 'hacked';
  assert.equal(s.getEvent(ev.id).name, 'E');
});

test('addPdfs copies into the library and rejects non-PDFs', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  const bad = path.join(src, 'notes.pdf');
  fs.writeFileSync(bad, 'hello', { encoding: 'utf-8' });
  const { added, rejected } = s.addPdfs(ev.id, [fakePdf('a.pdf'), bad, path.join(src, 'missing.pdf')]);
  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'a.pdf');
  assert.equal(rejected.length, 2);
  assert.deepEqual(rejected.map((r) => r.reason), ['Not a PDF file', 'File not found']);
  assert.equal(libFiles().length, 1);
  // Original can disappear without breaking the event.
  fs.rmSync(path.join(src, 'a.pdf'));
  assert.ok(fs.existsSync(s.libraryPath(s.getEvent(ev.id).items[0].file)));
});

test('addPdfs inserts at an index', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  s.addPdfs(ev.id, [fakePdf('a.pdf'), fakePdf('c.pdf')]);
  s.addPdfs(ev.id, [fakePdf('b.pdf')], 1);
  assert.deepEqual(s.getEvent(ev.id).items.map((i) => i.name), ['a.pdf', 'b.pdf', 'c.pdf']);
});

test('reorderItems and moveItem rearrange the playlist', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  s.addPdfs(ev.id, ['a', 'b', 'c'].map((n) => fakePdf(`${n}.pdf`)));
  const ids = s.getEvent(ev.id).items.map((i) => i.id);
  s.reorderItems(ev.id, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(s.getEvent(ev.id).items.map((i) => i.name), ['c.pdf', 'a.pdf', 'b.pdf']);
  s.moveItem(ev.id, ids[2], 2);
  assert.deepEqual(s.getEvent(ev.id).items.map((i) => i.name), ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.throws(() => s.reorderItems(ev.id, [ids[0], ids[0], ids[1]]), StoreError);
  assert.throws(() => s.reorderItems(ev.id, [ids[0]]), StoreError);
});

test('removeItem deletes the library copy when unreferenced', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  s.addPdfs(ev.id, [fakePdf('a.pdf'), fakePdf('b.pdf')]);
  const [a] = s.getEvent(ev.id).items;
  s.removeItem(ev.id, a.id);
  assert.deepEqual(s.getEvent(ev.id).items.map((i) => i.name), ['b.pdf']);
  assert.equal(libFiles().length, 1);
});

test('duplicateEvent shares library files; deleting one event keeps the other working', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  s.addPdfs(ev.id, [fakePdf('a.pdf')]);
  const copy = s.duplicateEvent(ev.id);
  assert.equal(copy.name, 'E copy');
  assert.notEqual(copy.items[0].id, s.getEvent(ev.id).items[0].id);
  assert.equal(copy.items[0].file, s.getEvent(ev.id).items[0].file);
  s.deleteEvent(ev.id);
  assert.equal(libFiles().length, 1, 'file still used by the copy');
  s.deleteEvent(copy.id);
  assert.equal(libFiles().length, 0);
});

test('setItemPageCount stores counts and validates', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  const { added } = s.addPdfs(ev.id, [fakePdf('a.pdf')]);
  s.setItemPageCount(ev.id, added[0].id, 24);
  assert.equal(new Store(dir).getEvent(ev.id).items[0].pageCount, 24);
  assert.throws(() => s.setItemPageCount(ev.id, added[0].id, -1), StoreError);
});

test('new decks have an empty presenter and title', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  const { added } = s.addPdfs(ev.id, [fakePdf('a.pdf')]);
  assert.equal(added[0].presenter, '');
  assert.equal(added[0].title, '');
});

test('updateItem stores presenter and title, tidies them, and persists', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  const { added } = s.addPdfs(ev.id, [fakePdf('a.pdf')]);
  const id = added[0].id;
  const it = s.updateItem(ev.id, id, { presenter: '  Asha   Rao ', title: 'Tiny\nGardens' });
  assert.equal(it.presenter, 'Asha Rao');
  assert.equal(it.title, 'Tiny Gardens');
  // One field at a time leaves the other alone; "" and null clear.
  assert.equal(s.updateItem(ev.id, id, { title: 'New title' }).presenter, 'Asha Rao');
  assert.equal(s.updateItem(ev.id, id, { presenter: '' }).presenter, '');
  assert.equal(s.updateItem(ev.id, id, { title: null }).title, '');
  s.updateItem(ev.id, id, { presenter: 'Marek', title: 'Night Trains' });
  const again = new Store(dir).getEvent(ev.id).items[0];
  assert.deepEqual([again.presenter, again.title, again.name], ['Marek', 'Night Trains', 'a.pdf']);
  assert.equal(s.updateItem(ev.id, id, { presenter: 'x'.repeat(500) }).presenter.length, 200);
});

test('updateItem ignores other fields and rejects bad input', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  const { added } = s.addPdfs(ev.id, [fakePdf('a.pdf')]);
  const id = added[0].id;
  const it = s.updateItem(ev.id, id, { name: 'hacked.pdf', file: '../../etc/passwd', pageCount: 99 });
  assert.deepEqual([it.name, it.file, it.pageCount], ['a.pdf', added[0].file, null]);
  assert.equal(s.updateItem(ev.id, id).presenter, '');
  assert.throws(() => s.updateItem(ev.id, id, { presenter: 42 }), StoreError);
  assert.throws(() => s.updateItem(ev.id, id, { title: { a: 1 } }), StoreError);
  assert.throws(() => s.updateItem(ev.id, 'nope', { title: 'x' }), StoreError);
  assert.throws(() => s.updateItem('nope', id, { title: 'x' }), StoreError);
});

test('events saved by an older version load with empty presenter and title', () => {
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify({
    version: 1,
    settings: { displayId: null },
    events: [{ id: 'e1', name: 'Old', timePerSlide: 20, maxSlides: 20, items: [{ id: 'i1', name: 'a.pdf', file: 'a.pdf', pageCount: 20 }] }],
  }), { encoding: 'utf-8' });
  const it = new Store(dir).getEvent('e1').items[0];
  assert.deepEqual([it.presenter, it.title, it.name, it.pageCount], ['', '', 'a.pdf', 20]);
});

test('duplicateEvent copies presenter and title', () => {
  const s = new Store(dir);
  const ev = s.createEvent('E');
  const { added } = s.addPdfs(ev.id, [fakePdf('a.pdf')]);
  s.updateItem(ev.id, added[0].id, { presenter: 'Asha', title: 'Tiny Gardens' });
  const copy = s.duplicateEvent(ev.id).items[0];
  assert.deepEqual([copy.presenter, copy.title], ['Asha', 'Tiny Gardens']);
});

test('settings persist', () => {
  const s = new Store(dir);
  assert.deepEqual(s.getSettings(), { displayId: null, theme: 'midnight-teal' });
  s.updateSettings({ displayId: '12345' });
  assert.equal(new Store(dir).getSettings().displayId, 12345);
  s.updateSettings({ displayId: null });
  assert.equal(new Store(dir).getSettings().displayId, null);
});

test('theme setting persists, rejects unknown themes and leaves the display alone', () => {
  const s = new Store(dir);
  s.updateSettings({ displayId: '7' });
  assert.equal(s.updateSettings({ theme: 'blueprint' }).theme, 'blueprint');
  assert.deepEqual(new Store(dir).getSettings(), { displayId: 7, theme: 'blueprint' });
  assert.throws(() => s.updateSettings({ theme: 'no-such-theme' }), StoreError);
  assert.throws(() => s.updateSettings({ theme: null }), StoreError);
  assert.equal(new Store(dir).getSettings().theme, 'blueprint');
  assert.equal(s.updateSettings({ displayId: null }).theme, 'blueprint');
});

test('settings saved before themes existed, or naming a removed theme, load with the default theme', () => {
  const write = (settings) => fs.writeFileSync(path.join(dir, 'events.json'),
    JSON.stringify({ version: 1, settings, events: [] }), { encoding: 'utf-8' });
  write({ displayId: 3 });
  assert.deepEqual(new Store(dir).getSettings(), { displayId: 3, theme: 'midnight-teal' });
  write({ displayId: null, theme: 'gone-in-a-later-version' });
  assert.equal(new Store(dir).getSettings().theme, 'midnight-teal');
  write({ displayId: null, theme: 'vibe-with-claude' });
  assert.equal(new Store(dir).getSettings().theme, 'vibe-with-claude');
});

const THEME_BASE = { bg: '#101418', text: '#eef2f5', accent: '#44ccaa', warn: '#f2c14e', danger: '#ff6b7a', ok: '#5fd39a' };

test('custom themes: save creates, updates in place, and persists', () => {
  const s = new Store(dir);
  assert.deepEqual(s.listThemes(), []);
  const made = s.saveTheme({ name: 'Harbor', base: THEME_BASE });
  assert.match(made.id, /^custom-[0-9a-f-]+$/);
  assert.deepEqual({ name: made.name, mode: made.mode, base: made.base }, { name: 'Harbor', mode: 'dark', base: THEME_BASE });
  const edited = s.saveTheme({ id: made.id, name: 'Harbor', base: { ...THEME_BASE, accent: '#ff00aa' } });
  assert.equal(edited.id, made.id);
  assert.equal(s.listThemes().length, 1);
  assert.equal(new Store(dir).listThemes()[0].base.accent, '#ff00aa');
});

test('custom themes: names stay unique, including against built-in themes', () => {
  const s = new Store(dir);
  assert.equal(s.saveTheme({ name: 'Paper', base: THEME_BASE }).name, 'Paper 2');
  assert.equal(s.saveTheme({ name: 'paper', base: THEME_BASE }).name, 'paper 3');
  const a = s.saveTheme({ name: 'Mine', base: THEME_BASE });
  assert.equal(s.saveTheme({ name: 'Mine', base: THEME_BASE }).name, 'Mine 2');
  assert.equal(s.saveTheme({ id: a.id, name: 'Mine', base: THEME_BASE }).name, 'Mine'); // re-saving keeps its own name
});

test('custom themes: a saved theme can never take a built-in id', () => {
  const s = new Store(dir);
  const t = s.saveTheme({ id: 'midnight-teal', name: 'Sneaky', base: THEME_BASE });
  assert.match(t.id, /^custom-/);
  assert.equal(s.saveTheme({ id: 'custom-does-not-exist', name: 'Orphan', base: THEME_BASE }).id.startsWith('custom-'), true);
  assert.equal(s.listThemes().length, 2);
});

test('custom themes: can be selected, and the theme in use is returned in full', () => {
  const s = new Store(dir);
  assert.equal(s.currentTheme().id, 'midnight-teal');
  const t = s.saveTheme({ name: 'Harbor', base: THEME_BASE });
  assert.equal(s.updateSettings({ theme: t.id }).theme, t.id);
  assert.deepEqual(new Store(dir).currentTheme(), t);
  assert.throws(() => s.updateSettings({ theme: 'custom-nope' }), StoreError);
});

test('custom themes: deleting the theme in use falls back to the default', () => {
  const s = new Store(dir);
  const a = s.saveTheme({ name: 'A', base: THEME_BASE });
  const b = s.saveTheme({ name: 'B', base: THEME_BASE });
  s.updateSettings({ theme: a.id });
  assert.equal(s.deleteTheme(b.id).theme, a.id); // deleting another theme changes nothing
  assert.equal(s.deleteTheme(a.id).theme, 'midnight-teal');
  assert.deepEqual(new Store(dir).listThemes(), []);
  assert.throws(() => s.deleteTheme(a.id), StoreError);
  assert.throws(() => s.deleteTheme('paper'), StoreError); // built-in themes cannot be deleted
});

test('custom themes: bad input is refused with a readable message, and nothing is saved', () => {
  const s = new Store(dir);
  assert.throws(() => s.saveTheme({ name: 'Bad', base: { ...THEME_BASE, text: 'white' } }), /Text color must look like/);
  assert.throws(() => s.saveTheme(null), StoreError);
  assert.deepEqual(s.listThemes(), []);
});

test('custom themes: there is a limit on how many are kept', () => {
  const s = new Store(dir);
  for (let i = 0; i < 100; i += 1) s.saveTheme({ name: `T${i}`, base: THEME_BASE });
  assert.throws(() => s.saveTheme({ name: 'One too many', base: THEME_BASE }), /up to 100/);
  const first = s.listThemes()[0];
  assert.equal(s.saveTheme({ ...first, name: 'Renamed' }).name, 'Renamed'); // editing is still allowed at the limit
});

test('custom themes: damaged entries in the file are dropped, good ones kept, and a lost theme falls back', () => {
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify({
    version: 1,
    settings: { displayId: null, theme: 'custom-gone' },
    themes: [
      { id: 'custom-good', name: 'Good', mode: 'dark', base: THEME_BASE },
      { id: 'custom-bad', name: 'Bad', base: { bg: 'x' } },
      { id: 'paper', name: 'Fake built-in', base: THEME_BASE },
      { id: 'custom-good', name: 'Duplicate id', base: THEME_BASE },
      'nonsense',
    ],
    events: [],
  }), { encoding: 'utf-8' });
  const s = new Store(dir);
  assert.deepEqual(s.listThemes().map((t) => t.name), ['Good']);
  assert.equal(s.getSettings().theme, 'midnight-teal');
});

test('practice: a one-deck event that is never listed and never saved', () => {
  const s = new Store(dir);
  const real = s.createEvent('Real night');
  const ev = s.startPractice(fakePdf('my talk.pdf'));
  assert.equal(ev.id, PRACTICE_EVENT_ID);
  assert.equal(ev.practice, true);
  assert.deepEqual([ev.timePerSlide, ev.maxSlides, ev.items.length, ev.items[0].name], [20, 20, 1, 'my talk.pdf']);
  assert.match(ev.items[0].file, /^practice-[0-9a-f-]+\.pdf$/);
  assert.ok(fs.existsSync(path.join(dir, 'library', ev.items[0].file)));
  // The player can read it and record its page count...
  assert.equal(s.getEvent(PRACTICE_EVENT_ID).name, 'Practice: my talk.pdf');
  assert.equal(s.setItemPageCount(PRACTICE_EVENT_ID, ev.items[0].id, 17).pageCount, 17);
  // ...but it is not an event anywhere else.
  assert.deepEqual(s.listEvents().map((e) => e.id), [real.id]);
  assert.ok(!fs.readFileSync(path.join(dir, 'events.json'), 'utf-8').includes('practice'));
  assert.deepEqual(new Store(dir).listEvents().map((e) => e.id), [real.id]);
});

test('practice: uses the timing it is given, and falls back to 20 x 20 for anything invalid', () => {
  const s = new Store(dir);
  const pdf = fakePdf('a.pdf');
  assert.deepEqual((({ timePerSlide, maxSlides }) => [timePerSlide, maxSlides])(s.startPractice(pdf, { timePerSlide: 15, maxSlides: 12 })), [15, 12]);
  for (const bad of [{ timePerSlide: 0, maxSlides: 0 }, { timePerSlide: 'x', maxSlides: 2.5 }, { timePerSlide: 99999, maxSlides: -1 }, {}, undefined]) {
    const ev = s.startPractice(pdf, bad);
    assert.deepEqual([ev.timePerSlide, ev.maxSlides], [20, 20], JSON.stringify(bad));
  }
});

test('practice: cannot be edited, duplicated or deleted like a real event', () => {
  const s = new Store(dir);
  s.startPractice(fakePdf('a.pdf'));
  assert.throws(() => s.updateEvent(PRACTICE_EVENT_ID, { name: 'x' }), StoreError);
  assert.throws(() => s.duplicateEvent(PRACTICE_EVENT_ID), StoreError);
  assert.throws(() => s.deleteEvent(PRACTICE_EVENT_ID), StoreError);
  assert.throws(() => s.addPdfs(PRACTICE_EVENT_ID, [fakePdf('b.pdf')]), StoreError);
  assert.equal(s.listEvents().length, 0);
});

test('practice: ending it removes its copy of the PDF and leaves real decks alone', () => {
  const s = new Store(dir);
  const real = s.createEvent('E');
  s.addPdfs(real.id, [fakePdf('keep.pdf')]);
  const first = s.startPractice(fakePdf('one.pdf'));
  // Library cleanup triggered by ordinary edits must not remove the deck being practised.
  s.gcLibrary();
  assert.ok(fs.existsSync(path.join(dir, 'library', first.items[0].file)));
  // A new practice replaces the old one and removes the old copy.
  const second = s.startPractice(fakePdf('two.pdf'));
  assert.ok(!fs.existsSync(path.join(dir, 'library', first.items[0].file)));
  // A late "closed" from the first practice must not end the second.
  assert.equal(s.endPractice(first.items[0].id), false);
  assert.equal(s.getEvent(PRACTICE_EVENT_ID).items[0].name, 'two.pdf');
  assert.equal(s.endPractice(second.items[0].id), true);
  assert.throws(() => s.getEvent(PRACTICE_EVENT_ID), StoreError);
  assert.equal(s.endPractice(), false);
  assert.equal(libFiles().length, 1); // only keep.pdf's copy
  assert.equal(s.getEvent(real.id).items.length, 1);
});

test('practice: rejects missing files and non-PDFs, and cleans up after a crash', () => {
  const s = new Store(dir);
  assert.throws(() => s.startPractice(path.join(src, 'nope.pdf')), /File not found/);
  const txt = path.join(src, 'notes.pdf');
  fs.writeFileSync(txt, 'not a pdf', { encoding: 'utf-8' });
  assert.throws(() => s.startPractice(txt), /Not a PDF/);
  assert.throws(() => s.startPractice(''), /File not found/);
  assert.throws(() => s.getEvent(PRACTICE_EVENT_ID), StoreError);
  // The app is closed mid-practice: the next start removes the leftover copy.
  s.startPractice(fakePdf('a.pdf'));
  assert.equal(libFiles().length, 1);
  new Store(dir);
  assert.equal(libFiles().length, 0);
});

test('corrupt events.json is backed up, not lost', () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.json'), '{not json', { encoding: 'utf-8' });
  const s = new Store(dir);
  assert.deepEqual(s.listEvents(), []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('events.json.corrupt-')));
});

test('isPdfFile checks magic bytes', () => {
  assert.equal(isPdfFile(fakePdf('ok.pdf')), true);
  const p = path.join(src, 'x.pdf');
  fs.writeFileSync(p, 'nope', { encoding: 'utf-8' });
  assert.equal(isPdfFile(p), false);
  assert.equal(isPdfFile(path.join(src, 'missing')), false);
});
