/**
 * The lesson at a glance: a 22px strip above the lane holding every note of
 * the loop, with a playhead sweeping it. Shows the shape of the whole pattern
 * and where you are in it.
 *
 * Draws the lesson's *targets* (what to play), not live instances, so it is
 * stable while the loop repeats. Marks take their rating colour once graded.
 *
 * Notes are 3x3 squares on three vertical bands — the strip is too short to
 * give every lane its own row, so the bands only hint at register. The lane
 * stack below is where you read individual lanes.
 *
 * A viewport rectangle around the playhead marks the slice of the loop the
 * lane is currently showing (Melodics-style), so the strip answers both
 * "where am I?" and "how much of the pattern can I see?".
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
  loopBeats: number;
  /** Position within the loop, in beats. Null when stopped or counting in. */
  beatInLoop: number | null;
  /** Rating of each target in the current loop, by target index. */
  ratings: ReadonlyMap<number, Rating>;
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
/** Hex alpha for the viewport rectangle's fill and its edge. */
const VIEW_FILL = "1f";
const VIEW_EDGE = "99";

/**
 * The loop-relative span(s) the viewport rectangle covers, as `[from, to)`
 * beat pairs.
 *
 * The lane scrolls a continuous timeline while the strip shows a single loop,
 * so the window can run off one end and reappear at the other. That returns
 * two segments; their outer edges land on the strip's own edges, which reads
 * as one rectangle wrapping round. When the window is at least a loop wide the
 * whole loop is on screen at once and the rectangle covers the strip.
 *
 * Exported for its own tests — it is the one bit of real arithmetic here.
 */
export function viewportSegments(
  beatInLoop: number,
  view: VisibleWindow,
  loopBeats: number,
): Array<[number, number]> {
  const loop = Math.max(1e-9, loopBeats);
  const span = view.behind + view.ahead;
  if (span <= 0) return [];
  if (span >= loop) return [[0, loop]];

  const start = (((beatInLoop - view.behind) % loop) + loop) % loop;
  const end = start + span;
  return end <= loop ? [[start, end]] : [[start, loop], [0, end - loop]];
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
    const xOf = (beat: number) => (beat / loop) * W;

    // Bar lines. Quarters of the loop, matching the design's 25/50/75%.
    ctx.fillStyle = p.grid;
    for (let i = 1; i < 4; i++) {
      ctx.fillRect(Math.round((W * i) / 4), 0, 1, H);
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

    f.targets.forEach((t, i) => {
      const rating = f.ratings.get(i);
      ctx.fillStyle = rating
        ? p.rating[rating]
        : f.instrument === "piano"
          ? ledUpcoming(p, 5)
          : ledUpcoming(p, ledIndexOf(t.lane));
      ctx.fillRect(Math.round(xOf(t.beat)), Math.round(bandY(bandOf(t.lane))), MARK, MARK);
    });

    // Viewport rectangle: the slice of the loop the lane below is showing, so
    // what sits inside the rectangle is exactly what is on screen. Drawn
    // under the playhead so the playhead stays the brightest mark.
    if (f.beatInLoop !== null && f.view) {
      this.viewport(f, H, loop, xOf);
    }

    if (f.beatInLoop !== null) {
      ctx.fillStyle = p.head;
      ctx.fillRect(Math.round(xOf(f.beatInLoop)), 0, 2, H);
    }
  }

  /** Paint the window rectangle from `viewportSegments`. */
  private viewport(
    f: OverviewFrame,
    H: number,
    loop: number,
    xOf: (beat: number) => number,
  ): void {
    const ctx = this.ctx;
    const p = f.palette;

    for (const [a, bEnd] of viewportSegments(f.beatInLoop!, f.view!, loop)) {
      const x0 = Math.round(xOf(a)) + 0.5;
      const x1 = Math.round(xOf(bEnd)) - 0.5;
      if (x1 <= x0) continue;
      ctx.fillStyle = p.head + VIEW_FILL;
      ctx.fillRect(x0, 0.5, x1 - x0, H - 1);
      ctx.strokeStyle = p.head + VIEW_EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, 0.5, x1 - x0, H - 1);
    }
  }
}
