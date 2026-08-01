import { describe, it, expect } from "vitest";
import { AdvanceTracker } from "../src/engine/adaptive";

describe("AdvanceTracker", () => {
  it("clears the lesson on one strong run at/above base tempo", () => {
    const a = new AdvanceTracker();
    expect(a.update(0.95, 100, 100)).toBe(true);
  });

  it("resets its streak after advancing", () => {
    const a = new AdvanceTracker();
    expect(a.update(0.95, 100, 100)).toBe(true);
    // the next lesson starts from scratch, not already cleared
    expect(a.update(0.7, 100, 100)).toBe(false);
  });

  it("does not clear on a weak run", () => {
    const a = new AdvanceTracker();
    expect(a.update(0.7, 100, 100)).toBe(false);
    expect(a.update(0.89, 100, 100)).toBe(false);
    expect(a.update(0.9, 100, 100)).toBe(true);
  });

  it("does not count a strong run below base tempo", () => {
    const a = new AdvanceTracker();
    expect(a.update(0.95, 90, 100)).toBe(false);
    expect(a.update(0.95, 99, 100)).toBe(false);
    expect(a.update(0.95, 100, 100)).toBe(true);
  });
});
