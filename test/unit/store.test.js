import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, StoreError, isPdfFile } from '../../src/main/store.js';

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

test('settings persist', () => {
  const s = new Store(dir);
  assert.deepEqual(s.getSettings(), { displayId: null });
  s.updateSettings({ displayId: '12345' });
  assert.equal(new Store(dir).getSettings().displayId, 12345);
  s.updateSettings({ displayId: null });
  assert.equal(new Store(dir).getSettings().displayId, null);
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
