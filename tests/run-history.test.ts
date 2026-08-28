import { describe, expect, it } from "vitest";
import { AXIS_Y, BADGE, VIEW, historyChart, stepFor, xOf, yOf } from "@/components/run-history";

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

  it("spans the gutter to the right edge at full capacity", () => {
    expect(xOf(0, CAP)).toBe(26);
    expect(xOf(CAP - 1, CAP)).toBeCloseTo(614, 9);
  });

  it("holds the spacing fixed as history accumulates", () => {
    // The point of laying out against capacity rather than the attempts in
    // hand: dot 3 does not move when a fourth run is added, so the chart does
    // not rescale under the player after every run.
    expect(stepFor(CAP)).toBeCloseTo((614 - 26) / 39, 9);
    expect(historyChart([0.1, 0.2, 0.3], CAP).points[2].x).toBeCloseTo(
      historyChart([0.1, 0.2, 0.3, 0.4], CAP).points[2].x,
      9,
    );
  });
});

describe("historyChart", () => {
  it("draws the first-ever run as one dot with no line and no FIRST label", () => {
    const c = historyChart([0.42], CAP);
    expect(c.points).toHaveLength(1);
    expect(c.path).toBe("");
    expect(c.first).toBeNull();
    expect(c.current).not.toBeNull();
    // Nothing to beat, so no badge either.
    expect(c.isBest).toBe(false);
    expect(c.badge).toBeNull();
  });

  it("puts a second attempt near the left rather than across the width", () => {
    const c = historyChart([0.4, 0.5], CAP);
    expect(c.points[1].x).toBeCloseTo(xOf(1, CAP), 9);
    expect(c.points[1].x).toBeLessThan(VIEW.w / 4);
  });

  it("badges a run only when it beat every attempt before it", () => {
    expect(historyChart([0.4, 0.5, 0.9], CAP).isBest).toBe(true);
    expect(historyChart([0.4, 0.9, 0.5], CAP).isBest).toBe(false);
    // Matching your best is not beating it.
    expect(historyChart([0.9, 0.9], CAP).isBest).toBe(false);
  });

  it("keeps the badge inside the chart at full capacity", () => {
    const full = Array.from({ length: CAP }, (_, i) => i / CAP);
    const c = historyChart(full, CAP);
    expect(c.badge).not.toBeNull();
    expect(c.badge!.x).toBeGreaterThanOrEqual(0);
    expect(c.badge!.x + BADGE.w).toBeLessThanOrEqual(VIEW.w);
  });

  it("keeps the badge inside the box, even on a full-marks run", () => {
    // Handoff 10 §2: the taller plot leaves room above a perfect run, so the
    // badge no longer hangs outside the viewBox relying on overflow.
    const perfect = historyChart([0.5, 1], CAP).badge!;
    expect(perfect.y).toBe(0);
    expect(perfect.y + BADGE.h).toBeLessThanOrEqual(VIEW.h);
    // A low run keeps its badge attached to the dot instead.
    expect(historyChart([0.1, 0.4], CAP).badge!.y).toBeGreaterThan(0);
  });

  it("never lets the badge leave the box at any accuracy", () => {
    // From 1% up, so the current run always beats the 0% before it and there
    // is a badge to place at all.
    for (let pct = 1; pct <= 100; pct++) {
      const badge = historyChart([0, pct / 100], CAP).badge;
      expect(badge).not.toBeNull();
      expect(badge!.y).toBeGreaterThanOrEqual(0);
      expect(badge!.y + BADGE.h).toBeLessThanOrEqual(VIEW.h);
    }
  });

  it("labels the first attempt only once there is more than one", () => {
    expect(historyChart([0.3], CAP).first).toBeNull();
    expect(historyChart([0.3, 0.4], CAP).first!.value).toBe(0.3);
  });

  it("joins every point, so attempts stay countable", () => {
    const c = historyChart([0.2, 0.4, 0.6], CAP);
    expect(c.path.split(" ")).toHaveLength(3);
    expect(c.points).toHaveLength(3);
  });

  it("draws nothing at all for a lesson never run", () => {
    const c = historyChart([], CAP);
    expect(c.points).toEqual([]);
    expect(c.current).toBeNull();
    expect(c.badge).toBeNull();
  });
});
