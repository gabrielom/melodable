import { describe, it, expect } from "vitest";
import { BUILTIN_LESSONS } from "../src/data/lessons";
import { noteToPad } from "../src/engine/gm";

describe("builtin lesson data", () => {
  it("has a non-empty progression with unique ids", () => {
    expect(BUILTIN_LESSONS.length).toBeGreaterThanOrEqual(6);
    const ids = BUILTIN_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is ordered easy → hard by starting tempo", () => {
    const bpms = BUILTIN_LESSONS.map((l) => l.bpm);
    const sorted = [...bpms].sort((a, b) => a - b);
    expect(bpms).toEqual(sorted);
  });

  for (const lesson of BUILTIN_LESSONS) {
    describe(lesson.name, () => {
      it("is a well-formed builtin pad lesson", () => {
        expect(lesson.instrument).toBe("pads");
        expect(lesson.source).toBe("builtin");
        expect(lesson.bars).toBeGreaterThanOrEqual(1);
        expect(lesson.beatsPerBar).toBeGreaterThanOrEqual(1);
        expect(lesson.bpm).toBeGreaterThan(0);
        expect(lesson.notes.length).toBeGreaterThan(0);
      });

      it("routes every note to a pad and keeps it inside the loop", () => {
        const loopBeats = lesson.bars * lesson.beatsPerBar;
        for (const n of lesson.notes) {
          // No silently-dropped notes: each pitch must map to a pad lane.
          expect(noteToPad(n.pitch), `pitch ${n.pitch} in "${lesson.name}"`).not.toBeNull();
          expect(n.time).toBeGreaterThanOrEqual(0);
          expect(n.time).toBeLessThan(loopBeats);
        }
      });
    });
  }
});
