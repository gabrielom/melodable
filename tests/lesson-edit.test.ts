import { describe, it, expect } from "vitest";
import {
  KEY_RANGE,
  applyEdit,
  authoredKey,
  clampTempo,
  usableEdits,
} from "../src/engine/lesson-edit";
import { usableCourses } from "../src/engine/course";
import { TEMPO_MAX, TEMPO_MIN, type Lesson } from "../src/engine/types";

const LESSON: Lesson = {
  id: "x",
  name: "El Día de Mi Suerte",
  instrument: "piano",
  bpm: 200,
  bars: 4,
  beatsPerBar: 4,
  notes: [{ time: 0, pitch: 60 }],
  source: "midi-import",
  hint: "Montuno",
};

describe("applyEdit", () => {
  it("changes the words on the card", () => {
    const got = applyEdit(LESSON, { name: "  El Día  ", hint: " Right hand first " });
    expect(got.name).toBe("El Día");
    expect(got.hint).toBe("Right hand first");
  });

  it("returns a new lesson, so anything watching by identity sees it", () => {
    const got = applyEdit(LESSON, { bpm: 180 });
    expect(got).not.toBe(LESSON);
    expect(LESSON.bpm).toBe(200);
  });

  it("will not empty a name, but will empty a description", () => {
    expect(applyEdit(LESSON, { name: "   " }).name).toBe("El Día de Mi Suerte");
    expect(applyEdit(LESSON, { hint: "" }).hint).toBe("");
  });

  it("keeps the tempo a whole number inside the one range", () => {
    expect(applyEdit(LESSON, { bpm: 187.6 }).bpm).toBe(188);
    expect(applyEdit(LESSON, { bpm: 999 }).bpm).toBe(TEMPO_MAX);
    expect(applyEdit(LESSON, { bpm: 1 }).bpm).toBe(TEMPO_MIN);
    expect(applyEdit(LESSON, { bpm: NaN }).bpm).toBe(200);
    expect(clampTempo(120.4)).toBe(120);
  });

  it("sets a key, and hands it back to the notes with null", () => {
    const set = applyEdit(LESSON, { key: -3 });
    expect(authoredKey(set)).toBe(-3);
    const back = applyEdit(set, { key: null });
    expect(authoredKey(back)).toBeNull();
    expect("key" in back).toBe(false);
  });

  it("ignores a key that is no key", () => {
    expect(authoredKey(applyEdit(LESSON, { key: 9 }))).toBeNull();
    expect(authoredKey(applyEdit(LESSON, { key: 1.5 }))).toBeNull();
    expect(KEY_RANGE).toEqual({ min: -7, max: 7 });
  });

  it("leaves the material alone", () => {
    const got = applyEdit(LESSON, { name: "a", hint: "b", bpm: 100, key: 2 });
    expect(got.notes).toBe(LESSON.notes);
    expect(got.bars).toBe(4);
    expect(got.instrument).toBe("piano");
  });
});

describe("authoredKey", () => {
  it("does not trust a key read back from the store", () => {
    expect(authoredKey({ key: 3 })).toBe(3);
    expect(authoredKey({})).toBeNull();
    expect(authoredKey({ key: "G" as unknown as number })).toBeNull();
  });
});

describe("usableEdits", () => {
  it("keeps the fields it understands and drops the rest", () => {
    expect(
      usableEdits({
        a: { name: "Kick", bpm: 90, key: null, junk: 1 },
        b: { key: 12, hint: "x" },
        c: "nonsense",
      }),
    ).toEqual({ a: { name: "Kick", bpm: 90, key: null }, b: { hint: "x" } });
  });

  it("answers for anything that is not a map", () => {
    expect(usableEdits(null)).toEqual({});
    expect(usableEdits([1, 2])).toEqual({});
  });
});

describe("a song's description", () => {
  it("survives the store", () => {
    const saved = [{ id: "c", name: "Song", hint: "Four parts", lessonIds: ["a", "b"] }];
    expect(usableCourses(saved, ["a", "b"])[0].hint).toBe("Four parts");
  });

  it("is simply absent when never written", () => {
    const saved = [{ id: "c", name: "Song", lessonIds: ["a", "b"] }];
    expect("hint" in usableCourses(saved, ["a", "b"])[0]).toBe(false);
  });
});
