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
/**
 * Ceiling on a falling note's width. Key columns widen as the visible range
 * narrows, and a note sized to its key becomes a slab over a two-octave
 * lesson. Matches the pads view's cap so the two instruments agree.
 */
const NOTE_V_MAX_W = 72;
/**
 * Height of that note — its extent along the time axis. Deep enough to seat
 * the 8.5px name, which is the whole reason it is not the 8px sliver it was.
 * At the five-bar zoom this is about an eighth note, so eighths sit edge to
 * edge and anything faster overlaps, same as the horizontal view.
 */
const NOTE_V_H = 16;
/**
 * Below this the note name is dropped rather than spilled onto its
 * neighbours. The widest label over A0–C8 is a sharp like "C#4", measured at
 * 16px in 8.5px Geist Mono, so 20 leaves 2px either side.
 */
const LABEL_MIN_W = 20;

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

    this.beginLabels(8.5);
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
        // A pill on the key's own column, capped and centred: a narrow range
        // makes keys wide, and a note that just fills its key turns into a
        // slab. Tall enough to carry its own name, the way the horizontal
        // view does — the keyboard tells you where the key is, the label
        // tells you which one without having to trace down the column.
        const w = Math.min(NOTE_V_MAX_W, g.width - 2);
        const x = g.x + (g.width - w) / 2;
        this.note(f, x, y - NOTE_V_H / 2, w, NOTE_V_H, inst, NOTE_V_H / 2);
        // Skipped when the column is too narrow to hold the text — a clip
        // spanning most of the keyboard leaves black keys around 14px.
        if (w >= LABEL_MIN_W) this.label(f, noteName(inst.lane), x + w / 2, y);
      }
    }
    this.endLabels();

    if (f.playing) paintVeil(ctx, f.palette.lane, [0, H], [0, hitY], [0, hitY, W, H - hitY]);

    ctx.fillStyle = f.palette.head;
    ctx.fillRect(0, hitY - 1, W, 2);

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
    this.beginLabels(8.5);
    for (const inst of f.instances) {
      if (inst.lane < low || inst.lane > high) continue;
      if (f.countIn && inst.time < f.now) continue;
      const x = hitX + (inst.time - f.now) * pxPerSec;
      if (x < trackX - 50 || x > W + 50) continue;
      const y = rowY(inst.lane) + (rowH - h) / 2;
      // Deliberately taller than a row, with a full pill radius, so the note
      // name always fits — rows get thin over a three-octave range.
      this.note(f, x - noteW / 2, y, noteW, h, inst, h / 2);
      this.label(f, noteName(inst.lane), x, y + h / 2);
    }
    this.endLabels();
    ctx.restore();

    if (f.playing) {
      paintVeil(ctx, f.palette.lane, [trackX, 0], [hitX, 0], [trackX, 0, hitX - trackX, H]);
    }

    ctx.fillStyle = f.palette.head;
    ctx.fillRect(Math.round(hitX) - 1, 0, 2, H);

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

  /**
   * Text state for a run of note labels. Assigning `ctx.font` re-parses the
   * font string and re-resolves the family, which is one of the more
   * expensive things you can do per call on a 2D context — so it is set once
   * around the note loop rather than once per note.
   */
  private beginLabels(size: number): void {
    const ctx = this.ctx;
    ctx.font = `500 ${size}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  private endLabels(): void {
    this.ctx.textBaseline = "alphabetic";
    this.ctx.textAlign = "left";
  }

  /** The note's name, written on the note so you know which key to press. */
  private label(f: LaneFrame, text: string, cx: number, cy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = f.theme === "light" ? "#e9e9ea" : "#0b0b0c";
    ctx.fillText(text, cx, cy + 0.5);
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

  private roundRect(x: number, y: number, w: number, h: number, radius: number): void {
    const ctx = this.ctx;
    // Clamp to what the box can actually hold. `arcTo` does not do this: ask
    // for more than half the shorter side and the two corner arcs overlap,
    // the path doubles back, and the note renders as a pointed lens with a
    // spike off each end. Callers ask for `h / 2` meaning "fully rounded
    // ends", and on a 16x26 note that is wider than the box allows. Native
    // `ctx.roundRect` and CSS `border-radius` both clamp the same way.
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
