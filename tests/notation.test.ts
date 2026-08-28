import { describe, expect, it } from "vitest";
import {
  BOTTOM_LINE_PITCH,
  FIGURE_BEAMS,
  FIGURE_BEATS,
  MIN_NOTE_GAP_PX,
  NOTEHEAD_EM_CENTRE,
  NOTEHEAD_EM_HEIGHT,
  accidentalFor,
  beamGroups,
  beatsOf,
  figureFor,
  ledgerSteps,
  sheetPxPerBeat,
  smallestGap,
  staffStep,
  type BeamCandidate,
} from "@/engine/notation";

/**
 * These two came off the font binary — the glyph bounds of U+1D15D at
 * unitsPerEm 1000 — not out of the handoff, which asks to be checked rather
 * than copied. Replace the font and both have to be measured again.
 */
describe("the font's measured constants", () => {
  it("makes a notehead exactly one staff space tall", () => {
    expect(NOTEHEAD_EM_HEIGHT).toBeCloseTo(0.252, 3);
    // The scale factor the renderer sizes the glyph by.
    expect(17 / NOTEHEAD_EM_HEIGHT).toBeCloseTo(67.46, 1);
  });

  it("seats the notehead centre just above the baseline", () => {
    expect(NOTEHEAD_EM_CENTRE).toBeCloseTo(0.134, 3);
  });
});

describe("figureFor", () => {
  it("names the plain values", () => {
    expect(figureFor(4)).toEqual({ figure: "whole", dotted: false });
    expect(figureFor(2)).toEqual({ figure: "half", dotted: false });
    expect(figureFor(1)).toEqual({ figure: "quarter", dotted: false });
    expect(figureFor(0.5)).toEqual({ figure: "eighth", dotted: false });
    expect(figureFor(0.25)).toEqual({ figure: "sixteenth", dotted: false });
  });

  it("names the dotted ones", () => {
    expect(figureFor(3)).toEqual({ figure: "half", dotted: true });
    expect(figureFor(1.5)).toEqual({ figure: "quarter", dotted: true });
    expect(figureFor(0.75)).toEqual({ figure: "eighth", dotted: true });
  });

  it("draws a zero-length note as a quarter rather than dropping it", () => {
    // Every pad lesson: a drum has decayed before you could let go.
    expect(figureFor(0)).toEqual({ figure: "quarter", dotted: false });
    expect(figureFor(-1)).toEqual({ figure: "quarter", dotted: false });
  });

  it("picks the nearest drawable value for a length notation cannot spell", () => {
    // Nothing is exactly 1.2 beats; a quarter is nearer than a dotted quarter.
    expect(figureFor(1.2).figure).toBe("quarter");
    expect(figureFor(1.4)).toEqual({ figure: "quarter", dotted: true });
  });

  it("round-trips every value it can name", () => {
    for (const [figure, beats] of Object.entries(FIGURE_BEATS)) {
      expect(figureFor(beats)).toEqual({ figure, dotted: false });
      expect(figureFor(beats * 1.5)).toEqual({ figure, dotted: true });
    }
  });

  it("agrees with beatsOf", () => {
    for (const b of [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25]) {
      expect(beatsOf(figureFor(b))).toBeCloseTo(b, 9);
    }
  });
});

describe("staffStep", () => {
  it("puts E4 on the bottom line", () => {
    expect(staffStep(BOTTOM_LINE_PITCH)).toBe(0);
  });

  it("walks diatonically, not chromatically", () => {
    expect(staffStep(65)).toBe(1); // F4, the space above
    expect(staffStep(66)).toBe(1); // F#4 shares F's position
    expect(staffStep(67)).toBe(2); // G4, second line
  });

  it("places the landmarks the handoff names", () => {
    expect(staffStep(67)).toBe(2); // G4 on the second line
    expect(staffStep(72)).toBe(5); // C5 in the third space
    expect(staffStep(60)).toBe(-2); // C4 one ledger below
  });

  it("puts F5 on the top line", () => {
    expect(staffStep(77)).toBe(8);
  });

  it("keeps an octave exactly seven steps", () => {
    expect(staffStep(76) - staffStep(64)).toBe(7);
  });
});

describe("accidentalFor", () => {
  it("marks the raised notes and nothing else", () => {
    expect(accidentalFor(61)).toBe("sharp"); // C#
    expect(accidentalFor(66)).toBe("sharp"); // F#
    expect(accidentalFor(60)).toBeNull(); // C
    expect(accidentalFor(64)).toBeNull(); // E
  });

  it("agrees with the position: a sharp shares its natural's step", () => {
    for (let p = 60; p < 84; p++) {
      if (accidentalFor(p) === "sharp") expect(staffStep(p)).toBe(staffStep(p - 1));
    }
  });
});

