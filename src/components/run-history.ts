/**
 * Geometry for the summary's run-history chart (handoff 09 §2).
 *
 * Kept out of the component because it is arithmetic with real edge cases —
 * the first-ever run, a second attempt, a full forty — and those are worth
 * pinning in a test rather than eyeballing on screen once.
 *
 * Everything here is in the chart's own coordinate space, not the screen's:
 * the SVG is drawn on a fixed 620 x 78 viewBox and scaled to whatever width
 * the panel column has, so none of it depends on layout.
 */

/** The design's viewBox. */
export const VIEW = { w: 620, h: 78 } as const;
/** Left gutter carries the axis labels; the plot starts after it. */
const PLOT_X0 = 26;
const PLOT_X1 = 614;
/** 0% sits at y=62, 100% at y=7. */
const PLOT_Y0 = 62;
const PLOT_SPAN = 55;
/** The rule under the plot, with a dot at each end. */
export const AXIS_Y = 71;
export const AXIS_DOT_R = 2.6;
export const DOT_R = 3.1;
export const CURRENT_DOT_R = 4.1;
/** Gridlines, and their labels in the gutter. Two only — this is a shape to
 *  read, not a table. */
export const GRID_VALUES = [100, 50] as const;

/** The BEST flag above the current dot. */
export const BADGE = { w: 42, h: 14, gap: 5 } as const;
/**
 * How far the badge may spill above the viewBox. The chart sits under its own
 * header with a gap, and the design lets the badge rise into it rather than
 * pushing the plot down — but only so far, or a full-marks run would collide
 * with the header text.
 */
const BADGE_CEILING = -10;

/**
 * Horizontal step between attempts.
 *
 * Fixed, not stretched to fill: a second attempt should read as two dots near
 * the left, not as a chart with two points. It is derived from the *full*
 * capacity so the spacing never changes as history accumulates — dots march
 * rightwards across runs instead of the whole chart rescaling under you.
 */
export function stepFor(capacity: number): number {
  return capacity > 1 ? (PLOT_X1 - PLOT_X0) / (capacity - 1) : 0;
}

export function xOf(index: number, capacity: number): number {
  return PLOT_X0 + index * stepFor(capacity);
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
  /** True only when this run beat every attempt before it. */
  isBest: boolean;
  /** Where the BEST flag goes. Null when `isBest` is false. */
  badge: { x: number; y: number } | null;
  gridlines: Array<{ value: number; y: number }>;
}

/** The badge sits over the current dot, kept inside the chart's width. */
function badgeFor(current: HistoryPoint): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, current.x - BADGE.w / 2), VIEW.w - BADGE.w),
    y: Math.max(BADGE_CEILING, current.y - CURRENT_DOT_R - BADGE.gap - BADGE.h),
  };
}

/**
 * Lay the attempts out. `attempts` is oldest first and includes the run that
 * has just finished, which is always the last point.
 */
export function historyChart(attempts: readonly number[], capacity: number): HistoryChart {
  const points = attempts.map((value, i) => ({ x: xOf(i, capacity), y: yOf(value), value }));
  const current = points.length ? points[points.length - 1] : null;
  // A single dot has no line, and no "first" to label — it *is* the first.
  const first = points.length > 1 ? points[0] : null;
  const previous = attempts.slice(0, -1);
  // Strictly beat, not matched: repeating your best is not a new one, and a
  // badge that shows up on every run is decoration.
  const isBest = previous.length > 0 && attempts[attempts.length - 1] > Math.max(...previous);
  return {
    points,
    path:
      points.length > 1
        ? points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
        : "",
    first,
    current,
    isBest,
    badge: isBest && current ? badgeFor(current) : null,
    gridlines: GRID_VALUES.map((value) => ({ value, y: yOf(value / 100) })),
  };
}
