/**
 * Engraving arithmetic for the sheet view (handoff 10 §1).
 *
 * The roll draws a note's length as a translucent bar. Notation draws it as
 * the note's *shape* — a half note is visibly a half note — and that is the
 * whole reason the mode exists. This module turns a lesson's notes into the
 * pieces an engraver needs: which figure to draw, where on the staff it sits,
 * and whether it carries an accidental or ledger lines.
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

/** How many beams a figure carries — its flags, when it stands alone. */
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
 * How far right of the glyph's origin the *notehead* sits, in em.
 *
 * Handoff 11 §1.2: derive from this, never from measured ink bounds. An
 * eighth note's flag extends its ink to the right, so ink-centre puts a label
 * ~8px off while its head is at the same offset as a quarter's.
 *
 * The whole note's `0.2570` is measured off the font binary and agrees with
 * the handoff exactly. The stemmed figure is the handoff's, corroborated
 * against the half note — the one stemmed glyph whose head is a separate
 * contour — which measures `0.1975`, within 0.003em.
 */
export const NOTEHEAD_EM_DX = { stemmed: 0.2006, whole: 0.257 } as const;

/**
 * Half a notehead's width, in em — and therefore where its stem attaches.
 *
 * Rasterised from the font at the drawn size: a stemmed head spans `0.0519`
 * to `0.3446em` about a centre of `0.1983`, and the stem sits at that right
 * edge. So the same number places a bare head in a chord *and* the stem beside
 * it, which is what keeps the two touching.
 *
 * The bare heads have to match the glyph's, because a chord's heads and a
 * single note's glyph appear side by side on the same staff.
 */
export const NOTEHEAD_EM_HALF_WIDTH = 0.1464;

/** That offset for a given figure. */
export function noteheadDx(figure: Figure): number {
  return figure === "whole" ? NOTEHEAD_EM_DX.whole : NOTEHEAD_EM_DX.stemmed;
}

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

/**
 * Where each rest glyph sits, measured off the font and seated by the rule
 * notation uses for it.
 *
 * `em` is the offset above the baseline of the part of the glyph that lands on
 * `step`, and the two differ per figure because rests are not all seated the
 * same way:
 *
 * - a **whole** rest *hangs* from the fourth line, so its **top** goes on
 *   step 6 and its half-space body drops into the space below;
 * - a **half** rest *sits* on the middle line, so its **bottom** goes on
 *   step 4 and its body rises into the same space — which is why the two are
 *   told apart by hanging against sitting and not by shape;
 * - everything shorter is **centred** on the middle line, and the font agrees:
 *   the quarter, eighth and sixteenth all measure their ink centre at
 *   `0.4995`-`0.5005em`, within a thousandth of each other.
 *
 * `dx` is the em from the pen to the ink's horizontal centre, so a rest
 * centres on its beat the way a notehead centres on its own.
 */
export const REST_SEAT: Record<Figure, { em: number; step: number; dx: number }> = {
  whole: { em: 0.512, step: 6, dx: (0.05 + 0.733) / 2 },
  half: { em: 0.244, step: 4, dx: (0.05 + 0.733) / 2 },
  quarter: { em: 0.5005, step: 4, dx: (0.051 + 0.307) / 2 },
  eighth: { em: 0.4995, step: 4, dx: (0.05 + 0.312) / 2 },
  sixteenth: { em: 0.4995, step: 4, dx: (0.05 + 0.38) / 2 },
  thirtysecond: { em: 0.4755, step: 4, dx: (0.05 + 0.451) / 2 },
};

/** A silence, drawn. `beat` is where it starts within the pattern. */
export interface Rest {
  beat: number;
  figure: Figure;
}

/** Longest first, which is the order the greedy fill has to try them in. */
const REST_FIGURES: readonly Figure[] = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "sixteenth",
  "thirtysecond",
];
const REST_EPS = 1e-6;

