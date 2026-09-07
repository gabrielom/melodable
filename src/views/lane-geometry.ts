/**
 * Shared geometry and field furniture for the note lanes — the rules both
 * renderers obey, in one place, so pads and piano can't drift apart.
 *
 * The maths is pure; the two painters take a context and are the only part
 * that touches canvas. The trainer's viewport rectangle is derived from the
 * same numbers that position the notes, so the overview strip can never
 * disagree with what is actually on screen.
 */

import { contrastRatio, hueOf, type HueName, type Palette, type Theme } from "@/engine/theme";
import { chordName, romanOf, type Chord } from "@/engine/harmony";
import type { NoteInstance } from "@/engine/scoring";
import type { LaneFrame } from "@/views/lane-frame";

/**
 * The colour a note wears, and the one rule both renderers obey.
 *
 * A note is either a **target** — it takes its lane's hue, dimmed, and says
 * *what* to hit — or a **result**, in which case it takes its timing colour
 * and says *how well*. The two palettes share no value, so a dimmed target can
 * never be misread as a judgement.
 *
 * The switch is `resolved` rather than which side of the playhead the note is
 * on. They amount to the same line, and only `resolved` is answerable: a note
 * sitting exactly on the playhead has no result yet — it is still there to be
 * struck — so there is no timing colour to give it.
 *
 * During the count-in nothing has been judged at all, so everything takes its
 * tint whatever the scorer says. A count-in showing greens and ambers would be
 * showing results that do not exist.
 *
 * `colourMode` (sheet only) can silence either system independently
 * (handoff 12). `targets` keeps the hues and stops judgement recolouring a
 * played note — it takes its own tint at *full* strength instead, so it still
 * reads as played without being marked. `mono` drops both to the staff ink,
 * the printed page, where a notehead's colour says nothing and its position
 * says everything. Neither changes what the scorer does.
 */
export function noteInk(
  f: Pick<LaneFrame, "palette" | "instrument" | "countIn" | "colourMode">,
  inst: Pick<NoteInstance, "resolved" | "rating">,
  laneIndex: number,
): string {
  if (f.colourMode === "mono") return f.palette.txt;
  const hue = hueOf(f.palette, f.instrument, laneIndex);
  const judged = inst.resolved && inst.rating && !f.countIn;
  if (!judged) return hue.dim;
  return f.colourMode === "targets" ? hue.full : f.palette.rating[inst.rating!];
}

// ------------------------------------------------------- wrong notes

/** A strike that hit nothing, and when it landed. */
export interface WrongMark {
  lane: number;
  /** Audio-clock time of the strike. */
  time: number;
}

/**
 * A wrong strike is a small dot, and it **scrolls with the music** rather than
 * flashing at the playhead.
 *
 * Pinned to the playhead it would be a half-second flash and then nothing —
 * gone before you could look at it, and telling you only that something was
 * wrong, not where. Left in the timeline at the position it was struck, the
 * played-out half of the lane becomes a record you can read after the fact:
 * three dots crowding a beat says you are rushing that beat, and they stay
 * there until they scroll away like everything else.
 *
 * Small, because it is not a note. A note is something the lesson asked for
 * and has a lane and a length; this is a mark on the page where you played
 * something that was not asked for.
 */
export const WRONG_DOT_R = 3.6;

/**
 * Paint a wrong strike: a small filled dot, never anything note-shaped.
 *
 * Size is what separates it from a missed target. Both are red — both are
 * results, and the rating language has one red — but a miss is a note of the
 * lesson you did not play, and this is a note you played that the lesson did
 * not contain. Drawn at note size the two would be indistinguishable exactly
 * when they overlap, which is when both are happening.
 *
 * `behind` rings the dot in the bed colour so it still reads sitting on top of
 * a missed note, which is the same red — again, the case that matters most.
 */
