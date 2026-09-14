import { describe, expect, it } from "vitest";
import {
  clampRegion,
  regionAt,
  regionBeats,
  regionTargets,
  runBeatOf,
  type LoopRegion,
} from "@/engine/loop-region";
import { loopGrabAt } from "@/views/Overview";
import type { TargetNote } from "@/engine/scoring";

/**
 * A two-bar pattern of four notes, played four times: an eight-bar run.
 * Beats 0, 1, 4, 6 within each repeat, on four different lanes.
 */
const PATTERN: TargetNote[] = [
  { lane: 0, beat: 0, duration: 0 },
  { lane: 1, beat: 1, duration: 0 },
  { lane: 2, beat: 4, duration: 0 },
  { lane: 3, beat: 6, duration: 0 },
];
const LOOP_BEATS = 8; // two bars of 4/4
const REPEATS = 4; // an eight-bar run
const BPB = 4;

describe("regionBeats", () => {
  it("measures the region in run beats", () => {
    expect(regionBeats({ fromBar: 2, bars: 3 }, 4)).toEqual({ from: 8, to: 20, length: 12 });
  });

  it("never has a length of nothing", () => {
    expect(regionBeats({ fromBar: 0, bars: 0 }, 4).length).toBe(4);
  });
});

describe("clampRegion", () => {
  it("leaves a region that already fits", () => {
    expect(clampRegion({ fromBar: 2, bars: 4 }, 8)).toEqual({ fromBar: 2, bars: 4 });
  });

  it("slides a region up against the end rather than shrinking it", () => {
    // Dragging right should stop, not eat the length — a length set by hand is
    // a decision, a position out of room is only a limit.
    expect(clampRegion({ fromBar: 7, bars: 4 }, 8)).toEqual({ fromBar: 4, bars: 4 });
  });

  it("gives way on the length only when the region is longer than the run", () => {
    expect(clampRegion({ fromBar: 0, bars: 20 }, 8)).toEqual({ fromBar: 0, bars: 8 });
  });

  it("refuses a region of no bars, or one starting before the run", () => {
    expect(clampRegion({ fromBar: -3, bars: 0 }, 8)).toEqual({ fromBar: 0, bars: 1 });
  });
});

describe("regionAt", () => {
  it("starts at the bar the playhead is in", () => {
    // Mid-way through bar 2 (beats 8..12) starts the loop at bar 2.
    expect(regionAt(9.5, BPB, 4, 8)).toEqual({ fromBar: 2, bars: 4 });
  });

  it("starts at the top when the run has not begun", () => {
    expect(regionAt(0, BPB, 8, 8)).toEqual({ fromBar: 0, bars: 8 });
  });

  it("gives what is left when there is less than the asked-for length", () => {
    // Pressed two bars from the end: a two-bar loop from here to the end, not
    // a silent jump backwards to fit eight in.
    expect(regionAt(24, BPB, 8, 8)).toEqual({ fromBar: 6, bars: 2 });
  });

  it("always leaves at least a bar to loop", () => {
    const r = regionAt(31, BPB, 8, 8);
    expect(r).toEqual({ fromBar: 7, bars: 1 });
  });
});

