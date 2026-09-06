import { describe, expect, it } from "vitest";
import { HUE_NAMES, MIN_CONTRAST, PALETTE, contrastRatio, hueOf, readableInk, type HueName } from "@/engine/theme";

/**
 * The dimmed hues are derived from the full ones rather than authored, so the
 * derivation is the thing that can break. This is the handoff's own table,
 * kept here as the fixture it is: if `mix`, the field colour or the amount
 * ever moves, these fail rather than the palette quietly drifting off-design.
 */
const TABLE: Record<HueName, { dark: [string, string]; light: [string, string] }> = {
  teal: { dark: ["#4fbdb2", "#275350"], light: ["#1f7370", "#5c9290"] },
  bronze: { dark: ["#d59a4a", "#5d4526"], light: ["#96601a", "#a98658"] },
  blue: { dark: ["#3d9fe6", "#204764"], light: ["#2b6fae", "#6390b9"] },
  violet: { dark: ["#9d5ce8", "#472d65"], light: ["#6b45a8", "#8d74b5"] },
  plum: { dark: ["#c471c0", "#563555"], light: ["#8a3f86", "#a1709f"] },
  indigo: { dark: ["#7079e0", "#353862"], light: ["#43489c", "#7376ad"] },
  olive: { dark: ["#8cc45f", "#40562e"], light: ["#4f7a2e", "#7b9765"] },
  stone: { dark: ["#9aa0ad", "#45484e"], light: ["#63666e", "#888a8f"] },
  steel: { dark: ["#7898b8", "#384552"], light: ["#46647f", "#75889a"] },
  periwinkle: { dark: ["#99a2f0", "#454968"], light: ["#5a63b8", "#8288bf"] },
  sky: { dark: ["#58b4f0", "#2b5068"], light: ["#2f80c0", "#669bc4"] },
  orchid: { dark: ["#c56fd6", "#57345e"], light: ["#94439b", "#a873ac"] },
  navy: { dark: ["#4a6fd0", "#25345c"], light: ["#24457f", "#5f749a"] },
  mauve: { dark: ["#b06aa8", "#4e324c"], light: ["#7a3a72", "#976d92"] },
};

describe("instrument hues", () => {
  it("matches the design's table in both themes", () => {
    for (const name of HUE_NAMES) {
      for (const theme of ["dark", "light"] as const) {
        const [full, dim] = TABLE[name][theme];
        expect({ name, theme, ...PALETTE[theme].hues[name] }).toEqual({ name, theme, full, dim });
      }
    }
  });

  it("gives pads the list in order and piano the cool end first", () => {
    const p = PALETTE.dark;
    expect(hueOf(p, "pads", 0)).toBe(p.hues.teal);
    expect(hueOf(p, "pads", 3)).toBe(p.hues.violet);
    expect(hueOf(p, "piano", 0)).toBe(p.hues.blue);
    expect(hueOf(p, "piano", 1)).toBe(p.hues.violet);
    expect(hueOf(p, "piano", 2)).toBe(p.hues.bronze);
    expect(hueOf(p, "piano", 3)).toBe(p.hues.teal);
  });

  it("uses every hue exactly once before repeating, in both orders", () => {
    const p = PALETTE.dark;
    for (const instrument of ["pads", "piano"] as const) {
      const seen = new Set(HUE_NAMES.map((_, i) => hueOf(p, instrument, i)));
      expect(seen.size).toBe(HUE_NAMES.length);
    }
  });

  it("wraps past the end and handles a lane that isn't in the list", () => {
    const p = PALETTE.light;
    expect(hueOf(p, "pads", HUE_NAMES.length)).toBe(hueOf(p, "pads", 0));
    expect(hueOf(p, "piano", -1)).toBe(hueOf(p, "piano", HUE_NAMES.length - 1));
  });

  it("keeps the timing colours out of the hue set, so a target can't read as a result", () => {
    for (const theme of ["dark", "light"] as const) {
      const p = PALETTE[theme];
      const ratings = new Set(Object.values(p.rating));
      for (const name of HUE_NAMES) {
        expect(ratings.has(p.hues[name].full)).toBe(false);
        expect(ratings.has(p.hues[name].dim)).toBe(false);
      }
    }
  });
});

describe("readableInk", () => {
  it("clears the contrast floor for every hue on its own paper", () => {
    // The reason this exists: a dimmed instrument tint on staff paper fails
    // outright, measured at 2.27:1 light and 1.61:1 dark (handoff 11 §1.3).
    for (const theme of ["dark", "light"] as const) {
      const p = PALETTE[theme];
      for (const name of Object.keys(p.hues) as HueName[]) {
        for (const strength of ["full", "dim"] as const) {
          const ink = readableInk(p.hues[name][strength], theme, p.lane);
          expect(contrastRatio(ink, p.lane)).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });

  it("shifts as little as it can, so the hue stays recognisable", () => {
    // A hue that already passes is returned untouched; one that does not is
    // moved by the smallest step on the ladder that works.
    const p = PALETTE.dark;
    const easy = "#ffffff";
    expect(readableInk(easy, "dark", p.lane)).toBe(easy);
    const hard = p.hues.blue.dim;
    const ink = readableInk(hard, "dark", p.lane);
    expect(ink).not.toBe(hard);
    expect(contrastRatio(ink, p.lane)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // One step back down the ladder would have failed, or it shifted too far.
    expect(contrastRatio(ink, p.lane)).toBeLessThan(MIN_CONTRAST + 2);
  });

  it("walks toward black on light paper and white on dark", () => {
    const dark = readableInk(PALETTE.dark.hues.blue.dim, "dark", PALETTE.dark.lane);
    const light = readableInk(PALETTE.light.hues.blue.dim, "light", PALETTE.light.lane);
    // Lighter than it started in dark, darker than it started in light.
    expect(contrastRatio(dark, "#000000")).toBeGreaterThan(
      contrastRatio(PALETTE.dark.hues.blue.dim, "#000000"),
    );
    expect(contrastRatio(light, "#ffffff")).toBeGreaterThan(
      contrastRatio(PALETTE.light.hues.blue.dim, "#ffffff"),
    );
  });
});
