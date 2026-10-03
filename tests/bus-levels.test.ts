import { describe, expect, it } from "vitest";
import { busLevelsFrom } from "@/stores/settings";

/**
 * The guide and click faders are the switches now, and a returning player's
 * store was written when they were not. This is the one place where getting
 * that wrong is silent — the app would simply start making a noise it never
 * used to, or stop making one it did — so it is pinned.
 *
 * Defaults stand in for "what the store did not say": guide 0, click 0.9.
 */
const restore = (saved: Parameters<typeof busLevelsFrom>[0]) => busLevelsFrom(saved, 0, 0.9);

describe("busLevelsFrom", () => {
  it("takes a current store at its word", () => {
    expect(restore({ volGuide: 0.4, volMetronome: 0.7 })).toEqual({
      guide: 0.4,
      metronome: 0.7,
    });
  });

  it("keeps a level of zero, which is now how something is switched off", () => {
    expect(restore({ volGuide: 0, volMetronome: 0 })).toEqual({ guide: 0, metronome: 0 });
  });

  it("falls back to the defaults for anything a store does not carry", () => {
    expect(restore({})).toEqual({ guide: 0, metronome: 0.9 });
  });

  it("silences the click an old store had switched off, however loud its fader", () => {
    // The flag gated the level, so the level alone was never the truth.
    expect(restore({ metronome: false, volMetronome: 0.9 })).toEqual({
      guide: 0,
      metronome: 0,
    });
  });

  it("keeps the click an old store had on, at the level it kept", () => {
    expect(restore({ metronome: true, volMetronome: 0.5 }).metronome).toBe(0.5);
  });

  it("starts an old store's guide silent whatever its fader said", () => {
    // Its toggle was session state that began every run off, so nobody has
    // ever heard the guide without asking for it in that sitting. Restoring
    // 0.6 would start playing the lesson at someone who never had it on.
    expect(restore({ metronome: true, volGuide: 0.6 }).guide).toBe(0);
    expect(restore({ metronome: false, volGuide: 1 }).guide).toBe(0);
  });

  it("reads the old shape off the flag, not off the levels", () => {
    // A current store may hold exactly the same levels and must be left alone.
    const old = restore({ metronome: true, volGuide: 0.6, volMetronome: 0.9 });
    const now = restore({ volGuide: 0.6, volMetronome: 0.9 });
    expect(old.guide).toBe(0);
    expect(now.guide).toBe(0.6);
  });

  it("ignores a non-number level rather than trusting it", () => {
    const bad = { volGuide: "loud", volMetronome: null } as unknown as Parameters<
      typeof busLevelsFrom
    >[0];
    expect(restore(bad)).toEqual({ guide: 0, metronome: 0.9 });
  });
});
