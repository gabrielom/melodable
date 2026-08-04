/**
 * Canvas renderer for the pads note lane.
 *
 * Framework-free: a single class the Vue side calls `draw()` on from one
 * requestAnimationFrame loop that reads the transport clock. Vue never
 * re-renders per frame (invariant 6).
 *
 * Both orientations show the same five bars of music and share every rule:
 *
 * - The playhead is **centred** in the note field, one continuous line across
 *   the whole stack, painted above the lane separators.
 * - **Ahead of it** notes carry their lane's LED at full strength — what is
 *   coming has to be the most readable thing on screen.
 * - **Behind it** they carry the colour they were graded, keep travelling, and
 *   dissolve into a veil as they reach the far edge. They never vanish at the
 *   playhead.
 * - A tempo grid rules the field: a heavy line on each downbeat, hairlines on
 *   beats and eighths. It sits under the notes — it is orientation, not
 *   content.
 */

import { ledOf, RADIUS } from "@/engine/theme";
import { PADS, padPosition } from "@/engine/gm";
import {
  paintCountIn,
  paintGrid,
  paintVeil,
  pxPerBeat,
  SEPARATOR_INK,
} from "@/views/lane-geometry";
import type { LaneFrame, LaneRenderer, VisibleWindow } from "@/views/lane-frame";

/** Canvas takes a font shorthand, not a CSS variable — mirrors `--mono`. */
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '"Geist", ui-sans-serif, system-ui, sans-serif';

/** Label gutter (horizontal). Wide enough to seat the controller mini-grid. */
const GUTTER = 128;
/** Label tile under each column (vertical). */
const TILE_H = 42;
/** The lane's LED stripe, on the gutter's outer edge in both orientations. */
const LED_EDGE = 3;
/** Hairline between lanes. */
const LANE_GAP = 1;
/** Note block, horizontal. */
const NOTE_W = 28;
const NOTE_H = 28;
/** Note block when notes fall: a pill inset from the column's edges. */
const NOTE_V = 16;
const NOTE_V_INSET = 12;
/**
 * Ceiling on that pill's width. A two-lane lesson gets half the window per
 * column, and a note that simply insets from the column's edges becomes a
 * 600px slab — the lane reads as a filled bar rather than as a note. Past this
 * the note stays put and centres in its column instead of growing with it.
 */
const NOTE_V_MAX_W = 144;
/** Vertical: distance from the bottom of the note field to the hit line. */
const HIT_FROM_BOTTOM = 76;

/** Controller mini-grid: 3px cells, 1px gaps. */
const CELL = 3;
const CELL_STEP = CELL + 1;
/** Gap between the mini-grid and the drum name. */
const MINI_GAP = 9;


