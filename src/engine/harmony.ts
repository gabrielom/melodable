/**
 * The harmony under a lesson, derived from its own notes.
 *
 * Handoff 11 §1.4 draws a chord ribbon under the field, and §1.5 leaves where
 * the chords come from open: "built-in lessons author it; imported MIDI needs
 * either analysis or a manual entry point". This is the analysis. Nothing is
 * authored, so an imported clip gets a ribbon on the same terms a built-in
 * does — the same trade `keySignatureFor` makes for the key signature, and it
 * fails the same honest way: a bar of ambiguous or passing harmony gets named
 * confidently and may be named wrong.
 *
 * Pure, per invariant 2.
 */

import { LETTER_NAME, LETTER_SEMITONE, signatureAlters, tonicLetter } from "./notation";

/** Triad qualities the seven degrees of a major scale produce, in order. */
const QUALITY = [
  "major",
  "minor",
  "minor",
  "major",
  "major",
  "minor",
  "diminished",
] as const;

export type ChordQuality = (typeof QUALITY)[number];

export interface Chord {
  /** Scale degree of the root, 1..7. */
  degree: number;
  quality: ChordQuality;
  /** Root pitch class, for anything that needs to sound it. */
  root: number;
  /** The diatonic seventh is sounding too — `vi7` rather than `vi`. */
  seventh: boolean;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

/**
 * How much of a bar's weight the seventh must carry to be named.
 *
 * A fifth. Below that it is a passing note that happens to land there, and
 * calling every triad a seventh chord would say less than calling none of
 * them one.
 */
const SEVENTH_SHARE = 0.2;

/**
 * The numeral, cased by quality: upper for major, lower for minor, and a ring
 * on the diminished one. Case is how a reader takes in the quality of a whole
 * progression at a glance, which is the ribbon's entire job.
 */
export function romanOf(c: Chord): string {
  const r = ROMAN[c.degree - 1];
  const base =
    c.quality === "major" ? r : c.quality === "minor" ? r.toLowerCase() : `${r.toLowerCase()}°`;
  return c.seventh ? `${base}7` : base;
}

/** The chord's absolute name — "C", "Am", "B°" — spelled in the key. */
export function chordName(c: Chord, fifths: number): string {
  const letter = (tonicLetter(fifths) + c.degree - 1) % 7;
  const alter = signatureAlters(fifths)[letter];
  const mark = alter > 0 ? "#" : alter < 0 ? "b" : "";
  const tail = c.quality === "minor" ? "m" : c.quality === "diminished" ? "°" : "";
  return `${LETTER_NAME[letter]}${mark}${tail}${c.seventh ? "7" : ""}`;
}

/** Pitch classes of the chord on `degree`: root, third, fifth, then seventh. */
function chordTones(degree: number, fifths: number): number[] {
  const alters = signatureAlters(fifths);
  const tonic = tonicLetter(fifths);
  return [0, 2, 4, 6].map((step) => {
    const letter = (tonic + degree - 1 + step) % 7;
    return (((LETTER_SEMITONE[letter] + alters[letter]) % 12) + 12) % 12;
  });
}

/** The triad on `degree` of the key. */
export function diatonicTriad(degree: number, fifths: number, seventh = false): Chord {
  return {
    degree,
    quality: QUALITY[degree - 1],
    root: chordTones(degree, fifths)[0],
    seventh,
  };
}

/**
 * How much a note counts toward naming its bar's chord.
 *
 * Length and metrical position, multiplied. A melody states its harmony on
 * the strong beats and in the long notes, and fills the gaps with passing
 * tones that belong to no chord at all — counting every note equally lets a
 * run of semiquavers outvote the crotchet the bar is built on. This is the
 * difference between reading a melody and counting one.
 */
function weightOf(beat: number, duration: number, beatsPerBar: number): number {
  const inBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const onBeat = Math.abs(inBar - Math.round(inBar)) < 1e-6;
  const metre = inBar < 1e-6 ? 3 : onBeat ? 2 : 1;
  // A zero-length note still happened; floor it rather than ignoring it.
  return metre * Math.max(0.25, Math.min(4, duration));
}

/**
 * One chord per bar of the loop, or null for a bar with nothing in it.
 *
 * Costed the way the key signature is: every diatonic triad is scored by how
 * much of the bar it accounts for — a note on a chord tone counts for it, a
 * note off one counts against — and the best fit wins. A tie goes to the triad
 * rooted on the bar's lowest note, which is what a bass line is for, and then
 * to the lower degree so the answer is stable rather than arbitrary.
 *
 * Returns null throughout when the lesson has no notes at all, which is the
 * caller's signal to draw no ribbon rather than a row of empty blocks.
 */
export function chordsForLoop(
  notes: readonly { lane: number; beat: number; duration?: number }[],
  beatsPerBar: number,
  bars: number,
  fifths: number,
): (Chord | null)[] {
  const bpb = Math.max(1, beatsPerBar);
  const n = Math.max(1, Math.floor(bars));
  const out: (Chord | null)[] = [];

  for (let bar = 0; bar < n; bar++) {
    const inBar = notes.filter((x) => Math.floor(x.beat / bpb) === bar);
    if (inBar.length === 0) {
      out.push(null);
      continue;
    }
    const bass = ((Math.min(...inBar.map((x) => x.lane)) % 12) + 12) % 12;
    const weighted = inBar.map((x) => ({
      pc: ((x.lane % 12) + 12) % 12,
      w: weightOf(x.beat, x.duration ?? 0, bpb),
    }));

    let bestDegree = 1;
    let bestScore = -Infinity;
    let bestIsBass = false;
    for (let degree = 1; degree <= 7; degree++) {
      const tones = chordTones(degree, fifths).slice(0, 3);
      let score = 0;
      for (const x of weighted) score += tones.includes(x.pc) ? x.w : -x.w;
      const isBass = tones[0] === bass;
      // Strictly better, or equal and rooted on the bass when the incumbent
      // is not. Ties beyond that keep the lower degree already held.
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) < 1e-9 && isBass && !bestIsBass)) {
        bestScore = score;
        bestIsBass = isBass;
        bestDegree = degree;
      }
    }

    // The seventh is an addition to a chord already named, not a candidate of
    // its own: it earns the label only when it carries real weight in the bar,
    // so a passing brush against it does not turn every triad into a seventh.
    const tones = chordTones(bestDegree, fifths);
    const total = weighted.reduce((n, x) => n + x.w, 0);
    const seventhWeight = weighted.reduce((n, x) => n + (x.pc === tones[3] ? x.w : 0), 0);
    out.push(diatonicTriad(bestDegree, fifths, seventhWeight >= total * SEVENTH_SHARE));
  }
  return out;
}

/** True when any bar produced a chord — the gate on drawing the ribbon. */
export function hasHarmony(chords: readonly (Chord | null)[]): boolean {
  return chords.some((c) => c !== null);
}
