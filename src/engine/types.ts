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
  /**
   * How long the note is written to be held, in beats.
   *
   * Absent or below `HOLD_MIN_BEATS` means an instant note — an onset to hit
   * and nothing more, which is every note the app had before sustain existed.
   * Above it the note is *held*: the release is judged too, and the lane draws
   * a bar from the head showing how much of the written length you covered.
   */
  duration?: number;
}

/**
 * Shortest written length that is worth aiming a release at. Below this a
 * note is an ornament rather than a hold: there is nothing to sustain, and
 * the bar would be a smudge on the head rather than a duration.
 *
 * A dotted eighth, chosen so it clears the design's 34px minimum bar at the
 * five-bar zoom in the horizontal views (44px at the standard width, 40px at
 * the window floor). The vertical views have far less room on the time axis,
 * so there a hold has to be a half note or longer before the bar is drawn —
 * that is the 34px rule biting, not this one.
 */
export const HOLD_MIN_BEATS = 0.75;

/** How much of a note's written length the player actually covered. */
export type HoldResult = "held" | "short" | "dropped";

/**
 * Where the sustain bands sit, as a fraction of the written length.
 *
 * The design proposes these pending feel-testing on real hardware, which is
 * exactly why they are two named numbers rather than literals in a branch.
 */
export const HOLD_WINDOWS = { held: 0.85, short: 0.5 } as const;

export interface Lesson {
  id: string;
  name: string;
  instrument: InstrumentType;
  bpm: number; // suggested starting tempo
  bars: number; // pattern length in bars
  beatsPerBar: number; // e.g. 4
  /**
   * How many times the pattern plays in one run. A lesson is a finite piece
   * of music, not an endless loop — it ends, and you are scored on the whole
   * run. Omitted for imported clips, where `lessonRepeats` derives a count
   * that lands the run near the target length.
   */
  repeats?: number;
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
  /** True when a peer's transport is running and we can see it. Needs Link's
   *  "Start Stop Sync" switched on at both ends. */
  playing: boolean;
  /** Beats from that peer's transport start to `clockMicros`. Names their
   *  downbeat rather than a quantum boundary; 0 when `playing` is false. */
  beatsSinceStart: number;
  /** Link's clock reading for the peer's last transport start or stop. Often a
   *  little ahead of `clockMicros` when `playing` has just turned true, because
   *  Live quantizes its own launch — that lead is the downbeat to start on. */
  startMicros: number;
}

/**
 * How a hit is graded. The loose band splits by *direction*: rushing and
 * dragging are different mistakes and want different fixes, so they get
 * different colours rather than sharing one amber.
 */
export type Rating = "perfect" | "great" | "early" | "late" | "miss";

/**
 * Timing windows in seconds, measured as |hit - target|. `loose` is the
 * outer band that `classify` splits into `early` / `late` by sign.
 */
export const TIMING_WINDOWS = { perfect: 0.032, great: 0.06, loose: 0.1 } as const;

/**
 * Score weight per rating. `early` and `late` carry what the old single loose
 * band did, so splitting it changes no accuracy maths.
 */
export const RATING_SCORE: Record<Rating, number> = {
  perfect: 100,
  great: 75,
  early: 40,
  late: 40,
  miss: 0,
};

/**
 * Timing colour language. Lives in `engine/theme.ts` now that there are two
 * palettes — a rating's colour depends on the active theme, so renderers read
 * `PALETTE[theme].rating[r]` rather than a single fixed map.
 */
export type { Theme } from "@/engine/theme";
