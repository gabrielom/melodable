import { describe, expect, it } from "vitest";
import {
  chordName,
  chordsForLoop,
  diatonicTriad,
  hasHarmony,
  romanOf,
} from "@/engine/harmony";

/** A bar's worth of notes at one beat each. */
const bar = (barIndex: number, pitches: number[]) =>
  pitches.map((lane, i) => ({ lane, beat: barIndex * 4 + i, duration: 1 }));

/** `[beat, pitch, length]` triples, for the melody fixtures. */
const mel = (spec: Array<[number, number, number]>) =>
  spec.map(([beat, lane, duration]) => ({ lane, beat, duration }));

describe("diatonicTriad", () => {
  it("gives C major the qualities every key has", () => {
    const q = [1, 2, 3, 4, 5, 6, 7].map((d) => diatonicTriad(d, 0).quality);
    expect(q).toEqual([
      "major", "minor", "minor", "major", "major", "minor", "diminished",
    ]);
  });

  it("roots each triad on its own scale degree", () => {
    // C major: I on C, IV on F, V on G, vi on A.
    expect(diatonicTriad(1, 0).root).toBe(0);
    expect(diatonicTriad(4, 0).root).toBe(5);
    expect(diatonicTriad(5, 0).root).toBe(7);
    expect(diatonicTriad(6, 0).root).toBe(9);
    // E major (four sharps): I on E, V on B.
    expect(diatonicTriad(1, 4).root).toBe(4);
    expect(diatonicTriad(5, 4).root).toBe(11);
  });
});

describe("romanOf and chordName", () => {
  it("cases the numeral by quality, which is how a progression is read", () => {
    expect(romanOf(diatonicTriad(1, 0))).toBe("I");
    expect(romanOf(diatonicTriad(4, 0))).toBe("IV");
    expect(romanOf(diatonicTriad(5, 0))).toBe("V");
    expect(romanOf(diatonicTriad(6, 0))).toBe("vi");
    expect(romanOf(diatonicTriad(7, 0))).toBe("vii°");
  });

  it("names the chord absolutely, spelled in the key", () => {
    expect(chordName(diatonicTriad(1, 0), 0)).toBe("C");
    expect(chordName(diatonicTriad(4, 0), 0)).toBe("F");
    expect(chordName(diatonicTriad(6, 0), 0)).toBe("Am");
    expect(chordName(diatonicTriad(7, 0), 0)).toBe("B°");
    // E major spells its own degrees with the signature's sharps.
    expect(chordName(diatonicTriad(1, 4), 4)).toBe("E");
    expect(chordName(diatonicTriad(4, 4), 4)).toBe("A");
    expect(chordName(diatonicTriad(2, 4), 4)).toBe("F#m");
    // A flat key spells with flats rather than their sharp equivalents.
    expect(chordName(diatonicTriad(4, -1), -1)).toBe("Bb");
  });
});

