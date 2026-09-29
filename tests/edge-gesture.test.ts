import { describe, it, expect } from "vitest";
import {
  DRUM_CHANNEL,
  GESTURE_WINDOW,
  edgeGesture as detect,
  type HeldNote,
} from "../src/engine/edge-gesture";

/** Which gesture, if any — most tests only care about that. */
const edgeGesture = (held: HeldNote[], padsLesson: boolean) => detect(held, padsLesson)?.kind ?? null;

/** Four notes struck together on one channel, a few ms apart. */
const grab = (notes: number[], channel = 0, t0 = 10): HeldNote[] =>
  notes.map((note, i) => ({ note, channel, at: t0 + i * 0.03 }));

describe("the keyboard's edges", () => {
  it("fires on the two lowest and two highest keys of a Launchkey 37 (C3–C6)", () => {
    expect(edgeGesture(grab([48, 49, 83, 84]), false)).toBe("keys");
  });

  it("fires on the two outermost white keys, as the user's hands landed (C3 D3, B6 C7)", () => {
    expect(edgeGesture(grab([48, 50, 95, 96]), false)).toBe("keys");
    expect(edgeGesture(grab([48, 50, 83, 84]), false)).toBe("keys");
  });

  it("fires whatever the size or octave — 25, 49, 61 and 88 keys", () => {
    expect(edgeGesture(grab([48, 49, 71, 72]), false)).toBe("keys"); // 25: C3–C5
    expect(edgeGesture(grab([36, 37, 83, 84]), false)).toBe("keys"); // 49: C2–C6
    expect(edgeGesture(grab([36, 37, 95, 96]), false)).toBe("keys"); // 61: C2–C7
    expect(edgeGesture(grab([21, 22, 107, 108]), false)).toBe("keys"); // 88: A0–C8
    expect(edgeGesture(grab([60, 61, 95, 96]), false)).toBe("keys"); // shifted up
  });

  it("fires in any order the fingers land, and in a pads lesson too", () => {
    expect(edgeGesture(grab([84, 48, 83, 49]), false)).toBe("keys");
    expect(edgeGesture(grab([48, 49, 83, 84]), true)).toBe("keys");
  });

  it("does not fire on music", () => {
    expect(edgeGesture(grab([60, 64, 67, 72]), false)).toBeNull(); // a C chord, doubled
    expect(edgeGesture(grab([60, 61, 63, 64]), false)).toBeNull(); // a cluster
    expect(edgeGesture(grab([60, 61, 70, 71]), false)).toBeNull(); // pairs under an octave apart
    expect(edgeGesture(grab([48, 51, 93, 96]), false)).toBeNull(); // pairs a third wide
    expect(edgeGesture(grab([48, 52, 79, 84]), false)).toBeNull(); // an open C voicing
    expect(edgeGesture(grab([48, 49, 83]), false)).toBeNull(); // three of the four
  });

  it("needs the four struck as one grab, not built up over time", () => {
    const slow: HeldNote[] = [
      { note: 48, channel: 0, at: 10 },
      { note: 49, channel: 0, at: 10.1 },
      { note: 83, channel: 0, at: 10.2 },
      { note: 84, channel: 0, at: 10.2 + GESTURE_WINDOW + 0.1 },
    ];
    expect(edgeGesture(slow, false)).toBeNull();
  });

  it("waits for a hand that sets one pair down before the other", () => {
    // Left pair, a pause, then the right pair: 0.9s end to end.
    const twoHanded: HeldNote[] = [
      { note: 48, channel: 0, at: 10 },
      { note: 49, channel: 0, at: 10.05 },
      { note: 83, channel: 0, at: 10.85 },
      { note: 84, channel: 0, at: 10.9 },
    ];
    expect(edgeGesture(twoHanded, false)).toBe("keys");
  });

  it("says when the grab began, so its strikes can be taken back", () => {
    const g = detect(grab([84, 48, 83, 49], 0, 20), false);
    expect(g?.since).toBe(20);
  });

  it("ignores a note held from earlier, and refuses a fifth in the grab", () => {
    const sustained: HeldNote = { note: 40, channel: 0, at: 2 };
    expect(edgeGesture([sustained, ...grab([48, 49, 83, 84])], false)).toBe("keys");
    expect(edgeGesture(grab([48, 49, 60, 83, 84]), false)).toBeNull();
  });
});

describe("the pads' corners", () => {
  const onPads = (notes: number[]) => grab(notes, DRUM_CHANNEL);

  it("fires on the corners of a 4×4 bank (36, 39, 48, 51)", () => {
    expect(edgeGesture(onPads([36, 39, 48, 51]), false)).toBe("pads");
  });

  it("fires on either 2×8 arrangement — the Launchkey's pads are one of them", () => {
    expect(edgeGesture(onPads([36, 40, 47, 51]), false)).toBe("pads");
    expect(edgeGesture(onPads([36, 43, 44, 51]), false)).toBe("pads");
  });

  it("follows the bank when the pads are shifted", () => {
    expect(edgeGesture(onPads([52, 55, 64, 67]), false)).toBe("pads");
  });

  it("counts pad shapes from a pads lesson whatever the channel", () => {
    expect(edgeGesture(grab([36, 39, 48, 51], 0), true)).toBe("pads");
  });

  it("does not read a doubled minor triad on the keys as corner pads", () => {
    // C Eb C' Eb' is the 4×4's shape exactly — which is why pad shapes need pads.
    expect(edgeGesture(grab([60, 63, 72, 75], 0), false)).toBeNull();
  });

  it("does not fire on a groove", () => {
    expect(edgeGesture(onPads([36, 38, 42, 46]), false)).toBeNull(); // kick, snare, hats
    expect(edgeGesture(onPads([36, 39, 48]), false)).toBeNull();
  });
});
