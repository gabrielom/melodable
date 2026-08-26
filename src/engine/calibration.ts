/**
 * Timing calibration (M7).
 *
 * Every rig puts some delay between striking a pad and the player knowing they
 * struck it: the controller's own scan, the driver, and — when Ableton is
 * making the sound — the DAW's output buffer. The player hears the beat late,
 * so they play late, and the trainer marks them late for it. The offset here
 * is what cancels that out, and it is measured rather than guessed.
 *
 * The measurement is a tap test against a bare click on a fixed grid: no
 * transport, no lesson, no scorer. `tapError` places each strike against the
 * nearest click and `summarizeTaps` reduces the set to one number.
 *
 * Pure, like everything else in `engine/` — the caller supplies the times.
 */

/** Tempo of the calibration click. Slow enough to tap accurately. */
export const CAL_BPM = 100;

/** Seconds between clicks. */
export const CAL_PERIOD = 60 / CAL_BPM;

/** Clicks played before any tap counts, so the player can lock on. */
export const CAL_LEAD_CLICKS = 4;

/** Taps asked for. Enough for a median to be worth anything. */
export const CAL_TAPS = 16;

/** Fewest accepted taps that will produce a result at all. */
export const CAL_MIN_TAPS = 8;

/**
 * A strike further than this from any click is not an attempt at that beat —
 * a fumble, a double-trigger, a stray pad — and would drag a mean around.
 * Generous enough to still measure a rig that really is a fifth of a second
 * out, which is about as bad as a DAW buffer gets.
 */
export const CAL_MAX_ABS_MS = 250;

/**
 * Above this spread the taps disagree with each other more than they agree,
 * and the median is not describing the rig so much as the playing. The caller
 * says so rather than quietly applying it.
 */
export const CAL_STEADY_MS = 35;

/** Clamp for the stored offset, either direction. */
export const LATENCY_LIMIT_MS = 250;

export interface TapSummary {
  /** Median signed error, milliseconds. Positive means struck late. */
  offsetMs: number;
  /** Median absolute deviation, milliseconds — how much they disagree. */
  spreadMs: number;
  /** Taps that counted. */
  taps: number;
  /** False when the spread says this is playing, not latency. */
  steady: boolean;
}

/** Middle value; for an even count, the mean of the middle two. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Signed distance from `hitTime` to the nearest click on the grid that starts
 * at `gridStart` and repeats every `period` seconds. Positive is late.
 *
 * Returns null when the strike is too far from any click to be a tap at it.
 */
export function tapError(
  hitTime: number,
  gridStart: number,
  period = CAL_PERIOD,
  maxAbsMs = CAL_MAX_ABS_MS,
): number | null {
  const beats = (hitTime - gridStart) / period;
  const err = (beats - Math.round(beats)) * period;
  return Math.abs(err) * 1000 > maxAbsMs ? null : err;
}

/**
 * Reduce a set of signed errors (seconds) to the offset to store.
 *
 * Median rather than mean throughout: one late tap out of sixteen should move
 * the answer by nothing, and on a rig being calibrated for the first time a
 * couple of ragged taps are certain.
 */
export function summarizeTaps(errorsSeconds: readonly number[]): TapSummary | null {
  if (errorsSeconds.length < CAL_MIN_TAPS) return null;
  const ms = errorsSeconds.map((e) => e * 1000);
  const offsetMs = median(ms);
  const spreadMs = median(ms.map((m) => Math.abs(m - offsetMs)));
  return {
    offsetMs: Math.round(offsetMs),
    spreadMs: Math.round(spreadMs),
    taps: ms.length,
    steady: spreadMs <= CAL_STEADY_MS,
  };
}

/** Keep a stored offset inside what any real rig could account for. */
export function clampLatency(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-LATENCY_LIMIT_MS, Math.min(LATENCY_LIMIT_MS, Math.round(ms)));
}
