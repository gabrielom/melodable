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
 * The staff can silence them one at a time, in that order: `results` drops the
 * hues and keeps the judgement, `mono` drops both. These pin all three in both
 * themes — including that `results` leaves nothing of the first language on an
 * unplayed note, which is the whole point of it.
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

      it("takes the two systems away one at a time, in order", () => {
        const p = PALETTE[theme];
        // All: both. A target wears its hue, a played note its judgement.
        expect(noteInk(frame(theme, "all"), unplayed, 3)).toBe(hueOf(p, "piano", 3).dim);
        expect(noteInk(frame(theme, "all"), graded, 3)).toBe(p.rating.miss);
        // Results: the hues go, the judgement stays. Plain ink ahead of the
        // playhead, timing colours behind it — the state to sight-read in.
        expect(noteInk(frame(theme, "results"), unplayed, 3)).toBe(p.txt);
        expect(noteInk(frame(theme, "results"), graded, 3)).toBe(p.rating.miss);
        // Mono: neither, so the page is plain notation throughout.
        expect(noteInk(frame(theme, "mono"), unplayed, 3)).toBe(p.txt);
        expect(noteInk(frame(theme, "mono"), graded, 3)).toBe(p.txt);
      });

      it("leaves no pitch hue at all on an unplayed note in results", () => {
        // The reversal's whole point: what is coming reads as notation and
        // nothing else, so a target must not carry its lane's tint in any
        // strength — dim or full.
        const p = PALETTE[theme];
        for (let lane = 0; lane < 14; lane++) {
          const hue = hueOf(p, "piano", lane);
          const ink = noteInk(frame(theme, "results"), unplayed, lane);
          expect(ink).toBe(p.txt);
          expect(ink).not.toBe(hue.dim);
          expect(ink).not.toBe(hue.full);
        }
      });

      it("never lets a rating colour survive into mono", () => {
        const ratings = new Set(Object.values(PALETTE[theme].rating));
        for (let lane = 0; lane < 14; lane++) {
          expect(ratings.has(noteInk(frame(theme, "mono"), graded, lane))).toBe(false);
        }
      });

      it("judges nothing during the count-in, in any state", () => {
        const p = PALETTE[theme];
        // Nothing has been played yet, so every state shows its target ink —
        // which is the hue in `all` and the plain ink in the other two.
        expect(noteInk(frame(theme, "all", true), graded, 3)).toBe(hueOf(p, "piano", 3).dim);
        for (const mode of ["results", "mono"] as const) {
          expect(noteInk(frame(theme, mode, true), graded, 3)).toBe(p.txt);
        }
      });

      it("never lets a target wear a rating colour, in any state", () => {
        const ratings = new Set(Object.values(PALETTE[theme].rating));
        for (const mode of ["all", "results", "mono"] as const) {
          for (let lane = 0; lane < 14; lane++) {
            expect(ratings.has(noteInk(frame(theme, mode), unplayed, lane))).toBe(false);
          }
        }
      });
    });
  }
});
