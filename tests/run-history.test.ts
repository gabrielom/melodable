import { describe, expect, it } from "vitest";
import {
  AXIS_Y,
  BADGE,
  FOOT_Y,
  LANES,
  PLOT_END,
  TIP,
  VIEW,
  badgeAt,
  chipRight,
  historyChart,
  laneBars,
  stepFor,
  tipAt,
  xOf,
  yOf,
} from "@/components/run-history";

/** A full history, for the cases that care about the busiest chart. */

const CAP = 40;

describe("run-history geometry", () => {
  it("maps accuracy onto the design's plot band: y = 132 − 1.1v", () => {
    expect(yOf(0)).toBe(132);
    expect(yOf(1)).toBe(22);
    expect(yOf(0.5)).toBeCloseTo(77, 9);
  });

  it("clamps a value outside 0..1 rather than drawing off the chart", () => {
    expect(yOf(-1)).toBe(132);
    expect(yOf(3)).toBe(22);
  });

  it("keeps the plot clear of the axis rule, and the rule clear of the footer", () => {
    expect(yOf(0)).toBeLessThan(AXIS_Y);
    expect(AXIS_Y).toBeLessThan(FOOT_Y);
    expect(FOOT_Y).toBeLessThan(VIEW.h);
  });

  it("stops the plot short of the lanes, and only its end moves", () => {
    for (const n of [2, 7, 28]) {
      expect(xOf(0, n, PLOT_END.withLanes)).toBe(26);
      expect(xOf(n - 1, n, PLOT_END.withLanes)).toBeCloseTo(424, 9);
    }
    const c = historyChart([0.5, 0.6, 0.72], PLOT_END.withLanes);
    expect(c.current!.x).toBeCloseTo(424, 9);
    expect(c.x1).toBe(424);
    // The scale is the same either way: a score sits at one height.
    expect(c.current!.y).toBe(historyChart([0.5, 0.6, 0.72]).current!.y);
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

describe("the hovered score's chip", () => {
  it("never overlaps the BEST flag, which is why it sits below", () => {
    // Both appear together on the best run's dot — the first one a pointer
    // finds. Overlapping there would make each unreadable.
    for (let pct = 0; pct <= 100; pct++) {
      const point = historyChart([0, pct / 100]).points[1];
      const badge = badgeAt(point);
      const tip = tipAt(point);
      // The flag is always the upper of the two, flipped or not.
      expect(tip.y).toBeGreaterThanOrEqual(badge.y + BADGE.h);
    }
  });

  it("stands clear of the dot, so the cursor is never on top of it", () => {
    // The complaint this answers: tucked against the dot, the chip sat under
    // the arrow that was pointing at it.
    for (let pct = 0; pct <= 100; pct++) {
      const point = historyChart([0, pct / 100]).points[1];
      const tip = tipAt(point);
      const clearance = tip.flipped ? point.y - (tip.y + TIP.h) : tip.y - point.y;
      // A macOS arrow is about 19px tall below its hotspot, and the chart
      // renders at roughly 0.93 viewBox units to the pixel in the summary's
      // column — so it takes about 21 units to get out from under it.
      expect(clearance).toBeGreaterThanOrEqual(21);
    }
  });

  it("stays inside the box at every accuracy", () => {
    for (let pct = 0; pct <= 100; pct++) {
      const tip = tipAt(historyChart([0, pct / 100]).points[1]);
      expect(tip.y).toBeGreaterThanOrEqual(0);
      expect(tip.y + TIP.h).toBeLessThanOrEqual(VIEW.h);
    }
  });

  it("flips above a run too low to have room below it", () => {
    // Clamping to the floor instead would draw the chip over its own dot.
    const low = historyChart([0.5, 0]).points[1];
    const tipLow = tipAt(low);
    expect(tipLow.flipped).toBe(true);
    expect(tipLow.y + TIP.h).toBeLessThan(low.y);

    // And a normal score is not flipped — below is the resting side.
    const mid = historyChart([0.5, 0.8]).points[1];
    expect(tipAt(mid).flipped).toBe(false);
    expect(tipAt(mid).y).toBeGreaterThan(mid.y);
  });

  it("stacks the flag above the flipped chip, not through it", () => {
    const low = historyChart([0, 0]).points[1];
    const tip = tipAt(low);
    const badge = badgeAt(low);
    expect(tip.flipped).toBe(true);
    expect(badge.y + BADGE.h).toBeLessThanOrEqual(tip.y);
    expect(badge.y).toBeGreaterThanOrEqual(0);
  });

  it("stays inside the box at either end of the axis", () => {
    // The first and last dots sit hard against the edges, so a centred chip
    // would hang off both.
    const c = historyChart([0.4, 0.5, 0.6]);
    for (const point of c.points) {
      const tip = tipAt(point);
      expect(tip.x).toBeGreaterThanOrEqual(0);
      expect(tip.x + TIP.w).toBeLessThanOrEqual(VIEW.w);
    }
  });

  it("keeps both chips out of the lanes' column when the lanes are shown", () => {
    const right = chipRight(PLOT_END.withLanes);
    expect(right).toBeLessThan(LANES.divider);
    const c = historyChart([0.4, 0.5, 0.6], PLOT_END.withLanes);
    for (const point of c.points) {
      expect(tipAt(point, right).x + TIP.w).toBeLessThanOrEqual(right);
      expect(badgeAt(point, right).x + BADGE.w).toBeLessThanOrEqual(right);
    }
    // Without lanes the whole figure is theirs.
    expect(chipRight(PLOT_END.full)).toBe(VIEW.w);
  });

  it("flips above the footer rather than covering it", () => {
    for (let pct = 0; pct <= 100; pct++) {
      const tip = tipAt(historyChart([0, pct / 100]).points[1]);
      if (!tip.flipped) expect(tip.y + TIP.h).toBeLessThan(FOOT_Y - 7.5);
    }
  });

  it("centres on the dot when there is room", () => {
    const point = historyChart([0.4, 0.5, 0.6]).points[1];
    expect(tipAt(point).x + TIP.w / 2).toBeCloseTo(point.x);
  });
});

describe("the weakest lanes on the history's axis", () => {
  it("stands a lane exactly as high as a run of the same score", () => {
    // Handoff 14's own frame: E4 at 64, G4 at 76, C5 at 83.
    const bars = laneBars([{ accuracy: 0.64 }, { accuracy: 0.76 }, { accuracy: 0.83 }]);
    expect(bars.map((b) => b.x)).toEqual([468, 522, 576]);
    expect(bars[0].y).toBeCloseTo(61.6, 9);
    expect(bars[0].h).toBeCloseTo(70.4, 9);
    expect(bars[2].y).toBeCloseTo(40.7, 9);
    for (const [i, a] of [0.64, 0.76, 0.83].entries()) {
      expect(bars[i].y).toBeCloseTo(yOf(a), 9);
      expect(bars[i].y + bars[i].h).toBeCloseTo(yOf(0), 9);
    }
  });

  it("keeps three bars inside the lanes' column", () => {
    const bars = laneBars([{ accuracy: 0.1 }, { accuracy: 0.5 }, { accuracy: 0.99 }]);
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(LANES.x0);
      expect(b.x + LANES.barW).toBeLessThanOrEqual(LANES.x1);
      expect(b.cx).toBeCloseTo(b.x + LANES.barW / 2, 9);
    }
    expect(LANES.divider).toBeGreaterThan(PLOT_END.withLanes);
    expect(LANES.divider).toBeLessThan(LANES.x0);
  });
});