/**
 * The silences in one staff's worth of music, as rests.
 *
 * **Per staff, never per system.** The two hands rest independently and
 * constantly: in the imported Lavoe the right hand has 14 silences and the
 * left 38, and almost none of them line up. Deriving from the merged onsets
 * would have found the 14 the hands happen to share and drawn nothing for the
 * rest — which is worse than drawing none at all, because the page would look
 * finished.
 *
 * A note with **no written length** ends where the next one starts, so it
 * leaves no silence — that is the pad case, and a clip whose note-offs never
 * arrived. Everything else is the gap between a note's written end and the
 * next onset.
 *
 * Two rules shape the decomposition, and both are what an engraver does:
 * a rest **never crosses a barline**, and it never crosses a metrical
 * boundary coarser than itself — enforced by only ever placing a value on a
 * multiple of itself. A quaver's silence from beat 0.5 to beat 2 therefore
 * comes out as a quaver rest then a crotchet rest, which is how it is
 * printed, rather than as one dotted crotchet in the wrong place. No dotted
 * rests at all: in simple metre the pair reads better and is commoner.
 *
 * A silence covering a whole bar is a **bar rest** — one whole rest, whatever
 * the metre. In 4/4 the greedy fill arrives there anyway; in 3/4 it would
 * otherwise write a minim and a crotchet, which is wrong.
 */
export function restsFor(
  notes: readonly { beat: number; written: number }[],
  beatsPerBar: number,
  loopBeats: number,
): Rest[] {
  const at = new Map<number, number>();
  for (const n of notes) at.set(n.beat, Math.max(at.get(n.beat) ?? 0, n.written));
  const onsets = [...at.keys()].sort((a, b) => a - b);

  const out: Rest[] = [];
  const fill = (from: number, to: number) => fillSilence(from, to, beatsPerBar, out);

  if (onsets.length === 0) {
    fill(0, loopBeats);
    return out;
  }
  // A pattern that starts after beat 0 starts with a silence, and one that
  // ends early ends with one — both are real rests on the page.
  fill(0, onsets[0]);
  for (let i = 0; i < onsets.length; i++) {
    const written = at.get(onsets[i]) ?? 0;
    const next = i + 1 < onsets.length ? onsets[i + 1] : loopBeats;
    if (written <= 0) continue; // no length to end: it runs to the next onset
    fill(Math.min(onsets[i] + written, next), next);
  }
  return out;
}

/** Split a silence at every barline, then fill each piece. */
function fillSilence(from: number, to: number, beatsPerBar: number, out: Rest[]): void {
  let t = from;
  while (t < to - REST_EPS) {
    const barEnd = (Math.floor(t / beatsPerBar + REST_EPS) + 1) * beatsPerBar;
    const end = Math.min(to, barEnd);
    // A whole bar of silence is one rest, whatever the metre says it is worth.
    if (Math.abs(end - t - beatsPerBar) < REST_EPS && alignedTo(t, beatsPerBar)) {
      out.push({ beat: t, figure: "whole" });
    } else {
      fillBar(t, end, out);
    }
    t = end;
  }
}

/** Largest value that both fits and may legally start here, until it is full. */
function fillBar(from: number, to: number, out: Rest[]): void {
  let t = from;
  while (t < to - REST_EPS) {
    const left = to - t;
    const figure = REST_FIGURES.find(
      (f) => FIGURE_BEATS[f] <= left + REST_EPS && alignedTo(t, FIGURE_BEATS[f]),
    );
    // Nothing fits only for a length no undotted figure can spell — a tuplet.
    // Drawing the nearest one would be a lie about the rhythm, so draw none.
    if (figure === undefined) return;
    out.push({ beat: t, figure });
    t += FIGURE_BEATS[figure];
  }
}

