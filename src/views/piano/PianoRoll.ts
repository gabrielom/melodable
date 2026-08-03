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

import { RADIUS } from "@/engine/theme";
import { paintCountIn, paintGrid, paintVeil, pxPerBeat, ROW_INK } from "@/views/lane-geometry";
import type { LaneFrame, LaneRenderer, VisibleWindow } from "@/views/lane-frame";
import { countWhiteKeys, isWhiteKey, keyGeometry, noteName, pitchClass } from "@/engine/pitch";

/**
 * No gutter: the rotated keyboard sits beside the roll and names the pitches,
 * so the roll uses its whole width and every row lines up with its key.
 */
const GUTTER = 0;

/** Canvas takes a font shorthand, not a CSS variable — mirrors the tokens. */
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '"Geist", ui-sans-serif, system-ui, sans-serif';
/** Semitone beds: black-key rows sit a shade darker than white-key rows. */
const ROW_BLACK = { dark: "#0d0d0e", light: "#c4c4c4" } as const;

export class PianoRoll implements LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Timeline on screen at the last draw, for the overview's viewport rect. */
  private window: VisibleWindow = { behind: 0, ahead: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  visibleBeats(): VisibleWindow {
    return this.window;
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
    // White-key rows are the bed; black-key rows darken over it.
    ctx.fillStyle = f.palette.lane;
    ctx.fillRect(0, 0, W, H);

    if (f.orientation === "horizontal") this.drawHorizontal(f, W, H);
    else this.drawVertical(f, W, H);
  }

  // ------------------------------------------------------------- vertical

  private drawVertical(f: LaneFrame, W: number, H: number): void {
    const ctx = this.ctx;
    const low = f.lowNote;
    const high = f.highNote;
    const whiteWidth = W / Math.max(1, countWhiteKeys(low, high));
    // Centred, like the pads view: half the visible span either side.
    const hitY = Math.round(H / 2);
    const beatPx = pxPerBeat(H, f.beatsPerBar);
    const halfBeats = H / 2 / beatPx;
    this.window = { behind: halfBeats, ahead: halfBeats };
    const pxPerSec = beatPx / f.secPerBeat;

    for (let note = low; note <= high; note++) {
      const g = keyGeometry(note, low, whiteWidth);
      if (!isWhiteKey(note)) {
        ctx.fillStyle = f.palette.lane;
        ctx.fillRect(g.x, 0, g.width, H);
      }
      if (pitchClass(note) === 0) {
        ctx.strokeStyle = f.palette.hair;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x + 0.5, 0);
        ctx.lineTo(g.x + 0.5, H);
        ctx.stroke();
      }
    }

    paintGrid(ctx, {
      theme: f.theme,
      instrument: "piano",
      from: f.absBeat - halfBeats,
      to: f.absBeat + halfBeats,
      beatsPerBar: f.beatsPerBar,
      posOf: (beat) => hitY - (beat - f.absBeat) * beatPx,
      axis: "horizontal-lines",
      x: 0,
      y: 0,
      w: W,
      h: H,
    });

    // Two passes: white-key notes first so sharps sit above their neighbours.
    for (const blackPass of [false, true]) {
      for (const inst of f.instances) {
        const black = !isWhiteKey(inst.lane);
        if (black !== blackPass) continue;
        if (inst.lane < low || inst.lane > high) continue;
        if (f.countIn && inst.time < f.now) continue;
        const y = hitY - (inst.time - f.now) * pxPerSec;
        if (y < -30 || y > H + 30) continue;
        const g = keyGeometry(inst.lane, low, whiteWidth);
        // A slim block on the key's own column; the keyboard below names the
        // pitches this lesson uses, so the note doesn't have to carry a label.
        this.note(f, g.x + 1, y - 4, g.width - 2, 8, inst, 4);
      }
    }

    if (f.playing) paintVeil(ctx, f.palette.lane, [0, H], [0, hitY], [0, hitY, W, H - hitY]);

    ctx.fillStyle = f.palette.head;
    ctx.fillRect(0, hitY - 1, W, 2);

    if (!f.playing) this.idle(f, W / 2, hitY - 40);
    this.countIn(f, W, H);
  }

  // ----------------------------------------------------------- horizontal

  private drawHorizontal(f: LaneFrame, W: number, H: number): void {
    const ctx = this.ctx;
    const low = f.lowNote;
    const high = f.highNote;
    const rows = high - low + 1;
    const rowH = H / rows;
    const trackX = GUTTER;
    const trackW = W - GUTTER;
    const hitX = trackX + trackW / 2;
    const beatPx = pxPerBeat(trackW, f.beatsPerBar);
    const halfBeats = trackW / 2 / beatPx;
    this.window = { behind: halfBeats, ahead: halfBeats };
    const pxPerSec = beatPx / f.secPerBeat;
    /** Row 0 is the highest pitch, so pitch rises up the screen. */
    const rowY = (pitch: number) => (high - pitch) * rowH;

    for (let note = low; note <= high; note++) {
      const y = rowY(note);
      if (!isWhiteKey(note)) {
        ctx.fillStyle = ROW_BLACK[f.theme];
        ctx.fillRect(trackX, y, trackW, rowH);
      }
      if (pitchClass(note) === 0) {
        ctx.fillStyle = ROW_INK[f.theme];
        ctx.fillRect(trackX, Math.round(y), trackW, 1);
      }
    }

    paintGrid(ctx, {
      theme: f.theme,
      instrument: "piano",
      from: f.absBeat - halfBeats,
      to: f.absBeat + halfBeats,
      beatsPerBar: f.beatsPerBar,
      posOf: (beat) => hitX + (beat - f.absBeat) * beatPx,
      axis: "vertical-lines",
      x: trackX,
      y: 0,
      w: trackW,
      h: H,
    });

    // The blob is deliberately taller than a row so the note name fits — rows
    // get thin over a three-octave range. Neighbours overlap slightly, which
    // is how Melodics reads too.
    const noteW = 16;
    const h = 26;
    ctx.save();
    ctx.beginPath();
    ctx.rect(trackX, 0, trackW, H);
    ctx.clip();
    for (const inst of f.instances) {
      if (inst.lane < low || inst.lane > high) continue;
      if (f.countIn && inst.time < f.now) continue;
      const x = hitX + (inst.time - f.now) * pxPerSec;
      if (x < trackX - 50 || x > W + 50) continue;
      const y = rowY(inst.lane) + (rowH - h) / 2;
      // Deliberately taller than a row, with a full pill radius, so the note
      // name always fits — rows get thin over a three-octave range.
      this.note(f, x - noteW / 2, y, noteW, h, inst, h / 2);
      this.label(f, noteName(inst.lane), x, y + h / 2, 8.5);
    }
    ctx.restore();

    if (f.playing) {
      paintVeil(ctx, f.palette.lane, [trackX, 0], [hitX, 0], [trackX, 0, hitX - trackX, H]);
    }

    ctx.fillStyle = f.palette.head;
    ctx.fillRect(Math.round(hitX) - 1, 0, 2, H);

    if (!f.playing) this.idle(f, trackX + trackW / 2, H / 2);
    this.countIn(f, W, H);
  }

  // ---------------------------------------------------------------- parts

  private note(
    f: LaneFrame,
    x: number,
    y: number,
    w: number,
    h: number,
    inst: LaneFrame["instances"][number],
    radius?: number,
  ): void {
    const ctx = this.ctx;
    const r = radius ?? RADIUS[f.theme].note;
    // Piano has no pad LEDs, so everything still to come takes one instrument
    // colour; only what has been played wears a rating.
    ctx.fillStyle = inst.resolved ? f.palette.rating[inst.rating!] : f.palette.instrument;
    if (r <= 0) ctx.fillRect(x, y, w, h);
    else {
      this.roundRect(x, y, w, h, r);
      ctx.fill();
    }
  }

  /** The note's name, written on the note so you know which key to press. */
  private label(f: LaneFrame, text: string, cx: number, cy: number, size: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = f.theme === "light" ? "#e9e9ea" : "#0b0b0c";
    ctx.font = `500 ${size}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy + 0.5);
    ctx.textBaseline = "alphabetic";
  }

  private idle(f: LaneFrame, cx: number, cy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = f.palette.txt3;
    ctx.font = `500 8.5px ${MONO}`;
    ctx.textAlign = "center";
    ctx.fillText("PRESS START FOR THE COUNT-IN", cx, cy);
  }

  private countIn(f: LaneFrame, W: number, H: number): void {
    if (!f.countIn) return;
    paintCountIn(this.ctx, {
      theme: f.theme,
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
