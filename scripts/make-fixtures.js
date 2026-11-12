// Generate sample PDF decks with big slide numbers for testing the player.
// Usage: node scripts/make-fixtures.js [outDir]   (default: samples/)
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const OUT_DIR = path.resolve(process.argv[2] || 'samples');
const DECKS = [
  { name: 'alpha-5-slides.pdf', pages: 5, hue: [0.95, 0.35, 0.2] },
  { name: 'bravo-25-slides.pdf', pages: 25, hue: [0.2, 0.5, 0.9] },
  { name: 'charlie-3-slides.pdf', pages: 3, hue: [0.25, 0.7, 0.4] },
  { name: 'delta-4x3-4-slides.pdf', pages: 4, hue: [0.6, 0.3, 0.8], pageSize: [1024, 768] },
];

async function makeDeck({ name, pages, hue, pageSize = [1280, 720] }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = pageSize;
  for (let i = 1; i <= pages; i += 1) {
    const page = doc.addPage([W, H]);
    const t = i / pages;
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(hue[0] * (0.5 + t / 2), hue[1] * (0.5 + t / 2), hue[2] * (0.5 + t / 2)) });
    const label = String(i);
    const size = 360;
    page.drawText(label, { x: (W - font.widthOfTextAtSize(label, size)) / 2, y: H / 2 - size / 3, size, font, color: rgb(1, 1, 1) });
    const title = `${name.replace('.pdf', '')} — slide ${i} of ${pages}`;
    page.drawText(title, { x: 40, y: 40, size: 28, font, color: rgb(1, 1, 1) });
  }
  fs.writeFileSync(path.join(OUT_DIR, name), await doc.save());
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const d of DECKS) await makeDeck(d);
fs.writeFileSync(path.join(OUT_DIR, 'not-a-pdf.pdf'), 'this is not a pdf', { encoding: 'utf-8' });
console.log(`Wrote ${DECKS.length + 1} files to ${OUT_DIR}`);
