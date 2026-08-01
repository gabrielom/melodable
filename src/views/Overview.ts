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
 */

import type { TargetNote } from "@/engine/scoring";
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
  palette: Palette;
  theme: Theme;
}

/** Note mark, px. */
const MARK = 3;
/** Inset from the strip's top and bottom to the outer bands. */
const BAND_PAD = 4;
/** How many vertical bands lanes are folded onto. */
const BANDS = 3;

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

    if (f.beatInLoop !== null) {
      ctx.fillStyle = p.head;
      ctx.fillRect(Math.round(xOf(f.beatInLoop)), 0, 2, H);
    }
  }
}
