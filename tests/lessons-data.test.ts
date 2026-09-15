import { describe, it, expect } from "vitest";
import { BUILTIN_LESSONS } from "../src/data/lessons";
import { noteToPad } from "../src/engine/gm";
import { lessonRepeats } from "../src/engine/scoring";
import { TEMPO_MAX, TEMPO_MIN } from "../src/engine/types";

describe("the tempo range", () => {
  it("reaches every tempo a clip can be imported at", () => {
    // There were two ranges: the transport readout clamped to 50-160 while
    // the import dialog offered 40-240, so a 200 BPM clip displayed its own
    // tempo and then snapped to 160 the first time the readout was touched,
    // with no way back up. Importing must not be a one-way door.
    expect(TEMPO_MIN).toBeLessThanOrEqual(40);
    expect(TEMPO_MAX).toBeGreaterThanOrEqual(240);
  });

  it("covers every built-in lesson, which is why the old cap was never felt", () => {
    for (const l of BUILTIN_LESSONS) {
      expect(l.bpm).toBeGreaterThanOrEqual(TEMPO_MIN);
      expect(l.bpm).toBeLessThanOrEqual(TEMPO_MAX);
    }
    // All of them sit inside the old 50-160 too — the cap only ever bit on
    // imported material.
    expect(Math.max(...BUILTIN_LESSONS.map((l) => l.bpm))).toBeLessThan(160);
  });
});

describe("builtin lesson data", () => {
  it("has a non-empty catalogue with unique ids", () => {
    expect(BUILTIN_LESSONS.length).toBeGreaterThanOrEqual(6);
    const ids = BUILTIN_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders the pad progression easy → hard by tempo", () => {
    const bpms = BUILTIN_LESSONS.filter((l) => l.instrument === "pads").map((l) => l.bpm);
    expect(bpms).toEqual([...bpms].sort((a, b) => a - b));
  });

  it("gives every lesson a run of roughly half a minute to a minute", () => {
    for (const lesson of BUILTIN_LESSONS) {
      const repeats = lessonRepeats(lesson);
      const seconds = (lesson.bars * repeats * lesson.beatsPerBar * 60) / lesson.bpm;
      expect(seconds, `"${lesson.name}" runs ${Math.round(seconds)}s`).toBeGreaterThanOrEqual(30);
      expect(seconds, `"${lesson.name}" runs ${Math.round(seconds)}s`).toBeLessThanOrEqual(75);
      // whole bars, so the run ends on a bar line
      expect(Number.isInteger(lesson.bars * repeats)).toBe(true);
    }
  });

  it("ships at least one lesson of each instrument", () => {
    const kinds = new Set(BUILTIN_LESSONS.map((l) => l.instrument));
    expect(kinds.has("pads")).toBe(true);
    expect(kinds.has("piano")).toBe(true);
  });

  for (const lesson of BUILTIN_LESSONS) {
    describe(`${lesson.name} (${lesson.instrument})`, () => {
      it("is well-formed", () => {
        expect(lesson.source).toBe("builtin");
        expect(lesson.bars).toBeGreaterThanOrEqual(1);
        expect(lesson.beatsPerBar).toBeGreaterThanOrEqual(1);
        expect(lesson.bpm).toBeGreaterThan(0);
        expect(lesson.notes.length).toBeGreaterThan(0);
      });

      it("keeps every note inside the loop, on a valid lane", () => {
        const loopBeats = lesson.bars * lesson.beatsPerBar;
        for (const n of lesson.notes) {
          expect(n.time).toBeGreaterThanOrEqual(0);
          expect(n.time).toBeLessThan(loopBeats);
          expect(n.pitch).toBeGreaterThanOrEqual(0);
          expect(n.pitch).toBeLessThanOrEqual(127);
          // pad lessons must route every pitch to a pad; piano uses pitch directly
          if (lesson.instrument === "pads") {
            expect(noteToPad(n.pitch), `pitch ${n.pitch} in "${lesson.name}"`).not.toBeNull();
          }
        }
      });
    });
  }
});
