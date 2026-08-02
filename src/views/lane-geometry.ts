/**
 * Shared geometry and field furniture for the note lanes — the rules both
 * renderers obey, in one place, so pads and piano can't drift apart.
 *
 * The maths is pure; the two painters take a context and are the only part
 * that touches canvas. The trainer's viewport rectangle is derived from the
 * same numbers that position the notes, so the overview strip can never
 * disagree with what is actually on screen.
 */

import type { Theme } from "@/engine/theme";

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
