import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useChords } from "../src/stores/chords";
import { ribbonBarAt, type RibbonHits } from "../src/views/lane-geometry";

/**
 * Naming a bar's chord by hand.
 *
 * The derivation has a floor it cannot get under — two chords can be the same
 * pitch classes, so which one a bar is depends on an accompaniment an imported
 * clip does not carry. These cover the two halves of the escape hatch: where
 * the answer is kept, and how a click finds the bar it belongs to.
 */

describe("the chord override store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("derives every bar until something is said otherwise", () => {
    const s = useChords();
    expect(s.overrideFor("lesson", 0)).toBeNull();
    expect(s.forLesson("lesson")).toEqual({});
  });

  it("keeps a named bar, per lesson and per bar", () => {
    const s = useChords();
    s.setOverride("a", 1, 5);
    expect(s.overrideFor("a", 1)).toBe(5);
    // Another bar, and another lesson, are untouched.
    expect(s.overrideFor("a", 0)).toBeNull();
    expect(s.overrideFor("b", 1)).toBeNull();
  });

  it("hands a bar back to the derivation", () => {
    const s = useChords();
    s.setOverride("a", 1, 5);
    s.setOverride("a", 1, null);
    expect(s.overrideFor("a", 1)).toBeNull();
  });

  it("leaves no empty row behind when the last override goes", () => {
    // A row that says nothing would grow the store for ever.
    const s = useChords();
    s.setOverride("a", 1, 5);
    s.setOverride("a", 1, null);
    expect(Object.keys(s.byLesson)).toEqual([]);
  });

  it("clears a whole lesson at once", () => {
    const s = useChords();
    s.setOverride("a", 0, 1);
    s.setOverride("a", 2, 4);
    s.setOverride("b", 0, 5);
    s.clearLesson("a");
    expect(s.forLesson("a")).toEqual({});
    expect(s.overrideFor("b", 0)).toBe(5);
  });

  it("refuses a degree that is not one of the seven", () => {
    // The store is written by a menu, but it is also read back off disk.
    const s = useChords();
    s.byLesson = { a: { 0: 0, 1: 8, 2: 3 } };
    expect(s.overrideFor("a", 0)).toBeNull();
    expect(s.overrideFor("a", 1)).toBeNull();
    expect(s.overrideFor("a", 2)).toBe(3);
  });
});

describe("finding the bar under a click", () => {
  const hits: RibbonHits = {
    y0: 100,
    y1: 138,
    blocks: [
      { bar: 0, x0: 200, x1: 300 },
      { bar: 1, x0: 300, x1: 400 },
      { bar: 2, x0: 400, x1: 500 },
    ],
  };

  it("names the block the point is in", () => {
    expect(ribbonBarAt(hits, 250, 120)).toBe(0);
    expect(ribbonBarAt(hits, 350, 120)).toBe(1);
    expect(ribbonBarAt(hits, 450, 120)).toBe(2);
  });

  it("gives a shared edge to the block on its right", () => {
    // Blocks abut, so one of them has to own the boundary and it must be the
    // same one every time — otherwise a click on a bar line is a coin toss.
    expect(ribbonBarAt(hits, 300, 120)).toBe(1);
    expect(ribbonBarAt(hits, 400, 120)).toBe(2);
  });

  it("ignores a point outside the strip", () => {
    expect(ribbonBarAt(hits, 250, 99)).toBeNull();
    expect(ribbonBarAt(hits, 250, 139)).toBeNull();
    expect(ribbonBarAt(hits, 199, 120)).toBeNull();
    expect(ribbonBarAt(hits, 500, 120)).toBeNull();
  });

  it("has nothing to hit in a view that drew no ribbon", () => {
    expect(ribbonBarAt(null, 250, 120)).toBeNull();
  });
});
