/**
 * Canvas renderer for the pads note lane.
 *
 * Framework-free: a single class the Vue side calls `draw()` on from one
 * requestAnimationFrame loop that reads the transport clock. Vue never
 * re-renders per frame (invariant 6).
 *
 * Horizontal is the designed view: lanes are rows behind a 104px label
 * gutter, notes scroll right-to-left onto a playhead a fixed 96px into the
 * note area, and the strip behind the playhead is the "already played" zone
 * so a note stays visible after you strike it. Vertical keeps the same
 * palette and note size with the axes swapped — lanes become columns and
 * notes fall onto a horizontal hit line.
 */

import { ledOf, ledUpcoming, RADIUS } from "@/engine/theme";
import { PADS } from "@/engine/gm";
import type { LaneFrame, LaneRenderer } from "@/views/lane-frame";

/** Canvas takes a font shorthand, not a CSS variable — mirrors `--mono`. */
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const PX_PER_BEAT = 118;
/** Note square, px — the design's fixed size in both orientations. */
const NOTE = 20;
/** Label gutter in horizontal mode. */
const GUTTER = 104;
/** The already-played strip: fixed px into the note area, not a fraction. */
const ELAPSED = 96;
/** Hairline between lane rows. */
const LANE_GAP = 1;
/** The LED stripe down the leading edge of the gutter. */
const LED_EDGE = 3;
/** Fraction of the lane behind the hit line in vertical mode. */
const PAST_FRACTION = 0.28;

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
    // The stack's background shows through the 1px gaps as the hairline.
    ctx.fillStyle = f.theme === "light" ? f.palette.hair : f.palette.win;
    ctx.fillRect(0, 0, W, H);

    const lanes = f.padLanes.length ? f.padLanes : [12];
    const pxPerSec = PX_PER_BEAT / f.secPerBeat;
    if (f.orientation === "horizontal") this.drawHorizontal(f, W, H, lanes, pxPerSec);
    else this.drawVertical(f, W, H, lanes, pxPerSec);
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
    const p = f.palette;
    const n = lanes.length;
    const laneH = (H - LANE_GAP * (n - 1)) / n;
    const trackX = GUTTER;
    const trackW = Math.max(1, W - GUTTER);
    const hitX = trackX + ELAPSED;
    /** A lane is dimmed when it has nothing left to play on screen. */
    const busy = new Set(f.instances.map((i) => i.lane));

    this.gutterHits = [];
    lanes.forEach((pad, li) => {
      const y = li * (laneH + LANE_GAP);
      const led = ledOf(p, li);
      this.gutterHits.push({ pad, y0: y, y1: y + laneH });

      // gutter — LED stripe on the leading edge, then the label
      ctx.fillStyle = p.gutter;
      ctx.fillRect(0, y, GUTTER, laneH);
      ctx.fillStyle = led;
      ctx.fillRect(0, y, LED_EDGE, laneH);
      if (f.theme === "light") {
        ctx.fillStyle = p.hair;
        ctx.fillRect(GUTTER - 1, y, 1, laneH);
      }

      ctx.fillStyle = f.playing && !busy.has(pad) ? p.txt2 : p.txt;
      ctx.font = `500 8.5px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      this.tracked(PADS[pad].name.toUpperCase(), 9 + LED_EDGE, y + laneH / 2, 1.1, GUTTER - 22);

      // note bed, then the already-played strip and the playhead
      ctx.fillStyle = p.lane;
      ctx.fillRect(trackX, y, trackW, laneH);
      ctx.fillStyle = p.elapsed;
      ctx.fillRect(trackX, y, Math.min(ELAPSED, trackW), laneH);
    });

    ctx.textBaseline = "alphabetic";

    if (hitX < W) {
      ctx.fillStyle = p.head;
      ctx.fillRect(hitX, 0, 2, H);
    }

    if (!f.playing) return this.idle(f, trackX + trackW / 2, H / 2);

    // Clip to the note area: a note scrolling out on the left is half over the
    // gutter by the time its centre reaches it, and would paint across the label.
    ctx.save();
    ctx.beginPath();
    ctx.rect(trackX, 0, trackW, H);
    ctx.clip();

    const size = Math.min(NOTE, Math.max(6, laneH - 4));
    for (const inst of f.instances) {
      const li = lanes.indexOf(inst.lane);
      if (li < 0) continue;
      const x = hitX + (inst.time - f.now) * pxPerSec;
      if (x < trackX - NOTE || x > W + NOTE) continue;
      const y = li * (laneH + LANE_GAP);
      this.note(
        f,
        x - size / 2,
        y + (laneH - size) / 2,
        size,
        size,
        inst.resolved ? p.rating[inst.rating!] : ledUpcoming(p, li),
      );
    }
    ctx.restore();

    this.countIn(f, W, H);
  }

  // ------------------------------------------------------------- vertical

  private drawVertical(f: LaneFrame, W: number, H: number, lanes: number[], pxPerSec: number): void {
    const ctx = this.ctx;
    const p = f.palette;
    const n = lanes.length;
    const laneW = (W - LANE_GAP * (n - 1)) / n;
    const hitY = Math.round(H * (1 - PAST_FRACTION));

    lanes.forEach((pad, li) => {
      const x = li * (laneW + LANE_GAP);
      const led = ledOf(p, li);

      ctx.fillStyle = p.lane;
      ctx.fillRect(x, 0, laneW, H);
      // already-played zone below the hit line
      ctx.fillStyle = p.elapsed;
      ctx.fillRect(x, hitY, laneW, H - hitY);
      // the lane's LED reads as a header band, standing in for the gutter
      ctx.fillStyle = led;
      ctx.fillRect(x, 0, laneW, LED_EDGE);

      ctx.fillStyle = p.txt;
      ctx.font = `500 8.5px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.trackedCentered(PADS[pad].name.toUpperCase(), x + laneW / 2, LED_EDGE + 10, 1.1, laneW - 8);
    });

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = p.head;
    ctx.fillRect(0, hitY, W, 2);

    if (!f.playing) return this.idle(f, W / 2, hitY - 40);

    const size = Math.min(NOTE, Math.max(6, laneW - 6));
    for (const inst of f.instances) {
      const li = lanes.indexOf(inst.lane);
      if (li < 0) continue;
      const y = hitY - (inst.time - f.now) * pxPerSec;
      if (y < -NOTE || y > H + NOTE) continue;
      const x = li * (laneW + LANE_GAP);
      this.note(
        f,
        x + (laneW - size) / 2,
        y - size / 2,
        size,
        size,
        inst.resolved ? p.rating[inst.rating!] : ledUpcoming(p, li),
      );
    }

    this.countIn(f, W, H);
  }

  // ---------------------------------------------------------------- parts

  /** Pad under a point in the gutter, for click-to-play. Null elsewhere. */
  laneAt(x: number, y: number): number | null {
    if (x > GUTTER) return null;
    for (const h of this.gutterHits) if (y >= h.y0 && y <= h.y1) return h.pad;
    return null;
  }

  private note(f: LaneFrame, x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx;
    const r = RADIUS[f.theme].note;
    ctx.fillStyle = color;
    if (r <= 0) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    this.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  private idle(f: LaneFrame, cx: number, cy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = f.palette.txt3;
    ctx.font = `500 8.5px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.trackedCentered("PRESS START FOR THE COUNT-IN", cx, cy, 1.1, Infinity);
    ctx.textBaseline = "alphabetic";
  }

  private countIn(f: LaneFrame, W: number, H: number): void {
    if (!f.countIn) return;
    const ctx = this.ctx;
    const p = f.palette;
    const remaining = Math.ceil(f.countInBeats - f.countInBeat);
    const frac = f.countInBeat - Math.floor(f.countInBeat);
    ctx.fillStyle = f.theme === "light" ? "#cccccc99" : "#0e0e0f99";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = p.head;
    ctx.globalAlpha = f.reducedMotion ? 1 : 1 - frac * 0.6;
    ctx.font = `500 56px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(remaining), W / 2, H / 2 - 8);
    ctx.globalAlpha = 1;
    ctx.font = `500 8.5px ${MONO}`;
    ctx.fillStyle = p.txt3;
    this.trackedCentered("COUNT-IN", W / 2, H / 2 + 30, 1.2, Infinity);
    ctx.textBaseline = "alphabetic";
  }

  /**
   * Canvas has no letter-spacing, and the design leans on it for every label.
   * Draws left-aligned from `x`, clipping to `maxWidth` with an ellipsis.
   */
  private tracked(text: string, x: number, y: number, spacing: number, maxWidth: number): void {
    const ctx = this.ctx;
    const width = (s: string) => ctx.measureText(s).width + spacing * Math.max(0, s.length - 1);
    let s = text;
    if (width(s) > maxWidth) {
      while (s.length > 1 && width(s + "…") > maxWidth) s = s.slice(0, -1);
      s += "…";
    }
    let cx = x;
    for (const ch of s) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + spacing;
    }
  }

  /** Same, centred on `cx`. */
  private trackedCentered(
    text: string,
    cx: number,
    y: number,
    spacing: number,
    maxWidth: number,
  ): void {
    const ctx = this.ctx;
    const prev = ctx.textAlign;
    ctx.textAlign = "left";
    const width = (s: string) => ctx.measureText(s).width + spacing * Math.max(0, s.length - 1);
    let s = text;
    if (width(s) > maxWidth) {
      while (s.length > 1 && width(s + "…") > maxWidth) s = s.slice(0, -1);
      s += "…";
    }
    this.tracked(s, cx - width(s) / 2, y, spacing, Infinity);
    ctx.textAlign = prev;
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
