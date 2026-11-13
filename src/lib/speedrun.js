// Speedrun test: play a whole event fast, to check that every deck loads and
// every slide draws. Pure helpers, shared by the main process, both windows and
// the unit tests.
//
// A speedrun is a property of ONE player window, passed in its URL. It is never
// stored in settings or in an event, so an ordinary Play can never inherit it.

/** The only speeds on offer. Anything else is refused, so there is no slow-motion and no absurd value. */
export const SPEEDRUN_FACTORS = Object.freeze([5, 10, 20]);
export const DEFAULT_SPEEDRUN_FACTOR = 10;
/** A slide is never shown for less than this, however fast the run: long enough to see that it drew. */
export const MIN_SPEEDRUN_SLIDE_SECONDS = 0.4;
/** How long each deck's Play screen stays up before the deck starts by itself. */
export const SPEEDRUN_PLAY_SCREEN_MS = 1000;
/** A slide that has not drawn after this long is reported as a problem and the run moves on. */
export const SPEEDRUN_DRAW_TIMEOUT_MS = 10000;

/**
 * The speedrun factor named by a URL parameter or a menu choice.
 * @returns {number|null} one of SPEEDRUN_FACTORS, or null for "not a speedrun" (anything else at all)
 */
export function parseSpeedrun(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return SPEEDRUN_FACTORS.includes(n) ? n : null;
}

/** Seconds each slide is shown in a speedrun. */
export function speedrunSlideSeconds(timePerSlide, factor) {
  return Math.max(MIN_SPEEDRUN_SLIDE_SECONDS, Number(timePerSlide) / factor);
}

/** Roughly how long a speedrun takes, in seconds (slides plus the pause on each Play screen). */
export function speedrunDuration({ slides, decks, timePerSlide, factor }) {
  return slides * speedrunSlideSeconds(timePerSlide, factor) + decks * (SPEEDRUN_PLAY_SCREEN_MS / 1000);
}

/**
 * The report shown when a speedrun ends.
 * @param {object} run
 * @param {Array<{name: string, expected: number, shown: number, unreadable: boolean}>} run.decks
 *   one per playlist row: slides that should play, slides that were drawn, and whether the PDF could not be opened
 * @param {Array<{deck: number, slide: number, reason: 'failed'|'slow'}>} run.problems slides that did not draw (0-based)
 * @returns {{ok: boolean, headline: string, summary: string, lines: string[]}}
 */
export function speedrunReport({ decks, problems }) {
  const expected = decks.reduce((n, d) => n + d.expected, 0);
  const shown = decks.reduce((n, d) => n + d.shown, 0);
  const lines = [];
  decks.forEach((d, i) => {
    if (d.unreadable) lines.push(`Deck ${i + 1} “${d.name}” could not be opened and would be skipped.`);
  });
  for (const p of problems) {
    const name = decks[p.deck]?.name ?? '?';
    lines.push(p.reason === 'slow'
      ? `Deck ${p.deck + 1} “${name}”, slide ${p.slide + 1} took more than 10 seconds to draw.`
      : `Deck ${p.deck + 1} “${name}”, slide ${p.slide + 1} could not be drawn.`);
  }
  const skipped = expected - shown;
  if (skipped > 0 && problems.length === 0) {
    lines.push(`${skipped} slide${skipped === 1 ? ' was' : 's were'} not shown because the run was skipped ahead or stopped early.`);
  }
  const readable = decks.filter((d) => !d.unreadable).length;
  const ok = lines.length === 0;
  return {
    ok,
    headline: ok ? 'Speedrun passed' : 'Speedrun finished with problems',
    summary: `${readable} of ${decks.length} deck${decks.length === 1 ? '' : 's'} opened · ${shown} of ${expected} slides drawn`,
    lines,
  };
}
