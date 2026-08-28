/**
 * Engraving arithmetic for the sheet view (handoff 10 §1).
 *
 * The roll draws a note's length as a translucent bar. Notation draws it as
 * the note's *shape* — a half note is visibly a half note — and that is the
 * whole reason the mode exists. This module turns a lesson's notes into the
 * pieces an engraver needs: which figure to draw, where on the staff it sits,
 * whether it carries an accidental or ledger lines, and which runs of short
 * notes are beamed together.
 *
 * Pure, per invariant 2. Nothing here knows about canvas, fonts or pixels —
 * positions come out in *diatonic steps*, and the renderer decides what a step
 * is worth in pixels.
 */

/** The note shapes the font gives us, longest first. */
export type Figure =
  | "whole"
  | "half"
  | "quarter"
  | "eighth"
  | "sixteenth"
  | "thirtysecond";

/** Beats each figure is worth, undotted, in 4/4 where a quarter is 1. */
export const FIGURE_BEATS: Record<Figure, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  thirtysecond: 0.125,
};

/** How many beams (or flags) a figure carries. Zero for quarter and longer. */
export const FIGURE_BEAMS: Record<Figure, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirtysecond: 3,
};

/**
 * Noto Music, measured from the glyph bounds of U+1D15D at unitsPerEm 1000 —
 * the whole note, which is a bare head with no stem to confuse the bounds.
 *
 * A notehead is exactly one staff space tall, which is what makes the first
 * number a scale factor: `fontSize = staffSpace / NOTEHEAD_EM_HEIGHT`.
 * Handoff 10 §1.3 says to measure rather than copy its offsets; these agree
 * with it, and `tests/notation.test.ts` pins them.
 */
export const NOTEHEAD_EM_HEIGHT = 0.252;
/** Notehead centre, in em above the alphabetic baseline. */
export const NOTEHEAD_EM_CENTRE = 0.134;

/** Codepoints, all verified present in the bundled Noto Music. */
export const GLYPH: Record<Figure, string> = {
  whole: "\u{1D15D}",
  half: "\u{1D15E}",
  quarter: "\u{1D15F}",
  eighth: "\u{1D160}",
  sixteenth: "\u{1D161}",
  thirtysecond: "\u{1D162}",
};

export const REST_GLYPH: Record<Figure, string> = {
  whole: "\u{1D13B}",
  half: "\u{1D13C}",
  quarter: "\u{1D13D}",
  eighth: "\u{1D13E}",
  sixteenth: "\u{1D13F}",
  thirtysecond: "\u{1D140}",
};

export const CLEF_TREBLE = "\u{1D11E}";
export const ACCIDENTAL = { sharp: "♯", flat: "♭", natural: "♮" } as const;

export interface Engraved {
  figure: Figure;
  /** A dot adds half the value again. */
  dotted: boolean;
}

const LONGEST_FIRST: Figure[] = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "sixteenth",
  "thirtysecond",
];

/**
 * The figure that best represents `beats`.
 *
 * Notation cannot draw an arbitrary length, so this picks the nearest thing it
 * *can* draw rather than refusing. A lesson's written durations are already
 * musical values in practice, and a note whose length is nothing recognisable
 * still has to appear somewhere — silently dropping it would be worse than
 * drawing it a shade wrong.
 *
 * Zero-length notes (every pad lesson: a drum has decayed before you could let
 * go) come back as a quarter, which is the neutral "a note happens here".
 */
export function figureFor(beats: number): Engraved {
  if (!Number.isFinite(beats) || beats <= 0) return { figure: "quarter", dotted: false };

  let best: Engraved = { figure: "thirtysecond", dotted: false };
  let bestErr = Infinity;
  for (const figure of LONGEST_FIRST) {
    for (const dotted of [false, true]) {
      const value = FIGURE_BEATS[figure] * (dotted ? 1.5 : 1);
      // Relative error, so a whole note is not favoured just for being large.
      const err = Math.abs(Math.log(beats / value));
      if (err < bestErr - 1e-9) {
        bestErr = err;
        best = { figure, dotted };
      }
    }
  }
  return best;
}

/** Beats a figure is worth once its dot is counted. */
export function beatsOf(e: Engraved): number {
  return FIGURE_BEATS[e.figure] * (e.dotted ? 1.5 : 1);
}

// ------------------------------------------------------------------- pitch

/** Diatonic index within an octave, and whether the pitch is a raised note. */
const PITCH_CLASS: ReadonlyArray<readonly [number, boolean]> = [
  [0, false], // C
  [0, true], // C#
  [1, false], // D
  [1, true], // D#
  [2, false], // E
  [3, false], // F
  [3, true], // F#
  [4, false], // G
  [4, true], // G#
  [5, false], // A
  [5, true], // A#
  [6, false], // B
];

/**
 * The staff's bottom line in the treble clef is E4 (MIDI 64). Positions are
 * counted from there in **diatonic steps** — one step is half a space, so the
 * five lines are at steps 0, 2, 4, 6, 8.
 */