describe("ledgerSteps", () => {
  it("asks for none inside the staff", () => {
    for (const step of [0, 2, 4, 6, 8, 1, 7]) expect(ledgerSteps(step)).toEqual([]);
  });

  it("gives C4 a single line below", () => {
    expect(ledgerSteps(-2)).toEqual([-2]);
  });

  it("gives the note in the space below that same one line", () => {
    // B3 hangs under the ledger it shares with C4.
    expect(ledgerSteps(-3)).toEqual([-2]);
  });

  it("stacks them going further out", () => {
    expect(ledgerSteps(-4)).toEqual([-2, -4]);
    expect(ledgerSteps(10)).toEqual([10]);
    expect(ledgerSteps(13)).toEqual([10, 12]);
  });
});

describe("beamGroups", () => {
  const notes = (spec: Array<[number, BeamCandidate["figure"]]>): BeamCandidate[] =>
    spec.map(([beat, figure]) => ({ beat, figure }));

  it("beams a pair of eighths inside one beat", () => {
    const g = beamGroups(notes([[0, "eighth"], [0.5, "eighth"]]), 4);
    expect(g).toEqual([{ members: [0, 1], beams: 1 }]);
  });

  it("never beams across a beat line", () => {
    const g = beamGroups(notes([[0.5, "eighth"], [1, "eighth"]]), 4);
    // Two lone eighths, each keeping its own flag.
    expect(g).toEqual([]);
  });

  it("leaves a single eighth to its own flag", () => {
    expect(beamGroups(notes([[0, "eighth"]]), 4)).toEqual([]);
  });

  it("breaks a group on a quarter, which has no beam to share", () => {
    const g = beamGroups(
      notes([[0, "eighth"], [0.5, "eighth"], [1, "quarter"], [2, "eighth"], [2.5, "eighth"]]),
      4,
    );
    expect(g).toEqual([
      { members: [0, 1], beams: 1 },
      { members: [3, 4], beams: 1 },
    ]);
  });

  it("beams four sixteenths with two beams", () => {
    const g = beamGroups(
      notes([[0, "sixteenth"], [0.25, "sixteenth"], [0.5, "sixteenth"], [0.75, "sixteenth"]]),
      4,
    );
    expect(g).toEqual([{ members: [0, 1, 2, 3], beams: 2 }]);
  });

  it("shares only the beams the whole group carries", () => {
    // A dotted eighth and a sixteenth share one beam; the second's extra beam
    // is the broken stub handoff 10 §1.4.2 describes, drawn by the renderer.
    const g = beamGroups(notes([[0, "eighth"], [0.75, "sixteenth"]]), 4);
    expect(g).toEqual([{ members: [0, 1], beams: 1 }]);
  });

  it("counts beams per figure the way the font's flags do", () => {
    expect(FIGURE_BEAMS.quarter).toBe(0);
    expect(FIGURE_BEAMS.eighth).toBe(1);
    expect(FIGURE_BEAMS.sixteenth).toBe(2);
  });
});

describe("the sheet zoom", () => {
  it("leaves a lesson of quarters at the roll's zoom", () => {
    expect(sheetPxPerBeat(1, 64)).toBe(64);
  });

  it("zooms in until sixteenths clear the notehead", () => {
    // 64px per beat puts sixteenths 16px apart, which collides at 22px wide.
    const px = sheetPxPerBeat(0.25, 64);
    expect(px).toBe(MIN_NOTE_GAP_PX / 0.25);
    expect(px * 0.25).toBeGreaterThanOrEqual(MIN_NOTE_GAP_PX);
  });

  it("never zooms out below the roll, however sparse the lesson", () => {
    expect(sheetPxPerBeat(4, 64)).toBe(64);
  });

  it("has an answer for a lesson with one note", () => {
    expect(sheetPxPerBeat(0, 64)).toBe(64);
  });

  it("clears every built-in note spacing it is given", () => {
    for (const gap of [1, 0.5, 0.25]) {
      expect(sheetPxPerBeat(gap, 64) * gap).toBeGreaterThanOrEqual(MIN_NOTE_GAP_PX);
    }
  });
});

describe("smallestGap", () => {
  it("finds the closest pair", () => {
    expect(smallestGap([0, 1, 1.25, 3])).toBeCloseTo(0.25, 9);
  });

  it("ignores notes struck together, which do not crowd each other", () => {
    // A chord is one column, not two neighbours.
    expect(smallestGap([0, 0, 0, 2])).toBe(2);
  });

  it("has an answer for one note, or none", () => {
    expect(smallestGap([1])).toBe(0);
    expect(smallestGap([])).toBe(0);
  });
});
