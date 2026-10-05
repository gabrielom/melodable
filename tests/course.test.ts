import { describe, it, expect } from "vitest";
import {
  PASS_MARK,
  type Course,
  type HandsOf,
  handToPlay,
  openingStep,
  passes,
  pointsToGo,
  qualifies,
  songState,
  stepLabel,
  stepReport,
  stepKey,
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
    expect(r.following?.step.label).toBe("PART C");
  });

  it("still points on after a run short of the mark — nothing is locked", () => {
    const r = stepReport(SONG, { a: 0.9, b: 0.9 }, { a: 0.9, b: 0.9, c: 0.72 }, "c", true)!;
    expect(r.justPassed).toBe(false);
    expect(r.following?.step).toMatchObject({ label: "PART D", state: "todo" });
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

describe("parts learned one hand at a time (handoff 15)", () => {
  // A piano song: every part has both hands to learn, the full song does not.
  const PIANO: HandsOf = () => ["R", "L", "BOTH"];
  const R = (id: string) => stepKey(id, "R");
  const L = (id: string) => stepKey(id, "L");

  it("gives each part R, L and BOTH, and the full song BOTH alone", () => {
    const steps = stepsOf(SONG, {}, PIANO);
    expect(steps.slice(0, 4).every((s) => s.hands.map((h) => h.hand).join() === "R,L,BOTH")).toBe(true);
    expect(steps[4].hands.map((h) => h.hand)).toEqual(["BOTH"]);
    expect(songState(SONG, {}, PIANO).stepCount).toBe(13);
  });

  it("keeps a part score saved before hands existed as its both-hands best", () => {
    // The key a part's score was always stored under is the BOTH step's.
    expect(stepKey("c", "BOTH")).toBe("c");
    const c = stepsOf(SONG, { c: 0.86 }, PIANO)[2];
    expect(c.hands[2]).toMatchObject({ hand: "BOTH", best: 0.86, state: "passed" });
    expect(c.state).toBe("passed");
  });

  it("completes a part on its both-hands step alone — the hands are practice", () => {
    expect(stepsOf(SONG, { [R("a")]: 0.95, [L("a")]: 0.95 }, PIANO)[0].state).toBe("todo");
    expect(stepsOf(SONG, { a: 0.8 }, PIANO)[0].state).toBe("passed");
  });

  it("counts parts, not steps", () => {
    const p = { a: 0.9, [R("b")]: 0.9, [L("b")]: 0.9 };
    expect(songState(SONG, p, PIANO).passedCount).toBe(1);
  });

  it("suggests the first part not complete, at its first step not yet passed", () => {
    const p = { a: 0.91, b: 0.86, [R("c")]: 0.88, [L("c")]: 0.72 };
    const st = songState(SONG, p, PIANO);
    expect(st.suggested).toBe(2);
    expect(st.suggestedHand).toBe("L");
    // Nothing played yet: part A, right hand.
    expect(songState(SONG, {}, PIANO).suggestedHand).toBe("R");
    // Everything complete: nothing to suggest.
    const done = { a: 0.9, b: 0.9, c: 0.9, d: 0.9, full: 0.9 };
    expect(songState(SONG, done, PIANO).suggestedHand).toBeNull();
  });

  it("plays a complete part with both hands, and an incomplete one at its first open step", () => {
    const steps = stepsOf(SONG, { a: 0.9, [R("b")]: 0.9 }, PIANO);
    expect(handToPlay(steps[0])).toBe("BOTH");
    expect(handToPlay(steps[1])).toBe("L");
  });

  it("records a hand's run under its own key", () => {
    expect(withRun({}, L("c"), 0.72, 200, 200)).toEqual({ "c#L": 0.72 });
  });

  it("sends NEXT through the hands, then on to the next part", () => {
    const after = { [R("c")]: 0.88 };
    const r = stepReport(SONG, {}, after, "c", true, "R", PIANO)!;
    expect(r.hand).toBe("R");
    expect(r.handed).toBe(true);
    expect(r.justPassed).toBe(true);
    expect(r.partJustPassed).toBe(false);
    expect(r.following).toMatchObject({ index: 2, hand: "L" });

    const both = stepReport(SONG, after, { ...after, c: 0.83 }, "c", true, "BOTH", PIANO)!;
    expect(both.partJustPassed).toBe(true);
    expect(both.following).toMatchObject({ index: 3, hand: "R" });
  });

  it("goes past the hands of a part already complete", () => {
    const p = { d: 0.9 };
    const r = stepReport(SONG, p, { ...p, c: 0.85 }, "c", true, "BOTH", PIANO)!;
    expect(r.following).toMatchObject({ index: 3, hand: "BOTH" });
  });

  it("keeps a pads song one step a part", () => {
    const steps = stepsOf(SONG, {}, () => ["BOTH"]);
    expect(steps.every((s) => s.hands.length === 1)).toBe(true);
    expect(stepReport(SONG, {}, { a: 0.5 }, "a", true, "BOTH", () => ["BOTH"])!.handed).toBe(false);
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
