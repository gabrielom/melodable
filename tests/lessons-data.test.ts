import { describe, it, expect } from "vitest";
import { BUILTIN_LESSONS } from "../src/data/lessons";
import { noteToPad } from "../src/engine/gm";

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
