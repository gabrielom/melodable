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

/**
 * Where an accidental's own centre sits, in em above the baseline.
 *
 * Measured the same way, from the counter — the hole the glyph encloses, which
 * is the part an engraver lines up with the note. The sharp's and the
 * natural's land on `NOTEHEAD_EM_CENTRE` to three decimal places, which is the
 * font telling us they are drawn to sit level with a notehead. The flat's does
 * not: its bowl hangs below a stem that rises out of the way, so centring it
 * like the others lifts it off its own line.
 */
export const ACCIDENTAL_EM_CENTRE = {
  sharp: 0.134,
  natural: 0.134,
  flat: 0.1175,
} as const;

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

/**
 * The engraved value of every distinct onset in a loop.
 *
 * **Not the note's `duration`.** That answers a different question — how long
 * you must hold it — and `lessonTargets` deliberately zeroes anything under
 * `HOLD_MIN_BEATS`, because a short note is not a hold. Read as notation that
 * turns every quaver in a piece into a crotchet: no flag, no beam, and a bar
 * of eighths drawn as four times too much music.
 *
 * What decides a note's *shape* is the rhythmic slot it occupies, which is the
 * distance to the next onset. So: use the written length when it survived the
 * hold floor and is therefore real, and otherwise fill in from the gap.
 *
 * Notes struck together are one onset and take one value — a chord is a
 * column, and its longest written note speaks for it.
 */
export function engraveOnsets(
  notes: readonly { beat: number; duration: number }[],
  loopBeats: number,
  holdFloor: number,
): Map<number, Engraved> {
  const held = new Map<number, number>();
  for (const n of notes) {
    held.set(n.beat, Math.max(held.get(n.beat) ?? 0, n.duration));
  }
  const onsets = [...held.keys()].sort((a, b) => a - b);

  const out = new Map<number, Engraved>();
  for (let i = 0; i < onsets.length; i++) {
    const beat = onsets[i];
    // The last onset runs to the end of the loop, where the pattern repeats.
    const next = i + 1 < onsets.length ? onsets[i + 1] : loopBeats;
    const gap = Math.max(0, next - beat);
    const written = held.get(beat) ?? 0;
    const value = written >= holdFloor ? Math.min(written, loopBeats) : gap;
    out.set(beat, figureFor(value));
  }
  return out;
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
 * Sharps only, which is all the key of C ever needs. `spell` supersedes this
 * for a lesson in any other key — it is kept because it is the honest answer
 * for C, and `spell(pitch, 0)` is pinned against it.
 */
export function accidentalFor(pitch: number): "sharp" | null {
  return PITCH_CLASS[((pitch % 12) + 12) % 12][1] ? "sharp" : null;
}

// --------------------------------------------------------- key signatures

/** Semitones above C for the seven letters, C D E F G A B. */
const LETTER_SEMITONE = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * The order accidentals join a signature — F C G D A E B for sharps, and the
 * same list backwards for flats. This is not a style choice: it is what makes
 * each signature a run of consecutive fifths, so every scale degree is
 * spelled on its own letter.
 */
const SHARP_LETTERS = [3, 0, 4, 1, 5, 2, 6] as const;
const FLAT_LETTERS = [6, 2, 5, 1, 4, 0, 3] as const;

/**
 * Where each accidental of a signature is written, as a diatonic step above
 * the bottom line (E4). These are the engraved positions, not derived ones:
 * the shape a signature makes on the staff is fixed by convention, and a
 * reader recognises four sharps by that shape before reading any of them.
 *
 * Treble: F♯ on the top line, C♯ in the third space, G♯ above the staff, and
 * so on down the list.
 */
const SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4] as const;
const FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1] as const;

/** The most accidentals a signature can carry. */
export const MAX_FIFTHS = 7;

export interface SignatureMark {
  /** Diatonic step above the bottom staff line. */
  step: number;
  accidental: "sharp" | "flat";
}

/**
 * The accidentals of a signature, in the order they are written.
 *
 * `fifths` is the signature's place on the circle: +4 is four sharps (E major
 * or C♯ minor), −2 is two flats, 0 is none. The signature names a *pair* of
 * keys, major and its relative minor, and the app never has to choose between
 * them — what is drawn is the same either way.
 */
export function signatureMarks(fifths: number): SignatureMark[] {
  const n = Math.min(MAX_FIFTHS, Math.abs(Math.trunc(fifths)));
  const steps = fifths >= 0 ? SHARP_STEPS : FLAT_STEPS;
  const accidental = fifths >= 0 ? "sharp" : "flat";
  return Array.from({ length: n }, (_, i) => ({ step: steps[i], accidental }));
}

/** Semitone shift the signature applies to each letter, C..B. */
export function signatureAlters(fifths: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const n = Math.min(MAX_FIFTHS, Math.abs(Math.trunc(fifths)));
  const letters = fifths >= 0 ? SHARP_LETTERS : FLAT_LETTERS;
  for (let i = 0; i < n; i++) out[letters[i]] += fifths >= 0 ? 1 : -1;
  return out;
}

