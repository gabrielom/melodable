/**
 * Shared contract between the trainer and its two falling-note renderers.
 *
 * "One engine, two views" (invariant 4): the pads and piano views differ only
 * in a renderer and a pitch→lane mapping. Both renderers take the same frame
 * — a snapshot of the transport clock and the scorer's live instances — and
 * each reads the fields relevant to its layout (`padLanes` for pads,
 * `lowNote`/`highNote` for piano). The trainer builds one frame per rАF tick
 * and hands it to whichever renderer matches `lesson.instrument`.
 */

import type { NoteInstance } from "@/engine/scoring";

export interface LaneFrame {
  /** Audio-clock now, seconds. */
  now: number;
  secPerBeat: number;
  playing: boolean;
  countIn: boolean;
  /** Beats elapsed within the count-in. */
  countInBeat: number;
  countInBeats: number;
  instances: readonly NoteInstance[];
  reducedMotion: boolean;

  /** Pads: pad indices in use, left-to-right. */
  padLanes: number[];

  /** Piano: visible key range (inclusive), lane === MIDI pitch. */
  lowNote: number;
  highNote: number;
}

export interface LaneRenderer {
  /** Match the backing store to the element's CSS size. */
  resize(): void;
  draw(frame: LaneFrame): void;
}
