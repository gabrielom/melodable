/**
 * The palette, in one place, for both halves of the UI.
 *
 * CSS owns the DOM chrome via custom properties in `styles.css`; the canvas
 * renderers can't read those, so the same values live here as plain data.
 * Both are generated from the same design tokens — if you change one, change
 * the other.
 *
 * Two themes: dark is a Maschine-style near-black chassis, light is Ableton's
 * one-flat-grey with hairline separation. Light inverts on-states (dark chip,
 * light text) rather than lightening them, because every fill is the same grey
 * and a lighter fill would vanish.
 *
 * Two colour languages live here and must not be confused. The **instrument
 * hues** name a lane or a pitch — what a note is. The **rating** colours name
 * a result — how well it was played. A note wears one or the other, decided by
 * whether it has been judged, and the two sets share no value.
 *
 * `--led0..2` in `styles.css` are not part of either: they are chrome accents
 * (the device dot, the resume flag, the monitor's source dots) that happen to
 * be a green, an amber and a blue. They are deliberately not mirrored here.
 */

import type { InstrumentType, Rating } from "@/engine/types";

export type Theme = "dark" | "light";

/**
 * The instrument hues: one list of fourteen, shared by pads and piano.
 *
 * A hue says *what* a note is — which pad, which pitch. It is deliberately
 * disjoint from the timing colours below, which say *how well* it was played,
 * so a target can never be misread as a judgement (handoff 05 §2.1).
 *
 * Eight cover the pad kit; the remaining six are spares for a piano piece with
 * more than eight distinct pitches.
 */
export const HUE_NAMES = [
  "teal",
  "bronze",
  "blue",
  "violet",
  "plum",
  "indigo",
  "olive",
  "stone",
  "steel",
  "periwinkle",
  "sky",
  "orchid",
  "navy",
  "mauve",
] as const;

export type HueName = (typeof HUE_NAMES)[number];

/** Full-strength hue per theme. The dimmed value is derived, never authored. */
const HUE_FULL: Readonly<Record<Theme, Readonly<Record<HueName, string>>>> = {
  dark: {
    teal: "#4fbdb2",
    bronze: "#d59a4a",
    blue: "#3d9fe6",
    violet: "#9d5ce8",
    plum: "#c471c0",
    indigo: "#7079e0",
    olive: "#8cc45f",
    stone: "#9aa0ad",
    steel: "#7898b8",
    periwinkle: "#99a2f0",
    sky: "#58b4f0",
    orchid: "#c56fd6",
    navy: "#4a6fd0",
    mauve: "#b06aa8",
  },
  light: {
    teal: "#1f7370",
    bronze: "#96601a",
    blue: "#2b6fae",
    violet: "#6b45a8",
    plum: "#8a3f86",
    indigo: "#43489c",
    olive: "#4f7a2e",
    stone: "#63666e",
    steel: "#46647f",
    periwinkle: "#5a63b8",
    sky: "#2f80c0",
    orchid: "#94439b",
    navy: "#24457f",
    mauve: "#7a3a72",
  },
};

/**
 * How far a dimmed hue is carried toward the field behind it, and what that
 * field is.
 *
 * Dark needs to travel further because a saturated hue on near-black still
 * shouts at 35%. These two numbers reproduce the handoff's own dimmed column
 * exactly, for all fourteen hues in both themes — which is why the table is
 * not copied in: it is derivable, and a derived value cannot drift from its
 * source. (The handoff names #141415 as the dark field for pads; that does not
 * reproduce its table, and #0d0d0e does. The 4/255 difference is invisible, so
 * one field per theme it is.)
 */
