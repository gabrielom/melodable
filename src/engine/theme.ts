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
  /** Note colours once graded. */
  rating: Readonly<Record<Rating, string>>;
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
    perfect: "#4ccfe0",
    great: "#3d9fe6",
    good: "#f0a129",
    miss: "#e24b42",
  },
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
    perfect: "#0f7f92",
    great: "#2b6fae",
    good: "#a5710d",
    miss: "#a8382f",
  },
};

export const PALETTE: Readonly<Record<Theme, Palette>> = { dark: DARK, light: LIGHT };

/** Alpha suffix for a note that hasn't been played yet — the LED at 33%. */
export const UPCOMING_ALPHA = "55";

/** The identity colour for a lane, wrapping past the eight LEDs. */
export function ledOf(p: Palette, laneIndex: number): string {
  const n = p.led.length;
  return p.led[((laneIndex % n) + n) % n];
}

/** Same colour at the 33% used for notes still to come. */
export function ledUpcoming(p: Palette, laneIndex: number): string {
  return ledOf(p, laneIndex) + UPCOMING_ALPHA;
}

/**
 * Corner radii differ per theme: dark is a moulded chassis, light is flat
 * Ableton panelling that reads wrong with round corners.
 */
export const RADIUS: Readonly<Record<Theme, { panel: number; note: number }>> = {
  dark: { panel: 3, note: 2 },
  light: { panel: 0, note: 1 },
};
