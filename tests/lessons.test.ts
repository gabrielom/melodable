import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLessons } from "../src/stores/lessons";
import { BUILTIN_LESSONS } from "../src/data/lessons";

describe("lessons store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("seeds the builtin progression and starts at the first lesson", () => {
    const s = useLessons();
    expect(s.lessons.length).toBe(BUILTIN_LESSONS.length);
    expect(s.currentIndex).toBe(0);
    expect(s.current.id).toBe(BUILTIN_LESSONS[0].id);
    expect(s.hasNext).toBe(true);
  });

  it("selects by index and by id", () => {
    const s = useLessons();
    s.selectIndex(2);
    expect(s.current.id).toBe(BUILTIN_LESSONS[2].id);
    s.selectId(BUILTIN_LESSONS[0].id);
    expect(s.currentIndex).toBe(0);
  });

  it("ignores out-of-range or unknown selection", () => {
    const s = useLessons();
    s.selectIndex(99);
    s.selectIndex(-1);
    s.selectId("does-not-exist");
    expect(s.currentIndex).toBe(0);
  });

  it("advances through the progression, then stops at the last", () => {
    const s = useLessons();
    const n = s.lessons.length;
    for (let i = 1; i < n; i++) {
      expect(s.advance()?.id).toBe(BUILTIN_LESSONS[i].id);
    }
    expect(s.hasNext).toBe(false);
    expect(s.advance()).toBeNull();
    expect(s.currentIndex).toBe(n - 1);
  });
});
