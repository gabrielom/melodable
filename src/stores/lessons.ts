import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Lesson } from "@/engine/types";
import { BUILTIN_LESSONS } from "@/data/lessons";
import { usableImports } from "@/engine/library";
import { persistGet, persistSet } from "./persist";

/**
 * The lesson library and where the player currently is in it. The built-in
 * progression seeds the list; MIDI imports are appended at runtime. Selection
 * and advancement live here so the trainer and the home screen share one
 * source of truth.
 */
export const useLessons = defineStore("lessons", () => {
  const lessons = ref<Lesson[]>([...BUILTIN_LESSONS]);
  const currentIndex = ref(0);
  const hydrated = ref(false);

  const current = computed(() => lessons.value[currentIndex.value] ?? lessons.value[0]);
  const hasNext = computed(() => currentIndex.value < lessons.value.length - 1);

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

  /** The imported clips, in the order they were added — what gets persisted. */
  const imported = computed(() => lessons.value.filter((l) => l.source === "midi-import"));

  /**
   * Append a lesson (e.g. a MIDI import) and select it.
   *
   * Imports are kept across launches (M7). They used to live for the session
   * only, which left `history` holding runs for a lesson that no longer
   * existed and dropped the player back to a built-in on every relaunch.
   */
  function addLesson(lesson: Lesson): void {
    lessons.value = [...lessons.value, lesson];
    currentIndex.value = lessons.value.length - 1;
    void persistSet("importedLessons", imported.value);
  }

  // Restore the library, then the lesson the player was last on. Order
  // matters: `lastLessonId` may name an import, which has to be back in the
  // list before it can be selected.
  void Promise.all([
    persistGet<unknown>("importedLessons"),
    persistGet<string>("lastLessonId"),
  ]).then(([saved, id]) => {
    // A store written by an older build, or edited by hand, is not trusted to
    // be well-formed — a lesson with no notes would not fail here, it would
    // fail three screens later inside the scorer.
    const usable = usableImports(
      saved,
      lessons.value.map((l) => l.id),
    );
    if (usable.length) lessons.value = [...lessons.value, ...usable];
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
    selectIndex,
    selectId,
    advance,
    addLesson,
  };
});
