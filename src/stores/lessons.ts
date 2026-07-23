import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Lesson } from "@/engine/types";
import { BUILTIN_LESSONS } from "@/data/lessons";
import { persistGet, persistSet } from "./persist";

/**
 * The lesson library and where the player currently is in it. The built-in
 * progression seeds the list; M4 will append MIDI-imported lessons here at
 * runtime. Selection and advancement live here so the trainer and the library
 * UI share one source of truth.
 */
export const useLessons = defineStore("lessons", () => {
  const lessons = ref<Lesson[]>([...BUILTIN_LESSONS]);
  const currentIndex = ref(0);
  const hydrated = ref(false);

  const current = computed(() => lessons.value[currentIndex.value] ?? lessons.value[0]);
  const hasNext = computed(() => currentIndex.value < lessons.value.length - 1);
  const hasPrev = computed(() => currentIndex.value > 0);

  function selectIndex(i: number): void {
    if (i >= 0 && i < lessons.value.length) currentIndex.value = i;
  }

  function selectId(id: string): void {
    const i = lessons.value.findIndex((l) => l.id === id);
    if (i >= 0) currentIndex.value = i;
  }

  /** Advance to the next lesson; returns it, or null if already at the last. */
  function advance(): Lesson | null {
    if (!hasNext.value) return null;
    currentIndex.value += 1;
    return current.value;
  }

  /**
   * Append a lesson (e.g. a MIDI import) and select it. Imported lessons live
   * for the session — the persisted `lastLessonId` falls back to the first
   * built-in on relaunch if the import isn't present.
   */
  function addLesson(lesson: Lesson): void {
    lessons.value = [...lessons.value, lesson];
    currentIndex.value = lessons.value.length - 1;
  }

  // Remember the last lesson across launches (Tauri store; no-op in browser).
  void persistGet<string>("lastLessonId").then((id) => {
    if (id) selectId(id);
    hydrated.value = true;
  });

  watch(currentIndex, () => {
    if (!hydrated.value) return;
    void persistSet("lastLessonId", current.value.id);
  });

  return {
    lessons,
    currentIndex,
    current,
    hasNext,
    hasPrev,
    selectIndex,
    selectId,
    advance,
    addLesson,
  };
});
