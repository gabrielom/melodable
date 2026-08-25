/**
 * Transport: the looped playhead the whole trainer runs on.
 *
 * The transport does not own a clock — callers feed it the current time in
 * seconds (in the app that's `AudioContext.currentTime`, per the invariant
 * that all timing derives from the audio clock). That keeps this module pure
 * and unit-testable.
 *
 * Time is anchored at `anchorTime`, the moment beat 0 of `anchorLoop` plays.
 * Everything else — count-in, loop boundaries, note times — is derived from
 * that single anchor, so a tempo change only has to move the anchor to keep
 * the playhead continuous.
 */

/**
 * A re-anchor that moves the playhead further than this counts as a jump
 * rather than a drift trim — see `anchorTo`. Well above the sub-millisecond
 * corrections a locked Link follower makes, well below a musical distance.
 */
const JUMP_BEATS = 0.25;

/**
 * Scheduling lead-in before the count-in's first beat, so the opening click
 * is never scheduled in the past. Exported because the idle preview parks the
 * playhead exactly where `start` will place it, and that includes this — miss
 * it and the notes twitch a few pixels the moment Start is pressed.
 */
export const START_DELAY = 0.15;

/**
 * Beats the playhead keeps running past the last repeat before the run is
 * called finished, so the final note can still be struck late and is seen to
 * resolve rather than vanishing with the transport.
 */
const END_TAIL_BEATS = 1;

/**
 * Signed distance from `absBeat` to the nearest beat whose position within the
 * loop is `phase`, taking the shorter way round the loop.
 *
 * This is how the Link follower decides which way to slide: a loop sitting
 * just after the grid gets nudged back, not dragged almost a whole loop
 * forward. The result is never more than half a loop in either direction.
 */
export function phaseDelta(absBeat: number, phase: number, loopBeats: number): number {
  const inLoop = ((absBeat % loopBeats) + loopBeats) % loopBeats;
  let d = phase - inLoop;
  if (d > loopBeats / 2) d -= loopBeats;
  else if (d < -loopBeats / 2) d += loopBeats;
  return d;
}

/**
 * An external beat grid to start against — Ableton Link, in practice.
 *
 * `beat` is the grid's own beat value at clock time `at`, counted from a beat 0
 * that is a boundary worth landing on: the peer's transport start when Link
 * publishes one, otherwise the current quantum boundary.
 */
export interface StartGrid {
  beat: number;
  at: number;
}

export interface TransportPosition {
  playing: boolean;
  /** True while the pre-roll count-in bar is still running. */
  countIn: boolean;
  /** Beats elapsed within the count-in (0..countInBeats), 0 when not counting in. */
  countInBeat: number;
  /** Index of the current loop (0 = first scored loop). */
  loopIndex: number;
  /** Beat position within the current loop [0, loopBeats). */
  beatInLoop: number;
  /** Absolute beat since the first loop's beat 0; negative during count-in. */
  absBeat: number;
  /** True once the run's repeats (plus a short tail) have played out. */
  finished: boolean;
}

export class Transport {
  bpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly countInBars: number;
  /**
   * How many times the pattern plays before the run ends. `Infinity` keeps the
   * old endless behaviour, which the Ableton Link follower and the tests rely
   * on when no run length is given.
   */
  readonly totalLoops: number;

  private playing = false;
  /** Loop index whose beat 0 happens at `anchorTime`. */
  private anchorLoop = 0;
  private anchorTime = 0;
  /** Absolute beat up to which repeating events (clicks…) have been issued. */
  private scheduledUntilBeat = 0;

  constructor(opts: {
    bpm: number;
    bars: number;
    beatsPerBar: number;
    countInBars?: number;
    totalLoops?: number;
  }) {
    this.bpm = opts.bpm;
    this.bars = opts.bars;
    this.beatsPerBar = opts.beatsPerBar;
    this.countInBars = opts.countInBars ?? 1;
    this.totalLoops = opts.totalLoops ?? Infinity;
  }

  get secPerBeat(): number {
    return 60 / this.bpm;
  }

  /** Loop length in beats. */
  get loopBeats(): number {
    return this.bars * this.beatsPerBar;
  }

  get countInBeats(): number {
    return this.countInBars * this.beatsPerBar;
  }

