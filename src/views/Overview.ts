/**
 * The lesson at a glance: every note of the loop laid out across the strip,
 * with a playhead sweeping it. Sits above the lane so you can see the shape
 * of the whole pattern and where you are in it — the equivalent of the
 * overview bar in Melodics, scaled to our looping lessons.
 *
 * Draws the lesson's *targets* (what to play), not live instances, so it is
 * stable while the loop repeats. Marks are tinted once graded.
 */

import type { TargetNote } from "@/engine/scoring";
import { RATING_COLOR } from "@/engine/types";
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
}

const padColor = (i: number, a = 1) => `hsla(${(i * 47) % 360}, 55%, 60%, ${a})`;

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
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, W, H);

    const padX = 8;
    const inner = W - padX * 2;
    const loop = Math.max(1, f.loopBeats);
    const xOf = (beat: number) => padX + (beat / loop) * inner;

    // bar and beat lines
    for (let b = 0; b <= loop; b++) {
      const isBar = b % 4 === 0;
      ctx.strokeStyle = isBar ? "#ffffff1c" : "#ffffff0c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(xOf(b)) + 0.5, 3);
      ctx.lineTo(Math.round(xOf(b)) + 0.5, H - 3);
      ctx.stroke();
    }

    // one row per lane, tallest lane at the bottom for pads; pitch for piano
    const rowOf = (lane: number): number => {
      if (f.instrument === "piano") {
        const span = Math.max(1, f.highNote - f.lowNote);
        return 1 - (lane - f.lowNote) / span;
      }
      const i = f.padLanes.indexOf(lane);
      const n = Math.max(1, f.padLanes.length);
      return f.padLanes.length ? i / n : 0;
    };

    const top = 6;
    const usable = H - 12;
    const markH = f.instrument === "piano" ? 3 : Math.max(3, usable / Math.max(1, f.padLanes.length) - 2);

    f.targets.forEach((t, i) => {
      const x = xOf(t.beat);
      const y = top + rowOf(t.lane) * (usable - markH);
      const rating = f.ratings.get(i);
      ctx.fillStyle = rating
        ? RATING_COLOR[rating]
        : f.instrument === "piano"
          ? "#37d0c4"
          : padColor(t.lane, 0.9);
      ctx.globalAlpha = rating ? 0.95 : 0.75;
      ctx.fillRect(Math.round(x) - 1, Math.round(y), 3, Math.round(markH));
      ctx.globalAlpha = 1;
    });

    // playhead
    if (f.beatInLoop !== null) {
      const x = xOf(f.beatInLoop);
      ctx.fillStyle = "#ffb340";
      ctx.fillRect(Math.round(x) - 1, 0, 2, H);
      ctx.beginPath();
      ctx.moveTo(x - 4, 0);
      ctx.lineTo(x + 4, 0);
      ctx.lineTo(x, 6);
      ctx.closePath();
      ctx.fill();
    }
  }
}
