// Generate demo PechaKucha decks (16:9, 20 slides each) for the manual's tutorials.
// Usage: node scripts/make-demo-decks.js [outDir]   (default: samples/demo/)
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const OUT_DIR = path.resolve(process.argv[2] || 'samples/demo');
const W = 1280;
const H = 720;

const DECKS = [
  {
    file: '1-tiny-gardens.pdf', title: 'Tiny Gardens', by: 'Asha', color: [0.16, 0.42, 0.29],
    lines: ['Tiny Gardens', 'A balcony, one metre deep', 'Start with what survives', 'Herbs forgive mistakes',
      'Tomatoes do not', 'Light is the real budget', 'Pots: bigger than you think', 'Water in the morning',
      'Bees found us in week three', 'The basil wars', 'Vertical is free space', 'Compost in a shoebox',
      'Neighbours start talking', 'Seeds swap, people meet', 'Winter: the quiet season', 'Garlic in November',
      'What failed (most of it)', 'What grew (enough)', 'Your window counts', 'Go plant something'],
  },
  {
    file: '2-night-trains.pdf', title: 'Night Trains', by: 'Marek', color: [0.12, 0.2, 0.42],
    lines: ['Night Trains', 'Board at 21:40', 'The couchette lottery', 'Six strangers, one ladder',
      'Borders while you sleep', 'The 3 a.m. station stop', 'Tea from a samovar', 'Why they disappeared',
      'Why they are back', 'Cost vs. a flight', 'Carbon vs. a flight', 'Sleep vs. a flight',
      'The dining car', 'Snow on the window', 'Arriving downtown', 'No security line',
      'The routes I want next', 'Booking tips', 'Pack: earplugs', 'See you on the 21:40'],
  },
  {
    file: '3-why-bread-rises.pdf', title: 'Why Bread Rises', by: 'Lena', color: [0.55, 0.33, 0.1],
    lines: ['Why Bread Rises', 'Flour, water, salt, time', 'Yeast is alive', 'It eats sugar',
      'It breathes out CO2', 'Gluten: the balloon', 'Kneading builds the net', 'Proofing: patience',
      'Too warm, too fast', 'Too cold, too slow', 'Sourdough: wild yeast', 'Feeding the starter',
      'Oven spring', 'Steam makes the crust', 'The crumb tells a story', 'My first brick',
      'My hundredth loaf', 'Tools you do not need', 'Bake on Saturday', 'Share the bread'],
  },
  {
    file: '4-too-many-slides.pdf', title: 'The Long Version', by: 'Sam', color: [0.33, 0.18, 0.45],
    lines: Array.from({ length: 26 }, (_, i) => (i === 0 ? 'The Long Version' : i < 20 ? `Point number ${i}` : `Bonus slide ${i - 19} (never shown)`)),
  },
];

const mix = (c, k) => rgb(Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k));

async function makeDeck(deck) {
  const doc = await PDFDocument.create();
  doc.setTitle(deck.title);
  doc.setAuthor(deck.by);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const n = deck.lines.length;
  deck.lines.forEach((line, i) => {
    const page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: mix(deck.color, 0.85 + 0.3 * (i / n)) });
    page.drawCircle({ x: W - 120, y: H - 60, size: 260 + 12 * (i % 5), color: mix(deck.color, 1.6), opacity: 0.18 });
    page.drawCircle({ x: 140, y: 40, size: 120 + 10 * (i % 3), color: mix(deck.color, 2.2), opacity: 0.1 });
    const size = i === 0 ? 96 : 64;
    const font = bold;
    const tw = font.widthOfTextAtSize(line, size);
    const scale = Math.min(1, (W - 160) / tw);
    page.drawText(line, { x: (W - tw * scale) / 2, y: H / 2 - (size * scale) / 3, size: size * scale, font, color: rgb(1, 1, 1) });
    if (i === 0) {
      const by = `by ${deck.by}`;
      page.drawText(by, { x: (W - regular.widthOfTextAtSize(by, 36)) / 2, y: H / 2 - 110, size: 36, font: regular, color: rgb(1, 1, 1), opacity: 0.8 });
    }
    page.drawText(deck.title, { x: 48, y: H - 64, size: 24, font: regular, color: rgb(1, 1, 1), opacity: 0.7 });
    const num = `${i + 1} / ${n}`;
    page.drawText(num, { x: W - 48 - regular.widthOfTextAtSize(num, 24), y: 40, size: 24, font: regular, color: rgb(1, 1, 1), opacity: 0.7 });
  });
  fs.writeFileSync(path.join(OUT_DIR, deck.file), await doc.save());
}

try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const d of DECKS) await makeDeck(d);
  console.log(`Wrote ${DECKS.length} demo decks to ${OUT_DIR}`);
} catch (err) {
  console.error('make-demo-decks failed:', err);
  process.exit(1);
}
