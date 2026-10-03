import { describe, expect, it } from "vitest";
import { isUsableLesson, usableImports } from "@/engine/library";
import type { Lesson } from "@/engine/types";

const clip = (over: Partial<Lesson> = {}): Lesson => ({
  id: "imp-1",
  name: "Bounced clip",
  instrument: "pads",
  bpm: 96,
  bars: 2,
  beatsPerBar: 4,
  notes: [{ time: 0, pitch: 36 }],
  source: "midi-import",
  ...over,
});

describe("isUsableLesson", () => {
  it("takes a well-formed clip", () => {
    expect(isUsableLesson(clip())).toBe(true);
  });

  it("rejects what isn't an object at all", () => {
    for (const junk of [null, undefined, 7, "lesson", []]) {
      expect(isUsableLesson(junk)).toBe(false);
    }
  });

  it("rejects a lesson with nothing to play", () => {
    expect(isUsableLesson(clip({ notes: [] }))).toBe(false);
  });

  it("rejects a bar count the transport could not loop on", () => {
    expect(isUsableLesson(clip({ bars: 0 }))).toBe(false);
    expect(isUsableLesson(clip({ bars: 1.5 }))).toBe(false);
    expect(isUsableLesson(clip({ beatsPerBar: 0 }))).toBe(false);
  });

  it("rejects a tempo that would divide by zero downstream", () => {
    expect(isUsableLesson(clip({ bpm: 0 }))).toBe(false);
    expect(isUsableLesson(clip({ bpm: Number.NaN }))).toBe(false);
  });

  it("rejects an unknown instrument", () => {
    expect(isUsableLesson(clip({ instrument: "guitar" as Lesson["instrument"] }))).toBe(false);
  });

  it("rejects a note off the MIDI range, or with no time", () => {
    expect(isUsableLesson(clip({ notes: [{ time: 0, pitch: 200 }] }))).toBe(false);
    expect(isUsableLesson(clip({ notes: [{ pitch: 36 } as never] }))).toBe(false);
    expect(isUsableLesson(clip({ notes: [{ time: Number.NaN, pitch: 36 }] }))).toBe(false);
  });

  it("takes a note with a duration, since holds are ordinary now", () => {
    expect(isUsableLesson(clip({ notes: [{ time: 0, pitch: 60, duration: 2 }] }))).toBe(true);
  });
});

describe("usableImports", () => {
  it("has nothing to say about a store that holds nothing", () => {
    expect(usableImports(undefined, [])).toEqual([]);
    expect(usableImports("corrupt", [])).toEqual([]);
  });

  it("keeps the stored order", () => {
    const a = clip({ id: "a" });
    const b = clip({ id: "b" });
    expect(usableImports([a, b], []).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("drops the malformed and keeps the rest", () => {
    const good = clip({ id: "good" });
    expect(usableImports([{ id: "bad" }, good, null], []).map((l) => l.id)).toEqual(["good"]);
  });

  it("never shadows a lesson the library already has", () => {
    const dupe = clip({ id: "four-on-the-floor" });
    expect(usableImports([dupe], ["four-on-the-floor"])).toEqual([]);
  });

  it("collapses a duplicate inside the stored list itself", () => {
    const first = clip({ id: "x", name: "first" });
    const second = clip({ id: "x", name: "second" });
    const out = usableImports([first, second], []);
    expect(out.map((l) => l.name)).toEqual(["first"]);
  });
});