const DIM_FIELD: Readonly<Record<Theme, string>> = { dark: "#0d0d0e", light: "#cccccc" };
const DIM_AMOUNT: Readonly<Record<Theme, number>> = { dark: 0.6, light: 0.35 };

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** `t` of the way from `a` to `b`, as a hex string. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const ch = (x: number, y: number) =>
    Math.round(x * (1 - t) + y * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/**
 * WCAG relative luminance of a hex colour, for the contrast ratio below.
 */
function luminance(hex: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The floor a small label has to clear against its background. */
export const MIN_CONTRAST = 4.5;

/**
 * A hue shifted just far enough to be readable on `bg` (handoff 11 §1.3).
 *
 * A degree digit inherits its note's hue so it reads as belonging to that
 * note — but a dimmed instrument tint on staff paper fails contrast outright,
 * measured at 2.27:1 light and 1.61:1 dark. So walk the hue toward black on a
 * light ground or white on a dark one, and stop at the *first* step that
 * clears 4.5:1. Derived, not picked: the smallest shift that works is the one
 * that keeps the hue most recognisable.
 *
 * Returns the target itself if even that cannot clear the floor, which cannot
 * happen for any palette in the app but must not loop for ever if it did.
 */
export function readableInk(hue: string, theme: Theme, bg: string): string {
  const towards = theme === "light" ? "#000000" : "#ffffff";
  for (let i = 0; i <= 20; i++) {
    const ink = mix(hue, towards, i / 20);
    if (contrastRatio(ink, bg) >= MIN_CONTRAST) return ink;
  }
  return towards;
}

/** A hue at both the strengths the design uses. */
export interface Hue {
  /** A lane that is sounding, and the fill inside a hold's slot. */
  full: string;
  /** Everything a lane owns that has not been played: targets, LED, grid dot. */
  dim: string;
}

/**
 * Which hue a lane or a pitch takes, by position.
 *
 * Pads walk the list in order, so the kit reads teal → bronze → blue → violet
 * down the stack. Piano starts on the cool end — the first pitch is blue, the
 * second violet — because a roll is read low-to-high and the low voices want
 * the receding colours. Both draw from the same fourteen, so a pad and a pitch
 * can never share a hue by accident.
 */
const PAD_ORDER: readonly HueName[] = HUE_NAMES;
const PIANO_ORDER: readonly HueName[] = [
  "blue",
  "violet",
  "bronze",
  "teal",
  ...HUE_NAMES.slice(4),
];

/** Both strengths of every hue for one theme, derived once at module load. */
function hueTable(theme: Theme): Readonly<Record<HueName, Hue>> {
  const out = {} as Record<HueName, Hue>;
  for (const name of HUE_NAMES) {
    const full = HUE_FULL[theme][name];
    out[name] = { full, dim: mix(full, DIM_FIELD[theme], DIM_AMOUNT[theme]) };
  }
  return Object.freeze(out);
}

export interface Palette {
  /** Window behind the panels. */
  win: string;
  /** Lane bed and the overview strip. */
  lane: string;
  /** Lane label gutter. */
  gutter: string;
  /** The already-played strip behind the playhead. */
  elapsed: string;
  /** Bar lines inside the overview strip. */
  grid: string;
  /** Playhead. */
  head: string;
  /** Hairline separations — lane stack gaps, gutter edge. */
  hair: string;
  txt: string;
  txt2: string;
  txt3: string;
  /**
   * The instrument hues for this theme, keyed by name. Renderers reach them
   * through `hueOf`, which knows the per-instrument order; this is here so a
   * frame carries its whole palette and canvas never has to look one up.
   */
  hues: Readonly<Record<HueName, Hue>>;
  /** Note colours once graded. Only ever worn by a note that has a result. */
  rating: Readonly<Record<Rating, string>>;
  /** Unlit cells of the controller mini-grid. */
  miniOff: string;
  /** Overview strip's viewport rectangle: neutral, so it can't be mistaken
   *  for the playhead or a rating. */
  viewFill: string;
  viewEdge: string;
}

const DARK: Palette = {
  win: "#0e0e0f",
  lane: "#141415",
  gutter: "#1b1b1d",
  elapsed: "#0b0b0c",
  grid: "#202021",
  head: "#4ccfe0",
  hair: "#2a2a2c",
  txt: "#f2f2f3",
  txt2: "#98989c",
  txt3: "#67676c",
  hues: hueTable("dark"),
  rating: {
    perfect: "#59c46b",
    great: "#4ccfe0",
    early: "#f0a129",
    late: "#dd6ba8",
    miss: "#e24b42",
  },
  miniOff: "#2e2e30",
  viewFill: "#1b1b1d",
  viewEdge: "#4a4a4e",
};

const LIGHT: Palette = {
  win: "#cccccc",
  lane: "#cccccc",
  gutter: "#cccccc",
  elapsed: "#c4c4c4",
  grid: "#c2c2c2",
  head: "#2c2d2e",
  hair: "#b0b0b0",
  txt: "#232324",
  txt2: "#55565a",
  txt3: "#74757a",
  hues: hueTable("light"),
  rating: {
    perfect: "#3d8f4c",
    great: "#0f7f92",
    early: "#a5710d",
    late: "#9e3c72",
    miss: "#a8382f",
  },
  miniOff: "#b6b6b6",
  viewFill: "#d4d4d4",
  viewEdge: "#8f8f8f",
};

export const PALETTE: Readonly<Record<Theme, Palette>> = { dark: DARK, light: LIGHT };

/**
 * The hue a lane or pitch owns, by its position on screen — not by pad number
 * or pitch, so a lane keeps its colour from one lesson to the next.
 *
 * Wraps past fourteen. A piece with more than fourteen distinct pitches has
 * run out of distinguishable colours anyway, and repeating the list beats
 * inventing hues that collide with the timing set.
 */
export function hueOf(p: Palette, instrument: InstrumentType, index: number): Hue {
  const order = instrument === "piano" ? PIANO_ORDER : PAD_ORDER;
  const n = order.length;
  return p.hues[order[((index % n) + n) % n]];
}

/**
 * Corner radii differ per theme: dark is a moulded chassis, light is flat
 * Ableton panelling that reads wrong with round corners.
 */
export const RADIUS: Readonly<Record<Theme, { panel: number; note: number }>> = {
  dark: { panel: 3, note: 2 },
  light: { panel: 0, note: 1 },
};
