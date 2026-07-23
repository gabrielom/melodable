import { describe, it, expect } from "vitest";
import { Transport } from "../src/engine/transport";

const make = (bpm = 120, bars = 1, beatsPerBar = 4) =>
  new Transport({ bpm, bars, beatsPerBar });

describe("transport basics", () => {
  it("derives seconds per beat and loop length", () => {
    const t = make(120);
    expect(t.secPerBeat).toBeCloseTo(0.5);
    expect(t.loopBeats).toBe(4);
    expect(t.countInBeats).toBe(4);
  });

  it("is idle before start", () => {
    const t = make();
    expect(t.isPlaying).toBe(false);
    expect(t.position(10).playing).toBe(false);
  });
});

describe("count-in", () => {
  it("runs one bar of count-in before loop 0", () => {
    const t = make(120); // spb 0.5, count-in 2s
    t.start(10, 0.1); // anchor at 10 + 0.1 + 2 = 12.1

    const early = t.position(10.1);
    expect(early.countIn).toBe(true);
    expect(early.countInBeat).toBeCloseTo(0);
    expect(early.absBeat).toBeCloseTo(-4);

    const mid = t.position(11.1);
    expect(mid.countIn).toBe(true);
    expect(mid.countInBeat).toBeCloseTo(2);

    const after = t.position(12.1);
    expect(after.countIn).toBe(false);
    expect(after.loopIndex).toBe(0);
    expect(after.beatInLoop).toBeCloseTo(0);
  });
});

describe("loop position", () => {
  it("advances loops at loop boundaries", () => {
    const t = make(120);
    t.start(0, 0); // anchor at 2 (count-in 4 beats * 0.5)

    expect(t.position(2).loopIndex).toBe(0);
    expect(t.position(3.9).loopIndex).toBe(0);
    expect(t.position(3.9).beatInLoop).toBeCloseTo(3.8);
    expect(t.position(4).loopIndex).toBe(1);
    expect(t.position(6.5).loopIndex).toBe(2);
    expect(t.position(6.5).beatInLoop).toBeCloseTo(1);
  });

  it("maps (loop, beat) to clock time and back", () => {
    const t = make(120);
    t.start(0, 0); // anchor 2
    expect(t.timeOf(0, 0)).toBeCloseTo(2);
    expect(t.timeOf(0, 3)).toBeCloseTo(3.5);
    expect(t.timeOf(2, 1)).toBeCloseTo(6.5);
    expect(t.timeOfAbsBeat(-4)).toBeCloseTo(0); // first count-in click
  });
});

describe("tempo changes", () => {
  it("keeps the playhead continuous when bpm changes mid-loop", () => {
    const t = make(120);
    t.start(0, 0); // anchor 2
    const before = t.position(4.5); // loop 1, beat 1
    expect(before.absBeat).toBeCloseTo(5);

    t.setBpm(60, 4.5); // half speed
    const after = t.position(4.5);
    expect(after.absBeat).toBeCloseTo(5);
    expect(after.loopIndex).toBe(1);

    // one second later only one beat has passed at 60 bpm
    expect(t.position(5.5).absBeat).toBeCloseTo(6);
    // and future note times stretch accordingly: loop 1 beat 2 is 1s away
    expect(t.timeOf(1, 2)).toBeCloseTo(5.5);
  });

  it("changes bpm directly when stopped", () => {
    const t = make(120);
    t.setBpm(90);
    expect(t.bpm).toBe(90);
  });
});

describe("scheduler window", () => {
  it("starts at the count-in and grows monotonically", () => {
    const t = make(120);
    t.start(0, 0); // count-in beats -4..0, anchor at 2

    const w1 = t.advanceScheduler(0, 1.0);
    expect(w1).not.toBeNull();
    expect(w1!.from).toBe(-4);
    expect(w1!.to).toBeCloseTo(-2); // now (-4 beats) + 1s horizon = 2 beats

    // no time passed: nothing new to schedule
    expect(t.advanceScheduler(0, 1.0)).toBeNull();

    const w2 = t.advanceScheduler(1, 1.0);
    expect(w2!.from).toBeCloseTo(-2);
    expect(w2!.to).toBeCloseTo(0);
  });

  it("emits accented clicks on bar starts, count-in included", () => {
    const t = make(120, 2, 4); // 8-beat loop
    t.start(0, 0);
    const clicks = t.clicksIn(-4, 8);
    expect(clicks).toHaveLength(12);
    const accents = clicks.filter((c) => c.accent).map((c) => c.absBeat);
    expect(accents).toEqual([-4, 0, 4]);
  });
});
