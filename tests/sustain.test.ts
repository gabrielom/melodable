import { describe, expect, it } from "vitest";
import {
  Scorer,
  gradeHold,
  heldFraction,
  isHeldNote,
  lessonTargets,
  previewInstances,
  type TargetNote,
} from "@/engine/scoring";
import { HOLD_MIN_BEATS, type Lesson } from "@/engine/types";

/** One two-beat hold on lane 60, at beat 0. spb = 1, so times are beats. */
const held: TargetNote[] = [{ lane: 60, beat: 0, duration: 2 }];
const timeOf = (loop: number, beat: number) => loop * 4 + beat;

const scorer = () => {
  const s = new Scorer(held);
  s.spawnLoop(0, timeOf);
  return s;
};

describe("what counts as a hold", () => {
  it("takes a written length from the lesson and drops the ones too short to aim at", () => {
    const lesson = {
      notes: [
        { time: 0, pitch: 60, duration: 2 },
        { time: 1, pitch: 62, duration: HOLD_MIN_BEATS },
        { time: 2, pitch: 64, duration: HOLD_MIN_BEATS / 2 },
        { time: 3, pitch: 65 },
      ],
    } as Lesson;
    expect(lessonTargets(lesson, (p) => p).map((t) => t.duration)).toEqual([
      2,
      HOLD_MIN_BEATS,
      0,
      0,
    ]);
  });

  it("calls a note held only above the floor", () => {
    expect(isHeldNote({ duration: 0 })).toBe(false);
    expect(isHeldNote({ duration: HOLD_MIN_BEATS - 0.01 })).toBe(false);
    expect(isHeldNote({ duration: HOLD_MIN_BEATS })).toBe(true);
  });
});

describe("heldFraction", () => {
  const inst = { time: 10, endTime: 12 } as never;

  it("measures from the written onset, not from where the player struck", () => {
    expect(heldFraction(inst, 12)).toBe(1);
    expect(heldFraction(inst, 11)).toBe(0.5);
  });

  it("clamps at 1 — overholding is not an error", () => {
    expect(heldFraction(inst, 20)).toBe(1);
  });

  it("never goes negative, even for a release before the note", () => {
    expect(heldFraction(inst, 5)).toBe(0);
  });

  it("treats a zero-length note as fully held rather than dividing by zero", () => {
    expect(heldFraction({ time: 10, endTime: 10 } as never, 10)).toBe(1);
  });
});

describe("gradeHold", () => {
  it("splits at the design's bands", () => {
    expect(gradeHold(1)).toBe("held");
    expect(gradeHold(0.85)).toBe("held");
    expect(gradeHold(0.849)).toBe("short");
    expect(gradeHold(0.5)).toBe("short");
    expect(gradeHold(0.499)).toBe("dropped");
    expect(gradeHold(0)).toBe("dropped");
  });
});

describe("the scorer's holds", () => {
  it("opens on the strike and grades on the release", () => {
    const s = scorer();
    s.hit(60, 0);
    expect(s.instances[0].heldFrom).toBe(0);
    expect(s.instances[0].hold).toBeNull();

    s.release(60, 2);
    expect(s.instances[0].hold).toBe("held");
    expect(s.instances[0].releasedAt).toBe(2);
    expect(s.holdTally).toEqual({ held: 1, short: 0, dropped: 0 });
  });

  it("judges the onset and the sustain independently", () => {
    const s = scorer();
    // struck 30ms late — a perfect onset — but let go a quarter of the way in
    s.hit(60, 0.03);
    s.release(60, 0.5);
    expect(s.instances[0].rating).toBe("perfect");
    expect(s.instances[0].hold).toBe("dropped");
  });

  it("does not charge a late strike twice", () => {
    const s = scorer();
    // struck 80ms late, released at the written end: the onset is `late`,
    // but the note was covered, so the sustain is clean.
    s.hit(60, 0.08);
    s.release(60, 2);
    expect(s.instances[0].rating).toBe("late");
    expect(s.instances[0].hold).toBe("held");
  });

  it("breaks the combo on a dropped hold and keeps it on a short one", () => {
    const s = scorer();
    s.hit(60, 0);
    expect(s.combo).toBe(1);
    s.release(60, 1.4); // 70% — short
    expect(s.combo).toBe(1);

    const t = scorer();
    t.hit(60, 0);
    t.release(60, 0.5); // 25% — dropped
    expect(t.combo).toBe(0);
  });

  it("ignores a release with nothing open", () => {
    const s = scorer();
    expect(s.release(60, 1)).toBeNull();
    expect(s.holdTally).toEqual({ held: 0, short: 0, dropped: 0 });
  });

  it("closes the first hold when a lane is struck again", () => {
    const two = new Scorer([
      { lane: 60, beat: 0, duration: 2 },
      { lane: 60, beat: 2, duration: 2 },
    ]);
    two.spawnLoop(0, timeOf);
    two.hit(60, 0);
    two.hit(60, 2); // re-strike: the first note ends here
    expect(two.instances[0].hold).toBe("held");
    expect(two.instances[1].heldFrom).toBe(2);
    expect(two.instances[1].hold).toBeNull();
  });

  it("closes a hold that runs past the written end, so overholding reads as held", () => {
    const s = scorer();
    s.hit(60, 0);
    expect(s.sweepHolds(1)).toEqual([]); // still inside the note
    const closed = s.sweepHolds(2.5);
    expect(closed).toHaveLength(1);
    expect(s.instances[0].hold).toBe("held");
    expect(s.instances[0].releasedAt).toBe(2); // the written end, not 2.5
  });

  it("leaves a controller that never sends note-off scoring on its onsets", () => {
    const s = scorer();
    s.hit(60, 0);
    // No release ever arrives; the sweep closes it at the written end.
    s.sweepHolds(100);
    expect(s.instances[0].hold).toBe("held");
    expect(s.combo).toBe(1);
  });

  it("judges whatever is still held when the run ends", () => {
    const s = scorer();
    s.hit(60, 0);
    s.closeAllHolds(1); // stopped a beat in
    expect(s.instances[0].hold).toBe("short");
  });

  it("never opens a hold on an instant note", () => {
    const s = new Scorer([{ lane: 12, beat: 0, duration: 0 }]);
    s.spawnLoop(0, timeOf);
    s.hit(12, 0);
    expect(s.instances[0].heldFrom).toBeNull();
    s.release(12, 1);
    expect(s.instances[0].hold).toBeNull();
    expect(s.holdTally).toEqual({ held: 0, short: 0, dropped: 0 });
  });

  it("moves a note's end with its onset when the tempo changes", () => {
    const s = scorer();
    expect(s.instances[0].endTime).toBe(2);
    s.retime((loop, beat) => loop * 8 + beat * 2); // half speed
    expect(s.instances[0].time).toBe(0);
    expect(s.instances[0].endTime).toBe(4);
  });

  it("forgets a hold whose note has been pruned away", () => {
    const s = new Scorer(held);
    s.spawnLoop(0, timeOf);
    s.spawnLoop(1, timeOf);
    s.hit(60, 0);
    s.pruneBefore(1);
    expect(s.release(60, 1)).toBeNull();
  });
});

describe("the idle preview", () => {
  it("carries durations so a stopped lesson shows its holds", () => {
    const out = previewInstances(held, 4, 2, 0.5, 0, 8);
    expect(out[0].duration).toBe(2);
    expect(out[0].endTime - out[0].time).toBe(1); // 2 beats at spb 0.5
  });
});
