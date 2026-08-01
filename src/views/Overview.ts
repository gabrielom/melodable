/**
 * The lesson at a glance: a 22px strip above the lane holding every note of
 * the *run* — the pattern laid out once per repeat, end to end — with a
 * playhead sweeping it. Shows the shape of the whole exercise and where you
 * are in it.
 *
 * Draws the lesson's *targets* (what to play), not live instances, so it is
 * stable regardless of what has scrolled off screen. Marks take their rating
 * colour once graded, and keep it for the rest of the run.
 *
 * Notes are 3x3 squares on three vertical bands — the strip is too short to
 * give every lane its own row, so the bands only hint at register. The lane
 * stack below is where you read individual lanes.
 *
 * A viewport rectangle around the playhead marks the slice of the run the
 * lane is currently showing (Melodics-style), so the strip answers both
 * "where am I?" and "how much of it can I see?".
 */

import type { TargetNote } from "@/engine/scoring";
import type { VisibleWindow } from "@/views/lane-frame";
import { ledUpcoming, RADIUS, type Palette, type Theme } from "@/engine/theme";
import type { InstrumentType, Rating } from "@/engine/types";

export interface OverviewFrame {
  targets: readonly TargetNote[];
  instrument: InstrumentType;
  /** Lanes in display order (pads); ignored for piano. */
  padLanes: number[];
  lowNote: number;
  highNote: number;
  /** Length of one repeat, in beats. */
  loopBeats: number;
  /** How many times the pattern plays in the run. */
  totalLoops: number;
  /** Position within the run, in beats. Null when stopped or counting in. */
  runBeat: number | null;
  /** Rating of each note instance so far, keyed `loopIndex:targetIndex`. */
  ratings: ReadonlyMap<string, Rating>;
  /**
   * The slice of the timeline the lane below is showing, from its renderer.
   * Drawn as the viewport rectangle. Null when stopped.
   */
  view: VisibleWindow | null;
  palette: Palette;
  theme: Theme;
}

/** Note mark, px. */
const MARK = 3;
/** Inset from the strip's top and bottom to the outer bands. */
const BAND_PAD = 4;
/** How many vertical bands lanes are folded onto. */
const BANDS = 3;
/** Cap on repeat grid lines, so a long run doesn't turn into hatching. */
const MAX_GRID_LINES = 16;
/** Hex alpha for the viewport rectangle's fill and its edge. */
const VIEW_FILL = "1f";
const VIEW_EDGE = "99";

/**
 * The span of the run the viewport rectangle covers, as a `[from, to]` beat
 * pair, or null when there is nothing to draw.
 *
 * Clamped to the run rather than wrapped: a lesson is finite, so there is no
 * timeline past the end for the window to spill onto. Near either end the
 * rectangle simply runs up against the strip's edge, and when the window is
 * at least as long as the run the whole thing is on screen at once.
 */
export function viewportSpan(
  runBeat: number,
  view: VisibleWindow,
  runBeats: number,
): [number, number] | null {
  const run = Math.max(1e-9, runBeats);
  if (view.behind + view.ahead <= 0) return null;
  const from = Math.max(0, runBeat - view.behind);
  const to = Math.min(run, runBeat + view.ahead);
  return to > from ? [from, to] : null;
}

export class Overview {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(clientWidth * this.dpr));
    const h = Math.max(1, Math.round(clientHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(f: OverviewFrame): void {
    const ctx = this.ctx;
    const p = f.palette;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = p.lane;
    ctx.fillRect(0, 0, W, H);
    // Light has no fill contrast against the window, so it needs the hairline.
    if (RADIUS[f.theme].panel === 0) {
      ctx.strokeStyle = p.hair;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    }

    const loop = Math.max(1, f.loopBeats);
    const repeats = Number.isFinite(f.totalLoops) ? Math.max(1, Math.floor(f.totalLoops)) : 1;
    const run = loop * repeats;
    const xOf = (beat: number) => (beat / run) * W;

    // A grid line per repeat, thinned out so a long run doesn't become hatching.
    ctx.fillStyle = p.grid;
    const step = Math.ceil(repeats / MAX_GRID_LINES);
    for (let r = step; r < repeats; r += step) {
      ctx.fillRect(Math.round(xOf(r * loop)), 0, 1, H);
    }

    // Three bands: outer two sit BAND_PAD from the edges, one between.
    const top = BAND_PAD;
    const bottom = H - BAND_PAD - MARK;
    const bandY = (b: number) => top + (b * (bottom - top)) / (BANDS - 1);

    const bandOf = (lane: number): number => {
      if (f.instrument === "piano") {
        const span = Math.max(1, f.highNote - f.lowNote);
        // low pitches sit low in the strip
        const t = 1 - (lane - f.lowNote) / span;
        return Math.min(BANDS - 1, Math.max(0, Math.round(t * (BANDS - 1))));
      }
      const i = f.padLanes.indexOf(lane);
      if (i < 0 || f.padLanes.length <= 1) return Math.floor(BANDS / 2);
      return Math.min(BANDS - 1, Math.floor((i * BANDS) / f.padLanes.length));
    };

    const ledIndexOf = (lane: number): number => {
      const i = f.padLanes.indexOf(lane);
      return i < 0 ? 0 : i;
    };

    // Every repeat of the pattern, laid end to end across the strip.
    for (let r = 0; r < repeats; r++) {
      f.targets.forEach((t, i) => {
        const rating = f.ratings.get(`${r}:${i}`);
        ctx.fillStyle = rating
          ? p.rating[rating]
          : f.instrument === "piano"
            ? ledUpcoming(p, 5)
            : ledUpcoming(p, ledIndexOf(t.lane));
        ctx.fillRect(
          Math.round(xOf(r * loop + t.beat)),
          Math.round(bandY(bandOf(t.lane))),
          MARK,
          MARK,
        );
      });
    }

    // Viewport rectangle: the slice of the run the lane below is showing, so
    // what sits inside the rectangle is exactly what is on screen. Drawn
    // under the playhead so the playhead stays the brightest mark.
    if (f.runBeat !== null && f.view) {
      const span = viewportSpan(f.runBeat, f.view, run);
      if (span) {
        const x0 = Math.round(xOf(span[0])) + 0.5;
        const x1 = Math.round(xOf(span[1])) - 0.5;
        if (x1 > x0) {
          ctx.fillStyle = p.head + VIEW_FILL;
          ctx.fillRect(x0, 0.5, x1 - x0, H - 1);
          ctx.strokeStyle = p.head + VIEW_EDGE;
          ctx.lineWidth = 1;
          ctx.strokeRect(x0, 0.5, x1 - x0, H - 1);
        }
      }
    }

    if (f.runBeat !== null) {
      ctx.fillStyle = p.head;
      ctx.fillRect(Math.round(xOf(Math.min(f.runBeat, run))), 0, 2, H);
    }
  }
}
