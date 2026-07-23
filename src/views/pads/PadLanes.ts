/**
 * Canvas renderer for the pads falling-note lane.
 *
 * Framework-free: a single class the Vue side calls `draw()` on from one
 * requestAnimationFrame loop that reads the transport clock. Vue never
 * re-renders per frame (see build_plan.html §13).
 *
 * Only the lanes the current lesson uses are shown. Notes fall to a
 * horizontal hit line; resolved notes take their rating colour.
 */

import { RATING_COLOR } from "@/engine/types";
import { PADS } from "@/engine/gm";
import type { LaneFrame, LaneRenderer } from "@/views/lane-frame";

const PX_PER_BEAT = 118;
const HIT_FROM_BOTTOM = 54;

const padColor = (i: number, a = 1) => `hsla(${(i * 47) % 360}, 55%, 60%, ${a})`;

export class PadLanes implements LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  /** Match the backing store to the element's CSS size (call on resize). */
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

  draw(f: LaneFrame): void {
    const ctx = this.ctx;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#111318";
    ctx.fillRect(0, 0, W, H);

    const lanes = f.padLanes.length ? f.padLanes : [12];
    const padL = 6;
    const laneGap = 6;
    const laneW = (W - padL * 2 - laneGap * (lanes.length - 1)) / lanes.length;
    const hitY = H - HIT_FROM_BOTTOM;
    const pxPerSec = PX_PER_BEAT / f.secPerBeat;

    // lane backgrounds, hit targets, labels
    lanes.forEach((pad, li) => {
      const x = padL + li * (laneW + laneGap);
      ctx.fillStyle = "#15181e";
      ctx.fillRect(x, 0, laneW, H);
      ctx.fillStyle = padColor(pad, 0.14);
      ctx.fillRect(x, hitY - 3, laneW, 6);
      ctx.strokeStyle = padColor(pad, 0.5);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, hitY - 12, laneW - 1, 24);
      ctx.fillStyle = padColor(pad, 0.85);
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(PADS[pad].name.toUpperCase(), x + laneW / 2, 16);
    });

    // hit line
    ctx.strokeStyle = "#37d0c4";
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padL, hitY);
    ctx.lineTo(W - padL, hitY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!f.playing) {
      ctx.fillStyle = "#5a626d";
      ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Press Play to start the count-in", W / 2, hitY - 40);
      return;
    }

    // falling notes
    for (const inst of f.instances) {
      const li = lanes.indexOf(inst.lane);
      if (li < 0) continue;
      const y = hitY - (inst.time - f.now) * pxPerSec;
      if (y < -30 || y > H + 30) continue;
      const x = padL + li * (laneW + laneGap);
      const w = laneW - 10;
      const h = 20;
      let col = padColor(inst.lane, 0.95);
      if (inst.resolved) col = inst.rating === "miss" ? "#4a2a2a" : RATING_COLOR[inst.rating!];
      this.roundRect(x + 5, y - h / 2, w, h, 6);
      ctx.fillStyle = col;
      ctx.globalAlpha = inst.resolved ? 0.55 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!inst.resolved) {
        ctx.strokeStyle = "#ffffff33";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // count-in overlay: 4 · 3 · 2 · 1
    if (f.countIn) {
      const remaining = Math.ceil(f.countInBeats - f.countInBeat);
      const frac = f.countInBeat - Math.floor(f.countInBeat);
      ctx.fillStyle = "#0e1013aa";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffb340";
      ctx.globalAlpha = f.reducedMotion ? 1 : 1 - frac * 0.6;
      ctx.font = "700 64px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(remaining), W / 2, H / 2 - 10);
      ctx.globalAlpha = 1;
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#8a929e";
      ctx.fillText("COUNT-IN", W / 2, H / 2 + 34);
      ctx.textBaseline = "alphabetic";
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
