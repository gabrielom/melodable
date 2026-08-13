import { defineStore } from "pinia";
import { ref } from "vue";
import { persistGet, persistSet } from "./persist";

/**
 * Practice history: what you scored, per lesson, across sittings.
 *
 * The end-of-run summary asks "am I getting better", and that question needs
 * more than one run to answer — so this is the first thing in the app that has
 * to outlive the process. Invariant 7 still holds: it goes through the Tauri
 * store plugin like settings do, and is a no-op in a plain browser.
 *
 * Only the accuracies are kept, oldest first. Not timestamps, not tempos, not
 * per-lane figures: the chart draws a sequence of numbers and nothing else
 * reads this yet. The rest of M7's session log can come when something needs
 * it.
 */

/**
 * How many attempts are kept and drawn.
 *
 * The design's ceiling: past about forty the 3.1r dots start touching at the
 * chart's 620px, and the answer is to drop the oldest rather than squeeze the
 * spacing. Keeping exactly what is drawn means the store never grows without
 * bound either.
 */
export const MAX_ATTEMPTS = 40;

type History = Record<string, number[]>;

export const useHistory = defineStore("history", () => {
  /** Accuracies 0..1, oldest first, per lesson id. */
  const byLesson = ref<History>({});
  const hydrated = ref(false);

  void persistGet<History>("history").then((saved) => {
    // A run recorded before the store answered must not be thrown away, so
    // saved attempts go *before* whatever is already in memory.
    if (saved) {
      const merged: History = { ...saved };
      for (const [id, live] of Object.entries(byLesson.value)) {
        merged[id] = [...(saved[id] ?? []), ...live].slice(-MAX_ATTEMPTS);
      }
      byLesson.value = merged;
    }
    hydrated.value = true;
  });

  /** Every attempt at a lesson, oldest first. Empty before the first run. */
  function attempts(lessonId: string): readonly number[] {
    return byLesson.value[lessonId] ?? [];
  }

  /** Best accuracy so far, or null if the lesson has never been run. */
  function best(lessonId: string): number | null {
    const runs = attempts(lessonId);
    return runs.length ? Math.max(...runs) : null;
  }

  /** Add a finished run. Read it back through `attempts`. */
  function record(lessonId: string, accuracy: number): void {
    const next = [...attempts(lessonId), accuracy].slice(-MAX_ATTEMPTS);
    byLesson.value = { ...byLesson.value, [lessonId]: next };
    void persistSet("history", byLesson.value);
  }

  return { byLesson, hydrated, attempts, best, record };
});
