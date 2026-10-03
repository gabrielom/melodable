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
  ACCIDENTAL,
  ACCIDENTAL_EM_CENTRE,
  BRACE,
  BRACE_INK_EM,
  CLEF_BASS,
  CLEF_INK_EM,
  CLEF_REF_EM,
  CLEF_TREBLE,
  GRAND_STEP_OFFSET,
  bassSignatureMarks,
  needsBassStaff,
  onBassStaff,
  FIGURE_BEAMS,
  FLAG,
  FLAG_EM_TIP,
  GLYPH,
  REST_GLYPH,
  REST_SEAT,
  NOTEHEAD_EM_CENTRE,
  NOTEHEAD_EM_HALF_WIDTH,
  NOTEHEAD_EM_HEIGHT,
  STEM_EM_LEN,
  stemsUp,
  beamGroups,
  figureFor,
  ledgerSteps,
  degreeLabel,
  degreeRowDrop,
  noteheadDx,
  sheetPxPerBeat,
  signatureMarks,
  smallestGap,
  spell,
  type Engraved,
  type Rest,
  type Figure,
  type SignatureMark,
} from "@/engine/notation";
import {
  RIBBON_H,
  type RibbonHits,
  WRONG_DOT_R,
  gridBeatRange,
  paintRibbon,
  ribbonBarAt,
  noteInk,
  paintCountIn,
  paintWrong,
  pxPerBeat,
} from "@/views/lane-geometry";
import { hueOf, readableInk } from "@/engine/theme";
import type { LaneFrame, LaneRenderer, VisibleWindow } from "@/views/lane-frame";
import type { NoteInstance } from "@/engine/scoring";

/** Distance between two staff lines — every other measurement scales off it. */
const SPACE = 17;
const HALF_SPACE = SPACE / 2;
const LINE_W = 1.4;
const STAFF_H = SPACE * 4;

/**
 * The clef's own column: five short staff lines, then a rule.
 *
 * This is the width with no key signature. A signature widens it — the column
 * holds clef, key and metre, and the music starts after all three — so the
 * track origin is `this.gutter`, computed per frame, and not this constant.
 */
const CLEF_GUTTER = 92;
const CLEF_RULE_W = 1;

/**
 * The grand staff: a bass staff under the treble one, drawn only for music
 * that reaches down into it (`needsBassStaff`).
 *
 * The gap is one staff height, which is what engraving uses and what leaves
 * middle C's ledger floating clear of both staves. The two staves are **not**
 * diatonically continuous across it — E4 and A3 are four steps apart but sit
 * a whole staff height apart on the page — so every note is placed against
 * its own staff's bottom line and never on one long ladder.
 */
const GRAND_GAP = SPACE * 4;

/**
 * Which line each clef names, as a **step** above its own staff's bottom line
 * — G4 is the treble's second line, F3 the bass's fourth. Steps, not spaces:
 * a step is half a space, like every other position in this file.
 */
const CLEF_LINE = { treble: 2, bass: 6 } as const;

/** The brace's column: where its ink starts, and the tail after it. */
const BRACE_X = 6;
const BRACE_TAIL = 6;
/** Its span is fixed, so its drawn width is a constant. */
const BRACE_SPAN = STAFF_H * 2 + GRAND_GAP;
const BRACE_W = BRACE_X + BRACE_SPAN * (BRACE_INK_EM.x1 - BRACE_INK_EM.x0);
/** The rule down the system's left edge, this far clear of the brace. */
const BRACE_RULE_GAP = 4;

/**
 * Where the signature starts, and the gap it leaves before the metre.
 *
 * The clef is drawn at `CLEF_X` and the first accidental has to start clear of
 * its ink (`CLEF_INK_EM`, measured off the font) — which is **not the same for
 * the two clefs**. One staff or two, the signature clears whichever clefs are
 * actually drawn, so a grand staff pushes it, and the gutter behind it, a few
 * pixels right. Change the staff size and these re-derive themselves.
 */
const CLEF_X = 10;
const SIG_GAP = 3.4;
const SIG_TAIL = 8;
/** The signature's offset within the clef column, with and without the bass clef. */
const sigStart = (grand: boolean): number =>
  CLEF_X +
  (grand ? Math.max(CLEF_INK_EM.treble, CLEF_INK_EM.bass) : CLEF_INK_EM.treble) *
    (SPACE / NOTEHEAD_EM_HEIGHT) +
  SIG_GAP;
/** 58px, which is the number this file carried by hand before it was derived. */
const SIG_X0 = sigStart(false);
const SIG_X0_GRAND = sigStart(true);
/** Accidentals are drawn smaller than a notehead, in the signature and before a note. */
const ACCIDENTAL_SCALE = 0.62;

const BARLINE_W = 1.8;
/** Beat hairlines run this much past the staff, top and bottom. */
const GRID_OVERHANG = 10;
/** The playhead runs further still, so it reads over the notes. */
const PLAYHEAD_W = 2;
const PLAYHEAD_OVERHANG = 26;

const LEDGER_LEN = 30;
const LEDGER_W = 2.6;

