/**
 * Maps midir's monotonic microsecond timestamps onto the AudioContext clock,
 * so hardware hits are graded at the instant the note was struck rather than
 * the moment the event happened to reach the webview.
 *
 * The two clocks share no epoch, so we estimate the offset
 * `audioTime - midiTime` from observed pairs. Event delivery only ever adds
 * positive delay, so the *minimum* observed delta over a sliding window is
 * the best estimate of the true offset; jittery deliveries just fall above
 * it.
 */

const WINDOW = 64;

export class MidiClock {
  private deltas: number[] = [];

  /** Record an observed (midi timestamp, audio clock) pair. */
  sync(stampMicros: number, audioNow: number): void {
    this.deltas.push(audioNow - stampMicros / 1e6);
    if (this.deltas.length > WINDOW) this.deltas.shift();
  }

  /**
   * Convert a MIDI timestamp to audio-clock seconds. Falls back to
   * `fallback` (typically "now") until at least one pair has been seen.
   */
  toAudioTime(stampMicros: number, fallback: number): number {
    if (this.deltas.length === 0) return fallback;
    return stampMicros / 1e6 + Math.min(...this.deltas);
  }
}
