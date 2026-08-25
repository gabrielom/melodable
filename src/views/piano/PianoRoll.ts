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
import {
  HOLD_CLEARANCE,
  holdFill,
  holdFloor,
  holdLength,
  noteInk,
  paintCountIn,
  paintGrid,
  paintHold,
  paintVeil,
  pxPerBeat,
  ROW_INK,
} from "@/views/lane-geometry";
import type { LaneFrame, LaneRenderer, VisibleWindow } from "@/views/lane-frame";
import { countWhiteKeys, isWhiteKey, keyGeometry, pitchLetter, pitchClass } from "@/engine/pitch";

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
 * Diameter of a falling note, in both orientations. It is a circle, so this
 * governs both axes at once — no separate width cap against wide key columns,
 * and no separate height to clear a thin row. Whichever axis carries time, it
 * covers a little under a quarter note at the five-bar zoom, so consecutive
 * eighths still touch.
 */
const NOTE_DIAMETER = 26;
/**
 * Vertical: distance from the bottom of the roll to the hit line — the same
 * shape of rule the pads view uses, and taken from the handoff's `10f piano
 * vertical` frame, where the roll is 319px tall and the line sits at 211,
 * i.e. 108 up from its bottom. It is deliberately not centred: a falling-note
 * view needs most of its height for what is coming, and only a landing strip
 * for what has just gone.
 *
 * A fixed offset rather than a fraction, so the landing strip stays the same
 * size whatever the window height — which is also how the pads view reads its
 * own `HIT_FROM_BOTTOM`. Every handoff frame is 500px tall, so the drawings
 * cannot distinguish the two; this follows the existing convention.
 */
const HIT_FROM_BOTTOM = 108;
/**
 * Size of the letter inside the note. Large enough to be read at a glance
 * rather than squinted at — it is the one piece of text that tells you which
 * key to press.
 */
const LABEL_SIZE = 17;
/**
 * The sharp beside it, and how it sits: smaller than the letter and raised,
 * the way an accidental is set in type. It qualifies the letter rather than
 * standing beside it as an equal, and at full size "C#" nearly fills the
 * circle it is written in.
 */
const ACCIDENTAL_SIZE = 11;
const ACCIDENTAL_GAP = 1;
const ACCIDENTAL_RISE = 4;
/**
 * Below this the letter is dropped rather than spilled outside the circle.
 * The widest label is a sharp: 10.2px of letter, the 1px gap and 6.6px of
 * accidental, so 17.8px, and 22 leaves a couple of pixels either side. It was
 * 25 while the sharp was a second full-size character at 20.4px — setting the
 * accidental smaller bought back the room. In practice this only bites on an
 * imported clip wide enough to squeeze the black keys.
 */
const LABEL_MIN_W = 22;
/**
 * A hold's bar across the axis that isn't time: narrower than the 26px head
 * it grows from, so the head still reads as the note and the bar as its tail.
 */
const BAR_ACROSS = 18;
const BAR_RADIUS = 4;
/**
 * How far the slot reaches back behind its own head. The head is a 26px
 * circle, so 12 sits inside it — the cap is never seen, and without it the
 * head would show the slot's 2px channel through its middle.
 */
const HEAD_CAP = 12;
/**
 * The letter written on a note. One ink per theme, whatever the note's own
 * colour — the hues and the ratings are all mid-tone enough to carry it, and
 * a per-note ink would be one more thing that could disagree with itself.
 * Dark is a blue-black rather than a neutral one, which sits better on the
 * cool end of the hue list.
 */
const INK = { dark: "#08131a", light: "#f2f2f2" } as const;