describe("chordsForLoop", () => {
  it("names a bar of a triad as that triad", () => {
    const notes = [...bar(0, [60, 64, 67]), ...bar(1, [65, 69, 72])];
    const got = chordsForLoop(notes, 4, 2, 0);
    expect(got.map((c) => c && romanOf(c))).toEqual(["I", "IV"]);
  });

  it("reads the progression the design's own frame draws", () => {
    // I – IV – V – vi in C, one bar each, exactly what handoff 11 §1.4 shows.
    const notes = [
      ...bar(0, [60, 64, 67]),
      ...bar(1, [65, 69, 72]),
      ...bar(2, [67, 71, 74]),
      ...bar(3, [69, 72, 76]),
    ];
    const got = chordsForLoop(notes, 4, 4, 0);
    expect(got.map((c) => c && romanOf(c))).toEqual(["I", "IV", "V", "vi"]);
    expect(got.map((c) => c && chordName(c, 0))).toEqual(["C", "F", "G", "Am"]);
  });

  it("lets the bass break a tie, which is what a bass line is for", () => {
    // C and E alone are shared by C major and A minor. The lowest note
    // decides, and it decides differently for the same pair of pitches.
    const onC = chordsForLoop(bar(0, [60, 64]), 4, 1, 0);
    const onA = chordsForLoop(bar(0, [57, 60, 64]), 4, 1, 0);
    expect(onC[0] && romanOf(onC[0])).toBe("I");
    expect(onA[0] && romanOf(onA[0])).toBe("vi");
  });

  it("is not thrown by one passing note", () => {
    const notes = bar(0, [60, 64, 67, 60, 64, 67, 66]);
    const got = chordsForLoop(notes, 4, 1, 0);
    expect(got[0] && romanOf(got[0])).toBe("I");
  });

  it("leaves an empty bar empty rather than guessing", () => {
    const got = chordsForLoop(bar(0, [60, 64, 67]), 4, 3, 0);
    expect(got[0]).not.toBeNull();
    expect(got[1]).toBeNull();
    expect(got[2]).toBeNull();
  });

  it("has nothing to say about a lesson with no notes", () => {
    const got = chordsForLoop([], 4, 4, 0);
    expect(got).toEqual([null, null, null, null]);
    expect(hasHarmony(got)).toBe(false);
  });

  it("always answers with a chord where a bar has notes", () => {
    expect(hasHarmony(chordsForLoop(bar(0, [61]), 4, 1, 0))).toBe(true);
  });

  it("reads a melody by weight, not by counting notes", () => {
    // The bar is E major: a held B on the downbeat and a held E to close it,
    // with a scale run of passing tones between. By note *count* the passing
    // tones win and the bar is named wrong; by weight — length times metrical
    // position — the notes the bar is built on decide it.
    const notes = mel([
      [0, 71, 2],
      [2, 73, 0.25], [2.25, 74, 0.25], [2.5, 76, 0.25], [2.75, 78, 0.25],
      [3, 64, 1],
    ]);
    expect(romanOf(chordsForLoop(notes, 4, 1, 4)[0]!)).toBe("I");
  });

  it("reads No One's loop off its melody alone", () => {
    // I – V – vi – IV in E major, which is the progression under the clip.
    // The lesson carries no chord track, only the tune, so this is the case
    // the derivation actually has to survive.
    const notes = mel([
      [0, 71, 1], [1, 68, 0.5], [1.5, 69, 0.5], [2, 68, 1], [3, 64, 1],
      [4, 71, 1], [5, 75, 0.5], [5.5, 73, 0.5], [6, 78, 1], [7, 71, 1],
      [8, 73, 1], [9, 76, 0.5], [9.5, 75, 0.5], [10, 68, 1], [11, 73, 1],
      [12, 69, 1], [13, 73, 0.5], [13.5, 71, 0.5], [14, 76, 1], [15, 69, 1],
    ]);
    const got = chordsForLoop(notes, 4, 4, 4);
    expect(got.map((c) => c && romanOf(c))).toEqual(["I", "V", "vi", "IV"]);
    expect(got.map((c) => c && chordName(c, 4))).toEqual(["E", "B", "C#m", "A"]);
  });

  it("names Hooktheory's own reading of No One's second bar", () => {
    // B D♯ F♯ with a G♯ the melody leans on. Hooktheory calls it V(add6) and
    // prints B6 beside it; the G♯ is the note its keyboard lights up.
    const notes = mel([[0, 71, 1], [1, 75, 1], [2, 78, 1], [3, 68, 1]]);
    const got = chordsForLoop(notes, 4, 1, 4)[0]!;
    expect(romanOf(got)).toBe("V(add6)");
    expect(chordName(got, 4)).toBe("B6");
  });

  it("tells V from iii by which root the bar leans on", () => {
    // Both keep three of those four notes, so the score ties. The root is
    // what separates them — and with no bass line in a melody, "lowest note"
    // says nothing, so it is the weight on the root that decides.
    const onB = mel([[0, 71, 2], [1.5, 75, 0.5], [2, 78, 1], [3, 68, 1]]);
    expect(chordsForLoop(onB, 4, 1, 4)[0]!.degree).toBe(5);
    const onGsharp = mel([[0, 68, 2], [1.5, 75, 0.5], [2, 78, 1], [3, 71, 1]]);
    expect(chordsForLoop(onGsharp, 4, 1, 4)[0]!.degree).toBe(3);
  });

  it("names an added second and fourth as well", () => {
    // E major triad with a held F♯ — the second above the root.
    const add2 = mel([[0, 64, 1], [1, 68, 1], [2, 71, 1], [3, 66, 1]]);
    expect(romanOf(chordsForLoop(add2, 4, 1, 4)[0]!)).toBe("I(add2)");
    // …and with a held A instead, the fourth.
    const add4 = mel([[0, 64, 1], [1, 68, 1], [2, 71, 1], [3, 69, 1]]);
    expect(romanOf(chordsForLoop(add4, 4, 1, 4)[0]!)).toBe("I(add4)");
  });

  it("names at most one added tone, the one the bar leans on hardest", () => {
    // B D♯ F♯ with two candidates over it: a held G♯ (the sixth) and a
    // glancing C♯ (the second). Only the one carrying real weight is named.
    const notes = mel([
      [0, 71, 1], [1, 75, 1], [2, 78, 1], [3, 68, 1], [3.75, 73, 0.25],
    ]);
    const got = chordsForLoop(notes, 4, 1, 4)[0]!;
    expect(got.degree).toBe(5);
    expect(got.added).toBe(6);
    expect(romanOf(got)).toBe("V(add6)");
  });

  it("leaves a plain triad plain", () => {
    const notes = mel([[0, 64, 1], [1, 68, 1], [2, 71, 1], [3, 64, 1]]);
    const got = chordsForLoop(notes, 4, 1, 4)[0]!;
    expect(got.added).toBeNull();
    expect(got.seventh).toBe(false);
    expect(romanOf(got)).toBe("I");
  });

  it("names a seventh only when the bar really leans on it", () => {
    // C#m with a held B — the seventh — is vi7. The same triad with the B as
    // a passing semiquaver is just vi.
    const leaning = mel([[0, 61, 1], [1, 64, 1], [2, 68, 1], [3, 71, 1]]);
    expect(romanOf(chordsForLoop(leaning, 4, 1, 4)[0]!)).toBe("vi7");
    const passing = mel([
      [0, 61, 1], [1, 64, 1], [2, 68, 1], [3, 61, 0.75], [3.75, 71, 0.25],
    ]);
    expect(romanOf(chordsForLoop(passing, 4, 1, 4)[0]!)).toBe("vi");
  });

  it("writes the seventh into the absolute name too", () => {
    const leaning = mel([[0, 61, 1], [1, 64, 1], [2, 68, 1], [3, 71, 1]]);
    expect(chordName(chordsForLoop(leaning, 4, 1, 4)[0]!, 4)).toBe("C#m7");
  });

  it("reads the same music the same way in the key it is actually in", () => {
    // An E major triad, read in E: the tonic. Read in C, where none of its
    // notes are diatonic, it is something else — which is the point of
    // deriving the key first.
    const notes = bar(0, [64, 68, 71]);
    expect(romanOf(chordsForLoop(notes, 4, 1, 4)[0]!)).toBe("I");
    expect(romanOf(chordsForLoop(notes, 4, 1, 0)[0]!)).not.toBe("I");
  });
});
