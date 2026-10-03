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
  /**
   * A diatonic tone added to the triad, as a scale step above the root:
   * `2`, `4` or `6`. Hooktheory writes No One's second bar `V(add6)`, and
   * that is the note the melody is actually leaning on.
   *
   * At most one. A bar brushes several non-chord tones in passing and naming
   * them all would say less than naming none, so this is the strongest.
   */
  added: 2 | 4 | 6 | null;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

/**
 * How much of a bar's weight an extra tone must carry to be named.
 *
 * Below this it is a passing note that happens to land there, and calling
 * every triad a seventh — or an added sixth — would say less than calling
 * none of them one.
 *
 * This was a fifth, chosen against a four-note fixture where one note carries
 * 22.2% and so cleared it by two points. That fixture was too sparse to be
 * representative: in a real eight-note melodic bar the same tone carries
 * 15.4%, so the threshold silently dropped *every* addition as soon as a bar
 * held more than about five notes — which is why an imported clip never
 * showed a seventh. An eighth still names one held note in a busy bar and
 * still rejects a passing semiquaver, which carries about 3%.
 */
const EXTRA_SHARE = 0.12;

/**
 * How near a beat a note has to land to count as being *on* it.
 *
 * A sixty-fourth. The metrical weighting is the difference between reading a
 * melody and counting one, and an exact comparison threw it away on any clip
 * that was played rather than drawn: the imported No One sits its beats at
 * 1.99, 2.99 and 3.51, so every one of them scored as a weak off-beat. Loose
 * enough for export jitter, tight enough that real syncopation — a note a
 * quarter of a beat late — is still off the beat.
 */
const BEAT_TOLERANCE = 1 / 16;

/**
 * When a bar's lowest note is a bass line rather than just its lowest note.
 *
 * Two hands span more than one does. Below this the bar is a single register —
 * a melody — and its lowest note says nothing about the harmony, which is the
 * whole reason the root-weight tie-break exists. The imported No One spans 14
 * semitones across all four bars and is correctly left alone.
 */
const BASS_SPAN = 16;

/** Within a fifth of the bottom is the bass register, not the tune. */
const BASS_BAND = 7;

/**
 * How often each degree is actually used, relative to the commonest.
 *
 * The shape of Hooktheory's own corpus for major keys: I and V dominate, IV
 * and vi follow, and iii and vii° are rare. This is a prior on *which chords
 * songs contain*, and it is the only thing that can separate two candidates
 * whose pitch content is identical.
 */
const FUNCTION_FREQUENCY = [1.0, 0.23, 0.13, 0.5, 0.67, 0.43, 0.07];

/**
 * How hard that prior leans, as a share of the bar's own weight.
 *
 * **Measured, and the usable window is narrow.** On the imported No One the
 * second bar prefers `iii` over `V` by 18.9% of the bar — the melody leans on
 * G♯, the very note Hooktheory names as the added sixth, and only passes
 * through F♯. Below 0.3 the prior does not reach that; at 0.5 it starts
 * swamping the notes and every bar collapses toward `I`. 0.35 is the centre of
 * what works, and `tests/harmony.test.ts` pins both edges so the cliff above
 * is visible to anyone who moves it.
 */
const PRIOR_STRENGTH = 0.35;

/** Scale steps above the root that an added tone can sit on. */
const ADDED_STEPS = [
  { step: 1, name: 2 as const },
  { step: 3, name: 4 as const },
  { step: 5, name: 6 as const },
];

/**
 * The numeral, cased by quality: upper for major, lower for minor, and a ring
 * on the diminished one. Case is how a reader takes in the quality of a whole
 * progression at a glance, which is the ribbon's entire job.
 */
export function romanOf(c: Chord): string {
  const r = ROMAN[c.degree - 1];
  const base =
    c.quality === "major" ? r : c.quality === "minor" ? r.toLowerCase() : `${r.toLowerCase()}°`;
  const seventh = c.seventh ? "7" : "";
  return c.added ? `${base}${seventh}(add${c.added})` : `${base}${seventh}`;
}

/** The chord's absolute name — "C", "Am", "B°" — spelled in the key. */
export function chordName(c: Chord, fifths: number): string {
  const letter = (tonicLetter(fifths) + c.degree - 1) % 7;
  const alter = signatureAlters(fifths)[letter];
  const mark = alter > 0 ? "#" : alter < 0 ? "b" : "";
  const tail = c.quality === "minor" ? "m" : c.quality === "diminished" ? "°" : "";
  // A sixth on a plain triad is written as a figure, not as an "add" — `B6`
  // is how the chord symbol has always been spelled, and it is what
  // Hooktheory prints beside `V(add6)`. The second and fourth have no such
  // shorthand, so they keep the word.
  const extra = c.seventh
    ? `7${c.added ? `add${c.added}` : ""}`
    : c.added === 6
      ? "6"
      : c.added
        ? `add${c.added}`
        : "";
  return `${LETTER_NAME[letter]}${mark}${tail}${extra}`;
}

/** The pitch class `step` scale steps above the root of `degree`, in the key. */
function toneAt(degree: number, step: number, fifths: number): number {
  const alters = signatureAlters(fifths);
  const letter = (tonicLetter(fifths) + degree - 1 + step) % 7;
  return (((LETTER_SEMITONE[letter] + alters[letter]) % 12) + 12) % 12;
}

/** Pitch classes of the chord on `degree`: root, third, fifth, then seventh. */
function chordTones(degree: number, fifths: number): number[] {
  return [0, 2, 4, 6].map((step) => toneAt(degree, step, fifths));
}

