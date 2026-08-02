/**
 * Maps a Rust-side monotonic microsecond clock onto the AudioContext clock.
 *
 * Two callers need this, for the same reason: midir stamps each hardware hit
 * with the instant the note was struck, and Ableton Link stamps each session
 * snapshot with the instant it was sampled. Both must be graded (or applied)
 * at that instant, not at the moment the event reached the webview.
 *
 * The two clocks share no epoch, so we estimate the offset
 * `audioTime - hostTime` from observed pairs. Event delivery only ever adds
 * positive delay, so the *minimum* observed delta over a sliding window is
 * the best estimate of the true offset; jittery deliveries just fall above
 * it.
 *
 * Keep one instance per source — midir and Link are not guaranteed to be
 * reading the same underlying clock.
 */

const WINDOW = 64;

export class HostClock {
  private deltas: number[] = [];

  /** Record an observed (host timestamp, audio clock) pair. */
  sync(stampMicros: number, audioNow: number): void {
    this.deltas.push(audioNow - stampMicros / 1e6);
    if (this.deltas.length > WINDOW) this.deltas.shift();
  }

  /**
   * Convert a host timestamp to audio-clock seconds. Falls back to
   * `fallback` (typically "now") until at least one pair has been seen.
   */
  toAudioTime(stampMicros: number, fallback: number): number {
    if (this.deltas.length === 0) return fallback;
    return stampMicros / 1e6 + Math.min(...this.deltas);
  }
}
