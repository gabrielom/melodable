/**
 * Core data models. These are deliberately framework-agnostic: the engine
 * (transport, scoring, adaptive difficulty, lesson import) must not import Vue.
 * Pads and Piano differ only in a renderer and a pitch -> position mapping.
 */

export type InstrumentType = "pads" | "piano";

/** A single note the player must hit. `time` is in beats from the loop start. */
export interface NoteEvent {
  time: number; // beats (quarter note = 1.0)
  pitch: number; // MIDI note number (0-127)
  velocity?: number; // 0-127 (optional target dynamics)
}

export interface Lesson {
  id: string;
  name: string;
  instrument: InstrumentType;
  bpm: number; // suggested starting tempo
  bars: number; // loop length in bars
  beatsPerBar: number; // e.g. 4
  notes: NoteEvent[];
  source: "builtin" | "midi-import";
  hint?: string;
}

/** Raw MIDI event coming up from Rust via the `midi://message` event. */
export interface MidiMessage {
  kind: "noteon" | "noteoff" | "cc" | "other";
  note: number;
  velocity: number;
  channel: number;
  /** midir's monotonic timestamp. Grade against this, not Date.now(). */
  timestampMicros: number;
}

/**
 * A snapshot of the Ableton Link session, pushed up from Rust as
 * `link://state`. Mirrors `LinkState` in `src-tauri/src/link.rs`.
 */
export interface LinkState {
  /** False when Link is switched off, or this build has no Link support. */
  enabled: boolean;
  /** False when the app was built without the `link` cargo feature. */
  available: boolean;
  tempo: number;
  /** Position within the current quantum — the trainer's loop length. */
  phase: number;
  /** Other participants on the network (Ableton counts as one). */
  peers: number;
  /** Link's clock reading for this snapshot. Map it onto the audio clock via
   *  `HostClock` before using it — never apply it at delivery time. */
  clockMicros: number;
}

export type Rating = "perfect" | "great" | "good" | "miss";

/** Timing windows in seconds, measured as |hit - target|. */
export const TIMING_WINDOWS = { perfect: 0.032, great: 0.06, good: 0.1 } as const;

export const RATING_SCORE: Record<Rating, number> = {
  perfect: 100,
  great: 75,
  good: 40,
  miss: 0,
};

/**
 * Timing colour language. Melodics (2015-2019 desktop) used
 * green = perfect, orange/purple = early/late, red = missed.
 * We keep the same semantics with a palette that matches the DAW theme —
 * swap `perfect` to green here if you prefer their convention.
 */
export const RATING_COLOR: Record<Rating, string> = {
  perfect: "#ffb340",
  great: "#37d0c4",
  good: "#6ea8ff",
  miss: "#e2564d",
};