export class PianoRoll implements LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Timeline on screen at the last draw, for the overview's viewport rect. */
  private window: VisibleWindow = { behind: 0, ahead: 0 };
  /** Label widths, measured once — the two sizes are constants. */
  private metrics: { letter: number; sharp: number } | null = null;
  /** Accidentals from this frame's notes, drawn together in `endLabels`. */
  private sharps: Array<{ x: number; y: number }> = [];

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
    // Low in the field, like the pads view — not centred. More of the roll
    // is given to what is coming than to what has just passed.
    const hitY = Math.round(Math.max(0, H - HIT_FROM_BOTTOM));
    const beatPx = pxPerBeat(H, f.beatsPerBar);
    this.window = { behind: (H - hitY) / beatPx, ahead: hitY / beatPx };
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
      from: f.absBeat - this.window.behind,
      to: f.absBeat + this.window.ahead,
      beatsPerBar: f.beatsPerBar,
      posOf: (beat) => hitY - (beat - f.absBeat) * beatPx,
      axis: "horizontal-lines",
      x: 0,
      y: 0,
      w: W,
      h: H,
    });

    // Bars first, all of them, so every head sits above every slot.
    for (const inst of f.instances) {
      if (inst.duration <= 0) continue;
      if (inst.lane < low || inst.lane > high) continue;
      const y = hitY - (inst.time - f.now) * pxPerSec;
      if (y < -NOTE_DIAMETER || y > H + NOTE_DIAMETER) continue;
      const g = keyGeometry(inst.lane, low, whiteWidth);
      const d = Math.min(NOTE_DIAMETER, g.width - 2);
      const bw = Math.min(BAR_ACROSS, d);
      const len = holdLength(
        inst.duration * beatPx,
        this.roomAhead(f, inst, low, whiteWidth, (i) => hitY - (i.time - f.now) * pxPerSec, d, true),
        y - d / 2 < 0 || y + d / 2 > H,
        holdFloor("falling", HEAD_CAP),
      );
      if (len === null) continue;
      paintHold(this.ctx, {
        x: g.x + (g.width - bw) / 2,
        y: y - len,
        w: bw,
        h: len,
        headEnd: "bottom",
        headCap: HEAD_CAP,
        radius: BAR_RADIUS,
        colour: noteInk(f, inst, this.rankOf(f, inst.lane)),
        fill: holdFill(inst, f.now),
      });
    }

    this.beginLabels(LABEL_SIZE);
    // Two passes: white-key notes first so sharps sit above their neighbours.
    for (const blackPass of [false, true]) {
      for (const inst of f.instances) {
        const black = !isWhiteKey(inst.lane);
        if (black !== blackPass) continue;
        if (inst.lane < low || inst.lane > high) continue;
        // §2.4: notes behind the playhead stay on screen during the count-in. They
        // simply wear their tint like everything else — nothing has been judged.
        const y = hitY - (inst.time - f.now) * pxPerSec;
        // Cull on the note's own size, so a larger note is not clipped off
        // the edge before it has fully left the field.
        if (y < -NOTE_DIAMETER || y > H + NOTE_DIAMETER) continue;
        const g = keyGeometry(inst.lane, low, whiteWidth);
        // A circle centred on the key's own column. It shrinks to the key
        // when the key is narrower than the diameter, so a clip spanning the
        // whole board still keeps its notes inside their own columns. The
        // keyboard says where the key is; the letter says which one, without
        // having to trace down the column.
        const d = Math.min(NOTE_DIAMETER, g.width - 2);
        const x = g.x + (g.width - d) / 2;
        this.note(f, x, y - d / 2, d, d, noteInk(f, inst, this.rankOf(f, inst.lane)), d / 2);
        // Skipped when the circle is too small to hold the text.
        if (d >= LABEL_MIN_W) this.label(f, pitchLetter(inst.lane), x + d / 2, y);
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

    ctx.save();
    ctx.beginPath();
    ctx.rect(trackX, 0, trackW, H);
    ctx.clip();

    // Bars under every head, so a bar reaching a neighbour passes behind it.
    for (const inst of f.instances) {
      if (inst.duration <= 0) continue;
      if (inst.lane < low || inst.lane > high) continue;
      const x = hitX + (inst.time - f.now) * pxPerSec;
      if (x < trackX - 50 || x > W + 50) continue;
      const cy = rowY(inst.lane) + rowH / 2;
      const len = holdLength(
        inst.duration * beatPx,
        this.roomAheadRows(f, inst, rowY, rowH, (i) => hitX + (i.time - f.now) * pxPerSec),
        x - NOTE_DIAMETER / 2 < trackX || x + NOTE_DIAMETER / 2 > W,
        holdFloor("scrolling", HEAD_CAP),
      );
      if (len === null) continue;
      paintHold(ctx, {
        x,
        y: cy - BAR_ACROSS / 2,
        w: len,
        h: BAR_ACROSS,
        headEnd: "left",
        headCap: HEAD_CAP,
        radius: BAR_RADIUS,
        colour: noteInk(f, inst, this.rankOf(f, inst.lane)),
        fill: holdFill(inst, f.now),
      });
    }

    this.beginLabels(LABEL_SIZE);
    for (const inst of f.instances) {
      if (inst.lane < low || inst.lane > high) continue;
      // §2.4: notes behind the playhead stay on screen during the count-in. They
      // simply wear their tint like everything else — nothing has been judged.
      const x = hitX + (inst.time - f.now) * pxPerSec;
      if (x < trackX - 50 || x > W + 50) continue;
      // Centred on its row, the same circle the vertical view draws. It is
      // deliberately bigger than a row — rows get thin over two octaves — so
      // neighbouring semitones overlap slightly, which is how Melodics reads
      // too, and it keeps the note legible with its letter inside.
      const cy = rowY(inst.lane) + rowH / 2;
      const d = NOTE_DIAMETER;
      this.note(f, x - d / 2, cy - d / 2, d, d, noteInk(f, inst, this.rankOf(f, inst.lane)), d / 2);
      this.label(f, pitchLetter(inst.lane), x, cy);
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

  /**
   * Where a pitch sits in the lesson's own low-to-high order, which is what
   * picks its hue. A chord then reads as distinct voices rather than one
   * block of colour. Falls back to the first hue for a pitch the lesson never
   * asks for — an imported clip can put one on screen.
   */
  private rankOf(f: LaneFrame, pitch: number): number {
    return Math.max(0, f.hueOrder.indexOf(pitch));
  }

  /**
   * Vertical: room a hold has before the next head it would run into.
   *
   * "Whose band it would cross" is a real test here, not just a pitch match —
   * a sharp's column overlaps its neighbours', so a bar running up the C#
   * column can collide with a head on C or D. Compares the drawn columns.
   */
  private roomAhead(
    f: LaneFrame,
    inst: LaneFrame["instances"][number],
    low: number,
    whiteWidth: number,
    posOf: (i: LaneFrame["instances"][number]) => number,
    headSize: number,
    reverse: boolean,
  ): number {
    const mine = keyGeometry(inst.lane, low, whiteWidth);
    const here = posOf(inst);
    let room = Infinity;
    for (const other of f.instances) {
      if (other === inst || other.time <= inst.time) continue;
      const theirs = keyGeometry(other.lane, low, whiteWidth);
      if (theirs.x + theirs.width <= mine.x || theirs.x >= mine.x + mine.width) continue;
      const gap = reverse ? here - posOf(other) : posOf(other) - here;
      room = Math.min(room, gap - headSize / 2 - HOLD_CLEARANCE);
    }
    return room;
  }

  /**
   * Horizontal: the same test against rows. The 26px circle is taller than a
   * row once the range opens past an octave or so, so a note genuinely
   * overlaps its neighbours and an exact-row check would miss the collision.
   */
  private roomAheadRows(
    f: LaneFrame,
    inst: LaneFrame["instances"][number],
    rowY: (pitch: number) => number,
    rowH: number,
    posOf: (i: LaneFrame["instances"][number]) => number,
  ): number {
    const myTop = rowY(inst.lane) + rowH / 2 - BAR_ACROSS / 2;
    const myBottom = myTop + BAR_ACROSS;
    const here = posOf(inst);
    let room = Infinity;
    for (const other of f.instances) {
      if (other === inst || other.time <= inst.time) continue;
      const theirTop = rowY(other.lane) + rowH / 2 - NOTE_DIAMETER / 2;
      if (theirTop + NOTE_DIAMETER <= myTop || theirTop >= myBottom) continue;
      room = Math.min(room, posOf(other) - here - NOTE_DIAMETER / 2 - HOLD_CLEARANCE);
    }
    return room;
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
    ctx.font = `700 ${size}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    this.metrics ??= {
      letter: ctx.measureText("C").width,
      // Measured at the accidental's own size, then restored below.
      sharp: ((): number => {
        ctx.font = `700 ${ACCIDENTAL_SIZE}px ${MONO}`;
        const w = ctx.measureText("#").width;
        ctx.font = `700 ${size}px ${MONO}`;
        return w;
      })(),
    };
    this.sharps.length = 0;
  }

  /**
   * Flush the accidentals collected during the note loop. They are drawn here,
   * in one pass, rather than beside their letters — switching `ctx.font` per
   * note is exactly the cost `beginLabels` exists to avoid, so the size change
   * happens twice a frame instead of twice a sharp.
   */
  private endLabels(): void {
    const ctx = this.ctx;
    if (this.sharps.length) {
      ctx.font = `700 ${ACCIDENTAL_SIZE}px ${MONO}`;
      for (const s of this.sharps) ctx.fillText("#", s.x, s.y);
      this.sharps.length = 0;
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }

  /**
   * The note's letter, written on the note so you know which key to press.
   *
   * A sharp is set smaller and raised beside the letter rather than being a
   * second full-size character: "C#" at one size is nearly as wide as the
   * circle holding it, and the accidental is a qualifier on the letter, not
   * its equal. The pair is centred as a unit, so a sharp note reads as
   * balanced in its circle as a natural one.
   */
  private label(f: LaneFrame, text: string, cx: number, cy: number): void {
    const ctx = this.ctx;
    const m = this.metrics!;
    ctx.fillStyle = INK[f.theme];

    if (text.length === 1) {
      ctx.fillText(text, cx - m.letter / 2, cy + 0.5);
      return;
    }

    const total = m.letter + ACCIDENTAL_GAP + m.sharp;
    const x = cx - total / 2;
    ctx.fillText(text[0], x, cy + 0.5);
    this.sharps.push({ x: x + m.letter + ACCIDENTAL_GAP, y: cy - ACCIDENTAL_RISE });
  }


  private countIn(f: LaneFrame, W: number, H: number): void {
    if (!f.countIn) return;
    paintCountIn(this.ctx, {
      palette: f.palette,
      beats: f.countInBeats,
      beat: f.countInBeat,
      waiting: f.waiting,
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
