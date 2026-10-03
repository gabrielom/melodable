import { describe, expect, it } from "vitest";
import { gridBeatRange } from "@/views/lane-geometry";

/**
 * The bug this pins: the sheet view derived its range from `xOfBeat(0)`, which
 * expands to `2 × absBeat − …`. It therefore crept forward at twice the rate
 * of the track it was meant to cover, and the two slid past each other — so a
 * barline would be missing for a while and then appear out of nowhere.
 */
describe("gridBeatRange", () => {
  it("covers the whole visible track", () => {
    const { first, last } = gridBeatRange(10, 4, 12);
    expect(first).toBeLessThanOrEqual(10 - 4);
    expect(last).toBeGreaterThanOrEqual(10 + 12);
  });

  it("keeps a beat of margin, so a line never arrives a frame late", () => {
    const { first, last } = gridBeatRange(8, 2, 6);
    expect(first).toBeLessThan(8 - 2);
    expect(last).toBeGreaterThan(8 + 6);
  });

  it("moves exactly one beat when the playhead moves one beat", () => {
    // The runaway range moved two. This is the property that failed.
    const a = gridBeatRange(0, 5, 15);
    const b = gridBeatRange(1, 5, 15);
    expect(b.first - a.first).toBe(1);
    expect(b.last - a.last).toBe(1);
  });

  it("does not grow as the run goes on", () => {
    // The width breathes by one beat with the fractional offset — that is the
    // outward rounding which keeps coverage complete — but it must not creep.
    const width = (t: number) => {
      const r = gridBeatRange(t, 5, 15);
      return r.last - r.first;
    };
    const seen = [0, 1, 7.5, 100, 1000.25, 99999.5].map(width);
    expect(Math.min(...seen)).toBe(22);
    expect(Math.max(...seen)).toBe(23);
  });

  it("covers the track at every fractional position, never leaving a hole", () => {
    // Sweep a whole beat: every whole beat inside the window must be in range.
    for (let t = 0; t < 1; t += 0.05) {
      const absBeat = 40 + t;
      const { first, last } = gridBeatRange(absBeat, 5, 15);
      for (let b = Math.ceil(absBeat - 5); b <= Math.floor(absBeat + 15); b++) {
        expect(b).toBeGreaterThanOrEqual(first);
        expect(b).toBeLessThanOrEqual(last);
      }
    }
  });

  it("handles the count-in, where the playhead is before beat 0", () => {
    const { first, last } = gridBeatRange(-4, 5, 15);
    expect(first).toBeLessThanOrEqual(-9);
    expect(last).toBeGreaterThanOrEqual(11);
  });
});
