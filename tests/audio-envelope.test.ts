import { describe, expect, it } from "vitest";
import { noteEnvelope } from "../src/engine/audio";

describe("noteEnvelope", () => {
  it("keeps the voice's long-standing shape for an ordinary note", () => {
    expect(noteEnvelope(0.9)).toEqual({ attack: 0.006, decay: 0.16, release: 0.9 });
  });

  it("always peaks, settles and falls silent in that order, however short", () => {
    // A quaver at 200 BPM is 0.15s — shorter than the old fixed settle point.
    for (const d of [0, 0.01, 0.05, 0.15, 0.159, 0.16, 0.3, 4]) {
      const e = noteEnvelope(d);
      expect(e.attack).toBeGreaterThan(0);
      expect(e.decay).toBeGreaterThan(e.attack);
      expect(e.release).toBeGreaterThan(e.decay);
    }
  });
});
