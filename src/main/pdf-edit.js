// Writing PDF files: rebuild a deck with pages removed, reordered or rotated, and merge
// decks into one file. Runs in the main process. It always writes a NEW file and never
// touches the file it reads from.

import fs from 'node:fs';
import { PDFDocument, degrees } from 'pdf-lib';
import { debug } from '../lib/debug.js';
import { validatePages } from '../lib/page-edit.js';

/** An Error whose message is fit to show the user as it is. */
export class PdfEditError extends Error {}

async function load(filePath) {
  let bytes;
  try {
    bytes = await fs.promises.readFile(filePath);
  } catch (err) {
    debug('pdf-edit', `cannot read ${filePath}`, err);
    throw new PdfEditError(`Could not read the PDF: ${err.message}`);
  }
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    debug('pdf-edit', `cannot parse ${filePath}`, err);
    if (/encrypted/i.test(err.message)) throw new PdfEditError('This PDF is password-protected, so its pages cannot be edited or exported.');
    throw new PdfEditError('This file could not be read as a PDF, so its pages cannot be edited or exported.');
  }
}

/** Write bytes to a temporary file beside the destination, then move it into place, so a failure never leaves half a file. */
async function writeAtomically(destPath, bytes) {
  const tmp = `${destPath}.tmp-${process.pid}`;
  try {
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, destPath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    debug('pdf-edit', `cannot write ${destPath}`, err);
    throw new PdfEditError(`Could not write the PDF: ${err.message}`);
  }
}

/** Copy chosen pages of `src` onto the end of `out`, applying any extra rotation. */
async function appendPages(out, src, pages) {
  const copied = await out.copyPages(src, pages.map((p) => p.page - 1));
  copied.forEach((page, i) => {
    if (pages[i].rotate) page.setRotation(degrees((page.getRotation().angle + pages[i].rotate) % 360));
    out.addPage(page);
  });
}

/**
 * Build a new PDF from chosen pages of an existing one.
 * @param {string} srcPath the PDF to read (not modified)
 * @param {string} destPath where to write the new PDF (must differ from srcPath)
 * @param {Array<{page: number, rotate?: number}>} pages 1-based pages in the order to write them;
 *   rotate is extra clockwise rotation in degrees (0, 90, 180, 270)
 * @returns {Promise<{pageCount: number}>}
 */
export async function rewritePdf(srcPath, destPath, pages) {
  if (srcPath === destPath) throw new PdfEditError('Refusing to overwrite the file being read.');
  const src = await load(srcPath);
  let clean;
  try {
    clean = validatePages(pages, src.getPageCount());
  } catch (err) {
    throw new PdfEditError(err.message);
  }
  const out = await PDFDocument.create();
  for (const [get, set] of [['getTitle', 'setTitle'], ['getAuthor', 'setAuthor'], ['getSubject', 'setSubject']]) {
    try {
      const value = src[get]();
      if (value) out[set](value); // keep the deck's own title and author
    } catch (err) {
      debug('pdf-edit', `could not copy ${get}`, err);
    }
  }
  await appendPages(out, src, clean);
  await writeAtomically(destPath, await out.save());
  debug('pdf-edit', `wrote ${clean.length} pages to ${destPath}`);
  return { pageCount: clean.length };
}

/**
 * Join pages from several PDFs into one new PDF, in the order given.
 * @param {Array<{path: string, pages: Array<{page: number, rotate?: number}>|function(number): Array}>} parts
 *   `pages` may be a function of the PDF's page count; a part that ends up with no pages is left out
 * @param {string} destPath where to write (must not be one of the files being read)
 * @param {{title?: string}} [meta]
 * @returns {Promise<{pageCount: number, skipped: string[]}>} skipped = paths that could not be read
 */
export async function mergePdfs(parts, destPath, { title } = {}) {
  if (!Array.isArray(parts) || parts.length === 0) throw new PdfEditError('There is nothing to export.');
  if (parts.some((p) => p.path === destPath)) throw new PdfEditError('Refusing to overwrite one of the files being read.');
  const out = await PDFDocument.create();
  if (title) out.setTitle(title);
  const skipped = [];
  let pageCount = 0;
  for (const part of parts) {
    let src;
    try {
      src = await load(part.path);
    } catch (err) {
      skipped.push(part.path); // one bad deck must not stop the rest
      continue;
    }
    const wanted = typeof part.pages === 'function' ? part.pages(src.getPageCount()) : part.pages;
    if (Array.isArray(wanted) && wanted.length === 0) continue; // this deck plays nothing
    let clean;
    try {
      clean = validatePages(wanted, src.getPageCount());
    } catch (err) {
      throw new PdfEditError(err.message);
    }
    await appendPages(out, src, clean);
    pageCount += clean.length;
  }
  if (pageCount === 0) throw new PdfEditError('None of the decks has a page to export.');
  await writeAtomically(destPath, await out.save());
  debug('pdf-edit', `merged ${pageCount} pages from ${parts.length - skipped.length} files into ${destPath}`);
  return { pageCount, skipped };
}
