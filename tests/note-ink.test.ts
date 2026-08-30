import { describe, expect, it } from "vitest";
import { noteInk } from "@/views/lane-geometry";
import { PALETTE, hueOf } from "@/engine/theme";
import type { Theme } from "@/engine/theme";

/**
 * `noteInk` is the single place that decides what colour a note wears, and it
 * arbitrates between two languages that must never be confused: the instrument
 * hues say *what* to hit, the rating colours say *how well* it went.
 *
 * Sheet's mono ink is a third state, and it belongs to the first language
 * only. These pin that it takes the target half and leaves the result half
 * exactly where it was.
 */

const frame = (theme: Theme, mono: boolean, countIn = false) => ({
  palette: PALETTE[theme],
  instrument: "piano" as const,
  countIn,
  mono,
});

const unplayed = { resolved: false, rating: null } as const;
const graded = { resolved: true, rating: "miss" } as const;

describe("noteInk", () => {
  for (const theme of ["dark", "light"] as const) {
    describe(theme, () => {
      it("gives an unplayed note its lane's dimmed hue in colour", () => {
        for (const lane of [0, 1, 2, 7, 13]) {
          expect(noteInk(frame(theme, false), unplayed, lane)).toBe(
            hueOf(PALETTE[theme], "piano", lane).dim,
          );
        }
      });

      it("gives every unplayed note the same plain ink in mono", () => {
        const inks = [0, 1, 2, 7, 13].map((lane) => noteInk(frame(theme, true), unplayed, lane));
        expect(new Set(inks).size).toBe(1);
        expect(inks[0]).toBe(PALETTE[theme].txt);
      });

      it("keeps the rating in mono — a result is not decoration", () => {
        // The whole point of the view is to say how the run went. Mono takes
        // the hue that names a pitch, not the colour that names a result.
        expect(noteInk(frame(theme, true), graded, 3)).toBe(PALETTE[theme].rating.miss);
        expect(noteInk(frame(theme, false), graded, 3)).toBe(PALETTE[theme].rating.miss);
      });

      it("judges nothing during the count-in, in either ink", () => {
        expect(noteInk(frame(theme, true, true), graded, 3)).toBe(PALETTE[theme].txt);
        expect(noteInk(frame(theme, false, true), graded, 3)).toBe(
          hueOf(PALETTE[theme], "piano", 3).dim,
        );
      });

      it("never lets a target wear a rating colour, in either ink", () => {
        const ratings = new Set(Object.values(PALETTE[theme].rating));
        for (const mono of [true, false]) {
          for (let lane = 0; lane < 14; lane++) {
            expect(ratings.has(noteInk(frame(theme, mono), unplayed, lane))).toBe(false);
          }
        }
      });
    });
  }
});
