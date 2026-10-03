import { describe, it, expect } from "vitest";
import { GRIDS, gridFor, momentsOf, snapLength, snapTo } from "../src/engine/quantize";
import { lessonTargets } from "../src/engine/scoring";
import { smallestGap, sheetPxPerBeat } from "../src/engine/notation";
import { BUILTIN_LESSONS } from "../src/data/lessons";
import type { Lesson, NoteEvent } from "../src/engine/types";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * The opening of the imported Ave Maria, as the file carries it: eight even
 * quavers a bar, none of them on a quaver. The lengths wobble too — 0.474 to
 * 0.583 for the same written value.
 *
 * This is the clip that sent us here. Its closest pair of onsets is a melody
 * note landing 0.031 beats before the chord under it, which asked
 * `sheetPxPerBeat` for 1090 pixels a beat and drew an empty staff.
 */
const AVE: NoteEvent[] = [
  { time: 0, pitch: 48, duration: 0.5 },
  { time: 0.5, pitch: 52, duration: 0.583 },
  { time: 0.99, pitch: 55, duration: 0.5 },
  { time: 1.469, pitch: 60, duration: 0.563 },
  { time: 1.979, pitch: 64, duration: 0.583 },
  { time: 2.469, pitch: 55, duration: 0.521 },
  { time: 2.953, pitch: 60, duration: 0.583 },
  { time: 3.479, pitch: 64, duration: 0.583 },
  { time: 3.974, pitch: 48, duration: 0.495 },
  { time: 4.458, pitch: 52, duration: 0.495 },
  { time: 7.958, pitch: 48, duration: 0.536 },
  // The sustained string chord under it, struck a hair after the quaver that
  // shares its beat — the 0.031 pair.
  { time: 8, pitch: 48, duration: 7.99 },
  { time: 8, pitch: 55, duration: 7.99 },
];

const lessonOf = (notes: NoteEvent[]): Lesson =>
  ({ notes, beatsPerBar: 4, bars: 4, bpm: 100 }) as Lesson;

describe("momentsOf", () => {
  it("counts both ends of every note", () => {
    expect(momentsOf([{ time: 1, duration: 0.5 }])).toEqual([1, 1.5]);
  });

  it("counts only the onset when a note has no length", () => {
    expect(momentsOf([{ time: 1 }, { time: 2, duration: 0 }])).toEqual([1, 2]);
  });
});

describe("gridFor", () => {
  it("calls a clip of crotchets crotchets, not something finer that also fits", () => {
    // Every grid in the list divides these exactly, so the tie-break decides.
    expect(gridFor([0, 1, 2, 3, 4])).toBe(1);
  });

  it("finds the quaver when the clip uses one", () => {
    expect(gridFor([0, 0.5, 1, 1.5, 2])).toBe(0.5);
  });

  it("finds a triplet grid, which is coarser than a semiquaver one", () => {
    const t = [0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3, 2];
    expect(near(gridFor(t), 1 / 3)).toBe(true);
    // Ordering, not just the answer: a third of a beat comes before a quarter.
    expect(GRIDS.indexOf(1 / 3)).toBeLessThan(GRIDS.indexOf(1 / 4));
  });

  it("reads the quaver grid off a clip that was played rather than drawn", () => {
    expect(gridFor(momentsOf(AVE))).toBe(0.5);
  });

  it("takes the best fit and not the first one inside a tolerance", () => {
    // Mostly crotchets with two offbeats. A threshold rule would call the
    // whole thing crotchets — the mean error is small — and flatten them onto
    // the beat. The minimum is at the quaver, which is where they live.
    const beats = [0, 1, 2, 2.5, 3, 4, 5, 5.5, 6, 7];
    expect(gridFor(beats)).toBe(0.5);
  });

  it("is not dragged to the finest grid by one expressive note", () => {
    const beats = [0, 1, 2, 3, 4, 5, 6, 6.37, 7, 8, 9, 10];
    expect(gridFor(beats)).toBe(1);
  });

  it("answers for an empty clip rather than dividing by nothing", () => {
    expect(gridFor([])).toBe(1);
  });

  it("takes a written clip at its word, however fine one value is", () => {
    // A dotted quaver among whole notes. By fit alone the beat wins and the
    // 0.75 is rounded away; it is exactly on a sixteenth grid, so it is not a
    // slip and nothing here has to be decided.
    expect(gridFor([0, 4, 4.75, 8, 12])).toBe(0.25);
  });

  it("tells an authored value from a note that merely lands near one", () => {
    // 6.375 is a written double-dotted crotchet. 6.37 is a played one.
    expect(gridFor([0, 1, 2, 3, 4, 5, 6, 6.375, 7, 8])).toBe(0.125);
    expect(gridFor([0, 1, 2, 3, 4, 5, 6, 6.37, 7, 8])).toBe(1);
  });
});

