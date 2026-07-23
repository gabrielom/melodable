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
}

export class Transport {
  bpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly countInBars: number;

  private playing = false;
  /** Loop index whose beat 0 happens at `anchorTime`. */
  private anchorLoop = 0;
  private anchorTime = 0;
  /** Absolute beat up to which repeating events (clicks…) have been issued. */
  private scheduledUntilBeat = 0;

  constructor(opts: { bpm: number; bars: number; beatsPerBar: number; countInBars?: number }) {
    this.bpm = opts.bpm;
    this.bars = opts.bars;
    this.beatsPerBar = opts.beatsPerBar;
    this.countInBars = opts.countInBars ?? 1;
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

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Begin playback: a short scheduling delay, then the count-in bar, then
   * loop 0. `now` is the current clock reading.
   */
  start(now: number, delay = 0.15): void {
    this.playing = true;
    this.anchorLoop = 0;
    this.anchorTime = now + delay + this.countInBeats * this.secPerBeat;
    this.scheduledUntilBeat = -this.countInBeats;
  }

  stop(): void {
    this.playing = false;
  }

  position(now: number): TransportPosition {
    if (!this.playing) {
      return { playing: false, countIn: false, countInBeat: 0, loopIndex: 0, beatInLoop: 0, absBeat: 0 };
    }
    const absBeat = this.anchorLoop * this.loopBeats + (now - this.anchorTime) / this.secPerBeat;
    if (absBeat < 0) {
      return {
        playing: true,
        countIn: true,
        countInBeat: this.countInBeats + absBeat,
        loopIndex: 0,
        beatInLoop: 0,
        absBeat,
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
      const absBeat = this.anchorLoop * this.loopBeats + (now - this.anchorTime) / this.secPerBeat;
      this.bpm = bpm;
      // keep the playhead continuous: re-anchor at the current loop's beat 0
      this.anchorLoop = Math.max(0, Math.floor(absBeat / this.loopBeats));
      this.anchorTime = now - (absBeat - this.anchorLoop * this.loopBeats) * this.secPerBeat;
    } else {
      this.bpm = bpm;
    }
  }

  /**
   * Advance the scheduling window: returns the half-open range of absolute
   * beats [from, to) that now needs audio events scheduled (metronome clicks,
   * guide notes), or null if the window hasn't grown. `horizon` is how far
   * ahead of `now` to schedule, in seconds.
   */
  advanceScheduler(now: number, horizon = 1.0): { from: number; to: number } | null {
    if (!this.playing) return null;
    const nowBeat = this.anchorLoop * this.loopBeats + (now - this.anchorTime) / this.secPerBeat;
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
