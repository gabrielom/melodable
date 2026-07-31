import { describe, it, expect } from "vitest";
import { Scorer, classify, lessonTargets, type TargetNote } from "../src/engine/scoring";
import { TIMING_WINDOWS } from "../src/engine/types";
import { noteToPad } from "../src/engine/gm";
import type { Lesson } from "../src/engine/types";

describe("classify", () => {
  it("grades by absolute offset against the timing windows", () => {
    expect(classify(0)).toBe("perfect");
    expect(classify(-0.02)).toBe("perfect");
    expect(classify(TIMING_WINDOWS.perfect)).toBe("perfect");
    expect(classify(0.05)).toBe("great");
    expect(classify(-TIMING_WINDOWS.great)).toBe("great");
    expect(classify(0.09)).toBe("good");
    expect(classify(0.101)).toBeNull();
    expect(classify(-5)).toBeNull();
  });
});

describe("lessonTargets", () => {
  const lesson: Lesson = {
    id: "t",
    name: "t",
    instrument: "pads",
    bpm: 100,
    bars: 1,
    beatsPerBar: 4,
    source: "builtin",
    notes: [
      { time: 1, pitch: 38 }, // snare -> pad 13
      { time: 0, pitch: 36 }, // kick  -> pad 12
      { time: 2, pitch: 21 }, // unmapped -> dropped
    ],
  };

  it("routes pitches to lanes, drops unmapped, sorts by beat", () => {
    const targets = lessonTargets(lesson, noteToPad);
    expect(targets).toEqual([
      { lane: 12, beat: 0 },
      { lane: 13, beat: 1 },
    ]);
  });
});

// one kick lane note per beat, spb = 0.5 (times 0, 0.5s style via timeOf below)
const targets: TargetNote[] = [
  { lane: 12, beat: 0 },
  { lane: 12, beat: 1 },
  { lane: 13, beat: 2 },
];
const timeOf = (loop: number, beat: number) => 10 + loop * 2 + beat * 0.5;

describe("scorer", () => {
  it("spawns a loop once", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    s.spawnLoop(0, timeOf);
    expect(s.instances).toHaveLength(3);
    expect(s.instances[0].time).toBeCloseTo(10);
    expect(s.instances[2].time).toBeCloseTo(11);
  });

  it("grades a hit against the nearest unresolved note in the lane", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);

    const res = s.hit(12, 10.01);
    expect(res?.rating).toBe("perfect");
    expect(res?.instance.beat).toBe(0);
    expect(s.combo).toBe(1);

    // second hit near beat 1 grades against the remaining kick note
    const res2 = s.hit(12, 10.55);
    expect(res2?.rating).toBe("great");
    expect(res2?.instance.beat).toBe(1);
    expect(s.combo).toBe(2);
    expect(s.bestCombo).toBe(2);
  });

  it("ignores strays: wrong lane or outside the good window", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    expect(s.hit(13, 10.0)).toBeNull(); // snare lane note is at 11
    expect(s.hit(12, 10.25)).toBeNull(); // 0.25s from either kick note
    expect(s.combo).toBe(0);
    expect(s.accuracy).toBe(1); // strays don't count in v1
  });

  it("does not double-resolve a note", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    expect(s.hit(13, 11.0)?.rating).toBe("perfect");
    expect(s.hit(13, 11.02)).toBeNull(); // nothing left in the lane
  });

  it("sweeps overdue notes as misses and resets the combo", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    s.hit(12, 10.0);
    expect(s.combo).toBe(1);

    // beat-1 kick (t=10.5) window closes at 10.6; snare at 11 still open
    const missed = s.sweepMisses(10.75);
    expect(missed).toHaveLength(1);
    expect(missed[0].rating).toBe("miss");
    expect(missed[0].beat).toBe(1);
    expect(s.combo).toBe(0);

    // accuracy is score-weighted: one perfect + one miss = 0.5
    expect(s.accuracy).toBeCloseTo(0.5);
  });

  it("weights accuracy by rating score", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    s.hit(12, 10.0); // perfect: 1.0
    s.hit(12, 10.58); // good (0.08 off): 0.4
    expect(s.accuracy).toBeCloseTo(0.7);
  });

  it("reports and resets per-loop accuracy", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    s.hit(12, 10.0); // perfect
    s.sweepMisses(12.2); // misses the other two
    expect(s.endLoop()).toBeCloseTo(1 / 3);
    // fresh loop tally
    s.spawnLoop(1, timeOf);
    s.hit(12, 12.0);
    expect(s.endLoop()).toBeCloseTo(1);
  });

  it("returns full accuracy for a loop with nothing graded", () => {
    const s = new Scorer(targets);
    expect(s.endLoop()).toBe(1);
  });

  it("prunes old loops and can respawn only newer ones", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    s.spawnLoop(1, timeOf);
    s.pruneBefore(1);
    expect(s.instances.every((i) => i.loopIndex >= 1)).toBe(true);
    s.spawnLoop(2, timeOf);
    expect(s.instances).toHaveLength(6);
  });

  it("retimes unresolved notes after a tempo change", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    s.hit(12, 10.0);
    const slower = (loop: number, beat: number) => 10 + loop * 4 + beat * 1.0;
    s.retime(slower);
    const byBeat = (b: number) => s.instances.find((i) => i.beat === b)!;
    expect(byBeat(0).time).toBeCloseTo(10); // resolved: untouched
    expect(byBeat(1).time).toBeCloseTo(11);
    expect(byBeat(2).time).toBeCloseTo(12);
  });

});

describe("chord grading (piano)", () => {
  // A C-major triad on beat 0: three lanes (pitches) sharing the same time.
  const chord: TargetNote[] = [
    { lane: 60, beat: 0 },
    { lane: 64, beat: 0 },
    { lane: 67, beat: 0 },
  ];
  const timeOf = (loop: number, beat: number) => 5 + loop + beat * 0.5;

  it("grades each chord note independently, by its own pitch", () => {
    const s = new Scorer(chord);
    s.spawnLoop(0, timeOf); // all three at t=5

    expect(s.hit(60, 5.0)?.rating).toBe("perfect");
    expect(s.hit(64, 5.05)?.rating).toBe("great"); // 50ms late → great window
    expect(s.hit(67, 5.0)?.rating).toBe("perfect");
    expect(s.combo).toBe(3);
    expect(s.accuracy).toBeGreaterThan(0.9);
  });

  it("counts a missing chord note as a miss, not the whole chord", () => {
    const s = new Scorer(chord);
    s.spawnLoop(0, timeOf);
    s.hit(60, 5.0);
    s.hit(64, 5.0);
    // never play G; its window closes
    const missed = s.sweepMisses(5.5);
    expect(missed).toHaveLength(1);
    expect(missed[0].lane).toBe(67);
    // two of three landed
    expect(s.accuracy).toBeCloseTo(2 / 3);
  });
});
