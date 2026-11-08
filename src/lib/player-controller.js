// Pure playback state machine for a PechaKucha event. No DOM, no timers:
// the caller passes a monotonic `now` (ms) into every time-dependent call,
// which keeps it deterministic and unit-testable.
//
// Timing is deadline-based: each slide ends exactly `durationMs` after the
// previous deadline (not after the frame where we noticed), so slow frames
// never accumulate drift.

export const PHASE = Object.freeze({
  WAITING: 'waiting', // a deck is shown with the big Play button
  PLAYING: 'playing',
  PAUSED: 'paused',
  ENDED: 'ended', // past the last deck
});

export const DEFAULT_TIME_PER_SLIDE = 20;
export const DEFAULT_MAX_SLIDES = 20;

/** Number of slides a deck actually plays: never more than it has, never more than maxSlides. */
export function slidesToPlay(pageCount, maxSlides) {
  const pages = Number.isFinite(pageCount) ? Math.floor(pageCount) : 0;
  const max = Number.isFinite(maxSlides) ? Math.floor(maxSlides) : 0;
  return Math.max(0, Math.min(pages, max));
}

export class PlayerController {
  /**
   * @param {object} opts
   * @param {number[]} opts.pageCounts page count of each deck in playlist order (0 = unplayable, skipped)
   * @param {number} opts.timePerSlide seconds per slide (> 0)
   * @param {number} opts.maxSlides max slides per deck (>= 1)
   * @param {number} [opts.startDeck=0] deck index to start at
   */
  constructor({ pageCounts, timePerSlide, maxSlides, startDeck = 0 }) {
    if (!Array.isArray(pageCounts)) throw new TypeError('pageCounts must be an array');
    if (!(Number(timePerSlide) > 0)) throw new RangeError(`timePerSlide must be > 0 (got ${timePerSlide})`);
    if (!(Number(maxSlides) >= 1)) throw new RangeError(`maxSlides must be >= 1 (got ${maxSlides})`);

    this.slideCounts = pageCounts.map((c) => slidesToPlay(c, Number(maxSlides)));
    this.durationMs = Number(timePerSlide) * 1000;
    this.slideStart = 0;
    this.pausedAt = null;
    const start = Math.max(0, Math.min(Math.floor(startDeck) || 0, this.slideCounts.length));
    this.#gotoDeck(start);
  }

  get slideCount() {
    return this.slideCounts[this.deckIndex] ?? 0;
  }

  view() {
    return {
      phase: this.phase,
      deckIndex: this.deckIndex,
      slideIndex: this.slideIndex,
      slideCount: this.slideCount,
    };
  }

  /** WAITING -> PLAYING. Returns true if state changed. */
  play(now) {
    if (this.phase !== PHASE.WAITING) return false;
    this.phase = PHASE.PLAYING;
    this.slideStart = now;
    this.pausedAt = null;
    return true;
  }

  /** PLAYING <-> PAUSED. Returns true if state changed. */
  togglePause(now) {
    if (this.phase === PHASE.PLAYING) {
      this.phase = PHASE.PAUSED;
      this.pausedAt = now;
      return true;
    }
    if (this.phase === PHASE.PAUSED) {
      this.slideStart += now - this.pausedAt;
      this.pausedAt = null;
      this.phase = PHASE.PLAYING;
      return true;
    }
    return false;
  }

  elapsed(now) {
    if (this.phase === PHASE.PLAYING) return Math.max(0, now - this.slideStart);
    if (this.phase === PHASE.PAUSED) return Math.max(0, this.pausedAt - this.slideStart);
    return 0;
  }

  /** Fraction (0..1) of the current slide's time used. */
  progress(now) {
    return Math.min(1, Math.max(0, this.elapsed(now) / this.durationMs));
  }

  /** Advance past every deadline that has passed. Returns true if the visible slide/deck changed. */
  tick(now) {
    let changed = false;
    while (this.phase === PHASE.PLAYING && now - this.slideStart >= this.durationMs) {
      this.slideStart += this.durationMs;
      this.#advance();
      changed = true;
    }
    return changed;
  }

  /** Manual skip forward (restarts the slide timer). Past the last slide moves to the next deck. */
  nextSlide(now) {
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.PAUSED) return false;
    if (this.slideIndex + 1 < this.slideCount) {
      this.slideIndex += 1;
      this.#restartTimer(now);
    } else {
      this.#gotoDeck(this.deckIndex + 1);
    }
    return true;
  }

  /** Manual skip back (restarts the slide timer). On slide 1 it just restarts the timer. */
  prevSlide(now) {
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.PAUSED) return false;
    this.slideIndex = Math.max(0, this.slideIndex - 1);
    this.#restartTimer(now);
    return true;
  }

  /** Jump to the next deck and wait for Play. */
  nextDeck() {
    if (this.phase === PHASE.ENDED) return false;
    this.#gotoDeck(this.deckIndex + 1);
    return true;
  }

  /** The slide that will be shown after the current one (for pre-rendering), or null. */
  peekNext() {
    if (this.phase === PHASE.ENDED) return null;
    if (this.slideIndex + 1 < this.slideCount) {
      return { deckIndex: this.deckIndex, slideIndex: this.slideIndex + 1 };
    }
    const d = this.#firstPlayableFrom(this.deckIndex + 1);
    return d < this.slideCounts.length ? { deckIndex: d, slideIndex: 0 } : null;
  }

  #advance() {
    if (this.slideIndex + 1 < this.slideCount) this.slideIndex += 1;
    else this.#gotoDeck(this.deckIndex + 1);
  }

  #restartTimer(now) {
    this.slideStart = now;
    if (this.phase === PHASE.PAUSED) this.pausedAt = now;
  }

  #firstPlayableFrom(i) {
    let d = i;
    while (d < this.slideCounts.length && this.slideCounts[d] === 0) d += 1;
    return d;
  }

  #gotoDeck(i) {
    this.deckIndex = this.#firstPlayableFrom(i);
    this.slideIndex = 0;
    this.pausedAt = null;
    this.phase = this.deckIndex >= this.slideCounts.length ? PHASE.ENDED : PHASE.WAITING;
  }
}
