/**
 * The run at a glance: a 33px strip above the lane holding every note of the
 * whole run — the pattern laid out once per repeat, end to end.
 *
 * It is a true miniature, not a decoration: one dot per note, in its lane's
 * own row, at its position in the run, in the colour it carries in the lanes
 * below. A note inside the viewport rectangle sits directly above itself in
 * the lane area.
 *
 * Three layers, bottom to top: the viewport rectangle marking the slice the
 * lanes are showing, then the note dots, then the strip's own playhead. The
 * dots are never veiled — this is a minimap, and all of it has to read.
 */

import type { TargetNote } from "@/engine/scoring";
import type { VisibleWindow } from "@/views/lane-frame";
import { hueOf, RADIUS, type Palette, type Theme } from "@/engine/theme";
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
  beatsPerBar: number;
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

/** Note dot, px. Small enough that a thin row never becomes a solid line. */
const DOT = 2;
/**
 * Gap kept clear above the first row of dots and below the last.
 *
 * The rows are spread across what is left rather than each sitting centred in
 * an equal slice, so the outermost lanes never touch the strip's border — the
 * top row used to sit 1px in and the bottom one flush against the edge, which
 * read as clipping. The spacing between rows falls out of the same span, so it
 * adapts to however many lanes a lesson has: eight in pads, three or four in
 * the piano views.
 */
const ROW_INSET = 3;

/**
 * Top edge of a lane's row of dots, in a strip `height` tall.
 *
 * Rows are spread between the two insets rather than each centred in an equal
 * slice: the first sits exactly `ROW_INSET` from the top and the last ends
 * exactly `ROW_INSET` from the bottom, whatever the lane count. A single lane
 * has no span to spread over, so it centres.
 *
 * The inset gives way before the dot does: a strip too short to hold both
 * margins keeps the dots inside itself rather than hanging them over the edge.
 * That only bites while the canvas is being sized, but a draw can land there.
 */
export function rowTop(row: number, rows: number, height: number): number {
  const inset = Math.min(ROW_INSET, Math.max(0, (height - DOT) / 2));
  const span = Math.max(0, height - inset * 2 - DOT);
  if (rows <= 1) return inset + span / 2;
  return inset + (Math.min(row, rows - 1) / (rows - 1)) * span;
}
/** Downbeat tick ink — the same values the lane's separators use. */
const TICK_INK = { dark: "#ffffff1f", light: "#00000026" } as const;

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

    // Downbeat ticks, from the same anchor as the lane's tempo grid. Bars
    // only — evenly spaced thirds implied bars that were not there.
    const bpb = Math.max(1, f.beatsPerBar);
    const bars = Math.ceil(run / bpb);
    // Thin out when a bar would be under ~3px, so the strip can't become hatching.
    const stride = Math.max(1, Math.ceil(bars / (W / 3)));
    ctx.fillStyle = TICK_INK[f.theme];
    for (let b = stride; b < bars; b += stride) {
      ctx.fillRect(Math.round(xOf(b * bpb)), 0, 1, H);
    }

    // Viewport rectangle, under the dots: neutral, so it can't be mistaken
    // for the playhead or for a rating.
    if (f.runBeat !== null && f.view) {
      const span = viewportSpan(f.runBeat, f.view, run);
      if (span) {
        const x0 = Math.round(xOf(span[0])) + 0.5;
        const x1 = Math.round(xOf(span[1])) - 0.5;
        if (x1 > x0) {
          ctx.fillStyle = p.viewFill;
          ctx.fillRect(x0, 0.5, x1 - x0, H - 1);
          ctx.strokeStyle = p.viewEdge;
          ctx.lineWidth = 1;
          ctx.strokeRect(x0, 0.5, x1 - x0, H - 1);
        }
      }
    }

    this.dots(f, W, H, loop, repeats, xOf);

    if (f.runBeat !== null) {
      ctx.fillStyle = p.head;
      ctx.fillRect(Math.round(xOf(Math.min(f.runBeat, run))), 0, 2, H);
    }
  }

  /**
   * One dot per note, in its lane's row. Rows divide the strip's height by the
   * lane count, so the strip's vertical order matches the lane stack's.
   */
  private dots(
    f: OverviewFrame,
    _W: number,
    H: number,
    loop: number,
    repeats: number,
    xOf: (beat: number) => number,
  ): void {
    const ctx = this.ctx;
    const p = f.palette;

    // Piano maps pitch to a row, highest at the top so the strip reads the
    // way the roll does; pads map the lane's screen position.
    const piano = f.instrument === "piano";
    const order = piano
      ? [...new Set(f.targets.map((t) => t.lane))].sort((a, b) => b - a)
      : f.padLanes;
    const rows = Math.max(1, order.length);
    const rowOf = (lane: number) => {
      const i = order.indexOf(lane);
      return i < 0 ? rows - 1 : i;
    };
    /**
     * Hues are assigned low-to-high for piano, but the rows run high-to-low,
     * so the two indices are mirror images. Pads have only the one order.
     */
    const hueIndex = (row: number) => (piano ? rows - 1 - row : row);

    for (let r = 0; r < repeats; r++) {
      f.targets.forEach((t, i) => {
        const rating = f.ratings.get(`${r}:${i}`);
        const row = rowOf(t.lane);
        // Graded notes wear their rating; everything still to come wears its
        // lane's dimmed hue. The same rule, and the same values, as the lanes
        // below — the strip is a miniature of them, not its own language.
        ctx.fillStyle = rating
          ? p.rating[rating]
          : hueOf(p, f.instrument, hueIndex(row)).dim;
        ctx.fillRect(Math.round(xOf(r * loop + t.beat)), Math.round(rowTop(row, rows, H)), DOT, DOT);
      });
    }
  }
}
