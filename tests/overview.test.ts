import { describe, it, expect } from "vitest";
import { rowTop, viewportSpan } from "../src/views/Overview";

const win = (behind: number, ahead: number) => ({ behind, ahead });

describe("viewportSpan", () => {
  it("brackets the playhead, extending behind and ahead of it", () => {
    // 40 beats into a 64-beat run, 1 behind + 8 ahead
    expect(viewportSpan(40, win(1, 8), 64)).toEqual([39, 48]);
  });

  it("clamps at the start of the run rather than going negative", () => {
    expect(viewportSpan(0, win(1, 8), 64)).toEqual([0, 8]);
    expect(viewportSpan(0.5, win(1, 8), 64)).toEqual([0, 8.5]);
  });

  it("clamps at the end — a finite lesson has nothing after it to wrap onto", () => {
    expect(viewportSpan(60, win(1, 8), 64)).toEqual([59, 64]);
    expect(viewportSpan(64, win(1, 8), 64)).toEqual([63, 64]);
  });

  it("covers the whole strip only when the whole run really is on screen", () => {
    // 9 beats visible, 4-beat run, playhead at the start: all of it is showing
    expect(viewportSpan(0, win(0.81, 8.2), 4)).toEqual([0, 4]);
    // ...but two beats in, the first 1.19 beats have scrolled off the left
    expect(viewportSpan(2, win(0.81, 8.2), 4)).toEqual([1.19, 4]);
  });

  it("never runs outside the strip, at any position", () => {
    for (const run of [4, 16, 64]) {
      for (let b = 0; b <= run; b += 0.5) {
        const span = viewportSpan(b, win(0.81, 8.2), run);
        expect(span).not.toBeNull();
        const [from, to] = span!;
        expect(from).toBeGreaterThanOrEqual(0);
        expect(to).toBeLessThanOrEqual(run);
        expect(to).toBeGreaterThan(from);
        // the playhead is always inside the rectangle
        expect(b).toBeGreaterThanOrEqual(from - 1e-9);
        expect(b).toBeLessThanOrEqual(to + 1e-9);
      }
    }
  });

  it("draws nothing when there is no window", () => {
    expect(viewportSpan(1, win(0, 0), 8)).toBeNull();
  });
});

describe("rowTop", () => {
  /** The 33px strip and eight pad lanes, which is what the design drew. */
  it("puts the first row on the inset and the last one ending on it", () => {
    expect(rowTop(0, 8, 33)).toBe(3);
    expect(rowTop(7, 8, 33) + 2).toBe(30);
  });

  it("spreads evenly between the two, whatever the lane count", () => {
    for (const rows of [2, 3, 4, 6, 8, 12]) {
      const tops = Array.from({ length: rows }, (_, r) => rowTop(r, rows, 33));
      expect(tops[0]).toBe(3);
      expect(tops[rows - 1] + 2).toBeCloseTo(30, 9);
      const gaps = tops.slice(1).map((t, i) => t - tops[i]);
      for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 9);
    }
  });

  it("centres a lone row rather than pinning it to the top", () => {
    expect(rowTop(0, 1, 33)).toBe(3 + 25 / 2);
  });

  it("stays inside the strip when it is too short to hold the insets", () => {
    for (const h of [0, 2, 5, 8]) {
      for (const rows of [1, 4, 8]) {
        for (let r = 0; r < rows; r++) {
          expect(rowTop(r, rows, h)).toBeGreaterThanOrEqual(0);
          expect(rowTop(r, rows, h)).toBeLessThanOrEqual(Math.max(0, h));
        }
      }
    }
  });
});
