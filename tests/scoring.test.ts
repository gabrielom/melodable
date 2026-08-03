import { describe, it, expect } from "vitest";
import {
  Scorer,
  classify,
  lessonTargets,
  lessonRepeats,
  visibleLoopSpan,
  previewInstances,
  type TargetNote,
} from "../src/engine/scoring";
import { TIMING_WINDOWS } from "../src/engine/types";
import { noteToPad } from "../src/engine/gm";
import type { Lesson } from "../src/engine/types";

describe("classify", () => {
  it("grades the tight windows by absolute offset, in either direction", () => {
    expect(classify(0)).toBe("perfect");
    expect(classify(-0.02)).toBe("perfect");
    expect(classify(TIMING_WINDOWS.perfect)).toBe("perfect");
    expect(classify(-TIMING_WINDOWS.perfect)).toBe("perfect");
    expect(classify(0.05)).toBe("great");
    expect(classify(-0.05)).toBe("great");
    expect(classify(TIMING_WINDOWS.great)).toBe("great");
    expect(classify(-TIMING_WINDOWS.great)).toBe("great");
  });

  it("splits the loose band by direction: ahead is early, behind is late", () => {
    expect(classify(-0.09)).toBe("early"); // struck before the note
    expect(classify(0.09)).toBe("late"); // struck after it
    expect(classify(-TIMING_WINDOWS.loose)).toBe("early");
    expect(classify(TIMING_WINDOWS.loose)).toBe("late");
    // just outside the great window, so direction starts mattering here
    expect(classify(-(TIMING_WINDOWS.great + 0.001))).toBe("early");
    expect(classify(TIMING_WINDOWS.great + 0.001)).toBe("late");
  });

  it("is null outside every window, whichever side", () => {
    expect(classify(0.101)).toBeNull();
    expect(classify(-0.101)).toBeNull();
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
    s.hit(12, 10.58); // late (0.08 behind): 0.4
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

describe("lessonRepeats", () => {
  const lesson = (over: Partial<Lesson>): Lesson => ({
    id: "t",
    name: "t",
    instrument: "pads",
    bpm: 120,
    bars: 1,
    beatsPerBar: 4,
    notes: [],
    source: "builtin",
    ...over,
  });

  it("uses the lesson's own repeat count when it has one", () => {
    expect(lessonRepeats(lesson({ repeats: 16 }))).toBe(16);
    expect(lessonRepeats(lesson({ repeats: 8, bars: 2 }))).toBe(8);
  });

  it("repeats a short pattern into a run of roughly the target length", () => {
    // 1 bar at 120bpm = 2s, so ~20 passes lands near 40s
    expect(lessonRepeats(lesson({}))).toBe(20);
    // 1 bar at 60bpm = 4s
    expect(lessonRepeats(lesson({ bpm: 60 }))).toBe(10);
  });

  it("plays a clip that is already long enough once", () => {
    // 16 bars at 120bpm = 32s: near the target already
    expect(lessonRepeats(lesson({ bars: 16 }))).toBe(1);
    // a full minute: still one pass, never zero
    expect(lessonRepeats(lesson({ bars: 30 }))).toBe(1);
  });

  it("never returns zero or a runaway count", () => {
    expect(lessonRepeats(lesson({ bars: 0 }))).toBe(1);
    expect(lessonRepeats(lesson({ bpm: 0 }))).toBe(1);
    expect(lessonRepeats(lesson({ repeats: 9999 }))).toBeLessThanOrEqual(64);
  });
});

describe("run breakdown", () => {
  // two lanes, three notes each, so a lane can drift one way
  const two: TargetNote[] = [
    { lane: 12, beat: 0 },
    { lane: 12, beat: 1 },
    { lane: 13, beat: 2 },
    { lane: 13, beat: 3 },
  ];
  const at = (loop: number, beat: number) => 10 + loop * 4 + beat;

  it("tallies how many notes landed in each band", () => {
    const s = new Scorer(two);
    s.spawnLoop(0, at);
    s.hit(12, 10.0); // perfect
    s.hit(12, 11.05); // great
    s.hit(13, 12.08); // late
    s.sweepMisses(20); // the last one times out
    expect(s.tally).toEqual({ perfect: 1, great: 1, early: 0, late: 1, miss: 1 });
  });

  it("reports each lane's accuracy and which way it drifts, worst first", () => {
    const s = new Scorer(two);
    s.spawnLoop(0, at);
    s.hit(12, 10.0); // perfect
    s.hit(12, 11.0); // perfect
    s.hit(13, 11.92); // early (80ms ahead)
    s.hit(13, 12.92); // early

    const stats = s.laneStats();
    expect(stats).toHaveLength(2);
    // lane 13 only managed the loose band, so it sorts first
    expect(stats[0].lane).toBe(13);
    expect(stats[0].accuracy).toBeCloseTo(0.4);
    expect(stats[0].early).toBe(2);
    expect(stats[0].late).toBe(0);
    expect(stats[1].lane).toBe(12);
    expect(stats[1].accuracy).toBeCloseTo(1);
  });

  it("counts a swept note as a miss in both the tally and the lane", () => {
    const s = new Scorer(two);
    s.spawnLoop(0, at);
    s.sweepMisses(20);
    expect(s.tally.miss).toBe(4);
    expect(s.laneStats().every((l) => l.accuracy === 0)).toBe(true);
  });
});

describe("visibleLoopSpan", () => {
  // The case that motivated it: a one-bar pattern in a five-bar lane. The
  // playhead is centred, so the lane reaches 10 beats either way and touches
  // five repeats at once — "current and next" covered two of them.
  const BEHIND = 10;
  const AHEAD = 10;

  it("covers every repeat the lane can see, not just the next one", () => {
    const s = visibleLoopSpan(20, 4, BEHIND, AHEAD);
    expect(s.first).toBe(2); // beat 10 falls in repeat 2
    expect(s.last).toBe(7); // beat 30 falls in repeat 7
  });

  it("keeps the trailing edge on screen", () => {
    // Anything pruned before `first` is off the left edge of the lane.
    const s = visibleLoopSpan(20, 4, BEHIND, AHEAD);
    const oldestVisibleBeat = 20 - BEHIND;
    expect(s.first * 4).toBeLessThanOrEqual(oldestVisibleBeat);
  });

  it("does not run off the start of the run", () => {
    const s = visibleLoopSpan(2, 4, BEHIND, AHEAD);
    expect(s.first).toBe(0);
  });

  it("still includes the current and next repeat when the window is unknown", () => {
    // First frame, or audio-only: the renderer has not drawn yet. This is the
    // behaviour the fixed `[loopIndex, loopIndex + 1]` used to guarantee, and
    // grading a strike just before a repeat's first note depends on it.
    const s = visibleLoopSpan(9, 4, 0, 0);
    expect(s.first).toBe(2);
    expect(s.last).toBe(3);
  });

  it("spawns the first repeat during the count-in, when absBeat is negative", () => {
    const s = visibleLoopSpan(-4, 4, BEHIND, AHEAD);
    expect(s.first).toBe(0);
    expect(s.last).toBeGreaterThanOrEqual(1);
  });

  it("handles a pattern longer than the lane", () => {
    // Eight-bar clip, lane sees ten beats: only the current repeat and its
    // neighbour are ever in view.
    const s = visibleLoopSpan(40, 32, BEHIND, AHEAD);
    expect(s.first).toBe(0);
    expect(s.last).toBe(2);
  });

  it("never returns an inverted range", () => {
    for (const absBeat of [-8, -1, 0, 3, 17, 100]) {
      for (const loopBeats of [1, 4, 16]) {
        const s = visibleLoopSpan(absBeat, loopBeats, BEHIND, AHEAD);
        expect(s.last).toBeGreaterThanOrEqual(s.first);
        expect(s.first).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("previewInstances", () => {
  // Two lanes, notes on beats 0 and 2 of a 4-beat pattern.
  const pattern: TargetNote[] = [
    { lane: 12, beat: 0 },
    { lane: 13, beat: 2 },
  ];
  const SPB = 0.5; // 120bpm

  it("parks beat 0 exactly on the playhead", () => {
    const out = previewInstances(pattern, 4, 8, SPB, 100, 10);
    expect(out[0].beat).toBe(0);
    expect(out[0].time).toBeCloseTo(100);
  });

  it("lays later notes out ahead of it, at the lane's scroll rate", () => {
    const out = previewInstances(pattern, 4, 8, SPB, 100, 10);
    const at = (loop: number, beat: number) =>
      out.find((i) => i.loopIndex === loop && i.beat === beat)!;
    expect(at(0, 2).time).toBeCloseTo(101); // 2 beats * 0.5s
    expect(at(1, 0).time).toBeCloseTo(102); // one repeat later
    expect(at(2, 0).time).toBeCloseTo(104);
  });

  it("stops at the edge of what the lane can show", () => {
    const out = previewInstances(pattern, 4, 8, SPB, 100, 5);
    // beat 6 is past a 5-beat window; beat 4 is not.
    expect(out.some((i) => i.loopIndex === 1 && i.beat === 0)).toBe(true);
    expect(out.some((i) => i.loopIndex === 1 && i.beat === 2)).toBe(false);
  });

  it("never runs past the end of a short run", () => {
    const out = previewInstances(pattern, 4, 1, SPB, 100, 40);
    expect(out.every((i) => i.loopIndex === 0)).toBe(true);
  });

  it("survives an endless run without hanging", () => {
    const out = previewInstances(pattern, 4, Infinity, SPB, 100, 40);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((i) => i.loopIndex === 0)).toBe(true);
  });

  it("produces nothing resolved — the preview is never graded", () => {
    const out = previewInstances(pattern, 4, 8, SPB, 100, 10);
    expect(out.every((i) => !i.resolved && i.rating === null)).toBe(true);
  });

  it("is empty for a lesson with no notes", () => {
    expect(previewInstances([], 4, 8, SPB, 100, 10)).toEqual([]);
  });
});