/** The triad on `degree` of the key. */
export function diatonicTriad(
  degree: number,
  fifths: number,
  seventh = false,
  added: 2 | 4 | 6 | null = null,
): Chord {
  return {
    degree,
    quality: QUALITY[degree - 1],
    root: toneAt(degree, 0, fifths),
    seventh,
    added,
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
  // Near a beat, not exactly on it: a clip that was played rather than drawn
  // never lands on the grid, and an exact test threw the whole weighting away.
  const downbeat = Math.min(inBar, beatsPerBar - inBar) <= BEAT_TOLERANCE;
  const onBeat = Math.abs(inBar - Math.round(inBar)) <= BEAT_TOLERANCE;
  const metre = downbeat ? 3 : onBeat ? 2 : 1;
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

  // Which bar a note belongs to, with the same tolerance the metre uses. A
  // note played a hair *before* a bar line is that bar line's downbeat played
  // early, not the last note of the bar before — and it has to be counted
  // where it is weighted. Split, it was the worst of both: the A that opens
  // No One's fourth bar landed 0.02 beats early, so it was filed under bar
  // three and weighted there as a downbeat, which is the heaviest a note gets.
  // One pickup note was enough to call that bar `IV` instead of `vi`.
  const barOf = (beat: number) => Math.floor((beat + BEAT_TOLERANCE) / bpb);

  for (let bar = 0; bar < n; bar++) {
    const inBar = notes.filter((x) => barOf(x.beat) === bar);
    if (inBar.length === 0) {
      out.push(null);
      continue;
    }
    const lowest = Math.min(...inBar.map((x) => x.lane));
    const highest = Math.max(...inBar.map((x) => x.lane));
    const bass = ((lowest % 12) + 12) % 12;
    const weighted = inBar.map((x) => ({
      pitch: x.lane,
      pc: ((x.lane % 12) + 12) % 12,
      w: weightOf(x.beat, x.duration ?? 0, bpb),
    }));
    const total = weighted.reduce((n, x) => n + x.w, 0);
    /** How much of the bar a given pitch class accounts for. */
    const weightOfPc = (pc: number) =>
      weighted.reduce((n, x) => n + (x.pc === pc ? x.w : 0), 0);

    // A bar with two registers has a bass line, and a bass line states the
    // root. Its weight votes a second time for the triad rooted on it —
    // self-limiting, because a bass note held all bar votes hard and one
    // passing through votes barely at all. A single-register bar gets no vote:
    // a melody's lowest note is just its lowest note.
    const hasBass = highest - lowest >= BASS_SPAN;
    const bassWeightOfPc = (pc: number) =>
      hasBass
        ? weighted.reduce(
            (n, x) => n + (x.pc === pc && x.pitch <= lowest + BASS_BAND ? x.w : 0),
            0,
          )
        : 0;

    // A chord is identified by its root, so a bar that never sounds one is not
    // evidence for that chord. This is the guard the prior needs: without it a
    // bar of G♯ B D♯ F♯ gets called `I` in E major on the strength of the
    // prior alone, having no E anywhere in it. If no candidate's root sounds —
    // a bar of one chromatic note — every one stays in play, because a bar
    // with notes always gets an answer.
    const rooted = [1, 2, 3, 4, 5, 6, 7].filter(
      (d) => weightOfPc(toneAt(d, 0, fifths)) > 0,
    );
    const candidates = rooted.length > 0 ? rooted : [1, 2, 3, 4, 5, 6, 7];

    let bestDegree = candidates[0];
    let best = { score: -Infinity, root: -1, bass: false };
    for (const degree of candidates) {
      const tones = chordTones(degree, fifths).slice(0, 3);
      let score = 0;
      for (const x of weighted) score += tones.includes(x.pc) ? x.w : -x.w;
      score += bassWeightOfPc(tones[0]);
      // What songs actually contain. The only thing that can separate two
      // candidates whose pitch content is identical — and `V` against `iii`
      // in a bar of B D♯ F♯ G♯ is exactly that case, because B6 and G♯m7 are
      // the same four pitch classes.
      score += PRIOR_STRENGTH * FUNCTION_FREQUENCY[degree - 1] * total;
      const here = { score, root: weightOfPc(tones[0]), bass: tones[0] === bass };
      // A chord is identified by its root, so a tie goes to the triad whose
      // root the bar actually leans on — and only then to the one sitting on
      // the lowest note, which says nothing in a melody with no bass line.
      // This is what tells `V` from `iii` in a bar of B D♯ F♯ G♯: both keep
      // three of the four notes, and only one of them is rooted on the note
      // the bar is built from.
      const better =
        here.score > best.score + 1e-9 ||
        (Math.abs(here.score - best.score) < 1e-9 &&
          (here.root > best.root + 1e-9 ||
            (Math.abs(here.root - best.root) < 1e-9 && here.bass && !best.bass)));
      if (better) {
        best = here;
        bestDegree = degree;
      }
    }

    // Extras are additions to a chord already named, not candidates of their
    // own. Each earns its label only by carrying real weight in the bar, so a
    // passing brush against one does not rename the chord.
    const floor = total * EXTRA_SHARE;
    const seventh = weightOfPc(toneAt(bestDegree, 6, fifths)) >= floor;
    let added: 2 | 4 | 6 | null = null;
    let addedWeight = floor;
    for (const a of ADDED_STEPS) {
      const w = weightOfPc(toneAt(bestDegree, a.step, fifths));
      if (w >= addedWeight + 1e-9) {
        addedWeight = w;
        added = a.name;
      }
    }
    out.push(diatonicTriad(bestDegree, fifths, seventh, added));
  }
  return out;
}

/** True when any bar produced a chord — the gate on drawing the ribbon. */
export function hasHarmony(chords: readonly (Chord | null)[]): boolean {
  return chords.some((c) => c !== null);
}