/**
 * Augmentation dot: the font's own is a combining mark with no advance, so it
 * is drawn.
 *
 * `DOT_CLEAR` is measured from the notehead's **right edge**, not its centre.
 * It was 7px from the centre, and a head's half-width is 9.88px at this staff
 * size — so every dot was drawn inside the note it belonged to. Nothing caught
 * it because a dotted figure needs an onset gap of exactly 1.5 beats and the
 * built-in lessons have none.
 */
const DOT_R = 2.5;
const DOT_CLEAR = 5;

/**
 * Beamed groups are assembled, not glyphs — the font has no beam.
 *
 * The stem and the stub are the catalogue's, scaled off its own 12.5px staff
 * space to ours. **The beam is not**: at `4.2px` it was `0.247` of a staff
 * space, and the printed Lavoe transcription measures `0.553` — at 600dpi,
 * where its space is 47px, its beams are 26px. Less than half weight is why a
 * bar that should read as one solid stroke came out a tangle of hairlines.
 * Held as a ratio so it survives a change of `SPACE`.
 *
 * The **separation** between stacked beams is the one number not measured
 * here: that piece is quavers throughout and has no stacked beams in it, so
 * it takes the standard `0.25` of a space. `BEAM_GAP` is beam-to-beam, which
 * is the beam plus that separation.
 *
 * This is weight only. The catalogue still governs which figure is drawn and
 * what its shape is, and every other rule on the staff — staff lines, stems,
 * barlines, ledgers — is deliberately untouched.
 */
const STEM_W = 1.8;
/** How far a stem must pass the head at its far end, when a chord is wider than a stem is long. */
const STEM_MIN_PAST = SPACE;
const BEAM_H = SPACE * 0.553;
const BEAM_GAP = SPACE * (0.553 + 0.25);
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

/**
 * The degree row: 12px bold mono, its centre 35px below the bottom staff line.
 * Both read off the frames — the row's box sits 28px below the line and is
 * 14px tall.
 *
 * That is where it goes when the music leaves room for it, and the frames'
 * music does. A note a few ledger lines down does not: A3 puts its notehead
 * *centre* 34px below the bottom line, one pixel off the row's own centre, so
 * the note and the digit naming it are drawn on top of each other. Below C4
 * the row is pushed clear instead — the same trade `sheetPxPerBeat` makes for
 * the zoom, which is the design's number unless the material collides with it
 * and then the smallest move that clears.
 */
const DEGREE_SIZE = 12;
const DEGREE_DROP = 35;
/**
 * Between the lowest ink the lesson can draw and the top of the digit's box.
 *
 * Derived from the handoff's own drop rather than picked: 35 puts the row's
 * box 29px below the line, and a C4 — one ledger down, much the commonest note
 * under the staff — bottoms out at 25.5. So the design's number *is* 3.5px of
 * clearance at C4, and using that leaves every lesson it drew exactly where it
 * drew them. Only music that goes lower than the design's own moves the row.
 */
const DEGREE_CLEAR = 3.5;
/** Between two digits of one chord. */
const DEGREE_GAP = 4;

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
  /** The same position in its *own* staff's coordinates, for ledger lines. */
  local: number;
  /** What the key leaves to be drawn before this note, if anything. */
  accidental: "sharp" | "flat" | "natural" | null;
  fig: Engraved;
  ink: string;
  laneIndex: number;
  /** On screen this frame. Culling decides what is *drawn*, never how the
   *  music is grouped — see `notes`. */
  visible: boolean;
}

/**
 * Notes struck together, gathered into columns of one shared stem.
 *
 * Keyed on the written beat rather than a pixel distance, so a chord is a
 * chord at any zoom and never half-splits as the staff scrolls. Takes an
 * already-sorted list: `notes` sorts once and slices it per staff.
 */
function columnsOf(placed: readonly Placed[]): Placed[][] {
  const columns: Placed[][] = [];
  for (const n of placed) {
    const last = columns[columns.length - 1];
    const same =
      last && last[0].inst.loopIndex === n.inst.loopIndex && last[0].inst.beat === n.inst.beat;
    if (same) last.push(n);
    else columns.push([n]);
  }
  return columns;
}

/**
 * The staves this frame is drawing, and how a spelled step lands on them.
 *
 * One object so the drawing code never has to ask "grand or not" again: it
 * asks where a step goes and gets an answer either way.
 */
interface System {
  grand: boolean;
  /** Top line of the treble staff, and its bottom. */
  trebleTop: number;
  trebleBottom: number;
  /** The bass staff's, equal to the treble's when there is no bass staff. */
  bassTop: number;
  bassBottom: number;
  /** The whole system's extent, for the grid, the barlines and the playhead. */
  top: number;
  bottom: number;
  /** Whether a step goes on the bass staff — false outright when there isn't one. */
  bass(step: number): boolean;
  /** Canvas y of a step spelled against the treble staff's bottom line. */
  yOf(step: number): number;
  /** That step in its own staff's coordinates — what ledger lines count in. */
  localOf(step: number): number;
}

