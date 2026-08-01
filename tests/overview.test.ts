import { describe, it, expect } from "vitest";
import { viewportSegments } from "../src/views/Overview";

const win = (behind: number, ahead: number) => ({ behind, ahead });

describe("viewportSegments", () => {
  it("brackets the playhead, extending behind and ahead of it", () => {
    // playhead at beat 10 of a 64-beat loop, 1 behind + 8 ahead
    expect(viewportSegments(10, win(1, 8), 64)).toEqual([[9, 18]]);
  });

  it("covers the whole strip when the entire loop is on screen", () => {
    // the built-in 1-bar drills: 9 beats visible, 4-beat loop
    expect(viewportSegments(2, win(0.81, 8.2), 4)).toEqual([[0, 4]]);
    expect(viewportSegments(0, win(2, 2), 4)).toEqual([[0, 4]]);
  });

  it("wraps past the loop end into a second segment", () => {
    // playhead at 60, window 59..68 of a 64-beat loop
    expect(viewportSegments(60, win(1, 8), 64)).toEqual([
      [59, 64],
      [0, 4],
    ]);
  });

  it("wraps when the playhead is just after the loop start", () => {
    // playhead at 0.5, window starts at -0.5 -> 63.5
    const segs = viewportSegments(0.5, win(1, 8), 64);
    expect(segs).toHaveLength(2);
    expect(segs[0][0]).toBeCloseTo(63.5);
    expect(segs[0][1]).toBe(64);
    expect(segs[1]).toEqual([0, 8.5]);
  });

  it("always covers exactly the visible span", () => {
    for (const loop of [4, 16, 64]) {
      for (let b = 0; b < loop; b += 0.5) {
        const view = win(0.81, 8.2);
        const segs = viewportSegments(b, view, loop);
        const total = segs.reduce((a, [x, y]) => a + (y - x), 0);
        const span = Math.min(view.behind + view.ahead, loop);
        expect(total).toBeCloseTo(span);
        // and never runs outside the strip
        for (const [x, y] of segs) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(loop + 1e-9);
        }
      }
    }
  });

  it("draws nothing when there is no window", () => {
    expect(viewportSegments(1, win(0, 0), 8)).toEqual([]);
  });
});
