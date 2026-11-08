// pdf.js wrapper shared by the editor (thumbnails) and the player (slides).
import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.min.mjs';
import { debug } from '../lib/debug.js';

const PDFJS_BASE = new URL('../../node_modules/pdfjs-dist/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}build/pdf.worker.min.mjs`;

export function libraryUrl(file) {
  return `app://bundle/library/${encodeURIComponent(file)}`;
}

/** Open an imported PDF by its library file name. */
export async function openPdf(file) {
  const task = pdfjsLib.getDocument({
    url: libraryUrl(file),
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    disableRange: true,
    disableStream: true,
    isEvalSupported: false,
  });
  try {
    const doc = await task.promise;
    debug('pdf', `opened ${file} (${doc.numPages} pages)`);
    return doc;
  } catch (err) {
    debug('pdf', `could not open ${file}`, err);
    throw err;
  }
}

/**
 * Render a page (1-based) to a new canvas that fits inside maxW x maxH CSS pixels.
 * The canvas backing store is scaled by devicePixelRatio for crisp output.
 */
export async function renderPage(doc, pageNumber, maxW, maxH, { dpr = window.devicePixelRatio || 1, background = '#fff' } = {}) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxW / base.width, maxH / base.height);
  const viewport = page.getViewport({ scale: scale * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}