export function paintWrong(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: string,
  behind: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.strokeStyle = behind;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------- chord ribbon

/** The strip's height (handoff 11 §1.4). */
export const RIBBON_H = 38;
/** The numeral is set in a serif; the absolute name under it in the app's mono. */
const RIBBON_SERIF = 'Georgia, "Times New Roman", serif';
const RIBBON_MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Which hue names each function.
 *
 * §1.4 names four — I blue, IV teal, V bronze, vi violet — and leaves the
 * other three, so those are ours: cool for the pre-dominants, warm for the
 * leading tone. Taken from the instrument palette rather than invented, so the
 * ribbon cannot introduce a colour the app does not already own.
 */
const FUNCTION_HUE: readonly HueName[] = [
  "blue", "indigo", "plum", "teal", "bronze", "violet", "olive",
];

/** The two inks a block may take. Contrast-picked, never alpha-muted (§1.4). */
const BLOCK_INK = ["#f7f9fb", "#08131a"] as const;

export interface RibbonFrame {
  /** One entry per bar of the loop; null where a bar has no notes. */
  chords: readonly (Chord | null)[];
  beatsPerBar: number;
  /** Absolute beat under the playhead. */
  absBeat: number;
  fromBeat: number;
  toBeat: number;
  /** The key the chords are named in. */
  keyFifths: number;
  xOfBeat: (beat: number) => number;
  palette: Palette;
  theme: Theme;
  /** Left edge of the strip, and its width. */
  x: number;
  w: number;
  /** Top of the strip. */
  y: number;
  /** Label column inside the strip, or 0 when the view has none. */
  gutter: number;
}

/**
 * The chord ribbon: one block per bar, under the field.
 *
 * A map, not a score — **it never takes a timing colour**, whatever happened
 * in the bar. History is marked by a rule rather than by dimming: an earlier
 * draft of the design dimmed past chords and they read as disabled.
 *
 * Drawn on the lane's own canvas from the lane's own `xOfBeat`, so the blocks
 * and the bar lines above them cannot disagree — the reason the playhead can
 * be carried straight through it.
 */
export function paintRibbon(ctx: CanvasRenderingContext2D, f: RibbonFrame): void {
  const bpb = Math.max(1, f.beatsPerBar);
  const loop = f.chords.length;
  if (loop === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x + f.gutter, f.y, f.w - f.gutter, RIBBON_H);
  ctx.clip();

  const current = Math.floor(f.absBeat / bpb);
  const first = Math.floor(f.fromBeat / bpb);
  const last = Math.ceil(f.toBeat / bpb);
  for (let bar = first; bar <= last; bar++) {
    if (bar < 0) continue;
    const chord = f.chords[((bar % loop) + loop) % loop];
    if (!chord) continue;
    const x0 = f.xOfBeat(bar * bpb);
    const x1 = f.xOfBeat((bar + 1) * bpb);
    const fill = f.palette.hues[FUNCTION_HUE[(chord.degree - 1) % 7]].full;
    ctx.fillStyle = fill;
    ctx.fillRect(x0, f.y, x1 - x0 - 1, RIBBON_H);

    const ink = contrastRatio(BLOCK_INK[0], fill) >= contrastRatio(BLOCK_INK[1], fill)
      ? BLOCK_INK[0]
      : BLOCK_INK[1];
    const cx = (x0 + x1) / 2;
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `15px ${RIBBON_SERIF}`;
    ctx.fillText(romanOf(chord), cx, f.y + 21);
    ctx.font = `7.5px ${RIBBON_MONO}`;
    ctx.fillText(chordName(chord, f.keyFifths), cx, f.y + 31);

    // The bar you are in gets a full inner border; the bars behind you get a
    // rule along the top. Both in the playhead's colour, so "where I am" and
    // "where I have been" are told in the same voice as the playhead itself.
    ctx.fillStyle = f.palette.head;
    if (bar === current) {
      ctx.fillRect(x0, f.y, x1 - x0 - 1, 2);
      ctx.fillRect(x0, f.y + RIBBON_H - 2, x1 - x0 - 1, 2);
      ctx.fillRect(x0, f.y, 2, RIBBON_H);
      ctx.fillRect(x1 - 3, f.y, 2, RIBBON_H);
    } else if (bar < current) {
      ctx.fillRect(x0, f.y, x1 - x0 - 1, 3);
    }
  }
  ctx.restore();

  if (f.gutter > 0) {
    ctx.save();
    ctx.fillStyle = f.palette.lane;
    ctx.fillRect(f.x, f.y, f.gutter, RIBBON_H);
    ctx.fillStyle = f.palette.txt3;
    ctx.font = `8px ${RIBBON_MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("CHORD", f.x + f.gutter - 10, f.y + RIBBON_H / 2);
    ctx.restore();
  }
}

/**
 * Bars of music visible across the lane at once. Melodics shows about five;
 * two was too tight to read a phrase, and it made the overview's viewport
 * rectangle cover the whole strip.
 */
export const VISIBLE_BARS = 5;

/**
 * Pixels per beat, so that exactly `VISIBLE_BARS` fit the track. Everything on
 * the time axis derives from this — grid spacing, note onsets, note size — so
 * one bar occupies the same share of the track in every view regardless of how
 * wide it is.
 */
export function pxPerBeat(track: number, beatsPerBar: number): number {
  return track / (VISIBLE_BARS * Math.max(1, beatsPerBar));
}

/**
 * The whole beats to rule, covering the visible track with a beat of margin
 * either side so a line entering the edge is never drawn a frame late.
 *
 * `behind` and `ahead` are the renderer's own window — beats of timeline on
 * each side of the playhead. Deriving the range any other way invites the bug
 * this exists to prevent: a range that slides at a different rate from the
 * track it is meant to cover, so barlines wink in and out as the two drift
 * past each other.
 */
export function gridBeatRange(
  absBeat: number,
  behind: number,
  ahead: number,
): { first: number; last: number } {
  return {
    first: Math.floor(absBeat - behind) - 1,
    last: Math.ceil(absBeat + ahead) + 1,
  };
}

/**
 * The tempo grid, as absolute beat positions to rule, coarsest last so it
 * paints on top. `from`/`to` are absolute beats bounding the visible track.
 *
 * Three levels in a strict hierarchy: the downbeat is the only heavy line, and
 * no tempo line is ever thicker than a lane separator.
 */
export interface GridLines {
  eighths: number[];
  beats: number[];
  bars: number[];
}

export function gridLines(from: number, to: number, beatsPerBar: number): GridLines {
  const bpb = Math.max(1, beatsPerBar);
  const out: GridLines = { eighths: [], beats: [], bars: [] };
  // Half-beat resolution covers all three levels; each beat is classified once.
  for (let h = Math.ceil(from * 2); h <= Math.floor(to * 2); h++) {
    const beat = h / 2;
    if (h % 2 !== 0) out.eighths.push(beat);
    else if (((beat % bpb) + bpb) % bpb === 0) out.bars.push(beat);
    else out.beats.push(beat);
  }
  return out;
}

/**
 * Tempo-grid ink. Strict hierarchy: no tempo line is ever heavier than a lane
 * separator, and the downbeat is the one exception. Piano's beds are busier,
 * so its fine rules are a shade stronger to survive them.
 */
export const GRID_INK = {
  dark: {
    bar: "#ffffff33",
    pads: { beat: "#ffffff0a", eighth: "#ffffff05" },
    piano: { beat: "#ffffff10", eighth: "#ffffff08" },
  },
  light: {
    bar: "#00000042",
    pads: { beat: "#0000000d", eighth: "#00000006" },
    piano: { beat: "#00000016", eighth: "#0000000b" },
  },
} as const;

/** Lane separators — the reference weight the tempo grid stays under. */
export const SEPARATOR_INK = { dark: "#ffffff1f", light: "#00000026" } as const;
/** Piano's semitone rules, raised to match. */
export const ROW_INK = { dark: "#ffffff24", light: "#00000029" } as const;

/**
 * Rule the tempo grid across a field. `posOf` maps an absolute beat to the
 * axis position; `axis` says which way the lines run.
 *
 * Drawn coarsest last so the downbeat paints over the finer rules, and across
 * the whole field rather than per lane — a grid that lives inside the lanes
 * breaks at every separator gap.
 */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  opts: {
    theme: Theme;
    instrument: "pads" | "piano";
    from: number;
    to: number;
    beatsPerBar: number;
    posOf: (beat: number) => number;
    axis: "vertical-lines" | "horizontal-lines";
    x: number;
    y: number;
    w: number;
    h: number;
  },
): void {
  const { theme, instrument, posOf, axis, x, y, w, h } = opts;
  if (opts.to <= opts.from) return;
  const ink = GRID_INK[theme];
  const fine = ink[instrument];
  const lines = gridLines(opts.from, opts.to, opts.beatsPerBar);

  const rule = (beat: number, weight: number, colour: string) => {
    const at = Math.round(posOf(beat));
    ctx.fillStyle = colour;
    if (axis === "vertical-lines") {
      if (at < x || at > x + w) return;
      ctx.fillRect(at - (weight >> 1), y, weight, h);
    } else {
      if (at < y || at > y + h) return;
      ctx.fillRect(x, at - (weight >> 1), w, weight);
    }
  };

  for (const b of lines.eighths) rule(b, 1, fine.eighth);
  for (const b of lines.beats) rule(b, 1, fine.beat);
  for (const b of lines.bars) rule(b, 3, ink.bar);
}

// ------------------------------------------------------------------- holds

/**
 * How solid a hold's bar is, against the head it belongs to.
 *
 * An upcoming hold needs more: its head is already a dimmed tint, and taking
 * 38% of *that* leaves nothing. A judged head is at full strength, so its bar
 * can sit back.
 */
const HOLD_ALPHA = { judged: 0.38, upcoming: 0.66 } as const;

/**
 * Shortest bar worth drawing. Below it a stub reads as a smudge on the head
 * rather than as a duration.
 *
 * 34px is the design's figure and it holds on the **scrolling** axis, where
 * five bars are spread across the window's width. The **falling** views put
 * those same five bars down a third of the pixels — around 16px a beat — so
 * 34px there would mean no hold is ever drawn, and the design's own vertical
 * frames (`11c`, `11f`) plainly show them. Its bars measure ~48px against a
 * roll where a beat is ~32px, i.e. a far shallower zoom than this app's.
 *
 * So on the falling axis the floor is structural instead: the two caps, plus
 * enough slot between them to read as a channel rather than as a seam. Worth
 * checking back with design — it is the one number here that is ours.
 */
export const HOLD_MIN_PX = 34;
/** Slot that must show between the caps for a falling bar to be worth it. */
const SLOT_MIN = 10;

export function holdFloor(axis: "scrolling" | "falling", headCap: number): number {
  return axis === "scrolling" ? HOLD_MIN_PX : headCap + TAIL_CAP + SLOT_MIN;
}
/** Clear space kept between a bar's end and the next head it would run into. */
export const HOLD_CLEARANCE = 8;
/** The bar's far end, always. */
const TAIL_CAP = 5;
/** The fill: a thin bar from the head end, ending in a dot at the release. */
const FILL_W = 4;
const FILL_DOT = 8;
/** The transparent channel the fill runs down. */
const SLOT = 2;

/** `#rrggbb` at `a` (0..1), as the eight-digit form canvas understands. */
export function withAlpha(hex: string, a: number): string {
  const byte = Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${byte}`;
}

/**
 * How much of a hold's slot is filled, 0..1, or null for one that has not been
 * played and so has nothing to show.
 *
 * A hold being played right now fills *live*, to the playhead — the only
 * moving part of a note, and the thing that tells you you are still holding
 * it. Once released the fill freezes at the release point, and the empty
 * remainder is exactly what you let go of early.
 */
export function holdFill(
  inst: Pick<NoteInstance, "time" | "endTime" | "heldFrom" | "releasedAt">,
  now: number,
): number | null {
  if (inst.heldFrom === null) return null;
  const length = inst.endTime - inst.time;
  if (length <= 0) return null;
  const upTo = inst.releasedAt ?? Math.min(now, inst.endTime);
  return Math.min(1, Math.max(0, (upTo - inst.time) / length));
}

/**
 * How long a hold's bar should actually be, or null for a head drawn plain.
 *
 * Three of the design's edge cases in one place, because all three end in the
 * same answer. A head clipped by the edge of the field gets no bar — it would
 * read as a bar floating free of any note. A bar stops short of the next head
 * it would run into, whether or not that head shares its row exactly, since an
 * accidental sits half a row above its natural. And what is left has to be
 * long enough to read as a duration rather than as a smudge.
 */
export function holdLength(
  writtenPx: number,
  roomPx: number,
  headClipped: boolean,
  floorPx: number,
): number | null {
  if (headClipped) return null;
  const len = Math.min(writtenPx, roomPx);
  return len >= floorPx ? len : null;
}

export interface HoldBar {
  /** The whole bar, head end included — the head is drawn over it. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Which end the head is at. Time runs right in the scrolling views and up
   * in the falling ones, so the head is at the left or at the bottom.
   */
  headEnd: "left" | "bottom";
  /**
   * Length of the cap at the head end. It sits *behind* the head and is never
   * seen; its job is to close the slot so the head does not show a 2px notch
   * through it. Zero in pads vertical, where the head is a 16px pill that
   * covers only half of a 14px cap and the rest would show as a gap.
   */
  headCap: number;
  radius: number;
  /** The head's own colour. The bar takes it translucent; the fill takes it flat. */
  colour: string;
  /** From `holdFill`. Null draws an empty slot, which is a hold not yet played. */
  fill: number | null;
}

/**
 * A held note's bar: the slot, and how much of it the player covered.
 *
 * The slot is built from separate translucent pieces around a transparent
 * channel rather than painted solid and then overdrawn in the field colour.
 * That matters: the lane bed, the semitone bands and the beat grid read
 * straight through a hold, so a bar never competes with its own head, and it
 * cannot go stale against a background it was drawn to match.
 */
export function paintHold(ctx: CanvasRenderingContext2D, b: HoldBar): void {
  const wall = withAlpha(b.colour, b.fill === null ? HOLD_ALPHA.upcoming : HOLD_ALPHA.judged);
  const r = Math.max(0, Math.min(b.radius, b.w / 2, b.h / 2));
  ctx.fillStyle = wall;

  if (b.headEnd === "left") {
    const tailX = b.x + b.w - TAIL_CAP;
    const side = Math.max(0, (b.h - SLOT) / 2);
    if (b.headCap > 0) corner(ctx, b.x, b.y, b.headCap, b.h, r, "left");
    corner(ctx, tailX, b.y, TAIL_CAP, b.h, r, "right");
    const from = b.x + b.headCap;
    const span = Math.max(0, tailX - from);
    ctx.fillRect(from, b.y, span, side);
    ctx.fillRect(from, b.y + b.h - side, span, side);
    if (b.fill !== null) {
      const len = b.w * b.fill;
      const cy = b.y + b.h / 2;
      ctx.fillStyle = b.colour;
      ctx.fillRect(b.x, cy - FILL_W / 2, Math.max(0, len), FILL_W);
      dot(ctx, b.x + len, cy);
    }
    return;
  }

  // Head at the bottom: the tail cap is the top edge, and the bar grows up.
  const side = Math.max(0, (b.w - SLOT) / 2);
  corner(ctx, b.x, b.y, b.w, TAIL_CAP, r, "top");
  if (b.headCap > 0) corner(ctx, b.x, b.y + b.h - b.headCap, b.w, b.headCap, r, "bottom");
  const from = b.y + TAIL_CAP;
  const span = Math.max(0, b.h - TAIL_CAP - b.headCap);
  ctx.fillRect(b.x, from, side, span);
  ctx.fillRect(b.x + b.w - side, from, side, span);
  // With no head cap the walls have to carry the head end's own corners, or
  // the slot shows a notch through the pill.
  if (b.headCap === 0 && r > 0) {
    corner(ctx, b.x, b.y + b.h - r, side, r, r, "bottom-left");
    corner(ctx, b.x + b.w - side, b.y + b.h - r, side, r, r, "bottom-right");
  }
  if (b.fill !== null) {
    const len = b.h * b.fill;
    const cx = b.x + b.w / 2;
    ctx.fillStyle = b.colour;
    ctx.fillRect(cx - FILL_W / 2, b.y + b.h - len, FILL_W, Math.max(0, len));
    dot(ctx, cx, b.y + b.h - len);
  }
}

/** The release marker: the one thing that says "you let go here". */
function dot(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, FILL_DOT / 2, 0, Math.PI * 2);
  ctx.fill();
}

/** A rectangle rounded on one side only — the caps at either end of a slot. */
function corner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  side: "left" | "right" | "top" | "bottom" | "bottom-left" | "bottom-right",
): void {
  const rr = Math.max(0, Math.min(r, w, h));
  if (rr <= 0) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  const tl = side === "left" || side === "top" ? rr : 0;
  const tr = side === "right" || side === "top" ? rr : 0;
  const br = side === "right" || side === "bottom" || side === "bottom-right" ? rr : 0;
  const bl = side === "left" || side === "bottom" || side === "bottom-left" ? rr : 0;
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
  ctx.fill();
}

/**
 * The played side's veil: opaque in the lane's own colour at the far edge,
 * clear at the playhead. Played notes keep travelling and dissolve into it
 * rather than vanishing the moment they are graded.
 */
const VEIL_STOPS = [
  [0, "ff"],
  [0.14, "d9"],
  [0.42, "80"],
  [0.72, "2e"],
  [1, "00"],
] as const;

export function paintVeil(
  ctx: CanvasRenderingContext2D,
  lane: string,
  from: [number, number],
  to: [number, number],
  rect: [number, number, number, number],
): void {
  const g = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  for (const [stop, alpha] of VEIL_STOPS) g.addColorStop(stop, lane + alpha);
  ctx.fillStyle = g;
  ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
}

/**
 * Count-in: one ring per beat of the bar, filling left to right, the current
 * beat solid and enlarged.
 *
 * Drawn straight over the lane, with nothing dimming it. There used to be a
 * wash across the whole canvas behind these rings, which also greyed out the
 * notes — the very thing you are counting yourself in to play. The rings sit
 * in the middle of the field and read perfectly well without it.
 */
export function paintCountIn(
  ctx: CanvasRenderingContext2D,
  opts: {
    palette: { txt: string; txt3: string; rating: { early: string } };
    beats: number;
    beat: number;
    reducedMotion: boolean;
    lessonName: string;
    w: number;
    h: number;
    mono: string;
    sans: string;
  },
): void {
  const { palette: p, w: W, h: H } = opts;
  const beats = Math.max(1, Math.round(opts.beats));
  const done = Math.floor(opts.beat);
  const frac = opts.beat - done;

  const R = 13;
  const step = R * 2 + 22;
  const cx = W / 2 - ((beats - 1) * step) / 2;
  const cy = H / 2 - 10;

  for (let i = 0; i < beats; i++) {
    const current = i === done;
    // The current beat swells across its beat, unless motion is unwelcome.
    const r = R * (current && !opts.reducedMotion ? 1 + (1 - frac) * 0.18 : 1);
    ctx.beginPath();
    ctx.arc(cx + i * step, cy, r, 0, Math.PI * 2);
    if (i <= done) {
      ctx.fillStyle = p.rating.early;
      ctx.globalAlpha = current ? 1 : 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = p.txt3;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = p.txt;
  ctx.font = `500 12px ${opts.sans}`;
  ctx.fillText(opts.lessonName, W / 2, cy + R + 26);
  ctx.fillStyle = p.txt3;
  ctx.font = `500 8.5px ${opts.mono}`;
  ctx.fillText("ESC TO STOP", W / 2, cy + R + 46);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}
