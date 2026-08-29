import { describe, expect, it } from "vitest";
import {
  AXIS_Y,
  BADGE,
  VIEW,
  badgeAt,
  historyChart,
  stepFor,
  xOf,
  yOf,
} from "@/components/run-history";

/** A full history, for the cases that care about the busiest chart. */

const CAP = 40;

describe("run-history geometry", () => {
  it("maps accuracy onto the design's plot band", () => {
    expect(yOf(0)).toBe(132);
    expect(yOf(1)).toBe(22);
    expect(yOf(0.5)).toBeCloseTo(77, 9);
  });

  it("clamps a value outside 0..1 rather than drawing off the chart", () => {
    expect(yOf(-1)).toBe(132);
    expect(yOf(3)).toBe(22);
  });

  it("keeps the plot clear of the axis rule", () => {
    expect(yOf(0)).toBeLessThan(AXIS_Y);
  });

  it("spans the gutter to the right edge, whatever the count", () => {
    for (const n of [2, 6, 28, CAP]) {
      expect(xOf(0, n)).toBe(26);
      expect(xOf(n - 1, n)).toBeCloseTo(614, 9);
    }
  });

  it("fills the axis with six attempts as readily as with twenty-eight", () => {
    // The whole point of the change: six runs used to huddle into the left
    // fifth of a mostly empty chart.
    const six = historyChart([0.2, 0.3, 0.4, 0.5, 0.6, 0.94]);
    const many = historyChart(Array.from({ length: 28 }, (_, i) => i / 40));
    expect(six.points[0].x).toBeCloseTo(many.points[0].x, 9);
    expect(six.points[5].x).toBeCloseTo(many.points[27].x, 9);
  });

  it("spaces the dots evenly", () => {
    const c = historyChart([0.2, 0.3, 0.4, 0.5, 0.6]);
    const gaps = c.points.slice(1).map((p, i) => p.x - c.points[i].x);
    for (const g of gaps) expect(g).toBeCloseTo(stepFor(5), 9);
  });

  it("has no step to take with a single attempt", () => {
    expect(stepFor(1)).toBe(0);
    expect(stepFor(0)).toBe(0);
  });

  it("rescales as history accumulates, which is the accepted cost", () => {
    // Dot 3 does move when a fourth run arrives. That is the trade for a
    // chart that always fills its axis, and it is deliberate.
    expect(historyChart([0.1, 0.2, 0.3]).points[2].x).not.toBeCloseTo(
      historyChart([0.1, 0.2, 0.3, 0.4]).points[2].x,
      1,
    );
  });
});

describe("historyChart", () => {
  it("draws the first-ever run as one dot with no line and no FIRST label", () => {
    const c = historyChart([0.42]);
    expect(c.points).toHaveLength(1);
    expect(c.path).toBe("");
    expect(c.first).toBeNull();
    expect(c.current).not.toBeNull();
    // It is trivially its own best, being the only one.
    expect(c.bestIndex).toBe(0);
  });

  it("puts a second attempt at the far right, opposite the first", () => {
    const c = historyChart([0.4, 0.5]);
    expect(c.points[0].x).toBe(26);
    expect(c.points[1].x).toBeCloseTo(614, 9);
  });

  it("keeps this run rightmost, always", () => {
    for (const n of [2, 3, 9, 28]) {
      const c = historyChart(Array.from({ length: n }, () => 0.5));
      expect(c.current!.x).toBeCloseTo(614, 9);
      for (const p of c.points) expect(p.x).toBeLessThanOrEqual(c.current!.x + 1e-9);
    }
  });

  it("starts a lone attempt at the left, where a history begins", () => {
    expect(historyChart([0.42]).points[0].x).toBe(26);
  });

  it("names the highest attempt as the best, wherever it sits", () => {
    expect(historyChart([0.4, 0.5, 0.9]).bestIndex).toBe(2);
    // Not always the latest: a good run in the middle keeps the flag.
    expect(historyChart([0.4, 0.9, 0.5]).bestIndex).toBe(1);
  });

  it("gives a tie to the run that reached the mark first", () => {
    expect(historyChart([0.9, 0.9]).bestIndex).toBe(0);
  });

  it("has no best to name with no attempts at all", () => {
    expect(historyChart([]).bestIndex).toBeNull();
  });

  it("keeps the badge inside the chart at full capacity", () => {
    const full = Array.from({ length: CAP }, (_, i) => i / CAP);
    const c = historyChart(full);
    const badge = badgeAt(c.points[c.bestIndex!]);
    expect(badge.x).toBeGreaterThanOrEqual(0);
    expect(badge.x + BADGE.w).toBeLessThanOrEqual(VIEW.w);
  });

  it("keeps the badge inside the box, even on a full-marks run", () => {
    // Handoff 10 §2: the taller plot leaves room above a perfect run, so the
    // badge no longer hangs outside the viewBox relying on overflow.
    const perfect = badgeAt(historyChart([0.5, 1]).points[1]);
    expect(perfect.y).toBe(0);
    expect(perfect.y + BADGE.h).toBeLessThanOrEqual(VIEW.h);
    // A low run keeps its badge attached to the dot instead.
    expect(badgeAt(historyChart([0.1, 0.4]).points[1]).y).toBeGreaterThan(0);
  });

  it("never lets the badge leave the box at any accuracy", () => {
    for (let pct = 0; pct <= 100; pct++) {
      const badge = badgeAt(historyChart([0, pct / 100]).points[1]);
      expect(badge.y).toBeGreaterThanOrEqual(0);
      expect(badge.y + BADGE.h).toBeLessThanOrEqual(VIEW.h);
    }
  });

  it("labels the first attempt only once there is more than one", () => {
    expect(historyChart([0.3]).first).toBeNull();
    expect(historyChart([0.3, 0.4]).first!.value).toBe(0.3);
  });

  it("joins every point, so attempts stay countable", () => {
    const c = historyChart([0.2, 0.4, 0.6]);
    expect(c.path.split(" ")).toHaveLength(3);
    expect(c.points).toHaveLength(3);
  });

  it("draws nothing at all for a lesson never run", () => {
    const c = historyChart([]);
    expect(c.points).toEqual([]);
    expect(c.current).toBeNull();
    expect(c.bestIndex).toBeNull();
  });
});