export class PadLanes implements LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Gutter hit boxes from the last draw, for mouse triggering. */
  private gutterHits: Array<{ pad: number; x0: number; x1: number; y0: number; y1: number }> = [];
  /** Timeline on screen at the last draw, for the overview's viewport rect. */
  private window: VisibleWindow = { behind: 0, ahead: 0 };

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

  visibleBeats(): VisibleWindow {
    return this.window;
  }

  draw(f: LaneFrame): void {
    const ctx = this.ctx;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = f.palette.lane;
    ctx.fillRect(0, 0, W, H);

    const lanes = f.padLanes.length ? f.padLanes : [12];
    if (f.orientation === "horizontal") this.drawHorizontal(f, W, H, lanes);
    else this.drawVertical(f, W, H, lanes);
  }

  // ----------------------------------------------------------- horizontal

  private drawHorizontal(f: LaneFrame, W: number, H: number, lanes: number[]): void {
    const ctx = this.ctx;
    const p = f.palette;
    const n = lanes.length;
    const laneH = (H - LANE_GAP * (n - 1)) / n;
    const trackX = GUTTER;
    const trackW = Math.max(1, W - GUTTER);
    // Centred: half the visible span behind the playhead, half ahead.
    const hitX = trackX + trackW / 2;
    const beatPx = pxPerBeat(trackW, f.beatsPerBar);
    const halfBeats = trackW / 2 / beatPx;
    this.window = { behind: halfBeats, ahead: halfBeats };

    const xOfBeat = (beat: number) => hitX + (beat - f.absBeat) * beatPx;
    const busy = new Set(f.instances.map((i) => i.lane));

    this.gutterHits = [];
    lanes.forEach((pad, li) => {
      const y = li * (laneH + LANE_GAP);
      this.gutterHits.push({ pad, x0: 0, x1: GUTTER, y0: y, y1: y + laneH });

      this.gutter(f, 0, y, GUTTER, laneH, pad, li, "horizontal", busy.has(pad));

      // note bed, then the tempo grid ruled over it
      ctx.fillStyle = p.lane;
      ctx.fillRect(trackX, y, trackW, laneH);
    });

    paintGrid(ctx, {
      theme: f.theme,
      instrument: "pads",
      from: f.absBeat - this.window.behind,
      to: f.absBeat + this.window.ahead,
      beatsPerBar: f.beatsPerBar,
      posOf: xOfBeat,
      axis: "vertical-lines",
      x: trackX,
      y: 0,
      w: trackW,
      h: H,
    });

    // Notes: upcoming in the lane LED at full strength, played in their
    // rating colour. Both scroll with the lane; nothing jumps at the head.
    // Drawn whenever there are any, not only while the transport runs — a
    // stopped lesson previews its opening bars parked at the playhead.
    if (f.instances.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(trackX, 0, trackW, H);
      ctx.clip();

      const size = Math.min(NOTE_H, Math.max(5, laneH - 4));
      for (const inst of f.instances) {
        const li = lanes.indexOf(inst.lane);
        if (li < 0) continue;
        // Nothing has been played during the count-in, so the past stays empty.
        if (f.countIn && inst.time < f.now) continue;
        const x = hitX + (inst.time - f.now) * (beatPx / f.secPerBeat);
        if (x < trackX - NOTE_W || x > W + NOTE_W) continue;
        const y = li * (laneH + LANE_GAP);
        this.note(
          f,
          x - NOTE_W / 2,
          y + (laneH - size) / 2,
          NOTE_W,
          size,
          inst.resolved ? p.rating[inst.rating!] : ledOf(p, li),
        );
      }
      ctx.restore();
    }

    // The played side's wash only means something once something has been
    // played, so the preview leaves it off.
    if (f.playing) {
      paintVeil(ctx, p.lane, [trackX, 0], [hitX, 0], [trackX, 0, hitX - trackX, H]);
    }

    // Separators over the veil — they are structure, not content, so they do
    // not dissolve with the notes. Then the playhead over everything.
    ctx.fillStyle = SEPARATOR_INK[f.theme];
    for (let li = 1; li < n; li++) {
      ctx.fillRect(0, Math.round(li * (laneH + LANE_GAP)) - 1, W, LANE_GAP);
    }

    ctx.fillStyle = p.head;
    ctx.fillRect(Math.round(hitX) - 1, 0, 2, H);

    this.countIn(f, W, H);
  }

  // ------------------------------------------------------------- vertical

  private drawVertical(f: LaneFrame, W: number, H: number, lanes: number[]): void {
    const ctx = this.ctx;
    const p = f.palette;
    const n = lanes.length;
    const laneW = (W - LANE_GAP * (n - 1)) / n;
    const fieldH = Math.max(1, H - TILE_H);
    const hitY = fieldH - HIT_FROM_BOTTOM;
    const beatPx = pxPerBeat(fieldH, f.beatsPerBar);
    this.window = { behind: HIT_FROM_BOTTOM / beatPx, ahead: hitY / beatPx };

    // Notes fall, so a later beat sits higher up the screen.
    const yOfBeat = (beat: number) => hitY - (beat - f.absBeat) * beatPx;
    const busy = new Set(f.instances.map((i) => i.lane));

    this.gutterHits = [];
    lanes.forEach((pad, li) => {
      const x = li * (laneW + LANE_GAP);
      ctx.fillStyle = p.lane;
      ctx.fillRect(x, 0, laneW, fieldH);
      // The label tile sits at the bottom, LED on its outer edge — the same
      // place it occupies in the horizontal gutter.
      this.gutterHits.push({ pad, x0: x, x1: x + laneW, y0: fieldH, y1: H });
      this.gutter(f, x, fieldH, laneW, TILE_H, pad, li, "vertical", busy.has(pad));
    });

    paintGrid(ctx, {
      theme: f.theme,
      instrument: "pads",
      from: f.absBeat - this.window.behind,
      to: f.absBeat + this.window.ahead,
      beatsPerBar: f.beatsPerBar,
      posOf: yOfBeat,
      axis: "horizontal-lines",
      x: 0,
      y: 0,
      w: W,
      h: fieldH,
    });

    if (f.instances.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, fieldH);
      ctx.clip();

      for (const inst of f.instances) {
        const li = lanes.indexOf(inst.lane);
        if (li < 0) continue;
        if (f.countIn && inst.time < f.now) continue;
        const y = hitY - (inst.time - f.now) * (beatPx / f.secPerBeat);
        if (y < -NOTE_V || y > fieldH + NOTE_V) continue;
        const x = li * (laneW + LANE_GAP);
        const inset = Math.min(NOTE_V_INSET, Math.max(0, (laneW - 8) / 2));
        // Inset from the column, but never wider than the cap — then centred,
        // so a two-lane lesson gets a note rather than a bar.
        const noteW = Math.min(NOTE_V_MAX_W, laneW - inset * 2);
        this.note(
          f,
          x + (laneW - noteW) / 2,
          y - NOTE_V / 2,
          noteW,
          NOTE_V,
          inst.resolved ? p.rating[inst.rating!] : ledOf(p, li),
          NOTE_V / 2, // pill
        );
      }
      ctx.restore();
    }

    if (f.playing) {
      // Shorter falloff than horizontal — the played run here is only 76px.
      paintVeil(ctx, p.lane, [0, fieldH], [0, hitY], [0, hitY, W, fieldH - hitY]);
    }

    ctx.fillStyle = SEPARATOR_INK[f.theme];
    for (let li = 1; li < n; li++) {
      ctx.fillRect(Math.round(li * (laneW + LANE_GAP)) - 1, 0, LANE_GAP, H);
    }

    ctx.fillStyle = p.head;
    ctx.fillRect(0, Math.round(hitY) - 1, W, 2);

    this.countIn(f, W, fieldH);
  }

  // ---------------------------------------------------------------- parts

  /**
   * A lane's label block: the LED on its outer edge, the controller mini-grid,
   * then the drum name. Identical content in both orientations — only the edge
   * the LED sits on differs.
   */
  private gutter(
    f: LaneFrame,
    x: number,
    y: number,
    w: number,
    h: number,
    pad: number,
    li: number,
    orientation: "horizontal" | "vertical",
    active: boolean,
  ): void {
    const ctx = this.ctx;
    const p = f.palette;
    ctx.fillStyle = p.gutter;
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = ledOf(p, li);
    if (orientation === "horizontal") ctx.fillRect(x, y, LED_EDGE, h);
    else ctx.fillRect(x, y + h - LED_EDGE, w, LED_EDGE);

    if (f.theme === "light") {
      ctx.fillStyle = p.hair;
      if (orientation === "horizontal") ctx.fillRect(x + w - 1, y, 1, h);
      else ctx.fillRect(x, y, w, 1);
    }

    // The LED border sits inside the gutter's width, so the label block and
    // the note field never drift apart.
    const inner = orientation === "horizontal" ? x + LED_EDGE : x;
    const cy = orientation === "horizontal" ? y + h / 2 : y + (h - LED_EDGE) / 2;
    const gridRight = this.miniGrid(f, pad, li, inner + 10, cy);

    ctx.fillStyle = f.playing && !active ? p.txt2 : p.txt;
    ctx.font = `500 8.5px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const nameX = gridRight + MINI_GAP;
    this.tracked(PADS[pad].name.toUpperCase(), nameX, cy, 1.1, x + w - nameX - 8);
    ctx.textBaseline = "alphabetic";
  }

  /**
   * The controller's pad grid in miniature, this pad's cell lit — so you can
   * see where a lane sits on the hardware without reading the label. Reflows
   * with the layout (4x4 or 2x8). Returns the x it ends at.
   */
  private miniGrid(f: LaneFrame, pad: number, li: number, x0: number, cy: number): number {
    const ctx = this.ctx;
    const pos = padPosition(pad, f.padLayout);
    const gw = pos.cols * CELL_STEP - 1;
    const gh = pos.rows * CELL_STEP - 1;
    const y0 = cy - gh / 2;
    for (let r = 0; r < pos.rows; r++) {
      for (let c = 0; c < pos.cols; c++) {
        ctx.fillStyle = r === pos.row && c === pos.col ? ledOf(f.palette, li) : f.palette.miniOff;
        ctx.fillRect(x0 + c * CELL_STEP, y0 + r * CELL_STEP, CELL, CELL);
      }
    }
    return x0 + gw;
  }

  /** Pad under a point on the canvas, for click-to-play. Null elsewhere. */
  laneAt(x: number, y: number): number | null {
    for (const h of this.gutterHits) {
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h.pad;
    }
    return null;
  }

  private note(
    f: LaneFrame,
    x: number,
    y: number,
    w: number,
    h: number,
    colour: string,
    radius?: number,
  ): void {
    const ctx = this.ctx;
    const r = radius ?? RADIUS[f.theme].note;
    ctx.fillStyle = colour;
    if (r <= 0) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    this.roundRect(x, y, w, h, r);
    ctx.fill();
  }


  private countIn(f: LaneFrame, W: number, H: number): void {
    if (!f.countIn) return;
    paintCountIn(this.ctx, {
      palette: f.palette,
      beats: f.countInBeats,
      beat: f.countInBeat,
      reducedMotion: f.reducedMotion,
      lessonName: f.lessonName,
      w: W,
      h: H,
      mono: MONO,
      sans: SANS,
    });
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


  private roundRect(x: number, y: number, w: number, h: number, radius: number): void {
    const ctx = this.ctx;
    // Clamp, as `arcTo` will not: a radius over half the shorter side makes
    // the corner arcs overlap and the path double back, drawing a pointed
    // lens with a spike off each end instead of a rounded box. Nothing here
    // asks for one today, but the piano's notes did.
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
