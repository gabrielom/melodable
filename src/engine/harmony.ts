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
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

/**
 * The numeral, cased by quality: upper for major, lower for minor, and a ring
 * on the diminished one. Case is how a reader takes in the quality of a whole
 * progression at a glance, which is the ribbon's entire job.
 */
export function romanOf(c: Chord): string {
  const r = ROMAN[c.degree - 1];
  if (c.quality === "major") return r;
  return c.quality === "minor" ? r.toLowerCase() : `${r.toLowerCase()}°`;
}

/** The chord's absolute name — "C", "Am", "B°" — spelled in the key. */
export function chordName(c: Chord, fifths: number): string {
  const letter = (tonicLetter(fifths) + c.degree - 1) % 7;
  const alter = signatureAlters(fifths)[letter];
  const mark = alter > 0 ? "#" : alter < 0 ? "b" : "";
  const tail = c.quality === "minor" ? "m" : c.quality === "diminished" ? "°" : "";
  return `${LETTER_NAME[letter]}${mark}${tail}`;
}

/** The three pitch classes of the triad on `degree`, in the key. */
function triadTones(degree: number, fifths: number): number[] {
  const alters = signatureAlters(fifths);
  const tonic = tonicLetter(fifths);
  return [0, 2, 4].map((step) => {
    const letter = (tonic + degree - 1 + step) % 7;
    return (((LETTER_SEMITONE[letter] + alters[letter]) % 12) + 12) % 12;
  });
}

/** The triad on `degree` of the key. */
export function diatonicTriad(degree: number, fifths: number): Chord {
  return {
    degree,
    quality: QUALITY[degree - 1],
    root: triadTones(degree, fifths)[0],
  };
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
  notes: readonly { lane: number; beat: number }[],
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

    let best: Chord | null = null;
    let bestScore = -Infinity;
    let bestIsBass = false;
    for (let degree = 1; degree <= 7; degree++) {
      const tones = triadTones(degree, fifths);
      let score = 0;
      for (const x of inBar) {
        score += tones.includes(((x.lane % 12) + 12) % 12) ? 1 : -1;
      }
      const isBass = tones[0] === bass;
      // Strictly better, or equal and rooted on the bass when the incumbent
      // is not. Ties beyond that keep the lower degree already held.
      if (score > bestScore || (score === bestScore && isBass && !bestIsBass)) {
        bestScore = score;
        bestIsBass = isBass;
        best = diatonicTriad(degree, fifths);
      }
    }
    out.push(best);
  }
  return out;
}

/** True when any bar produced a chord — the gate on drawing the ribbon. */
export function hasHarmony(chords: readonly (Chord | null)[]): boolean {
  return chords.some((c) => c !== null);
}
