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
import type { Palette, Theme } from "@/engine/theme";
import type { InstrumentType } from "@/engine/types";
import type { LaneOrientation, PadLayout } from "@/stores/settings";

export interface LaneFrame {
  /** Audio-clock now, seconds. */
  now: number;
  secPerBeat: number;
  playing: boolean;
  countIn: boolean;
  /** Armed and holding for a Link peer's downbeat — nothing is counting yet. */
  waiting: boolean;
  /** Beats elapsed within the count-in. */
  countInBeat: number;
  countInBeats: number;
  instances: readonly NoteInstance[];
  reducedMotion: boolean;

  /** Active palette. Canvas can't read CSS custom properties, so it's passed. */
  palette: Palette;
  /** Drives the corner radii, which differ between the two themes. */
  theme: Theme;

  /** Absolute beat at `now` — the anchor the tempo grid is ruled from. */
  absBeat: number;
  /** Beats per bar — sets the downbeat spacing of the tempo grid. */
  beatsPerBar: number;
  /** Shown under the count-in rings. */
  lessonName: string;

  /** Notes fall top-to-bottom, or scroll right-to-left onto a playhead. */
  orientation: LaneOrientation;

  /**
   * Which of the two views this is. The renderer knows already, but the shared
   * colour rule doesn't — pads and piano take the same hue list in a different
   * order, so `noteInk` has to be told which.
   */
  instrument: InstrumentType;

  /**
   * The lanes this lesson uses, in the order that assigns hues: pad indices
   * left-to-right, or the piano's distinct pitches low-to-high. A lane's
   * *position* in this list picks its colour — not its pad number or its
   * pitch — so a lane keeps the same hue from one lesson to the next.
   *
   * Separate from `padLanes` because that also decides which columns exist,
   * a job the piano gives to `lowNote`/`highNote` instead.
   */
  hueOrder: number[];

  /** Pads: pad indices in use, left-to-right. */
  padLanes: number[];
  /** Pads: the controller arrangement, for the mini grid in the gutter. */
  padLayout: PadLayout;

  /** Piano: visible key range (inclusive), lane === MIDI pitch. */
  lowNote: number;
  highNote: number;
}

/**
 * The slice of the timeline a renderer has on screen, measured in beats either
 * side of the playhead. Tempo-independent: the lane scrolls at a fixed number
 * of pixels per beat, so this depends only on the canvas size and layout.
 */
export interface VisibleWindow {
  /** Beats of already-played timeline still visible behind the playhead. */
  behind: number;
  /** Beats of upcoming timeline visible ahead of the playhead. */
  ahead: number;
}

export interface LaneRenderer {
  /** Match the backing store to the element's CSS size. */
  resize(): void;
  draw(frame: LaneFrame): void;
  /**
   * The window `draw` last used. The overview strip draws this as a viewport
   * rectangle, so what sits inside the rectangle is exactly what is on screen
   * below. Recorded during the draw rather than recomputed, so the two can
   * never disagree about the geometry.
   */
  visibleBeats(): VisibleWindow;
}
