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
  pitches.map((lane, i) => ({ lane, beat: barIndex * 4 + i }));

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

  it("reads the same music the same way in the key it is actually in", () => {
    // An E major triad, read in E: the tonic. Read in C, where none of its
    // notes are diatonic, it is something else — which is the point of
    // deriving the key first.
    const notes = bar(0, [64, 68, 71]);
    expect(romanOf(chordsForLoop(notes, 4, 1, 4)[0]!)).toBe("I");
    expect(romanOf(chordsForLoop(notes, 4, 1, 0)[0]!)).not.toBe("I");
  });
});