export interface Spelling {
  /** Diatonic step above the bottom staff line — which line or space. */
  step: number;
  /** What to draw before the notehead, or null when the signature covers it. */
  accidental: "sharp" | "flat" | "natural" | null;
}

/**
 * Where `pitch` is written on the staff in a given key, and what accidental it
 * needs there.
 *
 * The signature does the work: a note the signature already alters is drawn
 * bare, one it alters the *other* way needs a natural, and anything outside
 * the key takes a sharp in a sharp key or a flat in a flat key. This is the
 * difference between a page of E major and the same music in C with a sharp
 * stuck on four notes out of seven.
 *
 * The octave comes out of the arithmetic rather than being assumed, so B♯ and
 * C♭ land on the letter they are spelled with and not the one they sound like.
 */
export function spell(pitch: number, fifths: number): Spelling {
  const alters = signatureAlters(fifths);
  const pc = ((pitch % 12) + 12) % 12;
  const at = (letter: number, alter: number): Spelling => ({
    // Exact: the octave that puts this letter, so altered, on this pitch.
    step: ((pitch - alter - LETTER_SEMITONE[letter]) / 12 - 1) * 7 + letter - BOTTOM_LINE_DIATONIC,
    accidental: alter === alters[letter] ? null : alter === 0 ? "natural" : alter > 0 ? "sharp" : "flat",
  });

  // In the key, so nothing to draw.
  for (let l = 0; l < 7; l++) {
    if (((LETTER_SEMITONE[l] + alters[l]) % 12 + 12) % 12 === pc) return at(l, alters[l]);
  }
  // The letter's own natural, which the signature is altering — so, a natural.
  for (let l = 0; l < 7; l++) {
    if (LETTER_SEMITONE[l] === pc && alters[l] !== 0) return at(l, 0);
  }
  // Outside the key: raise in a sharp key, lower in a flat one.
  const dir = fifths < 0 ? -1 : 1;
  for (let l = 0; l < 7; l++) {
    if (((LETTER_SEMITONE[l] + alters[l] + dir) % 12 + 12) % 12 === pc) {
      return at(l, alters[l] + dir);
    }
  }
  // Nothing a single accidental can reach (a double alteration). Fall back to
  // the C-major spelling rather than refusing to draw the note at all.
  return { step: staffStep(pitch), accidental: accidentalFor(pitch) };
}

/**
 * The key signature that suits a set of pitches.
 *
 * Chosen by the only measure that matters on the page: how many accidentals
 * the reader would have to be shown. Every candidate signature is costed as
 * the number of *notes* — not pitch classes, so a passing chromatic does not
 * outvote a tonic — that fall outside its scale, and the cheapest wins. A tie
 * goes to the simpler signature, so a fragment that fits several keys equally
 * is written in the plainest of them rather than an arbitrary one.
 *
 * Major and relative minor share a signature, so there is no mode to guess.
 */
export function keySignatureFor(pitches: readonly number[]): number {
  if (pitches.length === 0) return 0;

  const count = new Array(12).fill(0) as number[];
  for (const p of pitches) count[((p % 12) + 12) % 12]++;

  let best = 0;
  let bestCost = Infinity;
  // Sharps before flats at equal cost and equal size: a tie between the two is
  // a coin toss, and this repertoire is written sharp.
  for (const fifths of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7]) {
    const alters = signatureAlters(fifths);
    const inKey = new Array(12).fill(false) as boolean[];
    for (let l = 0; l < 7; l++) inKey[(((LETTER_SEMITONE[l] + alters[l]) % 12) + 12) % 12] = true;

    let cost = 0;
    for (let pc = 0; pc < 12; pc++) if (!inKey[pc]) cost += count[pc];
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = fifths;
    }
  }
  return best;
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
  /**
   * Beats from the start of the loop — the note's *written* position.
   *
   * Exact lesson data, never a position reconstructed from the clock. A beat
   * recomputed each frame jitters in its last bits, and a note sitting on a
   * beat line then falls either side of `Math.floor` from one frame to the
   * next: the group breaks and reforms, and the note is seen to flick between
   * a beam and a flag.
   */
  beat: number;
  figure: Figure;
  /** Which repeat of the pattern. A group never spans two. */
  loop?: number;
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
  let runLoop = -1;

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
    // Which beat of the bar this note falls in; a new beat starts a new group,
    // and so does a new repeat of the pattern.
    const inBar = ((n.beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const beatIndex = Math.floor(inBar + 1e-9);
    const loop = n.loop ?? 0;
    if (run.length > 0 && (beatIndex !== runBeat || loop !== runLoop)) flush();
    if (run.length === 0) {
      runBeat = beatIndex;
      runLoop = loop;
    }
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
