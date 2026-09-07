import { describe, expect, it } from "vitest";
import { noteInk } from "@/views/lane-geometry";
import { PALETTE, hueOf } from "@/engine/theme";
import type { Theme } from "@/engine/theme";
import type { ColourMode } from "@/stores/settings";

/**
 * `noteInk` is the single place that decides what colour a note wears, and it
 * arbitrates between two languages that must never be confused: the instrument
 * hues say *what* to hit, the rating colours say *how well* it went.
 *
 * Sheet's mono ink is a third state, and it belongs to the first language
 * only. These pin that it takes the target half and leaves the result half
 * exactly where it was.
 */

const frame = (theme: Theme, colourMode: ColourMode, countIn = false) => ({
  palette: PALETTE[theme],
  instrument: "piano" as const,
  countIn,
  colourMode,
});

const unplayed = { resolved: false, rating: null } as const;
const graded = { resolved: true, rating: "miss" } as const;

describe("noteInk", () => {
  for (const theme of ["dark", "light"] as const) {
    describe(theme, () => {
      it("gives an unplayed note its lane's dimmed hue in colour", () => {
        for (const lane of [0, 1, 2, 7, 13]) {
          expect(noteInk(frame(theme, "all"), unplayed, lane)).toBe(
            hueOf(PALETTE[theme], "piano", lane).dim,
          );
        }
      });

      it("gives every unplayed note the same plain ink in mono", () => {
        const inks = [0, 1, 2, 7, 13].map((lane) => noteInk(frame(theme, "mono"), unplayed, lane));
        expect(new Set(inks).size).toBe(1);
        expect(inks[0]).toBe(PALETTE[theme].txt);
      });

      it("silences the two colour systems independently", () => {
        const p = PALETTE[theme];
        // All: judgement recolours a played note, which is the default.
        expect(noteInk(frame(theme, "all"), graded, 3)).toBe(p.rating.miss);
        // Targets only: the note keeps its own hue, at full strength so it
        // still reads as played — it is just no longer being marked.
        expect(noteInk(frame(theme, "targets"), graded, 3)).toBe(
          hueOf(p, "piano", 3).full,
        );
        expect(noteInk(frame(theme, "targets"), unplayed, 3)).toBe(hueOf(p, "piano", 3).dim);
        // Mono: neither system, so the page is plain notation.
        expect(noteInk(frame(theme, "mono"), graded, 3)).toBe(p.txt);
      });

      it("never lets a rating colour survive into targets-only or mono", () => {
        const ratings = new Set(Object.values(PALETTE[theme].rating));
        for (const mode of ["targets", "mono"] as const) {
          for (let lane = 0; lane < 14; lane++) {
            expect(ratings.has(noteInk(frame(theme, mode), graded, lane))).toBe(false);
          }
        }
      });

      it("judges nothing during the count-in, in any state", () => {
        expect(noteInk(frame(theme, "mono", true), graded, 3)).toBe(PALETTE[theme].txt);
        for (const mode of ["all", "targets"] as const) {
          expect(noteInk(frame(theme, mode, true), graded, 3)).toBe(
            hueOf(PALETTE[theme], "piano", 3).dim,
          );
        }
      });

      it("never lets a target wear a rating colour, in any state", () => {
        const ratings = new Set(Object.values(PALETTE[theme].rating));
        for (const mode of ["all", "targets", "mono"] as const) {
          for (let lane = 0; lane < 14; lane++) {
            expect(ratings.has(noteInk(frame(theme, mode), unplayed, lane))).toBe(false);
          }
        }
      });
    });
  }
});
