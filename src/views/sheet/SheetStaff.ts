/**
 * Canvas renderer for the sheet view (handoff 10 §1).
 *
 * A third trainer mode beside the roll: the same run, drawn as real notation
 * on a treble staff, scrolling right-to-left onto a playhead. The roll draws a
 * note's length as a translucent bar; here the length *is* the note's shape,
 * which is the whole reason the mode exists.
 *
 * Horizontal only — notation has no vertical form — so the trainer disables
 * the orientation control while this is active.
 *
 * Same shape as `PadLanes` and `PianoRoll`: one class driven by the trainer's
 * single rAF loop, no Vue and no per-frame reactivity (invariant 6). All the
 * arithmetic — figures, staff positions, beams — is in `engine/notation.ts`
 * where it can be tested; this file is the drawing only.
 */

import {
  CLEF_TREBLE,
  GLYPH,
  NOTEHEAD_EM_CENTRE,
  NOTEHEAD_EM_HEIGHT,
  accidentalFor,
  beamGroups,
  figureFor,
  ledgerSteps,
  sheetPxPerBeat,
  smallestGap,
  staffStep,
  type Engraved,
} from "@/engine/notation";
import { gridBeatRange, noteInk, paintCountIn, pxPerBeat } from "@/views/lane-geometry";
import type { LaneFrame, LaneRenderer, VisibleWindow } from "@/views/lane-frame";
import type { NoteInstance } from "@/engine/scoring";

/** Distance between two staff lines — every other measurement scales off it. */
const SPACE = 17;
const HALF_SPACE = SPACE / 2;
const LINE_W = 1.4;
const STAFF_H = SPACE * 4;

/** The clef's own column: five short staff lines, then a rule. */
const CLEF_GUTTER = 92;
const CLEF_RULE_W = 1;

const BARLINE_W = 1.8;
/** Beat hairlines run this much past the staff, top and bottom. */
const GRID_OVERHANG = 10;
/** The playhead runs further still, so it reads over the notes. */
const PLAYHEAD_W = 2;
const PLAYHEAD_OVERHANG = 26;

const LEDGER_LEN = 30;
const LEDGER_W = 2.6;

/** Augmentation dot: the font's own is a combining mark with no advance. */
const DOT_R = 2.5;
const DOT_GAP = 7;

/** Beamed groups are assembled, not glyphs — the font has no beam. */
const STEM_W = 1.8;
const STEM_LEN = 32;
const BEAM_H = 4.2;
const BEAM_GAP = 6.4;
const BEAM_STUB = 11;

/** Soft highlight behind the note being played right now. */
const HIGHLIGHT_R = 13;
const HIGHLIGHT_ALPHA = 0.2;

/**
 * Where the playhead sits across the track.
 *
 * A third along, not the middle the roll uses: reading notation is reading
 * *ahead*, so the mode wants more of what is coming than of what has gone.
 * Taken from the frames, where the playhead is at x=432 with a 92px clef
 * gutter in a 1164px panel — 31.7% of the track, which this rounds.
 */
const PLAYHEAD_FRAC = 1 / 3;

const SANS = '"Geist", ui-sans-serif, system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const MUSIC = '"Noto Music", serif';

/** A note placed on the staff, ready to draw. */
interface Placed {
  inst: NoteInstance;
  x: number;
  /** Centre of the notehead. */
  y: number;
  step: number;
  fig: Engraved;
  ink: string;
  laneIndex: number;
  /** On screen this frame. Culling decides what is *drawn*, never how the
   *  music is grouped — see `notes`. */
  visible: boolean;
}

