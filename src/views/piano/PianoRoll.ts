/**
 * Canvas renderer for the piano falling-note lane.
 *
 * Vertical (Synthesia-style): pitch maps to an x-position via `keyGeometry` —
 * the exact function the on-screen keyboard uses — so a note lands on its key,
 * and notes fall onto a horizontal hit line.
 *
 * Horizontal (Melodics-style): each semitone is a row and notes scroll
 * right-to-left onto a vertical playhead, with the note name written on the
 * note itself. Chords are simply several notes sharing a `time`.
 *
 * Same shape as `PadLanes`: one class, driven by the trainer's single rAF
 * loop reading the transport clock. No Vue, no per-frame reactivity.
 */

import { RATING_COLOR } from "@/engine/types";
import type { LaneFrame, LaneRenderer } from "@/views/lane-frame";
import { countWhiteKeys, isWhiteKey, keyGeometry, noteName, pitchClass } from "@/engine/pitch";

const PX_PER_BEAT = 118;
/** Fraction of the lane behind the hit line — the "already played" zone, so a
 *  note stays on screen after you strike it instead of vanishing instantly. */
const PAST_FRACTION = 0.34;
/** Width of the note-name gutter in horizontal mode. */
const GUTTER = 46;

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

    const pxPerSec = PX_PER_BEAT / f.secPerBeat;
    if (f.orientation === "horizontal") this.drawHorizontal(f, W, H, pxPerSec);
    else this.drawVertical(f, W, H, pxPerSec);
  }

  // ------------------------------------------------------------- vertical

  private drawVertical(f: LaneFrame, W: number, H: number, pxPerSec: number): void {
    const ctx = this.ctx;
    const low = f.lowNote;
    const high = f.highNote;
    const whiteWidth = W / Math.max(1, countWhiteKeys(low, high));
    const hitY = Math.round(H * (1 - PAST_FRACTION));

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

    ctx.fillStyle = "#00000055";
    ctx.fillRect(0, hitY, W, H - hitY);

    ctx.strokeStyle = "#37d0c4";
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(W, hitY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!f.playing) return this.idle(W / 2, hitY - 40);

    // black keys last so they sit on top of their neighbours
    for (const blackPass of [false, true]) {
      for (const inst of f.instances) {
        const black = !isWhiteKey(inst.lane);
        if (black !== blackPass) continue;
        if (inst.lane < low || inst.lane > high) continue;
        const y = hitY - (inst.time - f.now) * pxPerSec;
        if (y < -30 || y > H + 30) continue;
        const g = keyGeometry(inst.lane, low, whiteWidth);
        const w = g.width - 2;
        this.note(g.x + 1, y - 9, w, 18, 4, inst, black ? BLACK_NOTE : WHITE_NOTE);
        // name fits only on wider keys
        if (w >= 26) this.label(noteName(inst.lane), g.x + 1 + w / 2, y, 9);
      }
    }

    this.countIn(f, W, H);
  }

  // ----------------------------------------------------------- horizontal

  private drawHorizontal(f: LaneFrame, W: number, H: number, pxPerSec: number): void {
    const ctx = this.ctx;
    const low = f.lowNote;
    const high = f.highNote;
    const rows = high - low + 1;
    const rowH = H / rows;
    const trackX = GUTTER;
    const trackW = W - GUTTER;
    const hitX = trackX + Math.round(trackW * PAST_FRACTION);
    /** Row 0 is the highest pitch, so pitch rises up the screen. */
    const rowY = (pitch: number) => (high - pitch) * rowH;

    for (let note = low; note <= high; note++) {
      const y = rowY(note);
      if (!isWhiteKey(note)) {
        ctx.fillStyle = "#0f1319";
        ctx.fillRect(trackX, y, trackW, rowH);
      }
      if (pitchClass(note) === 0) {
        ctx.strokeStyle = "#ffffff10";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(trackX, Math.round(y) + 0.5);
        ctx.lineTo(W, Math.round(y) + 0.5);
        ctx.stroke();
        // octave marker in the gutter
        if (rowH >= 9) {
          ctx.fillStyle = "#5a626d";
          ctx.font = "600 9px ui-monospace, SFMono-Regular, Menlo, monospace";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(noteName(note), GUTTER - 8, y + rowH / 2);
          ctx.textBaseline = "alphabetic";
        }
      }
    }

    ctx.fillStyle = "#00000055";
    ctx.fillRect(trackX, 0, hitX - trackX, H);

    ctx.strokeStyle = "#37d0c4";
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hitX, 0);
    ctx.lineTo(hitX, H);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!f.playing) return this.idle(trackX + trackW / 2, H / 2);

    // The blob is deliberately taller than a row so the note name fits — rows
    // get thin over a three-octave range. Neighbours overlap slightly, which
    // is how Melodics reads too.
    const noteW = 34;
    const h = Math.max(16, Math.min(rowH * 1.6, 26));
    for (const inst of f.instances) {
      if (inst.lane < low || inst.lane > high) continue;
      const x = hitX + (inst.time - f.now) * pxPerSec;
      if (x < trackX - 50 || x > W + 50) continue;
      const y = rowY(inst.lane) + (rowH - h) / 2;
      this.note(
        x - noteW / 2,
        y,
        noteW,
        h,
        h / 2,
        inst,
        isWhiteKey(inst.lane) ? WHITE_NOTE : BLACK_NOTE,
      );
      this.label(noteName(inst.lane), x, y + h / 2, Math.min(10, h - 4));
    }

    this.countIn(f, W, H);
  }

  // ---------------------------------------------------------------- parts

  private note(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    inst: LaneFrame["instances"][number],
    baseColor: string,
  ): void {
    const ctx = this.ctx;
    this.roundRect(x, y, w, h, r);
    ctx.fillStyle = inst.resolved ? RATING_COLOR[inst.rating!] : baseColor;
    ctx.globalAlpha = inst.resolved ? 0.85 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!inst.resolved) {
      ctx.strokeStyle = "#ffffff33";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** The note's name, written on the note so you know which key to press. */
  private label(text: string, cx: number, cy: number, size: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#08131a";
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy + 0.5);
    ctx.textBaseline = "alphabetic";
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
