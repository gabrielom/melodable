import { describe, it, expect } from "vitest";
import { viewportSpan } from "../src/views/Overview";

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
