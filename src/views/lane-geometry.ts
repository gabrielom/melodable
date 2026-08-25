/**
 * Shared geometry and field furniture for the note lanes — the rules both
 * renderers obey, in one place, so pads and piano can't drift apart.
 *
 * The maths is pure; the two painters take a context and are the only part
 * that touches canvas. The trainer's viewport rectangle is derived from the
 * same numbers that position the notes, so the overview strip can never
 * disagree with what is actually on screen.
 */

import { hueOf, type Theme } from "@/engine/theme";
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
 */
export function noteInk(
  f: Pick<LaneFrame, "palette" | "instrument" | "countIn">,
  inst: Pick<NoteInstance, "resolved" | "rating">,
  laneIndex: number,
): string {
  if (inst.resolved && inst.rating && !f.countIn) return f.palette.rating[inst.rating];
  return hueOf(f.palette, f.instrument, laneIndex).dim;
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
