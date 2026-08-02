/**
 * The palette, in one place, for both halves of the UI.
 *
 * CSS owns the DOM chrome via custom properties in `styles.css`; the canvas
 * renderers can't read those, so the same values live here as plain data.
 * Both are generated from the same design tokens — if you change one, change
 * the other.
 *
 * Two themes: dark is a Maschine-style near-black chassis with LED-coloured
 * notes, light is Ableton's one-flat-grey with hairline separation. Light
 * inverts on-states (dark chip, light text) rather than lightening them,
 * because every fill is the same grey and a lighter fill would vanish.
 */

import type { Rating } from "@/engine/types";

export type Theme = "dark" | "light";

/**
 * Lane identity colours, index 0-7, wrapping beyond that. A fixed set rather
 * than a hash of the pad number, so a given lane keeps its colour from one
 * lesson to the next.
 */
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
  /** Pad/lane identity LEDs, by index. */
  led: readonly string[];
  /** Note colours once graded. Only ever used behind the playhead (§21). */
  rating: Readonly<Record<Rating, string>>;
  /** Upcoming-note colour for piano, which has no pad LEDs. */
  instrument: string;
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
  led: ["#59c46b", "#f0a129", "#3d9fe6", "#9d5ce8", "#e24b42", "#4ccfe0", "#7fbf5a", "#d98f4a"],
  rating: {
    perfect: "#59c46b",
    great: "#4ccfe0",
    early: "#f0a129",
    late: "#dd6ba8",
    miss: "#e24b42",
  },
  /** Piano has no pad LEDs, so upcoming notes take one instrument colour. */
  instrument: "#9d5ce8",
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
  led: ["#3d8f4c", "#b1720f", "#2b6fae", "#6b45a8", "#a8382f", "#0f7f92", "#5b8134", "#9b6a20"],
  rating: {
    perfect: "#3d8f4c",
    great: "#0f7f92",
    early: "#a5710d",
    late: "#9e3c72",
    miss: "#a8382f",
  },
  instrument: "#6b45a8",
  miniOff: "#b6b6b6",
  viewFill: "#d4d4d4",
  viewEdge: "#8f8f8f",
};

export const PALETTE: Readonly<Record<Theme, Palette>> = { dark: DARK, light: LIGHT };

/** The identity colour for a lane, wrapping past the eight LEDs. */
export function ledOf(p: Palette, laneIndex: number): string {
  const n = p.led.length;
  return p.led[((laneIndex % n) + n) % n];
}

/**
 * Corner radii differ per theme: dark is a moulded chassis, light is flat
 * Ableton panelling that reads wrong with round corners.
 */
export const RADIUS: Readonly<Record<Theme, { panel: number; note: number }>> = {
  dark: { panel: 3, note: 2 },
  light: { panel: 0, note: 1 },
};
