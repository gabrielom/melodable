/**
 * Geometry for the summary's run-history chart (handoff 09 §2).
 *
 * Kept out of the component because it is arithmetic with real edge cases —
 * the first-ever run, a second attempt, a full forty — and those are worth
 * pinning in a test rather than eyeballing on screen once.
 *
 * Everything here is in the chart's own coordinate space, not the screen's:
 * the SVG is drawn on a fixed 620 x 148 viewBox and scaled to whatever width
 * the panel column has, so none of it depends on layout.
 */

/**
 * The design's viewBox.
 *
 * Handoff 10 §2 doubled the height. At the old 55px of range the climb from a
 * first attempt to a good one was a shallow drift; at 110px it reads as
 * progress, which is the only reason the block is on the screen at all.
 */
export const VIEW = { w: 620, h: 148 } as const;
/** Left gutter carries the axis labels; the plot starts after it. */
const PLOT_X0 = 26;
const PLOT_X1 = 614;
/** 0% sits at y=132, 100% at y=22. */
const PLOT_Y0 = 132;
const PLOT_SPAN = 110;
/** The rule under the plot, with a dot at each end. */
export const AXIS_Y = 141;
export const AXIS_DOT_R = 2.6;
export const DOT_R = 3.1;
export const CURRENT_DOT_R = 4.1;
/** Gridlines, and their labels in the gutter. Two only — this is a shape to
 *  read, not a table. */
export const GRID_VALUES = [100, 50] as const;

/** The BEST flag above the current dot. */
export const BADGE = { w: 42, h: 14, gap: 5 } as const;
/**
 * How far the badge may rise. With 100% at y=22 there is room for the badge
 * above a full-marks run *inside* the box, so it no longer hangs outside and
 * no longer depends on `overflow: visible` to be seen at all (handoff 10 §2).
 */
const BADGE_CEILING = 0;

/**
 * Horizontal step between attempts.
 *
 * Stretched to fill: the attempts always span the whole axis, whether there
 * are six of them or the full twenty-eight, so the shape of the climb is the
 * same size to read at any point in a lesson's life.
 *
 * It used to divide the *capacity* instead, which kept the spacing fixed and
 * marched the dots rightwards as history accumulated — six attempts then
 * huddled into the left fifth of a mostly empty chart, which is the one thing
 * the block is on screen to avoid.
 */
export function stepFor(count: number): number {
  return count > 1 ? (PLOT_X1 - PLOT_X0) / (count - 1) : 0;
}

/**
 * Where the `index`-th of `count` attempts sits.
 *
 * Oldest at the left, this run hard right. A lone attempt has no span to
 * stretch across and starts at the left, where a history begins.
 */
export function xOf(index: number, count: number): number {
  return PLOT_X0 + index * stepFor(count);
}

/** Accuracy 0..1 to a y in the plot. Clamped, so a rogue value stays inside. */
export function yOf(accuracy: number): number {
  const pct = Math.min(1, Math.max(0, accuracy));
  return PLOT_Y0 - pct * PLOT_SPAN;
}

export interface HistoryPoint {
  x: number;
  y: number;
  /** 0..1, for the labels. */
  value: number;
}

export interface HistoryChart {
  points: HistoryPoint[];
  /** `points` as an SVG polyline, or "" when there is nothing to join. */
  path: string;
  first: HistoryPoint | null;
  current: HistoryPoint | null;
  /**
   * The highest-scoring attempt, earliest on a tie — the one the BEST flag
   * names when it is hovered. Null when there is nothing to compare.
   */
  bestIndex: number | null;
  gridlines: Array<{ value: number; y: number }>;
}

/**
 * The score chip below a dot. Same box as the BEST flag — same height, same
 * corner, same type — so the two read as one language on hover. Narrower,
 * because it holds four characters rather than a word.
 */
export const TIP = { w: 34, h: 14, gap: 5 } as const;

/** Where the score chip goes below a dot, kept inside the chart's box. */
export function tipAt(point: HistoryPoint): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, point.x - TIP.w / 2), VIEW.w - TIP.w),
    y: Math.min(VIEW.h - TIP.h, point.y + CURRENT_DOT_R + TIP.gap),
  };
}

/**
 * Where the BEST flag goes above a dot, kept inside the chart's box.
 *
 * Takes any point rather than assuming the current one: the flag is shown on
 * hover now, and the best run is not always the latest.
 */
export function badgeAt(point: HistoryPoint): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, point.x - BADGE.w / 2), VIEW.w - BADGE.w),
    y: Math.max(BADGE_CEILING, point.y - CURRENT_DOT_R - BADGE.gap - BADGE.h),
  };
}

/**
 * Lay the attempts out. `attempts` is oldest first and includes the run that
 * has just finished, which is always the last point and always the rightmost.
 */
export function historyChart(attempts: readonly number[]): HistoryChart {
  const n = attempts.length;
  const points = attempts.map((value, i) => ({ x: xOf(i, n), y: yOf(value), value }));
  const current = points.length ? points[points.length - 1] : null;
  // A single dot has no line, and no "first" to label — it *is* the first.
  const first = points.length > 1 ? points[0] : null;

  // Earliest on a tie: the run that *reached* the mark owns it, not a later
  // one that merely matched it.
  let bestIndex: number | null = null;
  for (let i = 0; i < attempts.length; i++) {
    if (bestIndex === null || attempts[i] > attempts[bestIndex]) bestIndex = i;
  }

  return {
    points,
    path:
      points.length > 1
        ? points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
        : "",
    first,
    current,
    bestIndex,
    gridlines: GRID_VALUES.map((value) => ({ value, y: yOf(value / 100) })),
  };
}
