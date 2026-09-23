import { describe, it, expect } from "vitest";
import {
  PASS_MARK,
  type Course,
  openingStep,
  passes,
  pointsToGo,
  qualifies,
  songState,
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
  it("leaves every section open on a fresh song", () => {
    // Nothing is locked — the user moves between sections freely.
    expect(states({})).toEqual(Array(5).fill("todo"));
  });

  it("marks a section complete at the mark, and only that", () => {
    expect(states({ a: 0.91, b: 0.86 })).toEqual(["passed", "passed", "todo", "todo", "todo"]);
  });

  it("keeps a section to do, with its best, until it reaches the mark", () => {
    expect(stepsOf(SONG, { c: 0.72 })[2]).toMatchObject({ state: "todo", best: 0.72 });
  });

  it("completes a section played out of order", () => {
    expect(states({ c: 0.95 })).toEqual(["todo", "todo", "passed", "todo", "todo"]);
    expect(states({ full: 0.9 })[4]).toBe("passed");
  });

  it("completes everything once every section lands", () => {
    expect(states({ a: 0.9, b: 0.9, c: 0.9, d: 0.9, full: 0.83 })).toEqual(Array(5).fill("passed"));
  });
});

describe("what is suggested", () => {
  it("suggests the first section not yet complete, in the song's order", () => {
    expect(songState(SONG, {}).suggested).toBe(0);
    expect(songState(SONG, { a: 0.9, b: 0.9 }).suggested).toBe(2);
    // Skipping ahead does not move the suggestion past what is still to do.
    expect(songState(SONG, { a: 0.9, c: 0.9 }).suggested).toBe(1);
  });

  it("suggests nothing once the song is complete", () => {
    const s = songState(SONG, { a: 0.9, b: 0.9, c: 0.9, d: 0.9, full: 0.9 });
    expect(s.suggested).toBeNull();
    expect(s.complete).toBe(true);
    expect(s.passedCount).toBe(5);
  });

  it("opens the song on the suggestion, or the full song when all is done", () => {
    expect(openingStep(SONG, {})).toBe(0);
    expect(openingStep(SONG, { a: 0.9, b: 0.9 })).toBe(2);
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
  it("says a run completed its section, and points on to the next", () => {
    const r = stepReport(SONG, { a: 0.91 }, { a: 0.91, b: 0.86 }, "b", true)!;
    expect(r.label).toBe("PART B");
    expect(r.justPassed).toBe(true);
    expect(r.passedCount).toBe(2);
    expect(r.complete).toBe(false);
    expect(r.suggested).toBe(2);
    expect(r.following?.label).toBe("PART C");
  });

  it("still points on after a run short of the mark — nothing is locked", () => {
    const r = stepReport(SONG, { a: 0.9, b: 0.9 }, { a: 0.9, b: 0.9, c: 0.72 }, "c", true)!;
    expect(r.justPassed).toBe(false);
    expect(r.following).toMatchObject({ label: "PART D", state: "todo" });
  });

  it("carries that a run did not qualify, so the screen can say why", () => {
    const p = { a: 0.9 };
    const r = stepReport(SONG, p, p, "b", false)!;
    expect(r.qualified).toBe(false);
    expect(r.justPassed).toBe(false);
  });

  it("calls the song complete when its last section lands, whichever that is", () => {
    const before = { a: 0.9, b: 0.9, d: 0.9, full: 0.9 };
    const r = stepReport(SONG, before, { ...before, c: 0.83 }, "c", true)!;
    expect(r.complete).toBe(true);
    expect(r.justPassed).toBe(true);
    expect(r.suggested).toBeNull();
  });

  it("has nothing after the full song", () => {
    const r = stepReport(SONG, {}, { full: 0.83 }, "full", true)!;
    expect(r.following).toBeNull();
    expect(r.complete).toBe(false);
  });

  it("does not re-announce a section already complete", () => {
    const p = { a: 0.9, b: 0.9 };
    const r = stepReport(SONG, p, { a: 0.95, b: 0.9 }, "a", true)!;
    expect(r.justPassed).toBe(false);
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