export class SheetStaff implements LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private window: VisibleWindow = { behind: 0, ahead: 0 };

  constructor(private readonly el: HTMLCanvasElement) {
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("SheetStaff: no 2d context");
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.el.clientWidth));
    const h = Math.max(1, Math.round(this.el.clientHeight));
    if (this.el.width !== w * dpr || this.el.height !== h * dpr) {
      this.el.width = w * dpr;
      this.el.height = h * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  visibleBeats(): VisibleWindow {
    return this.window;
  }

  draw(f: LaneFrame): void {
    const ctx = this.ctx;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const trackX = CLEF_GUTTER;
    const trackW = Math.max(1, W - CLEF_GUTTER);

    // The staff sits above the space the keyboard leaves, centred in what is
    // left rather than pinned, so the view breathes at any window height.
    const topLineY = Math.round((H - STAFF_H) / 2);
    const bottomLineY = topLineY + STAFF_H;

    // Zoom: the roll's five bars unless the lesson's closest pair would
    // collide at that scale, in which case zoom in until it clears (§1.7).
    const rollPx = pxPerBeat(trackW, f.beatsPerBar);
    const gap = smallestGap([...f.noteValues.keys()]);
    const beatPx = sheetPxPerBeat(gap, rollPx);

    const hitX = trackX + trackW * PLAYHEAD_FRAC;
    const xOfBeat = (beat: number) => hitX + (beat - f.absBeat) * beatPx;

    this.window = {
      behind: (hitX - trackX) / beatPx,
      ahead: (W - hitX) / beatPx,
    };

    const p = f.palette;
    // Staff position of a pitch, as a y on the canvas.
    const yOfStep = (step: number) => bottomLineY - step * HALF_SPACE;

    this.grid(f, trackX, W, topLineY, xOfBeat);
    this.staffLines(ctx, trackX, W - trackX, topLineY, p.txt3);
    this.notes(f, xOfBeat, yOfStep);
    this.historyFade(f, trackX, hitX, H);
    this.clefGutter(f, topLineY, bottomLineY);

    // Playhead last of the chrome, so it reads over the notation.
    ctx.fillStyle = p.head;
    ctx.fillRect(
      Math.round(hitX) - PLAYHEAD_W / 2,
      topLineY - PLAYHEAD_OVERHANG,
      PLAYHEAD_W,
      STAFF_H + PLAYHEAD_OVERHANG * 2,
    );

    if (f.countIn) {
      paintCountIn(ctx, {
        palette: p,
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
  }

  /**
   * Played notation fades back into the paper, so the eye sits ahead of the
   * playhead rather than on what has gone.
   *
   * The bed colour, not a visible strip: this is drawn *over* the notes and
   * under nothing, so anything darker paints the left of the staff out.
   */
  private historyFade(f: LaneFrame, trackX: number, hitX: number, H: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(trackX, 0, hitX, 0);
    g.addColorStop(0, f.palette.lane);
    // *Not* `transparent`, which is transparent **black**: a gradient to it
    // interpolates the colour toward black as the alpha falls, so a light bed
    // fades through a grey slab on its way to nothing. Fade the bed's own
    // colour to zero alpha instead and only the notes underneath change.
    g.addColorStop(1, fadeOut(f.palette.lane));
    ctx.fillStyle = g;
    ctx.fillRect(trackX, 0, hitX - trackX, H);
  }

  private staffLines(
    ctx: CanvasRenderingContext2D,
    x: number,
    w: number,
    topLineY: number,
    ink: string,
  ): void {
    ctx.fillStyle = ink;
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(x, topLineY + i * SPACE - LINE_W / 2, w, LINE_W);
    }
  }

  /** Beat hairlines, and a heavier rule on each barline. */
  private grid(
    f: LaneFrame,
    trackX: number,
    W: number,
    topLineY: number,
    xOfBeat: (b: number) => number,
  ): void {
    const ctx = this.ctx;
    // From the window this frame is drawing, the way the roll does it. Deriving
    // it from `xOfBeat(0)` counted `absBeat` twice, so the range crept forward
    // at double speed and slid out from under the track — which is why a
    // barline would go missing and then reappear a few seconds later.
    const { first, last } = gridBeatRange(f.absBeat, this.window.behind, this.window.ahead);

    for (let b = first; b <= last; b++) {
      const x = xOfBeat(b);
      if (x < trackX - 2 || x > W + 2) continue;
      const onBar = ((b % f.beatsPerBar) + f.beatsPerBar) % f.beatsPerBar === 0;
      if (onBar) {
        ctx.fillStyle = f.palette.txt3;
        ctx.fillRect(Math.round(x) - BARLINE_W / 2, topLineY, BARLINE_W, STAFF_H + LINE_W / 2);
      } else {
        ctx.fillStyle = f.palette.grid;
        ctx.fillRect(
          Math.round(x),
          topLineY - GRID_OVERHANG,
          1,
          STAFF_H + GRID_OVERHANG * 2,
        );
      }
    }
  }

  /** The clef's column: its own staff lines, the clef, 4/4, and a rule. */
  private clefGutter(f: LaneFrame, topLineY: number, bottomLineY: number): void {
    const ctx = this.ctx;
    const p = f.palette;

    // Opaque, so notation scrolling off the left disappears behind it.
    ctx.fillStyle = p.lane;
    ctx.fillRect(0, 0, CLEF_GUTTER, this.el.clientHeight);
    this.staffLines(ctx, 0, CLEF_GUTTER, topLineY, p.txt3);

    const size = SPACE / NOTEHEAD_EM_HEIGHT;
    ctx.fillStyle = p.txt;
    ctx.font = `${size}px ${MUSIC}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // The treble clef curls around G4 — the second line up.
    ctx.fillText(CLEF_TREBLE, 10, bottomLineY - 2 * HALF_SPACE + NOTEHEAD_EM_CENTRE * size);

    // Time signature, stacked in the two halves of the staff.
    ctx.font = `600 ${SPACE * 1.5}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const sigX = CLEF_GUTTER - 24;
    ctx.fillText(String(f.beatsPerBar), sigX, topLineY + SPACE);
    ctx.fillText("4", sigX, topLineY + SPACE * 3);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = p.hair;
    ctx.fillRect(CLEF_GUTTER - CLEF_RULE_W, 0, CLEF_RULE_W, this.el.clientHeight);
  }

  // ------------------------------------------------------------ the notes

  private notes(
    f: LaneFrame,
    xOfBeat: (b: number) => number,
    yOfStep: (s: number) => number,
  ): void {
    const ctx = this.ctx;
    const size = SPACE / NOTEHEAD_EM_HEIGHT;
    const W = this.el.clientWidth;

    // Place *every* instance, not just the ones on screen.
    //
    // Culling here is what made each note flick between a beam and a flag: as
    // a note's partner crossed the edge of the window the group lost a member,
    // and the survivor fell back to the font's flagged glyph. Grouping has to
    // see the whole phrase; only drawing is clipped.
    const placed: Placed[] = [];
    for (const inst of f.instances) {
      const x = xOfBeat(this.absBeatOf(inst, f));
      const step = staffStep(inst.lane);
      const laneIndex = Math.max(0, f.hueOrder.indexOf(inst.lane));
      placed.push({
        inst,
        x,
        y: yOfStep(step),
        step,
        fig: f.noteValues.get(inst.beat) ?? figureFor(inst.duration),
        ink: noteInk(f, inst, laneIndex),
        laneIndex,
        visible: x >= CLEF_GUTTER - 60 && x <= W + 60,
      });
    }
    // Sorted by written position, not by x: exact lesson data cannot reorder
    // itself under floating-point drift the way a reconstructed x can.
    placed.sort(
      (a, b) =>
        a.inst.loopIndex - b.inst.loopIndex || a.inst.beat - b.inst.beat || a.step - b.step,
    );

    // Notes struck together are one column with one stem, not neighbours.
    // Keyed on the written beat rather than a pixel distance, so a chord is a
    // chord at any zoom and never half-splits as the staff scrolls.
    const columns: Placed[][] = [];
    for (const n of placed) {
      const last = columns[columns.length - 1];
      const same =
        last &&
        last[0].inst.loopIndex === n.inst.loopIndex &&
        last[0].inst.beat === n.inst.beat;
      if (same) last.push(n);
      else columns.push([n]);
    }

    // Beaming runs over columns, not notes: a chord of eighths beams once.
    const groups = beamGroups(
      columns.map((c) => ({
        beat: c[0].inst.beat,
        figure: c[0].fig.figure,
        loop: c[0].inst.loopIndex,
      })),
      f.beatsPerBar,
    );
    const beamed = new Set<number>();
    for (const g of groups) for (const m of g.members) beamed.add(m);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (!col.some((n) => n.visible)) continue;
      for (const n of col) {
        this.highlight(f, n);
        this.ledgers(n);
        this.accidental(n, size);
      }
      // A single unbeamed note keeps the font's own glyph, flag and all —
      // the one case where the stemmed glyph is usable (§1.4.2).
      if (col.length === 1 && !beamed.has(i)) {
        const n = col[0];
        ctx.fillStyle = n.ink;
        ctx.font = `${size}px ${MUSIC}`;
        ctx.fillText(
          GLYPH[n.fig.figure],
          n.x - this.headHalfWidth(size),
          n.y + NOTEHEAD_EM_CENTRE * size,
        );
      } else if (!beamed.has(i)) {
        // A chord: bare heads, one shared stem. Drawing each note's own glyph
        // would stack a stem per notehead, which is not how a chord is
        // engraved and reads as a smear at this size.
        for (const n of col) this.head(n, size);
        this.stem(col, size);
      }
      for (const n of col) if (n.fig.dotted) this.dot(n);
    }

    for (const g of groups) {
      const cols = g.members.map((m) => columns[m]);
      // Drawn whole if any part of it is on screen; the canvas clips the rest,
      // which is what keeps a beam entering from the edge intact.
      if (!cols.some((c) => c.some((n) => n.visible))) continue;
      this.beamGroup(cols, g.beams, size);
    }
  }

  /**
   * A bare notehead. Hollow for a half or longer, filled below that — the
   * distinction notation carries the value in.
   *
   * An ellipse rather than a glyph, which §1.4.2 allows for exactly this
   * case: the font's stemmed glyphs bring their own stem, and a chord or a
   * beamed group needs the head without one.
   */
  private head(n: Placed, size: number): void {
    const ctx = this.ctx;
    const rx = SPACE * 0.6;
    const ry = HALF_SPACE * 0.95;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, rx, ry, -0.32, 0, Math.PI * 2);
    const hollow = n.fig.figure === "whole" || n.fig.figure === "half";
    if (hollow) {
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = n.ink;
      ctx.stroke();
    } else {
      ctx.fillStyle = n.ink;
      ctx.fill();
    }
    ctx.restore();
    void size;
  }

  /** One stem for a column, from its lowest head past its highest. */
  private stem(col: Placed[], size: number): void {
    if (col[0].fig.figure === "whole") return; // a whole note has no stem
    const ctx = this.ctx;
    const top = Math.min(...col.map((n) => n.y));
    const bottom = Math.max(...col.map((n) => n.y));
    const x = col[0].x + this.headHalfWidth(size) * 0.92;
    ctx.fillStyle = col[0].ink;
    ctx.fillRect(x - STEM_W / 2, top - STEM_LEN, STEM_W, bottom - top + STEM_LEN);
  }

  /** Absolute beat of an instance, which is what the x axis is ruled in. */
  private absBeatOf(inst: NoteInstance, f: LaneFrame): number {
    // `beat` is within the loop; the trainer spawns one instance per repeat,
    // and its `time` already carries the repeat. Convert back through the
    // clock so the two axes cannot disagree.
    return f.absBeat + (inst.time - f.now) / f.secPerBeat;
  }

  /** Half the notehead's width, for centring the glyph on its beat. */
  private headHalfWidth(size: number): number {
    // The whole note is the widest head at 0.414em; the stemmed heads are
    // about 0.299em wide including the stem's own column. Centring on the
    // head rather than the glyph box is what puts the note on its beat.
    return size * 0.13;
  }

  private highlight(f: LaneFrame, n: Placed): void {
    // The note under the playhead, before it has been judged.
    if (n.inst.resolved) return;
    const dt = Math.abs(n.inst.time - f.now);
    if (dt > f.secPerBeat * 0.25) return;
    const ctx = this.ctx;
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    ctx.fillStyle = n.ink;
    ctx.beginPath();
    ctx.arc(n.x, n.y, HIGHLIGHT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private ledgers(n: Placed): void {
    const ctx = this.ctx;
    ctx.fillStyle = n.ink;
    for (const s of ledgerSteps(n.step)) {
      const y = n.y + (n.step - s) * HALF_SPACE;
      ctx.fillRect(n.x - LEDGER_LEN / 2, y - LEDGER_W / 2, LEDGER_LEN, LEDGER_W);
    }
  }

  private accidental(n: Placed, size: number): void {
    if (accidentalFor(n.inst.lane) !== "sharp") return;
    const ctx = this.ctx;
    ctx.fillStyle = n.ink;
    ctx.font = `${size * 0.62}px ${MUSIC}`;
    ctx.fillText("♯", n.x - SPACE * 1.5, n.y + NOTEHEAD_EM_CENTRE * size * 0.62);
  }

  /**
   * The augmentation dot. `U+1D16D` is a combining mark with no advance width
   * and cannot be positioned, so it is drawn (§1.4.1). On a line it lifts into
   * the space above, which is where an engraver puts it.
   */
  private dot(n: Placed): void {
    const onLine = ((n.step % 2) + 2) % 2 === 0;
    const ctx = this.ctx;
    ctx.fillStyle = n.ink;
    ctx.beginPath();
    ctx.arc(n.x + DOT_GAP, n.y - (onLine ? HALF_SPACE : 0), DOT_R, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * A beamed run: bare heads, one stem each, and a beam per subdivision
   * (§1.4.2). The font's stemmed glyphs carry their own flags and can never be
   * used inside a group, so this is assembled from parts.
   *
   * Stems are all up. Noto Music has no stem-down variants, and the frames
   * accept that — beginner notation often does (§1.4.3).
   */
  private beamGroup(columns: Placed[][], beams: number, size: number): void {
    if (columns.length < 2) return;
    const ctx = this.ctx;

    // Every stem in a group ends on the same beam line: hang it a full stem
    // above the highest head in the whole group.
    const topY = Math.min(...columns.flat().map((n) => n.y));
    const beamY = topY - STEM_LEN;
    const stemX = (col: Placed[]) => col[0].x + this.headHalfWidth(size) * 0.92;

    for (const col of columns) {
      for (const n of col) this.head(n, size);
      const bottom = Math.max(...col.map((n) => n.y));
      ctx.fillStyle = col[0].ink;
      ctx.fillRect(stemX(col) - STEM_W / 2, beamY, STEM_W, bottom - beamY);
    }

    const x0 = stemX(columns[0]) - STEM_W / 2;
    const x1 = stemX(columns[columns.length - 1]) + STEM_W / 2;
    ctx.fillStyle = columns[0][0].ink;
    for (let b = 0; b < beams; b++) {
      ctx.fillRect(x0, beamY + b * BEAM_GAP, x1 - x0, BEAM_H);
    }

    // A broken group — a dotted eighth against a sixteenth — gets a
    // half-length stub on the stem carrying the extra beam (§1.4.2).
    for (let i = 0; i < columns.length; i++) {
      const extra = beamsOf(columns[i][0].fig) - beams;
      for (let b = 0; b < extra; b++) {
        const y = beamY + (beams + b) * BEAM_GAP;
        const sx = stemX(columns[i]);
        const back = i > 0;
        ctx.fillStyle = columns[i][0].ink;
        ctx.fillRect(back ? sx - BEAM_STUB : sx, y, BEAM_STUB, BEAM_H);
      }
    }
  }
}

/**
 * The same colour at zero alpha, for the far end of a fade.
 *
 * Canvas gradients interpolate premultiplied-ish in sRGB, so a stop of
 * `transparent` drags the colour toward black on the way out. Anything but the
 * colour's own transparent form leaves a visible cast.
 */
function fadeOut(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "rgba(0,0,0,0)";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
}

/** Beams a placed note carries, dot included (a dot never adds a beam). */
function beamsOf(fig: Engraved): number {
  return { whole: 0, half: 0, quarter: 0, eighth: 1, sixteenth: 2, thirtysecond: 3 }[fig.figure];
}
