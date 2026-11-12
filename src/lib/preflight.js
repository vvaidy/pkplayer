// Deck pre-flight: spot decks that will surprise someone on the night.
// Pure functions, shared by the editor and the unit tests.

/** Two page shapes closer than this (relative difference) count as the same shape. */
export const SHAPE_TOLERANCE = 0.035;

const NAMED_SHAPES = [
  { name: '16:9', ratio: 16 / 9 },
  { name: '16:10', ratio: 16 / 10 },
  { name: '3:2', ratio: 3 / 2 },
  { name: 'A4', ratio: Math.SQRT2, paper: true },
  { name: '4:3', ratio: 4 / 3 },
  { name: 'Letter', ratio: 11 / 8.5, paper: true },
  { name: '5:4', ratio: 5 / 4 },
  { name: '1:1', ratio: 1 },
];
const NAME_TOLERANCE = 0.012;

const isShape = (aspect) => Number.isFinite(aspect) && aspect > 0;

/** True when two width/height ratios are the same shape within SHAPE_TOLERANCE. */
export function sameShape(a, b) {
  if (!isShape(a) || !isShape(b)) return false;
  return Math.abs(a - b) / Math.max(a, b) <= SHAPE_TOLERANCE;
}

/** A short name for a width/height ratio: "16:9", "4:3", "A4 portrait", or "1.90:1" when it has no common name. */
export function shapeName(aspect) {
  if (!isShape(aspect)) return 'unknown shape';
  const portrait = aspect < 1 - NAME_TOLERANCE;
  const landscape = portrait ? 1 / aspect : aspect;
  const match = NAMED_SHAPES.find((s) => Math.abs(landscape - s.ratio) / s.ratio <= NAME_TOLERANCE);
  if (!match) return portrait ? `1:${landscape.toFixed(2)}` : `${landscape.toFixed(2)}:1`;
  if (!portrait) return match.name;
  return match.paper ? `${match.name} portrait` : match.name.split(':').reverse().join(':');
}

/**
 * The shape most decks share, or null when there is no clear one.
 * There is a common shape only when one group of same-shaped decks has at least
 * two decks and is bigger than every other group (so 1 + 1 or 2 + 2 has none).
 * @param {Array<number|null>} aspects width/height of each deck's first page (null = not known)
 * @returns {number|null}
 */
export function commonShape(aspects) {
  const groups = [];
  for (const a of aspects) {
    if (!isShape(a)) continue;
    const group = groups.find((g) => sameShape(g.aspect, a));
    if (group) group.count += 1;
    else groups.push({ aspect: a, count: 1 });
  }
  groups.sort((x, y) => y.count - x.count);
  const [top, next] = groups;
  if (!top || top.count < 2 || (next && next.count === top.count)) return null;
  return top.aspect;
}

/**
 * Pre-flight warnings for every deck of an event.
 * @param {Array<{id: string, pages: number|null, aspect: number|null}>} decks
 * @param {object} opts
 * @param {number} opts.maxSlides the event's Max slides
 * @param {boolean} opts.expectFullDecks true when every deck should have exactly maxSlides pages
 *   (a named format such as PechaKucha); false when maxSlides is only a cap
 * @returns {Map<string, Array<{kind: 'short'|'shape', text: string}>>} deck id -> warnings (only decks that have some)
 */
export function preflight(decks, { maxSlides, expectFullDecks }) {
  const common = commonShape(decks.map((d) => d.aspect));
  const result = new Map();
  for (const d of decks) {
    const warnings = [];
    if (expectFullDecks && Number.isInteger(d.pages) && d.pages >= 1 && d.pages < maxSlides) {
      warnings.push({ kind: 'short', text: `only ${d.pages} slide${d.pages === 1 ? '' : 's'}` });
    }
    if (common != null && isShape(d.aspect) && !sameShape(d.aspect, common)) {
      warnings.push({ kind: 'shape', text: `${shapeName(d.aspect)}, most are ${shapeName(common)}` });
    }
    if (warnings.length) result.set(d.id, warnings);
  }
  return result;
}