describe("snapTo", () => {
  it("rounds to the nearest grid point", () => {
    expect(snapTo(0.99, 0.5)).toBe(1);
    expect(snapTo(1.469, 0.5)).toBe(1.5);
    expect(snapTo(3.974, 0.5)).toBe(4);
  });
});

describe("snapLength", () => {
  it("moves the note's end onto the grid, not its length", () => {
    // Struck early and released late: rounding the length alone would keep
    // the release off the beat it was aimed at.
    expect(snapLength(0.99, 0.56, 0.5)).toBe(0.5);
    expect(snapLength(7.958, 0.536, 0.5)).toBe(0.5);
  });

  it("keeps a note that rounds to nothing at one grid unit", () => {
    expect(snapLength(0, 0.1, 0.5)).toBe(0.5);
  });

  it("leaves a note with no length alone", () => {
    expect(snapLength(0, 0, 0.5)).toBe(0);
  });

  it("holds a long note's whole length", () => {
    expect(snapLength(8, 7.99, 0.5)).toBe(8);
  });
});

describe("lessonTargets straightens an imported clip", () => {
  it("puts every onset on the grid", () => {
    const beats = lessonTargets(lessonOf(AVE), (p) => p).map((t) => t.beat);
    for (const b of beats) expect(near(b / 0.5, Math.round(b / 0.5))).toBe(true);
    expect(beats.slice(0, 9)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  });

  it("collapses a near-simultaneous pair into one column", () => {
    const beats = lessonTargets(lessonOf(AVE), (p) => p).map((t) => t.beat);
    // 7.958 and 8.0 were 0.031 apart and are one onset now.
    expect(beats.filter((b) => b === 8)).toHaveLength(3);
    expect(beats.some((b) => b > 7.5 && b < 8)).toBe(false);
  });

  /**
   * The bug in one line. `sheetPxPerBeat` scales the staff so the closest pair
   * of onsets clears `MIN_NOTE_GAP_PX`; a pair 0.031 beats apart asks for a
   * zoom no window can show, and the sheet drew nothing at all.
   */
  it("leaves the sheet a zoom it can draw", () => {
    // 0.042 beats apart in this excerpt — 0.031 in the whole clip, which is
    // where the 1090 came from.
    const raw = smallestGap(AVE.map((n) => n.time));
    expect(sheetPxPerBeat(raw, 60)).toBeGreaterThan(800);

    const beats = lessonTargets(lessonOf(AVE), (p) => p).map((t) => t.beat);
    expect(smallestGap(beats)).toBe(0.5);
    expect(sheetPxPerBeat(smallestGap(beats), 60)).toBe(68);
  });

  it("does not round a hold up past the floor it sits on", () => {
    // Whole notes on the beat, one dotted quaver among them. The onsets alone
    // read as a one-beat grid, and rounding to that would turn a 0.75 hold
    // into a full beat — a different exercise.
    const lesson = lessonOf([
      { time: 0, pitch: 60, duration: 4 },
      { time: 4, pitch: 62, duration: 0.75 },
      { time: 8, pitch: 64, duration: 4 },
    ]);
    expect(lessonTargets(lesson, (p) => p).map((t) => t.duration)).toEqual([4, 0.75, 4]);
  });
});

describe("the library is authored on the grid already", () => {
  it.each(BUILTIN_LESSONS.map((l) => [l.name, l] as const))("%s is unmoved", (_name, lesson) => {
    const targets = lessonTargets(lesson, (p) => p);
    const want = [...lesson.notes].sort((a, b) => a.time - b.time);
    expect(targets).toHaveLength(want.length);
    targets.forEach((t, i) => {
      expect(near(t.beat, want[i].time)).toBe(true);
      expect(near(t.written, want[i].duration ?? 0)).toBe(true);
    });
  });
});
