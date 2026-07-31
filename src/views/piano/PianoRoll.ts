/**
 * Canvas renderer for the piano falling-note lane (Synthesia-style).
 *
 * Notes fall to a hit line that sits just above the on-screen keyboard; each
 * note's x-position comes from `keyGeometry`, the exact function the keyboard
 * uses, so a note lands on its key. Black-key notes are narrower and drawn
 * over the white columns. Chords are simply several notes sharing a `time`.
 *
 * Same shape as `PadLanes`: one class, driven by the trainer's single rAF
 * loop reading the transport clock. No Vue, no per-frame reactivity.
 */

import { RATING_COLOR } from "@/engine/types";
import type { LaneFrame, LaneRenderer } from "@/views/lane-frame";
import { countWhiteKeys, isWhiteKey, keyGeometry, pitchClass } from "./mapping";

const PX_PER_BEAT = 118;
/** Fraction of the lane below the hit line — the "already played" zone, so a
 *  note stays on screen after you strike it instead of vanishing instantly. */
const PAST_FRACTION = 0.34;

const WHITE_NOTE = "#37d0c4";
const BLACK_NOTE = "#2aa7c8";

export class PianoRoll implements LaneRenderer {
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

  draw(f: LaneFrame): void {
    const ctx = this.ctx;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, W, H);

    const low = f.lowNote;
    const high = f.highNote;
    const nWhite = Math.max(1, countWhiteKeys(low, high));
    const whiteWidth = W / nWhite;
    const hitY = Math.round(H * (1 - PAST_FRACTION));
    const pxPerSec = PX_PER_BEAT / f.secPerBeat;

    // black-key columns tinted darker, C boundaries marked — a lane backdrop
    for (let note = low; note <= high; note++) {
      const g = keyGeometry(note, low, whiteWidth);
      if (!isWhiteKey(note)) {
        ctx.fillStyle = "#0f1319";
        ctx.fillRect(g.x, 0, g.width, H);
      }
      if (pitchClass(note) === 0) {
        ctx.strokeStyle = "#ffffff10";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x + 0.5, 0);
        ctx.lineTo(g.x + 0.5, H);
        ctx.stroke();
      }
    }

    // the zone below the line is history — darken it so the eye stays above
    ctx.fillStyle = "#00000055";
    ctx.fillRect(0, hitY, W, H - hitY);

    // hit line
    ctx.strokeStyle = "#37d0c4";
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(W, hitY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!f.playing) {
      ctx.fillStyle = "#5a626d";
      ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Press Play to start the count-in", W / 2, hitY - 40);
      return;
    }

    // falling notes — black keys drawn last so they sit on top
    const draw = (blackPass: boolean) => {
      for (const inst of f.instances) {
        const black = !isWhiteKey(inst.lane);
        if (black !== blackPass) continue;
        if (inst.lane < low || inst.lane > high) continue;
        const y = hitY - (inst.time - f.now) * pxPerSec;
        if (y < -30 || y > H + 30) continue;
        const g = keyGeometry(inst.lane, low, whiteWidth);
        const w = g.width - 2;
        const h = 18;
        let col = black ? BLACK_NOTE : WHITE_NOTE;
        if (inst.resolved) col = inst.rating === "miss" ? "#4a2a2a" : RATING_COLOR[inst.rating!];
        this.roundRect(g.x + 1, y - h / 2, w, h, 4);
        ctx.fillStyle = col;
        ctx.globalAlpha = inst.resolved ? 0.85 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (!inst.resolved) {
          ctx.strokeStyle = "#ffffff33";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    };
    draw(false);
    draw(true);

    if (f.countIn) {
      const remaining = Math.ceil(f.countInBeats - f.countInBeat);
      const frac = f.countInBeat - Math.floor(f.countInBeat);
      ctx.fillStyle = "#0b0d11aa";
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
