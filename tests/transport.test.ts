import { describe, it, expect } from "vitest";
import { Transport, phaseDelta } from "../src/engine/transport";

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

describe("anchorTo (external grid / Ableton Link)", () => {
  it("puts the requested absolute beat at the requested time", () => {
    const t = make(120, 1, 4); // spb 0.5
    t.start(0, 0);

    t.anchorTo(6, 100);
    expect(t.position(100).absBeat).toBeCloseTo(6);
    expect(t.position(100).loopIndex).toBe(1);
    expect(t.position(100).beatInLoop).toBeCloseTo(2);
    // and the playhead keeps running from there
    expect(t.position(101).absBeat).toBeCloseTo(8);
  });

  it("keeps note times consistent with the new anchor", () => {
    const t = make(120, 1, 4);
    t.start(0, 0);
    t.anchorTo(6, 100);
    // beat 2 of loop 1 is exactly the anchored moment
    expect(t.timeOf(1, 2)).toBeCloseTo(100);
    expect(t.timeOfAbsBeat(8)).toBeCloseTo(101);
  });

  it("handles negative beats, so a count-in can ride the grid too", () => {
    const t = make(120, 1, 4);
    t.start(0, 0);
    t.anchorTo(-3, 50);
    const p = t.position(50);
    expect(p.countIn).toBe(true);
    expect(p.absBeat).toBeCloseTo(-3);
    expect(t.position(51.5).absBeat).toBeCloseTo(0); // 3 beats later
  });

  it("never rewinds the scheduling window on a drift trim", () => {
    const t = make(120, 1, 4);
    t.start(0, 0);
    const w = t.advanceScheduler(0, 1.0)!;
    expect(w.to).toBeCloseTo(-2);

    // Nudging forward may extend the window by a sliver, but it must pick up
    // exactly where the last one ended — no beat scheduled twice.
    t.anchorTo(t.position(0).absBeat + 0.004, 0);
    const next = t.advanceScheduler(0, 1.0);
    if (next) expect(next.from).toBeCloseTo(w.to);

    // Nudging back must not replay the beats already scheduled.
    t.anchorTo(t.position(0).absBeat - 0.02, 0);
    expect(t.advanceScheduler(0, 1.0)).toBeNull();
  });

  it("moves the scheduling window with the playhead on a real jump", () => {
    const t = make(120, 1, 4);
    t.start(0, 0);
    t.advanceScheduler(0, 1.0); // scheduled out to beat -2

    // locking onto Link relocates us; the window follows rather than
    // replaying everything between the old and new position
    t.anchorTo(40, 0);
    const w = t.advanceScheduler(0, 1.0)!;
    expect(w.from).toBeCloseTo(40);
    expect(w.to).toBeCloseTo(42);
  });
});

describe("phaseDelta", () => {
  it("is zero when already on the grid", () => {
    expect(phaseDelta(8, 0, 4)).toBeCloseTo(0);
    expect(phaseDelta(9.5, 1.5, 4)).toBeCloseTo(0);
  });

  it("takes the shorter way round rather than crossing the whole loop", () => {
    // just short of the loop end, grid wants phase 0: step 0.1 forward onto
    // the next boundary rather than winding 3.9 beats back to this one
    expect(phaseDelta(3.9, 0, 4)).toBeCloseTo(0.1);
    // just past it: nudge back 0.1 instead of forward 3.9
    expect(phaseDelta(0.1, 0, 4)).toBeCloseTo(-0.1);
    // and across a loop boundary in the other direction
    expect(phaseDelta(4.2, 3.7, 4)).toBeCloseTo(-0.5);
  });

  it("never moves more than half a loop", () => {
    for (const lb of [4, 8, 12]) {
      for (let cur = 0; cur < lb; cur += 0.25) {
        for (let ph = 0; ph < lb; ph += 0.25) {
          const d = phaseDelta(cur, ph, lb);
          expect(Math.abs(d)).toBeLessThanOrEqual(lb / 2 + 1e-9);
          // and it really does land on the requested phase
          const landed = (((cur + d) % lb) + lb) % lb;
          expect(Math.min(Math.abs(landed - ph), lb - Math.abs(landed - ph))).toBeCloseTo(0);
        }
      }
    }
  });

  it("handles negative beats, so a count-in aligns too", () => {
    expect(phaseDelta(-1, 3, 4)).toBeCloseTo(0);
    expect(phaseDelta(-4, 0, 4)).toBeCloseTo(0);
  });
});
