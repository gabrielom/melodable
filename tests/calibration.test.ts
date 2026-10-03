import { describe, expect, it } from "vitest";
import {
  CAL_MAX_ABS_MS,
  CAL_MIN_TAPS,
  CAL_PERIOD,
  CAL_STEADY_MS,
  LATENCY_LIMIT_MS,
  clampLatency,
  median,
  summarizeTaps,
  tapError,
} from "@/engine/calibration";

describe("median", () => {
  it("takes the middle of an odd count", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the middle two of an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is not dragged by one outlier, which is the whole point", () => {
    expect(median([10, 11, 12, 13, 900])).toBe(12);
  });

  it("has an answer for nothing at all", () => {
    expect(median([])).toBe(0);
  });
});

describe("tapError", () => {
  const grid = 5.0;

  it("is zero on the click", () => {
    expect(tapError(grid + 3 * CAL_PERIOD, grid)).toBe(0);
  });

  it("is positive when struck late", () => {
    const e = tapError(grid + 2 * CAL_PERIOD + 0.04, grid);
    expect(e).toBeCloseTo(0.04, 9);
  });

  it("is negative when struck early", () => {
    const e = tapError(grid + 2 * CAL_PERIOD - 0.04, grid);
    expect(e).toBeCloseTo(-0.04, 9);
  });

  it("measures against the nearest click, not the one before", () => {
    // 30ms before the *next* click, not 570ms after the last.
    const e = tapError(grid + 3 * CAL_PERIOD - 0.03, grid);
    expect(e).toBeCloseTo(-0.03, 9);
  });

  it("takes taps before the grid starts", () => {
    expect(tapError(grid - 0.05, grid)).toBeCloseTo(-0.05, 9);
  });

  it("rejects a strike too far from any click to be a tap at it", () => {
    const justOver = (CAL_MAX_ABS_MS + 1) / 1000;
    expect(tapError(grid + 4 * CAL_PERIOD + justOver, grid)).toBeNull();
  });

  it("keeps a rig that really is a fifth of a second out", () => {
    const bad = (CAL_MAX_ABS_MS - 1) / 1000;
    expect(tapError(grid + 4 * CAL_PERIOD + bad, grid)).toBeCloseTo(bad, 9);
  });
});

describe("summarizeTaps", () => {
  /** `n` taps all `ms` late, with an optional wobble either side. */
  const taps = (n: number, ms: number, wobbleMs = 0) =>
    Array.from({ length: n }, (_, i) => (ms + (i % 2 ? wobbleMs : -wobbleMs)) / 1000);

  it("says nothing at all from too few taps", () => {
    expect(summarizeTaps(taps(CAL_MIN_TAPS - 1, 40))).toBeNull();
  });

  it("reports a consistent lateness as the offset", () => {
    const s = summarizeTaps(taps(16, 42))!;
    expect(s.offsetMs).toBe(42);
    expect(s.taps).toBe(16);
    expect(s.steady).toBe(true);
  });

  it("reports earliness as a negative offset", () => {
    expect(summarizeTaps(taps(16, -18))!.offsetMs).toBe(-18);
  });

  it("ignores a couple of ragged taps", () => {
    const set = [...taps(14, 30), 0.24, -0.19];
    expect(summarizeTaps(set)!.offsetMs).toBe(30);
  });

  it("calls out taps that disagree more than they agree", () => {
    const s = summarizeTaps(taps(16, 20, CAL_STEADY_MS + 15))!;
    expect(s.spreadMs).toBeGreaterThan(CAL_STEADY_MS);
    expect(s.steady).toBe(false);
  });

  it("counts a tight set as steady", () => {
    const s = summarizeTaps(taps(16, 20, 5))!;
    expect(s.spreadMs).toBe(5);
    expect(s.steady).toBe(true);
  });

  /**
   * The round trip the feature exists for: a rig that is 55ms late, tapped
   * imperfectly, has to come back as 55ms — because that is what gets
   * subtracted from every hit thereafter.
   */
  it("recovers a known latency from imperfect tapping", () => {
    const jitter = [4, -7, 2, 7, -3, 0, 6, -5, 1, -2, -6, -4, 3, -1, 5];
    const set = jitter.map((j) => (55 + j) / 1000);
    const s = summarizeTaps(set)!;
    expect(s.offsetMs).toBe(55);
    expect(s.steady).toBe(true);
  });
});

describe("clampLatency", () => {
  it("rounds to whole milliseconds", () => {
    expect(clampLatency(42.4)).toBe(42);
  });

  it("holds the limit in both directions", () => {
    expect(clampLatency(9999)).toBe(LATENCY_LIMIT_MS);
    expect(clampLatency(-9999)).toBe(-LATENCY_LIMIT_MS);
  });

  it("treats a broken stored value as no offset", () => {
    expect(clampLatency(NaN)).toBe(0);
    expect(clampLatency(Infinity)).toBe(0);
  });
});
