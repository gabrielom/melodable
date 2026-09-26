/**
 * Geometry for the summary's run-history chart (handoff 09 §2, redrawn in
 * handoff 14 as 11i).
 *
 * Kept out of the component because it is arithmetic with real edge cases —
 * the first-ever run, a second attempt, a full forty — and those are worth
 * pinning in a test rather than eyeballing on screen once.
 *
 * Everything here is in the chart's own coordinate space, not the screen's.
 * Since handoff 14 that space is exactly the sheet's content width, 620 units
 * to 620 pixels, so the type in it is drawn at the size it is written and
 * never shrinks.
 */

/**
 * The design's figure: one SVG holding the run history and, beside it, the
 * weakest lanes on the same 0–100 scale (handoff 14 §02).
 */
export const VIEW = { w: 620, h: 166 } as const;
/** Left gutter carries the axis labels; the plot starts after it. */
const PLOT_X0 = 26;
/**
 * Where the plot ends. With weakest lanes to show it stops short and the
 * lanes stand to its right on its own axis; without any it takes the whole
 * figure, which is the summary as it was before the lanes came back. Only
 * this end moves — nothing else in the figure is resized to make room.
 */
export const PLOT_END = { full: 614, withLanes: 424 } as const;
/** 0% sits at y=132, 100% at y=22: `y(v) = 132 − 1.1v`. */
const PLOT_Y0 = 132;
const PLOT_SPAN = 110;
/** The rule under the plot, with a dot at each end. */
export const AXIS_Y = 141;
export const AXIS_DOT_R = 2.6;
/** The footer labels' baseline — inside the figure now, not a row under it. */
export const FOOT_Y = 160;
export const DOT_R = 3.1;
export const CURRENT_DOT_R = 4.1;
/** Gridlines, and their labels in the gutter. Two only — this is a shape to
 *  read, not a table. */
export const GRID_VALUES = [100, 50] as const;

/**
 * The weakest lanes' column. Up to three bars, 24 wide on a 54 pitch, rising
 * from the plot's own zero line; the divider stands between the two halves.
 */
export const LANES = {
  divider: 439,
  x0: 454,
  x1: PLOT_END.full,
  first: 468,
  pitch: 54,
  barW: 24,
  nameY: 146,
  leanY: 157,
} as const;

/**
 * The BEST flag above the hovered dot.
 *
 * `gap` is the reason both chips stand this far off: the mouse cursor hangs
 * down and to the right of the point it is over, so a chip tucked against the
 * dot is a chip under the arrow. It clears the pointer instead.
 */
export const BADGE = { w: 52, h: 18, gap: 18 } as const;
/**
 * How far the badge may rise: the top of the figure. Above a full-marks run
 * that is flush with the box, which is the one case where it sits close to
 * its dot — the header row is directly above and has the run's score in it.
 */
const BADGE_CEILING = 0;
/**
 * How far down the score chip may reach before it flips above its dot: clear
 * of the footer labels, which sit inside the figure now.
 */
const TIP_FLOOR = FOOT_Y - 8;

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
export function stepFor(count: number, x1: number = PLOT_END.full): number {
  return count > 1 ? (x1 - PLOT_X0) / (count - 1) : 0;
}

/**
 * Where the `index`-th of `count` attempts sits.
 *
 * Oldest at the left, this run hard right. A lone attempt has no span to
 * stretch across and starts at the left, where a history begins.
 */
export function xOf(index: number, count: number, x1: number = PLOT_END.full): number {
  return PLOT_X0 + index * stepFor(count, x1);
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
  /** Where this chart's plot ends — see `PLOT_END`. */
  x1: number;
}

/**
 * The score chip below a dot. Same box as the BEST flag — same height, same
 * corner, same type — so the two read as one language on hover. Narrower,
 * because it holds four characters rather than a word.
 */
export const TIP = { w: 44, h: 18, gap: 18 } as const;

/**
 * A chip centred on a dot, pulled back inside the chart's left edge and
 * `right` — the figure's edge, or the divider when the lanes are beside it.
 */
function chipX(point: HistoryPoint, width: number, right: number): number {
  return Math.min(Math.max(0, point.x - width / 2), right - width);
}

/** The right edge a chip may reach: short of the divider when lanes are shown. */
export function chipRight(x1: number): number {
  return x1 === PLOT_END.full ? VIEW.w : LANES.divider - 2;
}

export interface TipBox {
  x: number;
  y: number;
  /** True when the chip sits above the dot instead of below it. */
  flipped: boolean;
}

/**
 * Where the score chip goes: below the dot, standing clear of the cursor.
 *
 * A run in the bottom fifth has no room down there, and clamping the chip to
 * the floor — what this did before it was this far out — would lay it across
 * the very dot it is naming. So it flips above instead, which is empty at
 * those scores by definition.
 */
export function tipAt(point: HistoryPoint, right: number = VIEW.w): TipBox {
  const below = point.y + CURRENT_DOT_R + TIP.gap;
  const flipped = below + TIP.h > TIP_FLOOR;
  return {
    x: chipX(point, TIP.w, right),
    y: flipped ? point.y - CURRENT_DOT_R - TIP.gap - TIP.h : below,
    flipped,
  };
}

/**
 * Where the BEST flag goes above a dot, kept inside the chart's box.
 *
 * Takes any point rather than assuming the current one: the flag is shown on
 * hover now, and the best run is not always the latest.
 *
 * When the score chip has flipped above, the flag stacks above *it* — the two
 * appear together on the best dot, which is the first one a pointer finds.
 */
export function badgeAt(point: HistoryPoint, right: number = VIEW.w): { x: number; y: number } {
  const tip = tipAt(point, right);
  const ceiling = tip.flipped ? tip.y - BADGE.gap - BADGE.h : BADGE_CEILING;
  return {
    x: chipX(point, BADGE.w, right),
    y: tip.flipped ? ceiling : Math.max(ceiling, point.y - CURRENT_DOT_R - BADGE.gap - BADGE.h),
  };
}

/**
 * Lay the attempts out. `attempts` is oldest first and includes the run that
 * has just finished, which is always the last point and always the rightmost.
 */
export function historyChart(
  attempts: readonly number[],
  x1: number = PLOT_END.full,
): HistoryChart {
  const n = attempts.length;
  const points = attempts.map((value, i) => ({ x: xOf(i, n, x1), y: yOf(value), value }));
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
    x1,
  };
}

export interface LaneBar {
  /** Left edge and centre of the bar. */
  x: number;
  cx: number;
  /** Top of the bar, and its height — on the history's own scale. */
  y: number;
  h: number;
}

/**
 * The weakest lanes as bars on the history's axis (handoff 14 §02): a lane at
 * 64% stands exactly as high as a run at 64% would sit, so the dashed line
 * carrying this run's score across them shows at a glance which fell short.
 * Weakest first, left to right; at most three are ever passed in.
 */
export function laneBars(lanes: readonly { accuracy: number }[]): LaneBar[] {
  return lanes.map((l, i) => {
    const x = LANES.first + i * LANES.pitch;
    const y = yOf(l.accuracy);
    return { x, cx: x + LANES.barW / 2, y, h: PLOT_Y0 - y };
  });
}
