/**
 * Canvas renderer for the pads falling-note lane.
 *
 * Framework-free: a single class the Vue side calls `draw()` on from one
 * requestAnimationFrame loop that reads the transport clock. Vue never
 * re-renders per frame (see build_plan.html §13).
 *
 * Two orientations share this code. Vertical: lanes are columns and notes
 * fall onto a horizontal hit line. Horizontal (Melodics-style): lanes are
 * rows behind a name gutter and notes scroll right-to-left onto a vertical
 * playhead. Only the axis mapping differs — timing, colours and the
 * already-played zone are identical.
 */

import { RATING_COLOR } from "@/engine/types";
import { PADS, padPosition } from "@/engine/gm";
import type { LaneFrame, LaneRenderer } from "@/views/lane-frame";

const PX_PER_BEAT = 118;
/** Fraction of the lane behind the hit line — the "already played" zone, so a
 *  note stays on screen after you strike it instead of vanishing instantly. */
const PAST_FRACTION = 0.28;
/** Width of the lane-name gutter in horizontal mode. */
const GUTTER = 150;

const padColor = (i: number, a = 1) => `hsla(${(i * 47) % 360}, 55%, 60%, ${a})`;

export class PadLanes implements LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Gutter hit boxes from the last horizontal draw, for mouse triggering. */
  private gutterHits: Array<{ pad: number; y0: number; y1: number }> = [];

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
    const pxPerSec = PX_PER_BEAT / f.secPerBeat;
    if (f.orientation === "horizontal") this.drawHorizontal(f, W, H, lanes, pxPerSec);
    else this.drawVertical(f, W, H, lanes, pxPerSec);
  }

  // ------------------------------------------------------------- vertical

  private drawVertical(f: LaneFrame, W: number, H: number, lanes: number[], pxPerSec: number): void {
    const ctx = this.ctx;
    const padL = 6;
    const laneGap = 6;
    const laneW = (W - padL * 2 - laneGap * (lanes.length - 1)) / lanes.length;
    const hitY = Math.round(H * (1 - PAST_FRACTION));

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

    ctx.fillStyle = "#00000055";
    ctx.fillRect(0, hitY, W, H - hitY);

    ctx.strokeStyle = "#37d0c4";
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padL, hitY);
    ctx.lineTo(W - padL, hitY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!f.playing) return this.idle(W / 2, hitY - 40);

    for (const inst of f.instances) {
      const li = lanes.indexOf(inst.lane);
      if (li < 0) continue;
      const y = hitY - (inst.time - f.now) * pxPerSec;
      if (y < -30 || y > H + 30) continue;
      const x = padL + li * (laneW + laneGap);
      this.note(x + 5, y - 10, laneW - 10, 20, 6, inst.resolved, inst.rating, padColor(inst.lane, 0.95));
    }

    this.countIn(f, W, H);
  }

  // ----------------------------------------------------------- horizontal

  private drawHorizontal(
    f: LaneFrame,
    W: number,
    H: number,
    lanes: number[],
    pxPerSec: number,
  ): void {
    const ctx = this.ctx;
    const gap = 5;
    const laneH = (H - gap * (lanes.length - 1)) / lanes.length;
    const trackX = GUTTER;
    const trackW = W - GUTTER;
    // Playhead sits a little in from the left; notes arrive from the right.
    const hitX = trackX + Math.round(trackW * PAST_FRACTION);

    this.gutterHits = [];
    lanes.forEach((pad, li) => {
      const y = li * (laneH + gap);
      this.gutterHits.push({ pad, y0: y, y1: y + laneH });
      // lane row
      ctx.fillStyle = "#15181e";
      ctx.fillRect(trackX, y, trackW, laneH);
      // hit target
      ctx.fillStyle = padColor(pad, 0.14);
      ctx.fillRect(hitX - 3, y, 6, laneH);
      ctx.strokeStyle = padColor(pad, 0.5);
      ctx.lineWidth = 1;
      ctx.strokeRect(hitX - 12.5, y + 0.5, 24, laneH - 1);

      // gutter: the pad's place on the controller, then its name
      ctx.fillStyle = "#1a1e24";
      this.roundRect(2, y + 1, GUTTER - 10, laneH - 2, 8);
      ctx.fill();
      ctx.strokeStyle = padColor(pad, 0.45);
      ctx.lineWidth = 1;
      ctx.stroke();

      const grid = this.miniGrid(pad, f.padLayout, 11, y + laneH / 2);
      ctx.fillStyle = padColor(pad, 0.95);
      ctx.font = "700 11.5px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        PADS[pad].name.toUpperCase(),
        grid + 9,
        y + laneH / 2,
        GUTTER - grid - 22,
      );
      ctx.textBaseline = "alphabetic";
    });

    // already-played zone, left of the playhead
    ctx.fillStyle = "#00000055";
    ctx.fillRect(trackX, 0, hitX - trackX, H);

    ctx.strokeStyle = "#37d0c4";
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hitX, 0);
    ctx.lineTo(hitX, H);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!f.playing) return this.idle(trackX + trackW / 2, H / 2);

    const noteW = Math.min(26, Math.max(14, laneH * 0.7));
    for (const inst of f.instances) {
      const li = lanes.indexOf(inst.lane);
      if (li < 0) continue;
      const x = hitX + (inst.time - f.now) * pxPerSec;
      if (x < trackX - 40 || x > W + 40) continue;
      const y = li * (laneH + gap);
      const h = Math.max(10, laneH - 8);
      this.note(
        x - noteW / 2,
        y + (laneH - h) / 2,
        noteW,
        h,
        5,
        inst.resolved,
        inst.rating,
        padColor(inst.lane, 0.95),
      );
    }

    this.countIn(f, W, H);
  }

  // ---------------------------------------------------------------- parts

  /**
   * The controller grid with this pad's cell lit, drawn from `cx` at vertical
   * centre `cy`. Returns the x the grid ends at, so the name can follow it.
   */
  private miniGrid(pad: number, layout: LaneFrame["padLayout"], cx: number, cy: number): number {
    const ctx = this.ctx;
    const p = padPosition(pad, layout);
    const cell = 3;
    const step = cell + 1.5;
    const gw = p.cols * step - 1.5;
    const gh = p.rows * step - 1.5;
    const x0 = cx;
    const y0 = cy - gh / 2;
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.cols; c++) {
        const on = r === p.row && c === p.col;
        ctx.fillStyle = on ? padColor(pad, 1) : "#2b313a";
        ctx.fillRect(x0 + c * step, y0 + r * step, cell, cell);
      }
    }
    return x0 + gw;
  }

  /** Pad under a point in the gutter, for click-to-play. Null elsewhere. */
  laneAt(x: number, y: number): number | null {
    if (x > GUTTER) return null;
    for (const h of this.gutterHits) if (y >= h.y0 && y <= h.y1) return h.pad;
    return null;
  }

  private note(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    resolved: boolean,
    rating: LaneFrame["instances"][number]["rating"],
    baseColor: string,
  ): void {
    const ctx = this.ctx;
    this.roundRect(x, y, w, h, r);
    ctx.fillStyle = resolved ? RATING_COLOR[rating!] : baseColor;
    ctx.globalAlpha = resolved ? 0.85 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!resolved) {
      ctx.strokeStyle = "#ffffff33";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private idle(cx: number, cy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#5a626d";
    ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Press Play to start the count-in", cx, cy);
  }

  private countIn(f: LaneFrame, W: number, H: number): void {
    if (!f.countIn) return;
    const ctx = this.ctx;
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
