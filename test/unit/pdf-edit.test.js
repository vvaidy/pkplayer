import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { PdfEditError, mergePdfs, rewritePdf } from '../../src/main/pdf-edit.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-pdfedit-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** A PDF whose page i is (100 + i) points wide, so pages can be told apart after an edit. */
async function makePdf(name, pages, { title, author, rotateFirst } = {}) {
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  if (author) doc.setAuthor(author);
  for (let i = 1; i <= pages; i += 1) doc.addPage([100 + i, 200]);
  if (rotateFirst) doc.getPage(0).setRotation(degrees(rotateFirst));
  const file = path.join(dir, name);
  fs.writeFileSync(file, await doc.save());
  return file;
}

async function describe(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map((p) => `${p.getWidth() - 100}${p.getRotation().angle ? `r${p.getRotation().angle}` : ''}`);
}

test('rewritePdf removes, reorders and rotates pages, and keeps title and author', async () => {
  const src = await makePdf('src.pdf', 5, { title: 'Tiny Gardens', author: 'Asha' });
  const before = fs.readFileSync(src);
  const dest = path.join(dir, 'out.pdf');
  const res = await rewritePdf(src, dest, [{ page: 5 }, { page: 1, rotate: 90 }, { page: 3, rotate: 270 }]);
  assert.deepEqual(res, { pageCount: 3 });
  assert.deepEqual(await describe(dest), ['5', '1r90', '3r270']);
  const out = await PDFDocument.load(fs.readFileSync(dest));
  assert.deepEqual([out.getTitle(), out.getAuthor()], ['Tiny Gardens', 'Asha']);
  assert.ok(before.equals(fs.readFileSync(src)), 'the source file must be untouched');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['out.pdf', 'src.pdf']); // no temporary file left behind
});

test('rewritePdf adds to a rotation the page already had', async () => {
  const src = await makePdf('src.pdf', 2, { rotateFirst: 90 });
  const dest = path.join(dir, 'out.pdf');
  await rewritePdf(src, dest, [{ page: 1, rotate: 90 }, { page: 1, rotate: 270 }, { page: 2 }]);
  assert.deepEqual(await describe(dest), ['1r180', '1', '2']);
});

test('rewritePdf refuses bad page lists, bad files and overwriting its source, and writes nothing', async () => {
  const src = await makePdf('src.pdf', 3);
  const dest = path.join(dir, 'out.pdf');
  await assert.rejects(rewritePdf(src, dest, []), /at least one page/);
  await assert.rejects(rewritePdf(src, dest, [{ page: 4 }]), /pages 1 to 3/);
  await assert.rejects(rewritePdf(src, dest, [{ page: 1, rotate: 30 }]), /quarter turns/);
  await assert.rejects(rewritePdf(src, src, [{ page: 1 }]), /Refusing to overwrite/);
  await assert.rejects(rewritePdf(path.join(dir, 'missing.pdf'), dest, [{ page: 1 }]), /Could not read the PDF/);
  const junk = path.join(dir, 'junk.pdf');
  fs.writeFileSync(junk, 'this is not a pdf at all');
  await assert.rejects(rewritePdf(junk, dest, [{ page: 1 }]), (err) => err instanceof PdfEditError && /could not be read as a PDF/.test(err.message));
  await assert.rejects(rewritePdf(src, path.join(dir, 'no-such-folder', 'out.pdf'), [{ page: 1 }]), /Could not write the PDF/);
  assert.ok(!fs.existsSync(dest));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['junk.pdf', 'src.pdf']);
});

test('mergePdfs joins chosen pages of several decks in order', async () => {
  const a = await makePdf('a.pdf', 3);
  const b = await makePdf('b.pdf', 30);
  const dest = path.join(dir, 'event.pdf');
  const res = await mergePdfs([
    { path: a, pages: [{ page: 1 }, { page: 2 }, { page: 3 }] },
    { path: b, pages: [{ page: 2 }, { page: 3 }] },
    { path: a, pages: [{ page: 3, rotate: 180 }] },
  ], dest, { title: 'Friday Night' });
  assert.deepEqual(res, { pageCount: 6, skipped: [] });
  assert.deepEqual(await describe(dest), ['1', '2', '3', '2', '3', '3r180']);
  assert.equal((await PDFDocument.load(fs.readFileSync(dest))).getTitle(), 'Friday Night');
});

test('mergePdfs skips an unreadable deck and reports it, but fails if nothing is left', async () => {
  const a = await makePdf('a.pdf', 2);
  const junk = path.join(dir, 'junk.pdf');
  fs.writeFileSync(junk, 'nope');
  const dest = path.join(dir, 'event.pdf');
  const res = await mergePdfs([{ path: junk, pages: [{ page: 1 }] }, { path: a, pages: [{ page: 2 }] }], dest);
  assert.deepEqual(res, { pageCount: 1, skipped: [junk] });
  await assert.rejects(mergePdfs([{ path: junk, pages: [{ page: 1 }] }], path.join(dir, 'x.pdf')), /None of the decks has a page to export/);
  // Pages can be chosen from the deck's page count; a deck that ends up with none is left out.
  const byCount = await mergePdfs([{ path: a, pages: (n) => [{ page: n }] }, { path: a, pages: () => [] }], path.join(dir, 'z.pdf'));
  assert.deepEqual(byCount, { pageCount: 1, skipped: [] });
  assert.deepEqual(await describe(path.join(dir, 'z.pdf')), ['2']);
  await assert.rejects(mergePdfs([], dest), /nothing to export/);
  await assert.rejects(mergePdfs([{ path: a, pages: [{ page: 1 }] }], a), /Refusing to overwrite/);
  await assert.rejects(mergePdfs([{ path: a, pages: [{ page: 9 }] }], path.join(dir, 'y.pdf')), /pages 1 to 2/);
});