export class SheetStaff implements LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private window: VisibleWindow = { behind: 0, ahead: 0 };
  /** Left column's width this frame: brace, clef, key signature and metre. */
  private gutter = CLEF_GUTTER;
  /** The brace's own column in front of the clef, or 0 with one staff. */
  private braceW = 0;
  /** Where the signature starts inside the clef column, this frame. */
  private sigX0 = SIG_X0;

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


  /** Where the ribbon's blocks landed in the last paint. */
  private ribbon: RibbonHits | null = null;

  ribbonBarAt(x: number, y: number): number | null {
    return ribbonBarAt(this.ribbon, x, y);
  }

  visibleBeats(): VisibleWindow {
    return this.window;
  }

  draw(f: LaneFrame): void {
    const ctx = this.ctx;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    ctx.clearRect(0, 0, W, H);

    // The key signature lives in the gutter, so it sets the track's origin.
    const marks = signatureMarks(f.keyFifths);
    const grand = needsBassStaff(f.hueOrder, f.staffSplit);
    // The brace takes a column of its own in front of the clef rather than
    // sitting on top of it, so the gutter grows by exactly its width — and by
    // the few pixels the wider bass clef pushes the signature, so the metre
    // keeps the clearance the design's 92 gave it.
    this.braceW = grand ? BRACE_W + BRACE_TAIL : 0;
    this.sigX0 = grand ? SIG_X0_GRAND : SIG_X0;
    this.gutter =
      CLEF_GUTTER + (this.sigX0 - SIG_X0) + this.braceW + this.signatureWidth(marks);
    const trackX = this.gutter;
    const trackW = Math.max(1, W - trackX);

    // The staff sits above the space the keyboard leaves, centred in what is
    // left rather than pinned, so the view breathes at any window height. The
    // ribbon takes a band off the bottom before that centring happens.
    const ribbon = f.chords.length > 0 ? RIBBON_H : 0;
    const fieldH = H - ribbon;
    const sys = this.system(f, fieldH);

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
    // Staff position of a pitch, as a y on the canvas — on whichever staff it
    // belongs to, which is the only thing that changes about any of this.
    const yOfStep = (step: number) => sys.yOf(step);

    this.grid(f, trackX, W, sys, xOfBeat);
    this.staffLines(ctx, trackX, W - trackX, sys.trebleTop, p.txt3);
    if (sys.grand) this.staffLines(ctx, trackX, W - trackX, sys.bassTop, p.txt3);
    this.notes(f, xOfBeat, sys);

    // A wrong strike, on the staff line of the note actually played. Notation
    // has a place for every pitch, so this one is never homeless the way a
    // lane outside the roll's range is.
    for (const m of f.wrongMarks) {
      const beat = f.absBeat + (m.time - f.now) / f.secPerBeat;
      paintWrong(ctx, xOfBeat(beat), yOfStep(spell(m.lane, f.keyFifths).step),
        WRONG_DOT_R, p.rating.miss, p.lane);
    }

    this.historyFade(f, trackX, hitX, fieldH);

    this.clefGutter(f, marks, sys);

    if (ribbon > 0) {
      this.ribbon = paintRibbon(ctx, {
        chords: f.chords,
        beatsPerBar: f.beatsPerBar,
        absBeat: f.absBeat,
        fromBeat: f.absBeat - this.window.behind,
        toBeat: f.absBeat + this.window.ahead,
        keyFifths: f.keyFifths,
        overridden: f.chordOverrides,
        xOfBeat,
        palette: p,
        theme: f.theme,
        x: 0,
        w: W,
        y: fieldH,
        // Sheet's label column is inside the canvas — the clef gutter — so
        // the ribbon's own label lines up with it.
        gutter: trackX,
      });
    }


    // Playhead last of the chrome, so it reads over the notation.
    ctx.fillStyle = p.head;
    ctx.fillRect(
      Math.round(hitX) - PLAYHEAD_W / 2,
      sys.top - PLAYHEAD_OVERHANG,
      PLAYHEAD_W,
      // Carried down through the ribbon when there is one, so the strip and
      // the staff can never look like they disagree about where you are.
      ribbon > 0
        ? H - (sys.top - PLAYHEAD_OVERHANG)
        : sys.bottom - sys.top + PLAYHEAD_OVERHANG * 2,
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

  /**
   * Lay out the staves for this frame.
   *
   * A grand staff only when the lesson reaches below two ledger lines; a
   * melody that merely dips keeps the single treble staff it has always had,
   * because splitting one line of music across two staves reads far worse
   * than a couple of ledgers. The whole system is centred in the field, so
   * adding the bass staff lifts the treble rather than pushing the music off
   * the bottom.
   */
  private system(f: LaneFrame, fieldH: number): System {
    // Where the hands divide, decided by the lesson rather than by C4.
    const split = f.staffSplit;
    const grand = needsBassStaff(f.hueOrder, split);
    const height = grand ? STAFF_H * 2 + GRAND_GAP : STAFF_H;
    const trebleTop = Math.round((fieldH - height) / 2);
    const trebleBottom = trebleTop + STAFF_H;
    const bassTop = grand ? trebleBottom + GRAND_GAP : trebleTop;
    const bassBottom = bassTop + STAFF_H;
    return {
      grand,
      trebleTop,
      trebleBottom,
      bassTop,
      bassBottom,
      top: trebleTop,
      bottom: grand ? bassBottom : trebleBottom,
      bass: (step) => grand && onBassStaff(step, split),
      yOf: (step) =>
        grand && onBassStaff(step, split)
          ? bassBottom - (step + GRAND_STEP_OFFSET) * HALF_SPACE
          : trebleBottom - step * HALF_SPACE,
      localOf: (step) =>
        grand && onBassStaff(step, split) ? step + GRAND_STEP_OFFSET : step,
    };
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
    sys: System,
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
        // A barline runs the whole system, joining the two staves — which is
        // what says they are one instrument and not two parts.
        ctx.fillStyle = f.palette.txt3;
        ctx.fillRect(
          Math.round(x) - BARLINE_W / 2,
          sys.top,
          BARLINE_W,
          sys.bottom - sys.top + LINE_W / 2,
        );
      } else {
        ctx.fillStyle = f.palette.grid;
        ctx.fillRect(
          Math.round(x),
          sys.top - GRID_OVERHANG,
          1,
          sys.bottom - sys.top + GRID_OVERHANG * 2,
        );
      }
    }
  }

  /**
   * How much width the key signature needs, measured rather than assumed —
   * the advance of the glyph the font actually has, so the column fits it at
   * any staff size and for either accidental.
   */
  private signatureWidth(marks: readonly SignatureMark[]): number {
    if (marks.length === 0) return 0;
    const ctx = this.ctx;
    ctx.font = `${(SPACE / NOTEHEAD_EM_HEIGHT) * ACCIDENTAL_SCALE}px ${MUSIC}`;
    let w = 0;
    for (const m of marks) w += ctx.measureText(ACCIDENTAL[m.accidental]).width;
    return w + SIG_TAIL;
  }

  /** The clef's column: its own staff lines, the clef, the key, 4/4, a rule. */
  private clefGutter(f: LaneFrame, marks: readonly SignatureMark[], sys: System): void {
    const ctx = this.ctx;
    const p = f.palette;
    const gutter = this.gutter;

    // Opaque, so notation scrolling off the left disappears behind it.
    ctx.fillStyle = p.lane;
    ctx.fillRect(0, 0, gutter, this.el.clientHeight);
    this.staffLines(ctx, 0, gutter, sys.trebleTop, p.txt3);
    if (sys.grand) this.staffLines(ctx, 0, gutter, sys.bassTop, p.txt3);

    const size = SPACE / NOTEHEAD_EM_HEIGHT;
    ctx.fillStyle = p.txt;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    if (sys.grand) {
      // The brace, and the rule down the system's left edge. Both say the two
      // staves are one instrument; the brace is what says it is a keyboard.
      // The glyph fills its em box top to bottom, so at font size `span` on a
      // baseline of `sys.bottom` it lands on both staves' outer lines exactly;
      // the pen goes back by the left bearing so the ink starts at BRACE_X.
      const span = sys.bottom - sys.top;
      ctx.font = `${span}px ${MUSIC}`;
      ctx.fillText(BRACE, BRACE_X - span * BRACE_INK_EM.x0, sys.bottom);
      ctx.fillRect(BRACE_W + BRACE_RULE_GAP, sys.top, LINE_W, span);
    }

    const clefX = this.braceW + CLEF_X;
    // The treble clef curls around G4 and the bass clef's dots straddle F3 —
    // each seated on its own line, by its own measured reference.
    this.clef(CLEF_TREBLE, "treble", clefX, sys.trebleBottom, size, p.txt);
    if (sys.grand) this.clef(CLEF_BASS, "bass", clefX, sys.bassBottom, size, p.txt);

    // The key signature, between clef and metre — where a reader looks for it,
    // and the reason a note in the key needs no accidental of its own. Both
    // staves carry it, the bass clef's written a third lower.
    const accSize = size * ACCIDENTAL_SCALE;
    ctx.font = `${accSize}px ${MUSIC}`;
    this.signature(marks, this.braceW + this.sigX0, sys.trebleBottom, accSize);
    if (sys.grand) {
      this.signature(
        bassSignatureMarks(f.keyFifths),
        this.braceW + this.sigX0,
        sys.bassBottom,
        accSize,
      );
    }

    // Time signature, stacked in the two halves of each staff.
    ctx.font = `600 ${SPACE * 1.5}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const sigX = gutter - 24;
    const metre = (top: number) => {
      ctx.fillText(String(f.beatsPerBar), sigX, top + SPACE);
      ctx.fillText("4", sigX, top + SPACE * 3);
    };
    metre(sys.trebleTop);
    if (sys.grand) metre(sys.bassTop);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = p.hair;
    ctx.fillRect(gutter - CLEF_RULE_W, 0, CLEF_RULE_W, this.el.clientHeight);
  }

  /** A clef, seated on the line it names by its own measured reference. */
  private clef(
    glyph: string,
    which: "treble" | "bass",
    x: number,
    bottomLineY: number,
    size: number,
    ink: string,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = ink;
    ctx.font = `${size}px ${MUSIC}`;
    // A step is *half* a space — the same unit every other position here uses.
    ctx.fillText(
      glyph,
      x,
      bottomLineY - CLEF_LINE[which] * HALF_SPACE + CLEF_REF_EM[which] * size,
    );
  }

  /** A run of signature accidentals, in a staff's own coordinates. */
  private signature(
    marks: readonly SignatureMark[],
    x0: number,
    bottomLineY: number,
    accSize: number,
  ): void {
    const ctx = this.ctx;
    let x = x0;
    for (const m of marks) {
      const glyph = ACCIDENTAL[m.accidental];
      ctx.fillText(
        glyph,
        x,
        bottomLineY - m.step * HALF_SPACE + ACCIDENTAL_EM_CENTRE[m.accidental] * accSize,
      );
      x += ctx.measureText(glyph).width;
    }
  }

  // ------------------------------------------------------------ the notes

  private notes(f: LaneFrame, xOfBeat: (b: number) => number, sys: System): void {
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
      // Spelled in the lesson's key, so a note the signature already covers
      // arrives bare and one outside it says so.
      const { step, accidental } = spell(inst.lane, f.keyFifths);
      const laneIndex = Math.max(0, f.hueOrder.indexOf(inst.lane));
      placed.push({
        inst,
        x,
        y: sys.yOf(step),
        step,
        // Ledger lines count from the note's *own* staff, so a low left-hand
        // note gets them off the bass staff and not off the treble one it is
        // nowhere near.
        local: sys.localOf(step),
        accidental,
        fig: f.noteValues.get(inst.beat) ?? figureFor(inst.duration),
        ink: noteInk(f, inst, laneIndex),
        laneIndex,
        visible: x >= this.gutter - 60 && x <= W + 60,
      });
    }
    // Sorted by written position, not by x: exact lesson data cannot reorder
    // itself under floating-point drift the way a reconstructed x can.
    placed.sort(
      (a, b) =>
        a.inst.loopIndex - b.inst.loopIndex || a.inst.beat - b.inst.beat || a.step - b.step,
    );

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // **A stem belongs to one staff.** On a grand staff the two hands strike
    // together constantly, and keying a column on the beat alone made those
    // notes one chord: a single stem ran from the right hand's head down
    // through the gap into the left hand's, and a beam joined them across it.
    // A hand is engraved on its own staff, so the heads, stems and beams are
    // built per staff and only the degree row — which names what is *sounding*,
    // not what is written where — spans both.
    if (sys.grand) {
      for (const bass of [true, false]) {
        this.engrave(
          f,
          columnsOf(placed.filter((n) => sys.bass(n.step) === bass)),
          size,
          bass ? f.rests.bass : f.rests.treble,
        );
      }
      this.rests(f, f.rests.treble, sys.trebleBottom, xOfBeat, size);
      this.rests(f, f.rests.bass, sys.bassBottom, xOfBeat, size);
    } else {
      this.engrave(f, columnsOf(placed), size, f.rests.treble);
      // One staff, so `rests.treble` already holds the whole lesson's silences
      // and `rests.bass` is empty — the split happens where the staves do.
      this.rests(f, f.rests.treble, sys.trebleBottom, xOfBeat, size);
    }

    if (f.labelMode === "degree") {
      this.degreeRow(f, columnsOf(placed), this.degreeRowY(f, sys));
    }
  }

  /**
   * One staff's rests, repeated for every pass of the pattern on screen.
   *
   * Placed from the pattern beat like the barlines rather than from a note
   * instance, because a rest is not a note: nothing spawns it, nothing scores
   * it, and it has no rating to wear. It takes `palette.txt` for the same
   * reason — a silence is notation, never a result, so it stays outside the
   * two colour languages entirely.
   */
  private rests(
    f: LaneFrame,
    rests: readonly Rest[],
    bottomLineY: number,
    xOfBeat: (b: number) => number,
    size: number,
  ): void {
    if (rests.length === 0 || f.loopBeats <= 0) return;
    const ctx = this.ctx;
    const W = this.el.clientWidth;
    const from = f.absBeat - this.window.behind;
    const to = f.absBeat + this.window.ahead;
    const firstPass = Math.floor(from / f.loopBeats);
    const lastPass = Math.ceil(to / f.loopBeats);

    ctx.save();
    ctx.fillStyle = f.palette.txt;
    ctx.font = `${size}px ${MUSIC}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    for (let pass = firstPass; pass <= lastPass; pass++) {
      const origin = pass * f.loopBeats;
      for (const r of rests) {
        const x = xOfBeat(origin + r.beat);
        if (x < this.gutter - 40 || x > W + 40) continue;
        const seat = REST_SEAT[r.figure];
        ctx.fillText(
          REST_GLYPH[r.figure],
          x - seat.dx * size,
          bottomLineY - seat.step * HALF_SPACE + seat.em * size,
        );
      }
    }
    ctx.restore();
  }

  /** Heads, stems and beams for one staff's worth of columns. */
  private engrave(
    f: LaneFrame,
    columns: Placed[][],
    size: number,
    rests: readonly Rest[],
  ): void {
    // Beaming runs over columns, not notes: a chord of eighths beams once.
    // The staff's own rests go in too — a beam stops at a silence.
    const groups = beamGroups(
      columns.map((c) => ({
        beat: c[0].inst.beat,
        figure: c[0].fig.figure,
        loop: c[0].inst.loopIndex,
      })),
      f.beatsPerBar,
      rests.map((r) => r.beat),
    );
    const beamed = new Set<number>();
    for (const g of groups) for (const m of g.members) beamed.add(m);

    // Which way each column's stem goes. A beam is one unbroken line, so a
    // whole group answers together off every note under it; a lone column
    // answers for itself. Positions are each note's place on **its own**
    // staff (`local`), so the two hands of a grand staff decide separately.
    const up = new Map<number, boolean>();
    for (const g of groups) {
      const dir = stemsUp(g.members.flatMap((m) => columns[m].map((n) => n.local)));
      for (const m of g.members) up.set(m, dir);
    }
    for (let i = 0; i < columns.length; i++) {
      if (!up.has(i)) up.set(i, stemsUp(columns[i].map((n) => n.local)));
    }

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (!col.some((n) => n.visible)) continue;
      for (const n of col) {
        this.highlight(f, n);
        this.ledgers(n);
        this.accidental(n, size);
      }
      if (!beamed.has(i)) this.column(col, size, up.get(i) ?? true);
      for (const n of col) if (n.fig.dotted) this.dot(n, size);
    }

    for (const g of groups) {
      const cols = g.members.map((m) => columns[m]);
      // Drawn whole if any part of it is on screen; the canvas clips the rest,
      // which is what keeps a beam entering from the edge intact.
      if (!cols.some((c) => c.some((n) => n.visible))) continue;
      this.beamGroup(cols, g.beams, size, up.get(g.members[0]) ?? true);
    }
  }

  /**
   * One column of heads, and the stem and flag that belong to it.
   *
   * Everything but the whole note is **assembled** now, where a lone note used
   * to take the font's composed glyph. The glyphs are stem-up only, so using
   * them meant a note high on the staff kept a stem climbing away from it
   * while the chord beside it had a short drawn one — two paths that disagreed
   * about both the direction and the length of the same thing. `STEM_EM_LEN`
   * and `FLAG_EM_TIP` are read off those glyphs, so the assembled note is the
   * glyph's twin and there is one path left.
   */
  private column(col: Placed[], size: number, up: boolean): void {
    const ctx = this.ctx;
    const figure = col[0].fig.figure;
    if (figure === "whole") {
      // The one figure still taken from the font: it has no stem, so nothing
      // to point, and its head is a good deal wider than a stemmed one — a
      // difference the glyph carries and the drawn ellipse does not.
      ctx.font = `${size}px ${MUSIC}`;
      for (const n of col) {
        ctx.fillStyle = n.ink;
        ctx.fillText(
          GLYPH.whole,
          n.x - this.headHalfWidth(size, "whole"),
          n.y + NOTEHEAD_EM_CENTRE * size,
        );
      }
      return;
    }
    for (const n of col) this.head(n, size);
    this.stem(col, size, up);
    const flags = FIGURE_BEAMS[figure];
    if (flags > 0) this.flag(col, size, up, flags);
  }

  /** A flag, hung off the stem's tip — mirrored about it when the stem is down. */
  private flag(col: Placed[], size: number, up: boolean, flags: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = col[0].ink;
    ctx.font = `${size}px ${MUSIC}`;
    // The flag's ink starts at its own pen, so the pen goes on the stem's
    // outer edge — the side the flag curls away from.
    const x = this.stemX(col, size, up) - STEM_W / 2;
    const tip = this.stemTip(col, size, up);
    if (up) {
      ctx.fillText(FLAG[flags], x, tip + FLAG_EM_TIP * size);
    } else {
      // Flipping about the tip puts the flag's attachment on the stem's
      // bottom and curls it back up, which is the down-stem shape.
      ctx.translate(0, tip);
      ctx.scale(1, -1);
      ctx.fillText(FLAG[flags], x, FLAG_EM_TIP * size);
    }
    ctx.restore();
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
    // The glyph's own head, measured: half a staff space tall and
    // `NOTEHEAD_EM_HALF_WIDTH` either side. Fudged multiples of the staff
    // space drew it 3% wide and 5% short of the glyph beside it.
    const rx = size * NOTEHEAD_EM_HALF_WIDTH;
    const ry = HALF_SPACE;
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
  /**
   * The degree row under the staff (handoff 11 §1.2).
   *
   * A notehead is 17px of solid ink and carries no text, so unlike the roll
   * there is nowhere to put the label *inside* it. It goes on its own line
   * below the staff and above the keyboard, which is also where Hooktheory
   * puts its numerals.
   *
   * Centred on `x`, which is the notehead's centre and not the glyph's ink —
   * an eighth note's flag reaches right, and centring on ink would put the
   * digit several pixels off a note whose head is exactly where a quarter's
   * would be.
   *
   * A chord shares one x, so its digits are set side by side and the group is
   * centred on the column. The frames do not draw that case; a single note is
   * unaffected, and stacking them was not an option in a one-line row.
   */
  /**
   * Where the degree row sits, given how far below the staff this lesson goes.
   *
   * Off the *lesson's* lowest note, not the lowest one on screen: the row must
   * hold still while the music scrolls past it, and a row that jumped whenever
   * a low note came into view would be worse than one sitting on a notehead.
   */
  private degreeRowY(f: LaneFrame, sys: System): number {
    const base = sys.grand ? sys.bassBottom : sys.trebleBottom;
    const lowest = f.hueOrder[0];
    if (lowest === undefined) return base + DEGREE_DROP;
    // In the staff the lowest note actually sits on — on a grand staff that is
    // the bass one, where the same note needs far fewer ledgers, so the row
    // barely has to give at all.
    return (
      base +
      degreeRowDrop(
        sys.localOf(spell(lowest, f.keyFifths).step),
        HALF_SPACE,
        DEGREE_DROP,
        DEGREE_CLEAR,
        DEGREE_SIZE,
      )
    );
  }

  private degreeRow(f: LaneFrame, cols: Placed[][], y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 ${DEGREE_SIZE}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const col of cols) {
      if (!col[0].visible) continue;
      // Low note first, so a chord reads bottom-up the way the staff does.
      const sorted = [...col].sort((a, b) => a.step - b.step);
      const parts = sorted.map((n) => ({
        text: degreeLabel(n.inst.lane, f.keyFifths),
        // The note's own hue, walked toward the paper's opposite until it is
        // readable — a dimmed instrument tint on staff paper fails outright.
        ink: readableInk(hueOf(f.palette, f.instrument, n.laneIndex).full, f.theme, f.palette.lane),
      }));
      const widths = parts.map((q) => ctx.measureText(q.text).width);
      const total = widths.reduce((a, b) => a + b, 0) + DEGREE_GAP * (parts.length - 1);
      let x = col[0].x - total / 2;
      parts.forEach((q, i) => {
        ctx.fillStyle = q.ink;
        ctx.fillText(q.text, x, y);
        x += widths[i] + DEGREE_GAP;
      });
    }
    ctx.restore();
  }

  /**
   * The stem runs from the head at its own end of the column to the tip: a
   * chord's stem spans all its heads and then stands the full length clear of
   * the outermost one.
   */
  private stem(col: Placed[], size: number, up: boolean): void {
    if (col[0].fig.figure === "whole") return; // a whole note has no stem
    const ctx = this.ctx;
    const tip = this.stemTip(col, size, up);
    const foot = up ? Math.max(...col.map((n) => n.y)) : Math.min(...col.map((n) => n.y));
    ctx.fillStyle = col[0].ink;
    ctx.fillRect(
      this.stemX(col, size, up) - STEM_W / 2,
      Math.min(tip, foot),
      STEM_W,
      Math.abs(foot - tip),
    );
  }

  /** The free end of a column's stem, a full stem clear of the outermost head. */
  private stemTip(col: Placed[], size: number, up: boolean): number {
    return this.tipOf(
      col.map((n) => n.y),
      size,
      up,
    );
  }

  /**
   * The free end of a stem, measured from the head the stem **starts** at.
   *
   * Which head that is, is the whole of it. A stem-up chord's stem rises out
   * of its *lowest* note, so its length is a full stem above that — and the
   * notes above are simply passed on the way. Measuring from the far head
   * instead adds the chord's own span to every stem: a chord spanning a fifth
   * got three and a half spaces plus a fifth, a beamed group spanning an
   * octave got three and a half plus an octave, and on a grand staff those
   * stems and their beams sprawled out of the staff and into the gap, where
   * they tangled with the other hand's ledger lines. That is what "it still
   * looks really bad" was: not the spacing, which measures within a tenth of a
   * space of the printed score, but every stem being half again too long.
   *
   * The clamp is the other half of the rule: a chord wider than a stem is
   * long still needs its stem to pass the far head, so it grows to
   * `STEM_MIN_PAST` beyond it and no further.
   */
  private tipOf(
    heads: readonly number[],
    size: number,
    up: boolean,
    reserve = 0,
  ): number {
    const len = STEM_EM_LEN * size;
    const top = Math.min(...heads);
    const bottom = Math.max(...heads);
    // `reserve` is ink that will sit *inside* the tip — the beam stack. Without
    // it the clamp measures to the stem's end and the beam then grows back
    // toward the notehead, so a thick beam eats the clearance it was supposed
    // to keep: at one space past the head a 0.55-space beam leaves 0.45 of
    // visible stem. Reserving its thickness keeps the clear stem the same
    // whatever the beam weighs.
    const past = STEM_MIN_PAST + reserve;
    return up ? Math.min(bottom - len, top - past) : Math.max(top + len, bottom + past);
  }

  /**
   * Where a stem attaches to a drawn head — its right edge, and nothing else.
   *
   * The head's own half-width, the same measured number `head` draws with.
   * Two copies of this offset is what came apart: `beamGroup` kept its own
   * `headHalfWidth(size) * 0.92`, which tracked the *glyph* seating rather
   * than the head, and when that seating became per-figure the stems in every
   * beamed group stood 2.3px clear of the heads they belonged to. One
   * function, read by both callers, is what keeps them touching.
   */
  private stemX(col: Placed[], size: number, up: boolean): number {
    // An up-stem rises from the head's right edge and a down-stem falls from
    // its left — the side it leaves the head on is part of the convention,
    // not a detail, and a down-stem on the right reads as a mistake.
    return col[0].x + (up ? 1 : -1) * size * NOTEHEAD_EM_HALF_WIDTH;
  }

  /**
   * A beamed run: bare heads, one stem each, and a beam per subdivision
   * (§1.4.2). The font's stemmed glyphs carry their own flags and can never be
   * used inside a group, so this is assembled from parts — the notation set
   * catalogued under handoff 12's frames is the reference for every figure,
   * and it draws beams even though the trainer staff beside it happens to
   * hold no group short enough to need one.
   *
   * The whole group takes **one** direction, decided by its own outermost
   * note, and the beam sits on the far side of the heads from them: above for
   * stems up, below for stems down. Beams after the first stack back *toward*
   * the heads, so the outermost beam is always the one the stems reach.
   */
  private beamGroup(columns: Placed[][], beams: number, size: number, up: boolean): void {
    if (columns.length < 2) return;
    const ctx = this.ctx;

    // Every stem in a group ends on the same beam line: a full stem clear of
    // the outermost head in the group, on the side the stems point.
    // The whole stack has to clear the nearest head, not just the first beam.
    const stack = BEAM_H + (beams - 1) * BEAM_GAP;
    const beamY = this.tipOf(columns.flat().map((n) => n.y), size, up, stack);

    for (const col of columns) {
      for (const n of col) this.head(n, size);
      const foot = up ? Math.max(...col.map((n) => n.y)) : Math.min(...col.map((n) => n.y));
      ctx.fillStyle = col[0].ink;
      ctx.fillRect(
        this.stemX(col, size, up) - STEM_W / 2,
        Math.min(beamY, foot),
        STEM_W,
        Math.abs(foot - beamY),
      );
    }

    /** The top of beam `b`, counting outward-in from the stems' tips. */
    const beamTop = (b: number) => (up ? beamY + b * BEAM_GAP : beamY - b * BEAM_GAP - BEAM_H);

    const x0 = this.stemX(columns[0], size, up) - STEM_W / 2;
    const x1 = this.stemX(columns[columns.length - 1], size, up) + STEM_W / 2;
    ctx.fillStyle = columns[0][0].ink;
    for (let b = 0; b < beams; b++) ctx.fillRect(x0, beamTop(b), x1 - x0, BEAM_H);

    // A broken group — a dotted eighth against a sixteenth — gets a
    // half-length stub on the stem carrying the extra beam (§1.4.2).
    for (let i = 0; i < columns.length; i++) {
      const extra = FIGURE_BEAMS[columns[i][0].fig.figure] - beams;
      for (let b = 0; b < extra; b++) {
        const sx = this.stemX(columns[i], size, up);
        const back = i > 0;
        ctx.fillStyle = columns[i][0].ink;
        ctx.fillRect(back ? sx - BEAM_STUB : sx, beamTop(beams + b), BEAM_STUB, BEAM_H);
      }
    }
  }

  /** Absolute beat of an instance, which is what the x axis is ruled in. */
  private absBeatOf(inst: NoteInstance, f: LaneFrame): number {
    // `beat` is within the loop; the trainer spawns one instance per repeat,
    // and its `time` already carries the repeat. Convert back through the
    // clock so the two axes cannot disagree.
    return f.absBeat + (inst.time - f.now) / f.secPerBeat;
  }

  /** Half the notehead's width, for centring the glyph on its beat. */
  /**
   * How far to shift a glyph left so its *notehead* lands on `n.x`.
   *
   * Per figure, not one value for all: a whole note's head is 0.414em wide and
   * sits further into the glyph box than a stemmed head does. This used to be
   * a single fudged 0.13em, which put every glyph-drawn note about 5px right
   * of where the bare heads in a chord or a beamed group were being drawn —
   * the two paths disagreed about the same beat. Handoff 11 §1.2 names the
   * constant and warns against deriving it from ink bounds; a flag would drag
   * the answer several pixels right.
   */
  private headHalfWidth(size: number, figure: Figure = "quarter"): number {
    return size * noteheadDx(figure);
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
    for (const s of ledgerSteps(n.local)) {
      const y = n.y + (n.local - s) * HALF_SPACE;
      ctx.fillRect(n.x - LEDGER_LEN / 2, y - LEDGER_W / 2, LEDGER_LEN, LEDGER_W);
    }
  }

  private accidental(n: Placed, size: number): void {
    if (!n.accidental) return;
    const ctx = this.ctx;
    const accSize = size * ACCIDENTAL_SCALE;
    ctx.fillStyle = n.ink;
    ctx.font = `${accSize}px ${MUSIC}`;
    ctx.fillText(
      ACCIDENTAL[n.accidental],
      n.x - SPACE * 1.5,
      n.y + ACCIDENTAL_EM_CENTRE[n.accidental] * accSize,
    );
  }

  /**
   * The augmentation dot. `U+1D16D` is a combining mark with no advance width
   * and cannot be positioned, so it is drawn (§1.4.1). On a line it lifts into
   * the space above, which is where an engraver puts it.
   */
  private dot(n: Placed, size: number): void {
    // A dot on a line is unreadable, so it goes in the space above — which is
    // also why it is placed off the head's edge rather than its centre.
    const onLine = ((n.step % 2) + 2) % 2 === 0;
    const ctx = this.ctx;
    ctx.fillStyle = n.ink;
    ctx.beginPath();
    ctx.arc(
      n.x + size * NOTEHEAD_EM_HALF_WIDTH + DOT_CLEAR + DOT_R,
      n.y - (onLine ? HALF_SPACE : 0),
      DOT_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();
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