export const BOTTOM_LINE_PITCH = 64;
const BOTTOM_LINE_DIATONIC = 30; // E4: octave 4 × 7 + E's index 2

/** Diatonic step of `pitch` above the bottom staff line. Negative is below. */
export function staffStep(pitch: number): number {
  const octave = Math.floor(pitch / 12) - 1;
  const [index] = PITCH_CLASS[((pitch % 12) + 12) % 12];
  return octave * 7 + index - BOTTOM_LINE_DIATONIC;
}

/**
 * The accidental to draw before `pitch`, in the key of C.
 *
 * Sharps only: the lessons are in C, and choosing between F♯ and G♭ needs a
 * key signature the app does not carry. A flat-spelled import will read as its
 * sharp equivalent, which is the same key on the controller.
 */
export function accidentalFor(pitch: number): "sharp" | null {
  return PITCH_CLASS[((pitch % 12) + 12) % 12][1] ? "sharp" : null;
}

/** Steps of the five staff lines, bottom to top. */
export const LINE_STEPS = [0, 2, 4, 6, 8] as const;

/**
 * Ledger line positions for a note at `step`, as diatonic steps.
 *
 * Lines sit on even steps, so a note in a space between two ledgers still gets
 * the ledger below (or above) it — C4 at step −2 takes one, B3 at −3 takes the
 * same one.
 */
export function ledgerSteps(step: number): number[] {
  const out: number[] = [];
  if (step < 0) {
    for (let s = -2; s >= step; s -= 2) out.push(s);
  } else if (step > 8) {
    for (let s = 10; s <= step; s += 2) out.push(s);
  }
  return out;
}

// ------------------------------------------------------------------ beams

export interface BeamGroup {
  /** Indices into the array handed in, in time order. */
  members: number[];
  /** Beams shared by the whole group — the least any member carries. */
  beams: number;
}

/** What `beamGroups` needs to know about a note. */
export interface BeamCandidate {
  /** Beats from the start of the loop. */
  beat: number;
  figure: Figure;
}

/**
 * Which runs of short notes are beamed together.
 *
 * Beamed within a beat, never across one: that is what makes a bar's pulse
 * readable, and it is the rule beginner notation is engraved by. Anything a
 * quarter or longer breaks a group, because it carries no beam to share.
 *
 * A lone eighth is left out — it keeps its own flag from the font, which is
 * the one case where the single-note glyph is usable (handoff 10 §1.4.2).
 */
export function beamGroups(notes: readonly BeamCandidate[], beatsPerBar: number): BeamGroup[] {
  const groups: BeamGroup[] = [];
  let run: number[] = [];
  let runBeat = -1;

  const flush = () => {
    if (run.length > 1) {
      groups.push({
        members: run,
        beams: Math.min(...run.map((i) => FIGURE_BEAMS[notes[i].figure])),
      });
    }
    run = [];
  };

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const beams = FIGURE_BEAMS[n.figure];
    if (beams === 0) {
      flush();
      continue;
    }
    // Which beat of the bar this note falls in; a new beat starts a new group.
    const inBar = ((n.beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const beatIndex = Math.floor(inBar + 1e-9);
    if (run.length > 0 && beatIndex !== runBeat) flush();
    if (run.length === 0) runBeat = beatIndex;
    run.push(i);
  }
  flush();
  return groups;
}

// ------------------------------------------------------------------- zoom

/**
 * Horizontal room a notehead needs before its neighbour, in pixels.
 *
 * A notehead is 19px wide at the drawn staff size and needs air either side,
 * or consecutive notes touch. Handoff 10 §1.7 measures the collision: at the
 * drawn zoom of 60px per beat a sixteenth falls 15px after its neighbour and
 * overlaps.
 */
export const MIN_NOTE_GAP_PX = 22;

/**
 * Pixels per beat that keep the closest pair in a lesson legible.
 *
 * §1.7 leaves this open: "the fix is zooming the view in, not shrinking
 * noteheads — a decision the app has to make, since it changes how much of the
 * run is visible". Rather than pick one number for every lesson, derive it —
 * a lesson of quarters keeps the roll's five bars, and one with sixteenths
 * zooms in until they clear. Nothing is ever drawn colliding, and nothing
 * zooms further than it has to.
 */
export function sheetPxPerBeat(smallestGapBeats: number, rollPxPerBeat: number): number {
  if (!Number.isFinite(smallestGapBeats) || smallestGapBeats <= 0) return rollPxPerBeat;
  const needed = MIN_NOTE_GAP_PX / smallestGapBeats;
  return Math.max(rollPxPerBeat, needed);
}

/** The closest two onsets in a set of beats — what the zoom has to clear. */
export function smallestGap(beats: readonly number[]): number {
  const sorted = [...new Set(beats)].sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < sorted.length; i++) min = Math.min(min, sorted[i] - sorted[i - 1]);
  return Number.isFinite(min) ? min : 0;
}
