import { describe, it, expect } from "vitest";
import {
  PASS_MARK,
  type Course,
  openingStep,
  passes,
  pointsToGo,
  qualifies,
  stepLabel,
  stepReport,
  stepsOf,
  usableCourses,
  usableProgress,
  withRun,
} from "../src/engine/course";

const SONG: Course = { id: "c1", name: "El Día de Mi Suerte", lessonIds: ["a", "b", "c", "d", "full"] };
const states = (p: Record<string, number>) => stepsOf(SONG, p).map((s) => s.state);

describe("stepLabel", () => {
  it("letters the parts and calls the last one the full song", () => {
    expect([0, 1, 2, 3, 4].map((i) => stepLabel(i, 5))).toEqual([
      "PART A",
      "PART B",
      "PART C",
      "PART D",
      "FULL SONG",
    ]);
  });

  it("works for any number of steps", () => {
    expect([0, 1].map((i) => stepLabel(i, 2))).toEqual(["PART A", "FULL SONG"]);
  });
});

describe("passes", () => {
  it("is 80%", () => {
    expect(PASS_MARK).toBe(0.8);
    expect(passes(0.8)).toBe(true);
    expect(passes(0.79)).toBe(false);
  });

  it("judges the number the summary shows, not the one behind it", () => {
    // 79.6% is shown as 80 — refusing it beside a mark of 80 would argue with itself.
    expect(passes(0.796)).toBe(true);
    expect(passes(0.794)).toBe(false);
  });

  it("counts what is left in the same whole points", () => {
    expect(pointsToGo(0.72)).toBe(8);
    expect(pointsToGo(0.794)).toBe(1);
    expect(pointsToGo(0.9)).toBe(0);
  });
});

describe("stepsOf", () => {
  it("opens the first step and locks the rest on a fresh song", () => {
    expect(states({})).toEqual(["next", "locked", "locked", "locked", "locked"]);
  });

  it("opens the step after each one passed", () => {
    expect(states({ a: 0.91, b: 0.86 })).toEqual(["passed", "passed", "next", "locked", "locked"]);
  });

  it("keeps a step open, with its best, until it reaches the mark", () => {
    const steps = stepsOf(SONG, { a: 0.91, b: 0.86, c: 0.72 });
    expect(steps[2]).toMatchObject({ state: "next", best: 0.72 });
    expect(steps[3].state).toBe("locked");
  });

  it("holds the order even against a later step passed out of turn", () => {
    // Only possible if the song were re-combined; the order is still the rule.
    expect(states({ a: 0.9, c: 0.95 })).toEqual(["passed", "next", "locked", "locked", "locked"]);
  });

  it("passes everything once the full song lands", () => {
    expect(states({ a: 0.9, b: 0.9, c: 0.9, d: 0.9, full: 0.83 })).toEqual(Array(5).fill("passed"));
  });
});

describe("openingStep", () => {
  it("opens the step up next", () => {
    expect(openingStep(SONG, {})).toBe(0);
    expect(openingStep(SONG, { a: 0.9, b: 0.9 })).toBe(2);
  });

  it("opens the full song once everything is passed", () => {
    expect(openingStep(SONG, { a: 0.9, b: 0.9, c: 0.9, d: 0.9, full: 0.9 })).toBe(4);
  });
});

describe("what a run counts for", () => {
  it("only counts at the lesson's own tempo or faster", () => {
    expect(qualifies(200, 200)).toBe(true);
    expect(qualifies(210, 200)).toBe(true);
    expect(qualifies(199.9, 200)).toBe(false);
  });

  it("ignores a slower run, however good", () => {
    expect(withRun({}, "a", 0.99, 160, 200)).toEqual({});
  });

  it("keeps the best qualifying run and never takes a pass away", () => {
    let p = withRun({}, "a", 0.7, 200, 200);
    expect(p).toEqual({ a: 0.7 });
    p = withRun(p, "a", 0.85, 200, 200);
    expect(p).toEqual({ a: 0.85 });
    const same = withRun(p, "a", 0.6, 200, 200);
    expect(same).toBe(p);
  });
});

describe("stepReport", () => {
  it("says a pass opened the next step", () => {
    const r = stepReport(SONG, { a: 0.91 }, { a: 0.91, b: 0.86 }, "b", true)!;
    expect(r.label).toBe("PART B");
    expect(r.justPassed).toBe(true);
    expect(r.unlocked?.label).toBe("PART C");
    expect(r.passedCount).toBe(2);
    expect(r.complete).toBe(false);
    expect(r.following?.state).toBe("next");
  });

  it("opens nothing on a run short of the mark", () => {
    const r = stepReport(SONG, { a: 0.9, b: 0.9 }, { a: 0.9, b: 0.9, c: 0.72 }, "c", true)!;
    expect(r.justPassed).toBe(false);
    expect(r.unlocked).toBeNull();
    expect(r.following?.state).toBe("locked");
  });

  it("carries that a run did not qualify, so the screen can say why", () => {
    const p = { a: 0.9 };
    const r = stepReport(SONG, p, p, "b", false)!;
    expect(r.qualified).toBe(false);
    expect(r.justPassed).toBe(false);
  });

  it("calls the song complete when the full song is passed", () => {
    const before = { a: 0.9, b: 0.9, c: 0.9, d: 0.9 };
    const r = stepReport(SONG, before, { ...before, full: 0.83 }, "full", true)!;
    expect(r.complete).toBe(true);
    expect(r.justPassed).toBe(true);
    expect(r.unlocked).toBeNull();
    expect(r.following).toBeNull();
  });

  it("does not re-announce a step already passed", () => {
    const p = { a: 0.9, b: 0.9 };
    const r = stepReport(SONG, p, { a: 0.95, b: 0.9 }, "a", true)!;
    expect(r.justPassed).toBe(false);
    expect(r.unlocked).toBeNull();
  });

  it("has nothing to say about a lesson outside the song", () => {
    expect(stepReport(SONG, {}, {}, "elsewhere", true)).toBeNull();
  });
});

describe("reading songs back from the store", () => {
  it("keeps a well-formed song", () => {
    expect(usableCourses([SONG], ["a", "b", "c", "d", "full"])).toEqual([SONG]);
  });

  it("drops a step whose lesson is gone, and a song left with under two", () => {
    const got = usableCourses(
      [SONG, { id: "c2", name: "x", lessonIds: ["q", "gone"] }],
      ["a", "b", "full", "q"],
    );
    expect(got).toEqual([{ ...SONG, lessonIds: ["a", "b", "full"] }]);
  });

  it("lets a lesson belong to one song only", () => {
    const got = usableCourses(
      [SONG, { id: "c2", name: "x", lessonIds: ["a", "b", "z"] }],
      ["a", "b", "c", "d", "full", "z"],
    );
    expect(got.map((c) => c.id)).toEqual(["c1"]);
  });

  it("does not trust what it is handed", () => {
    expect(usableCourses(null, [])).toEqual([]);
    expect(usableCourses([1, { id: 2 }], ["a"])).toEqual([]);
    expect(usableProgress({ c1: { a: 0.9, b: "x", c: 7 }, c2: null })).toEqual({ c1: { a: 0.9 } });
  });
});