/** Whether `t` sits on a multiple of `v` — what keeps a rest off the offbeat. */
function alignedTo(t: number, v: number): boolean {
  const k = t / v;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

export const CLEF_TREBLE = "\u{1D11E}";
/** The F clef, for the bass staff of a grand staff. Its dots straddle F3. */
export const CLEF_BASS = "\u{1D122}";
/** The brace that joins the two staves of a grand staff at the left. */
export const BRACE = "\u{1D114}";
export const ACCIDENTAL = { sharp: "♯", flat: "♭", natural: "♮" } as const;

/**
 * The **combining** flags, indexed by how many the figure carries.
 *
 * These are what make a stem-down note drawable at all. The font's composed
 * figures (`GLYPH`) are stem-**up** only, so for years every note on the staff
 * pointed up whatever its position — which is the single thing that most made
 * the trainer's staff not look like engraved music. The flags have no advance
 * width and are drawn to hang off a stem whose tip is at `FLAG_EM_TIP`; for a
 * down-stem the same glyph is mirrored about the tip, which is how it curls
 * the right way.
 */
export const FLAG = ["", "\u{1D16E}", "\u{1D16F}", "\u{1D170}"] as const;

/**
 * A stem's length from the notehead's centre, and where a flag meets its tip —
 * both in em, both read off the composed quarter and eighth rather than
 * chosen.
 *
 * The quarter's ink stops at `1.009em` above the baseline and the notehead's
 * centre sits at `NOTEHEAD_EM_CENTRE`, so the font's own stem is the
 * difference: `0.875em`, or 3.47 staff spaces, which is the 3.5 every
 * engraving manual asks for. The drawn stems used a flat 32px — under two
 * spaces — so a chord's stem was little over half the length of the stem on
 * the single note beside it. One number now, and the assembled note is the
 * glyph's twin.
 */
export const FLAG_EM_TIP = 1.009;
export const STEM_EM_LEN = FLAG_EM_TIP - NOTEHEAD_EM_CENTRE;

/**
 * Where each clef's own reference line sits above its baseline, in em.
 *
 * The treble's is the notehead centre, which is what the font seats every
 * glyph by. The bass clef's is **measured off its two dots**: they straddle
 * the F line, their centres sit at `0.7545` and `0.5345em`, and the line is
 * the midpoint. Guessing the notehead centre for it too would have put the
 * clef half a staff out.
 */
export const CLEF_REF_EM = { treble: NOTEHEAD_EM_CENTRE, bass: 0.6445 } as const;

/**
 * How far each clef's ink reaches right of the pen, in em. The key signature
 * starts clear of whichever clefs are drawn, so these are what decide it —
 * and the two are **not** the same, which is why a grand staff's signature
 * sits a few pixels further right than a lone treble's.
 */
export const CLEF_INK_EM = { treble: 0.661, bass: 0.742 } as const;

/**
 * The brace's ink, in em about its pen. Both numbers earn their keep.
 *
 * Vertically it fills the em box exactly — `0.0` to `1.0` about the baseline —
 * so drawn at font size `span` on a baseline at the system's bottom it lands
 * on both staves' outer lines with no fudge at either end.
 *
 * Horizontally, `x0` is the **left bearing**, and it is the easy one to drop:
 * the ink is `0.161em` wide but sits `0.05em` right of the pen, so budgeting
 * the width alone after the pen position puts whatever comes next — the
 * system rule, then the clef — straight through the brace.
 */
export const BRACE_INK_EM = { x0: 0.05, x1: 0.211, top: 1, bottom: 0 } as const;

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
 * Read from `written`, the length the clip actually carries, **not** from
 * `duration`, which answers how long you must hold a note and is zeroed below
 * `HOLD_MIN_BEATS` because a short note is not a hold.
 *
 * That zeroing is why this used to fall back to the **gap to the next onset**,
 * and the fallback is wrong wherever a note is shorter than its slot. Every
 * quaver at every tempo is under the hold floor, so on a montuno of running
 * quaver chords — `Ⓑ 0, 0.5, 1.5, 2.0 …` — the note at 0.5 was a quaver
 * followed by a quaver rest and came out a **crotchet**, because that is the
 * distance to the next one. Crotchets carry no beam, so a passage printed as
 * beamed fours was drawn as alternating quavers and crotchets, and no amount
 * of fixing the beaming rules could have reached it.
 *
 * The gap survives only as the answer for a note with no length at all — a
 * pad hit, or a clip whose note-offs never arrived.
 *
 * Notes struck together are one onset and take one value — a chord is a
 * column, and its longest written note speaks for it.
 */
export function engraveOnsets(
  notes: readonly { beat: number; written: number }[],
  loopBeats: number,
): Map<number, Engraved> {
  const held = new Map<number, number>();
  for (const n of notes) {
    held.set(n.beat, Math.max(held.get(n.beat) ?? 0, n.written));
  }
  const onsets = [...held.keys()].sort((a, b) => a - b);

  const out = new Map<number, Engraved>();
  for (let i = 0; i < onsets.length; i++) {
    const beat = onsets[i];
    // The last onset runs to the end of the loop, where the pattern repeats.
    const next = i + 1 < onsets.length ? onsets[i + 1] : loopBeats;
    const gap = Math.max(0, next - beat);
    const written = held.get(beat) ?? 0;
    const value = written > 0 ? Math.min(written, loopBeats) : gap;
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

/** The middle line, which is what decides a stem's direction. */
export const MIDDLE_LINE_STEP = 4;

/**
 * Which way the stems go for a set of notes sharing one — a chord, or every
 * note under one beam.
 *
 * The rule notation has always used: a note **below** the middle line takes
 * its stem up, one on or above it takes it down, so the stem stays inside the
 * staff instead of running off the page. What decides a group is the note
 * **furthest from the middle line**; if the extremes are equally far, the
 * stem goes down, which is the convention for the ambiguous case.
 *
 * Steps are the notes' positions on **their own staff** — on a grand staff
 * each hand answers for itself, which is exactly why a two-hand strike must
 * not be one column.
 */
export function stemsUp(steps: readonly number[]): boolean {
  if (steps.length === 0) return true;
  let furthest = 0;
  for (const s of steps) furthest = Math.max(furthest, Math.abs(s - MIDDLE_LINE_STEP));
  return steps.every((s) => Math.abs(s - MIDDLE_LINE_STEP) < furthest || s < MIDDLE_LINE_STEP);
}

/** Diatonic step of `pitch` above the bottom staff line. Negative is below. */
export function staffStep(pitch: number): number {
  const octave = Math.floor(pitch / 12) - 1;
  const [index] = PITCH_CLASS[((pitch % 12) + 12) % 12];
  return octave * 7 + index - BOTTOM_LINE_DIATONIC;
}

/**
 * The grand staff: a bass staff under the treble one, for music that needs it.
 *
 * Positions everywhere in this module are diatonic steps above the **treble**
 * staff's bottom line, E4. The bass staff's own bottom line is G2, which is
 * twelve steps below that — so one `spell` still answers for both staves and
 * a note on the bass staff is drawn from its own bottom line at `step + 12`.
 * The two staves are *not* diatonically continuous on the page, and must not
 * be: real engraving separates them by far more than the four steps between
 * E4 and A3, which is why each note is placed against its own staff rather
 * than on one long ladder.
 */
export const GRAND_STEP_OFFSET = 12;

/**
 * Which staff a note goes on, given where this lesson's hands divide.
 *
 * Middle C is the classic line and is still the default, but it is **not** a
 * constant: plenty of two-hand music keeps the left hand above middle C, and
 * splitting such a piece at C4 leaves the bass staff nearly empty while the
 * left hand crowds in under the right. `handSplit` reads the real line off
 * the music; this only applies it.
 */
export function onBassStaff(step: number, split = MIDDLE_C_STEP): boolean {
  return step < split;
}

/**
 * What one treble staff holds without the reader counting lines: two ledgers
 * either side, `A3` (-4) below and `C6` (12) above.
 *
 * The low half is the older rule and its reasoning is unchanged — a melody
 * that merely dips, like the imported No One bottoming out on exactly A3,
 * belongs on one staff, because a single line of music does. The high half is
 * the same sentence the other way up, and it is what a two-hand piece trips
 * when its left hand never goes low: the right hand climbs off the top
 * instead. Without it a montuno sitting between B3 and G6 was drawn on one
 * staff with four ledgers above and three below.
 */
const TREBLE_LOW = -4;
const TREBLE_HIGH = 12;

/**
 * Whether a lesson's pitches need the bass staff at all.
 *
 * Derived, like the key signature and the harmony: nothing authors it, and a
 * clip that stays in one register keeps the single treble staff it has always
 * had. Only music that reaches past what one staff holds gets the second one.
 */
export function needsBassStaff(pitches: readonly number[], split = MIDDLE_C_STEP): boolean {
  if (pitches.length === 0) return false;
  const steps = pitches.map(staffStep);
  const tooWide = Math.min(...steps) < TREBLE_LOW || Math.max(...steps) > TREBLE_HIGH;
  if (!tooWide) return false;
  // And only if the split leaves each staff something to hold. Music living
  // entirely above the treble staff is still too wide for it, but a second
  // staff underneath would be empty — that case wants ledger lines, or an
  // `8va` we do not draw, and never a bass clef with nothing on it.
  return steps.some((s) => s < split) && steps.some((s) => s >= split);
}

/** C4, one ledger under the treble staff — the classic line between the hands. */
export const MIDDLE_C_STEP = -2;
/**
 * How far the derived split may stray from middle C: down to A3 and up to G4,
 * which is the band both staves can still reach without absurd ledgers.
 */
const SPLIT_LOW = -4;
const SPLIT_HIGH = 2;
/**
 * The smallest gap inside one simultaneity that counts as two hands rather
 * than one chord — a fifth. A triad's internal gaps are thirds; hands are
 * usually an octave or more apart.
 */
const MIN_HAND_GAP = 4;
/** Onsets within this many beats are the same moment, as everywhere else here. */
const ONSET_TOLERANCE = 1 / 16;

/**
 * Where a lesson's hands divide, read off the moments they play together.
 *
 * Middle C is the textbook answer and is wrong for a great deal of real
 * music. A mambo montuno plays `G3 B3 C4 D4` in the left hand against
 * `G4 B4 C5 D5 G5` in the right: split at C4 and the left hand's C4 and D4
 * climb onto the treble staff with the right hand, which is how ours came to
 * draw two staves and still look like one crowded one. There is no ledger-line
 * argument that finds the real line either — C4 and D4 sit perfectly
 * comfortably on the treble staff. What finds it is that the two hands
 * **sound together**: every onset of that montuno is one low note and one high
 * one, and the gap between them is never crossed. Each such moment votes for
 * the splits lying inside its own widest gap, and the winner is the line the
 * music itself never crosses — here G4, which is exactly where the printed
 * score puts it.
 *
 * A clip with no simultaneities is a melody and has no hands to divide, so it
 * keeps middle C; so does one whose gaps are all chord-sized. Ties go to
 * middle C as well. Derived from the whole lesson, never from what is on
 * screen — a staff that moved a note as you scrolled would be unreadable.
 */
export function handSplit(notes: readonly { time: number; pitch: number }[]): number {
  const moments = new Map<number, number[]>();
  for (const n of notes) {
    const key = Math.round(n.time / ONSET_TOLERANCE);
    const at = moments.get(key);
    if (at) at.push(staffStep(n.pitch));
    else moments.set(key, [staffStep(n.pitch)]);
  }

  const votes = new Map<number, number>();
  for (const steps of moments.values()) {
    const sorted = [...new Set(steps)].sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    let widest = 0;
    let at = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > widest) {
        widest = sorted[i] - sorted[i - 1];
        at = i;
      }
    }
    if (widest < MIN_HAND_GAP) continue;
    // A split of `v` sends everything below `v` down, so the splits that
    // divide this moment cleanly are the ones inside its gap.
    const from = Math.max(SPLIT_LOW, sorted[at - 1] + 1);
    const to = Math.min(SPLIT_HIGH, sorted[at]);
    for (let v = from; v <= to; v++) votes.set(v, (votes.get(v) ?? 0) + 1);
  }

  let best = MIDDLE_C_STEP;
  let bestVotes = 0;
  for (let v = SPLIT_LOW; v <= SPLIT_HIGH; v++) {
    const n = votes.get(v) ?? 0;
    const closer = Math.abs(v - MIDDLE_C_STEP) < Math.abs(best - MIDDLE_C_STEP);
    if (n > bestVotes || (n === bestVotes && n > 0 && closer)) {
      bestVotes = n;
      best = v;
    }
  }
  return bestVotes > 0 ? best : MIDDLE_C_STEP;
}

/**
 * A signature's accidentals as the bass clef writes them.
 *
 * Two steps lower than the treble's, which is the whole of the difference:
 * the F♯ that sits on the treble's top line sits on the bass's fourth line,
 * and every other accidental follows it down by the same third.
 */
export function bassSignatureMarks(fifths: number): SignatureMark[] {
  return signatureMarks(fifths).map((m) => ({ ...m, step: m.step - 2 }));
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
export const LETTER_SEMITONE = [0, 2, 4, 5, 7, 9, 11] as const;
/** Their names, in the same order. */
export const LETTER_NAME = ["C", "D", "E", "F", "G", "A", "B"] as const;

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

// --------------------------------------------------------- scale degrees

/**
 * Which letter the key's tonic is written on.
 *
 * The circle of fifths steps four letters at a time — C G D A E B F — so the
 * tonic's letter is the signature's own position times four. That holds in
 * both directions, which is why flats need no separate table.
 */
export function tonicLetter(fifths: number): number {
  return (((Math.trunc(fifths) * 4) % 7) + 7) % 7;
}

export interface Degree {
  /** Scale degree, 1..7 — the tonic is 1. */
  degree: number;
  /** Semitones off that degree: 0 diatonic, +1 raised, −1 lowered. */
  alter: number;
}

/**
 * `pitch` as a scale degree in a key — Hooktheory's move, and the whole point
 * of degree mode: what the note *does* rather than what it is called.
 *
 * The letter comes from `spell`, so the two labellings can never disagree
 * about which line a note is on. The alteration is **not** the notation
 * accidental: it is measured against the scale's own version of that degree.
 * In E major an F♮ is written with a natural sign, but it is `♭2` — the
 * signature's F♯ is what degree 2 is, and this note is a semitone under it.
 */
export function degreeOf(pitch: number, fifths: number): Degree {
  const alters = signatureAlters(fifths);
  const step = spell(pitch, fifths).step;
  const letter = (((step + BOTTOM_LINE_DIATONIC) % 7) + 7) % 7;
  const scalePc = (((LETTER_SEMITONE[letter] + alters[letter]) % 12) + 12) % 12;
  const pc = ((pitch % 12) + 12) % 12;
  // Wrapped into (−6, 6] so a degree at the octave boundary is not read as
  // eleven semitones away from itself.
  const alter = ((((pc - scalePc + 18) % 12) + 12) % 12) - 6;
  return { degree: (((letter - tonicLetter(fifths)) % 7) + 7) % 7 + 1, alter };
}

/**
 * A degree as the roll writes it inside a notehead: the digit, then its mark.
 *
 * Digit-then-mark, matching `C♯` — the accidental is a qualifier on the
 * degree, not its equal (handoff 11 §1.1). ASCII `#`/`b` rather than the music
 * glyphs, because this is set in the same mono face as the letters it
 * replaces and has to measure the same.
 */
export function degreeLabel(pitch: number, fifths: number): string {
  const { degree, alter } = degreeOf(pitch, fifths);
  return `${degree}${alter > 0 ? "#" : alter < 0 ? "b" : ""}`;
}

/** Tonic names by signature, for the bar's key chip. Majors, which is the
 *  name a signature is usually called by; the relative minor shares it. */
const TONIC_NAME: readonly string[] = [
  "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F",
  "C",
  "G", "D", "A", "E", "B", "F#", "C#",
];

/** The key a signature names, as the chip writes it — "C maj", "E maj". */
export function keyName(fifths: number): string {
  const i = Math.max(-MAX_FIFTHS, Math.min(MAX_FIFTHS, Math.trunc(fifths))) + MAX_FIFTHS;
  return `${TONIC_NAME[i]} maj`;
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
export function beamGroups(
  notes: readonly BeamCandidate[],
  beatsPerBar: number,
  restBeats: readonly number[] = [],
): BeamGroup[] {
  const groups: BeamGroup[] = [];
  let run: number[] = [];
  let runBeat = -1;
  let runLoop = -1;

  // A run of one is kept this far so `joinEighths` can still pair it with the
  // next beat's; what cannot be beamed to anything is dropped at the end.
  const flush = () => {
    if (run.length > 0) {
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
    // A silence ends a beam. The printed score breaks its beam either side of
    // a quaver rest rather than carrying one over the top of it, and a beam
    // spanning a rest reads as a run of notes that is not there.
    const prev = run.length > 0 ? notes[run[run.length - 1]] : undefined;
    const rested =
      prev !== undefined && restBeats.some((r) => r > prev.beat + 1e-9 && r < n.beat - 1e-9);
    if (run.length > 0 && (beatIndex !== runBeat || loop !== runLoop || rested)) flush();
    if (run.length === 0) {
      runBeat = beatIndex;
      runLoop = loop;
    }
    run.push(i);
  }
  flush();
  // A lone note has no beam — it wears the font's flag instead.
  return joinEighths(groups, notes, beatsPerBar, restBeats).filter((g) => g.members.length > 1);
}

/** How many beats a run of plain eighths may beam across. */
const BEAM_SPAN_BEATS = 2;

/**
 * Join per-beat groups of plain eighths that fill the same half-bar.
 *
 * Beaming by the beat is correct and is what the groups above are built on,
 * but a running quaver passage engraved that way comes out as a row of
 * two-note groups, and printed music beams it in fours. Both are right; the
 * four is what a reader expects and what every piano part this was checked
 * against does.
 *
 * Deliberately a pass over the finished groups rather than a wider unit in
 * the loop. Only **plain eighths** merge, so a sixteenth keeps its group on
 * the beat where the eye needs the subdivision, and a broken group — a dotted
 * eighth against a sixteenth, the case the beam stubs exist for — is never
 * swept into a longer beam. And only in a metre the half-bar divides, so 3/4
 * stays on the beat.
 */
function joinEighths(
  groups: BeamGroup[],
  notes: readonly BeamCandidate[],
  beatsPerBar: number,
  restBeats: readonly number[],
): BeamGroup[] {
  if (beatsPerBar % BEAM_SPAN_BEATS !== 0) return groups;
  const plain = (g: BeamGroup) => g.members.every((m) => FIGURE_BEAMS[notes[m].figure] === 1);
  const halfBarOf = (m: number) => {
    const inBar = ((notes[m].beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    return Math.floor(inBar / BEAM_SPAN_BEATS + 1e-9);
  };

  const out: BeamGroup[] = [];
  for (const g of groups) {
    const prev = out[out.length - 1];
    const joins =
      prev !== undefined &&
      plain(prev) &&
      plain(g) &&
      // Adjacent in the music, not merely adjacent in the list: a rest or a
      // longer note between them has already ended the beam.
      prev.members[prev.members.length - 1] + 1 === g.members[0] &&
      (notes[g.members[0]].loop ?? 0) === (notes[prev.members[0]].loop ?? 0) &&
      halfBarOf(g.members[0]) === halfBarOf(prev.members[0]) &&
      // …and nothing rests between them, for the reason above.
      !restBeats.some(
        (r) =>
          r > notes[prev.members[prev.members.length - 1]].beat + 1e-9 &&
          r < notes[g.members[0]].beat - 1e-9,
      );
    if (joins) prev.members = [...prev.members, ...g.members];
    else out.push({ ...g, members: [...g.members] });
  }
  return out;
}

/**
 * How far below the bottom staff line the degree row sits.
 *
 * Handoff 11 §1.2 puts it 35px down, and that is where it goes when the music
 * leaves room. A note a few ledger lines below the staff does not: A3 puts its
 * notehead *centre* 34px down, a pixel off the row's own centre, so the note
 * and the digit naming it are drawn on top of each other.
 *
 * Read off the *lesson's* lowest step, never the lowest on screen: the row has
 * to hold still while the music scrolls past it, and one that jumped whenever
 * a low note came into view would be worse than one sitting on a notehead.
 *
 * Same trade `sheetPxPerBeat` makes — the design's number unless the material
 * collides with it, then the smallest move that clears.
 */
export function degreeRowDrop(
  lowestStep: number,
  halfSpace: number,
  drop: number,
  clear: number,
  size: number,
): number {
  // The bottom edge of the lowest notehead. Its ledger line sits at the head's
  // own step or above it, so the head is what governs.
  const ink = -lowestStep * halfSpace + halfSpace;
  return Math.max(drop, ink + clear + size / 2);
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
/**
 * The closest two onsets may be drawn, in pixels — **two staff spaces**.
 *
 * Measured off a printed piano transcription rather than chosen. Taking every
 * adjacent pair of note columns across its three pages and normalising by its
 * own staff space (23.7px at 300dpi), the spacings pile up hard in one band:
 * 52% of 471 pairs fall between 2.0 and 2.5 spaces, the median is 2.47, and
 * the tail below 1.5 is chords with a second in them, drawn head-beside-head,
 * rather than successive notes at all.
 *
 * This was **22px, or 1.29 spaces** — about half what the printed page uses,
 * and on a montuno of continuous quaver chords in both hands that is what
 * "this could be much improved" was looking at. A notehead is 1.16 spaces
 * wide, so 1.29 left two pixels of air between one head and the next.
 *
 * Two spaces is the *floor* of the printed band rather than its median, and
 * the difference is paid in lookahead: on that piece, 2.0 spaces shows four
 * bars where 1.29 showed five, and 2.4 would show three and a third. A
 * scrolling trainer has to keep something on screen to read ahead into, so it
 * takes the bottom of what print considers normal and not the middle.
 */
export const MIN_NOTE_GAP_PX = 34;

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
