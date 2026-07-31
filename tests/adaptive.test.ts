import { describe, it, expect } from "vitest";
import { AdvanceTracker } from "../src/engine/adaptive";

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
