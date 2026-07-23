import { describe, it, expect } from "vitest";
import { nextTempo, AdvanceTracker, PUSH_ACC, EASE_ACC } from "../src/engine/adaptive";

describe("nextTempo", () => {
  const base = 100;

  it("pushes up by 4 bpm on clean loops", () => {
    expect(nextTempo(base, 100, 0.9)).toBe(104);
    expect(nextTempo(base, 100, PUSH_ACC)).toBe(104);
  });

  it("caps the push at 135% of base", () => {
    expect(nextTempo(base, 134, 1)).toBe(135);
    expect(nextTempo(base, 135, 1)).toBe(135);
  });

  it("eases off by 5 bpm on rough loops", () => {
    expect(nextTempo(base, 100, 0.3)).toBe(95);
    expect(nextTempo(base, 100, EASE_ACC - 0.01)).toBe(95);
  });

  it("floors the ease at 60% of base", () => {
    expect(nextTempo(base, 62, 0)).toBe(60);
    expect(nextTempo(base, 60, 0)).toBe(60);
  });

  it("holds in the middle band", () => {
    expect(nextTempo(base, 100, 0.7)).toBe(100);
    expect(nextTempo(base, 100, EASE_ACC)).toBe(100);
  });
});

describe("AdvanceTracker", () => {
  it("advances after two consecutive strong loops at/above base tempo", () => {
    const a = new AdvanceTracker();
    expect(a.update(0.95, 100, 100)).toBe(false);
    expect(a.update(0.92, 104, 100)).toBe(true);
  });

  it("resets its streak after advancing", () => {
    const a = new AdvanceTracker();
    a.update(0.95, 100, 100);
    a.update(0.95, 100, 100);
    expect(a.update(0.95, 100, 100)).toBe(false); // streak restarted
  });

  it("breaks the streak on a weak loop", () => {
    const a = new AdvanceTracker();
    expect(a.update(0.95, 100, 100)).toBe(false);
    expect(a.update(0.7, 100, 100)).toBe(false);
    expect(a.update(0.95, 100, 100)).toBe(false);
    expect(a.update(0.95, 100, 100)).toBe(true);
  });

  it("does not count strong loops below base tempo", () => {
    const a = new AdvanceTracker();
    expect(a.update(0.95, 90, 100)).toBe(false);
    expect(a.update(0.95, 95, 100)).toBe(false);
    expect(a.update(0.95, 100, 100)).toBe(false); // streak only starts here
    expect(a.update(0.95, 104, 100)).toBe(true);
  });
});