describe("regionTargets", () => {
  const derive = (region: LoopRegion) =>
    regionTargets(PATTERN, LOOP_BEATS, REPEATS, region, BPB);

  it("yields the pattern once for a region of one repeat", () => {
    const got = derive({ fromBar: 0, bars: 2 });
    expect(got.targets).toEqual(PATTERN);
    expect(got.sources).toEqual([
      { loopIndex: 0, index: 0 },
      { loopIndex: 0, index: 1 },
      { loopIndex: 0, index: 2 },
      { loopIndex: 0, index: 3 },
    ]);
  });

  it("yields the pattern twice for a region spanning two repeats", () => {
    const got = derive({ fromBar: 0, bars: 4 });
    expect(got.targets.map((t) => t.beat)).toEqual([0, 1, 4, 6, 8, 9, 12, 14]);
    expect(got.sources.map((s) => s.loopIndex)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("rebases to beat 0 wherever in the run it sits", () => {
    const got = derive({ fromBar: 4, bars: 2 });
    expect(got.targets.map((t) => t.beat)).toEqual([0, 1, 4, 6]);
    // Bars 4-5 are the third repeat of a two-bar pattern.
    expect(got.sources.map((s) => s.loopIndex)).toEqual([2, 2, 2, 2]);
  });

  it("takes a note by its onset, and keeps a length that overruns the end", () => {
    // A note starting inside the region belongs to it even if it is still
    // sounding past the end — the same way a held note at the end of a pattern
    // already behaves.
    const held: TargetNote[] = [{ lane: 0, beat: 6, duration: 4 }];
    const got = regionTargets(held, LOOP_BEATS, REPEATS, { fromBar: 0, bars: 2 }, BPB);
    expect(got.targets).toEqual([{ lane: 0, beat: 6, duration: 4 }]);
  });

  it("excludes a note landing exactly on the region's end", () => {
    // `[from, to)`. The note on the boundary opens the *next* pass.
    const got = derive({ fromBar: 0, bars: 1 });
    expect(got.targets.map((t) => t.beat)).toEqual([0, 1]);
  });

  it("comes out in beat order, the way lessonTargets does", () => {
    const got = derive({ fromBar: 0, bars: 8 });
    const beats = got.targets.map((t) => t.beat);
    expect([...beats].sort((a, b) => a - b)).toEqual(beats);
  });

  it("keeps sources in step with targets after sorting", () => {
    const got = derive({ fromBar: 0, bars: 4 });
    expect(got.sources.length).toBe(got.targets.length);
    // Every target's source really is the note it was taken from.
    got.targets.forEach((t, i) => {
      const s = got.sources[i];
      const runBeat = s.loopIndex * LOOP_BEATS + PATTERN[s.index].beat;
      expect(runBeat - regionBeats({ fromBar: 0, bars: 4 }, BPB).from).toBeCloseTo(t.beat, 9);
      expect(PATTERN[s.index].lane).toBe(t.lane);
    });
  });

  it("finds nothing in a region of silence", () => {
    const sparse: TargetNote[] = [{ lane: 0, beat: 0, duration: 0 }];
    const got = regionTargets(sparse, LOOP_BEATS, REPEATS, { fromBar: 1, bars: 1 }, BPB);
    expect(got.targets).toEqual([]);
  });
});

describe("runBeatOf", () => {
  const region: LoopRegion = { fromBar: 2, bars: 2 }; // run beats 8..16

  it("puts the region's first beat at the region's start", () => {
    expect(runBeatOf(0, region, BPB)).toBe(8);
  });

  it("walks forward through the region", () => {
    expect(runBeatOf(3, region, BPB)).toBe(11);
    expect(runBeatOf(7.5, region, BPB)).toBe(15.5);
  });

  it("wraps back to the start on the next pass", () => {
    expect(runBeatOf(8, region, BPB)).toBe(8);
    expect(runBeatOf(9, region, BPB)).toBe(9);
    expect(runBeatOf(25, region, BPB)).toBe(9);
  });

  it("holds at the region's start through the count-in", () => {
    // Negative beats are the count-in, which happens before the region's own
    // first beat — the playhead is about to be there, so that is what it says.
    expect(runBeatOf(-4, region, BPB)).toBe(8);
  });

  it("never leaves the region", () => {
    for (let b = 0; b < 40; b += 0.25) {
      const got = runBeatOf(b, region, BPB);
      expect(got).toBeGreaterThanOrEqual(8);
      expect(got).toBeLessThan(16);
    }
  });
});

describe("loopGrabAt", () => {
  // A region drawn from 100px to 200px, with the renderer's own 7px grip.
  const grab = (x: number) => loopGrabAt(x, 100, 200, 7);

  it("takes the edge you aimed at", () => {
    expect(grab(100)).toBe("from");
    expect(grab(200)).toBe("to");
    expect(grab(94)).toBe("from");
    expect(grab(206)).toBe("to");
  });

  it("takes the body between them", () => {
    expect(grab(150)).toBe("body");
  });

  it("takes nothing outside", () => {
    expect(grab(60)).toBeNull();
    expect(grab(300)).toBeNull();
  });

  it("gives a short region's right edge to the pointer nearest it", () => {
    // Squeezed into a 33px strip a whole run can put a bar in a few pixels, so
    // both grips cover the same ground. Always preferring the left would leave
    // the right edge unreachable — you could shrink a region and never grow it.
    expect(loopGrabAt(104, 100, 106, 7)).toBe("to");
    expect(loopGrabAt(101, 100, 106, 7)).toBe("from");
  });

  it("breaks a dead tie leftwards, so it never turns on a rounding", () => {
    expect(loopGrabAt(103, 100, 106, 7)).toBe("from");
  });
});