  /** Length of the whole run in beats; `Infinity` when endless. */
  get runBeats(): number {
    return this.totalLoops * this.loopBeats;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Absolute beat at clock time `now`, ignoring whether we're playing. */
  private absBeatAt(now: number): number {
    return this.anchorLoop * this.loopBeats + (now - this.anchorTime) / this.secPerBeat;
  }

  /**
   * Begin playback: a short scheduling delay, then the count-in bar, then
   * loop 0. `now` is the current clock reading.
   *
   * With a `grid` (Ableton Link) beat 0 is pinned to that grid instead of
   * falling wherever the press landed. Without it the follower would start us
   * at an arbitrary phase and yank the playhead onto the grid a frame later,
   * which is up to half a loop and eats the count-in it lands in.
   */
  start(now: number, delay = START_DELAY, grid?: StartGrid): void {
    this.playing = true;
    this.anchorLoop = 0;
    const earliest = now + delay + this.countInBeats * this.secPerBeat;
    this.anchorTime = grid ? this.gridAtOrAfter(earliest, grid) : earliest;
    this.scheduledUntilBeat = -this.countInBeats;
  }

  /**
   * Begin with beat 0 at an exact clock time, rather than at the next boundary
   * of our own loop — the peer's transport start, which is the one downbeat
   * Link can actually name.
   *
   * Whatever of the count-in still fits before `beatZero` is what sounds: Live
   * quantizes its launch so there is usually most of a bar of warning, but a
   * peer that starts on the spot leaves none, and dropping straight in beats
   * starting a bar out.
   */
  startAt(beatZero: number, now: number): void {
    this.playing = true;
    this.anchorLoop = 0;
    this.anchorTime = beatZero;
    // Never schedule into the past — if their downbeat has already gone by,
    // the count-in went with it.
    this.scheduledUntilBeat = Math.max(-this.countInBeats, this.absBeatAt(now));
  }

  /**
   * The first grid boundary at or after `t`. Boundaries sit a whole number of
   * loops from the grid's own beat 0, so our loop lines up with theirs and not
   * merely with a bar of theirs.
   *
   * The count-in keeps its full length and simply starts later; the wait
   * before it is silent, which is what waiting for the downbeat sounds like.
   */
  private gridAtOrAfter(t: number, grid: StartGrid): number {
    const loopSeconds = this.loopBeats * this.secPerBeat;
    const origin = grid.at - grid.beat * this.secPerBeat;
    // Nudge before rounding up so a boundary landing exactly on `t` is taken
    // rather than pushed a whole loop away by floating-point dust.
    const loops = Math.ceil((t - origin) / loopSeconds - 1e-9);
    return origin + loops * loopSeconds;
  }

  stop(): void {
    this.playing = false;
  }

  position(now: number): TransportPosition {
    if (!this.playing) {
      return {
        playing: false,
        countIn: false,
        countInBeat: 0,
        loopIndex: 0,
        beatInLoop: 0,
        absBeat: 0,
        finished: false,
      };
    }
    const absBeat = this.absBeatAt(now);
    if (absBeat < 0) {
      return {
        playing: true,
        countIn: true,
        countInBeat: this.countInBeats + absBeat,
        loopIndex: 0,
        beatInLoop: 0,
        absBeat,
        finished: false,
      };
    }
    const loopIndex = Math.floor(absBeat / this.loopBeats);
    return {
      playing: true,
      countIn: false,
      countInBeat: 0,
      loopIndex,
      beatInLoop: absBeat - loopIndex * this.loopBeats,
      absBeat,
      finished: absBeat >= this.runBeats + END_TAIL_BEATS,
    };
  }

  /** Clock time of `beat` within loop `loopIndex`. */
  timeOf(loopIndex: number, beat: number): number {
    return this.timeOfAbsBeat(loopIndex * this.loopBeats + beat);
  }

  /** Clock time of an absolute beat (negative beats fall in the count-in). */
  timeOfAbsBeat(absBeat: number): number {
    return this.anchorTime + (absBeat - this.anchorLoop * this.loopBeats) * this.secPerBeat;
  }

  /**
   * Change tempo. While playing the anchor is re-derived so the playhead's
   * current absolute beat stays where it is — no jump, no dropped notes.
   * Callers that cached note times must recompute them via `timeOf`.
   */
  setBpm(bpm: number, now?: number): void {
    if (bpm === this.bpm) return;
    if (this.playing && now !== undefined) {
      const absBeat = this.absBeatAt(now);
      this.bpm = bpm;
      // keep the playhead continuous: re-anchor at the current loop's beat 0
      this.anchorLoop = Math.max(0, Math.floor(absBeat / this.loopBeats));
      this.anchorTime = now - (absBeat - this.anchorLoop * this.loopBeats) * this.secPerBeat;
    } else {
      this.bpm = bpm;
    }
  }

  /**
   * Re-anchor so that absolute beat `absBeat` falls at clock time `atTime`.
   *
   * This is how an external grid (Ableton Link, M6) drives the playhead: the
   * follower converts Link's beat + clock reading into our terms and calls
   * this every poll. In the steady state the correction is well under a
   * millisecond, so the playhead is trimmed rather than moved.
   *
   * A correction larger than `JUMP_BEATS` is treated as a real move — locking
   * on to Link for the first time, or Ableton relocating — and the scheduling
   * window jumps with it, so we neither replay the beats we skipped nor flood
   * the scheduler after moving backwards. Audio already queued for the old
   * position still fires; that one-off blip is the same cost a tempo-slider
   * drag already pays.
   */
  anchorTo(absBeat: number, atTime: number): void {
    const moved = Math.abs(absBeat - this.absBeatAt(atTime));
    this.anchorLoop = Math.max(0, Math.floor(absBeat / this.loopBeats));
    this.anchorTime = atTime - (absBeat - this.anchorLoop * this.loopBeats) * this.secPerBeat;
    if (moved > JUMP_BEATS) this.scheduledUntilBeat = absBeat;
  }

  /**
   * Advance the scheduling window: returns the half-open range of absolute
   * beats [from, to) that now needs audio events scheduled (metronome clicks,
   * guide notes), or null if the window hasn't grown. `horizon` is how far
   * ahead of `now` to schedule, in seconds.
   */
  advanceScheduler(now: number, horizon = 1.0): { from: number; to: number } | null {
    if (!this.playing) return null;
    const nowBeat = this.absBeatAt(now);
    const to = nowBeat + horizon / this.secPerBeat;
    if (to <= this.scheduledUntilBeat) return null;
    const from = this.scheduledUntilBeat;
    this.scheduledUntilBeat = to;
    return { from, to };
  }

  /** Integer click beats within [from, to); accented on bar starts. */
  clicksIn(from: number, to: number): Array<{ absBeat: number; accent: boolean }> {
    const out: Array<{ absBeat: number; accent: boolean }> = [];
    for (let b = Math.ceil(from); b < to; b++) {
      // ((b % n) + n) % n so count-in beats (negative) accent correctly too
      const inBar = ((b % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
      out.push({ absBeat: b, accent: inBar === 0 });
    }
    return out;
  }
}
