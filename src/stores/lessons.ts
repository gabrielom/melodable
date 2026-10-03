import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Lesson } from "@/engine/types";
import { BUILTIN_LESSONS } from "@/data/lessons";
import { usableImports } from "@/engine/library";
import { applyEdit, usableEdits, type LessonEdit } from "@/engine/lesson-edit";
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

  /**
   * Advance to the next lesson; returns it, or null if already at the last.
   *
   * `skip` passes over lessons that are not on the home grid on their own — a
   * step of a song is reached through its song, never by falling into it from
   * the lesson before.
   */
  function advance(skip: (l: Lesson) => boolean = () => false): Lesson | null {
    for (let i = currentIndex.value + 1; i < lessons.value.length; i++) {
      if (skip(lessons.value[i])) continue;
      currentIndex.value = i;
      return current.value;
    }
    return null;
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

  /**
   * Edits made to built-in lessons. A built-in comes from the code rather than
   * the store, so what the player changed about it is kept apart and laid
   * over it on every launch. An import is simply saved as edited.
   */
  let builtinEdits: Record<string, LessonEdit> = {};

  /**
   * Change a lesson's name, description, tempo or key (edit mode on home).
   *
   * The lesson is *replaced*, not mutated, so anything watching it by
   * identity — the trainer resets on exactly that — sees the change.
   */
  function editLesson(id: string, edit: LessonEdit): void {
    const i = lessons.value.findIndex((l) => l.id === id);
    if (i < 0) return;
    const next = [...lessons.value];
    next[i] = applyEdit(next[i], edit);
    lessons.value = next;
    if (next[i].source === "midi-import") {
      void persistSet("importedLessons", imported.value);
    } else {
      builtinEdits = { ...builtinEdits, [id]: { ...builtinEdits[id], ...edit } };
      void persistSet("builtinEdits", builtinEdits);
    }
  }

  // Restore the library, then the lesson the player was last on. Order
  // matters: `lastLessonId` may name an import, which has to be back in the
  // list before it can be selected.
  void Promise.all([
    persistGet<unknown>("importedLessons"),
    persistGet<string>("lastLessonId"),
    persistGet<unknown>("builtinEdits"),
  ]).then(([saved, id, edits]) => {
    builtinEdits = { ...usableEdits(edits), ...builtinEdits };
    lessons.value = lessons.value.map((l) =>
      l.source === "builtin" && builtinEdits[l.id] ? applyEdit(l, builtinEdits[l.id]) : l,
    );
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
    hydrated,
    currentIndex,
    current,
    hasNext,
    selectIndex,
    selectId,
    advance,
    addLesson,
    editLesson,
  };
});
