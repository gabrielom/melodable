import { defineStore } from "pinia";
import { ref } from "vue";
import { persistGet, persistSet } from "./persist";

/**
 * Chords named by hand, per lesson, per bar.
 *
 * The ribbon is derived (`engine/harmony.ts`), and derivation from a melody
 * alone has a floor it cannot get under: some bars are genuinely ambiguous
 * from their notes, because two chords can be *the same pitch classes* — B6
 * and G♯m7 are one example, E6 and C♯m7 another. Which one a bar is depends on
 * an accompaniment an imported clip does not carry. The derivation picks well
 * and names its answer confidently, and when it is wrong only the player knows
 * it. This is where they say so.
 *
 * Same shape and the same trade as `history`: keyed by lesson id, through the
 * Tauri store plugin, a no-op in a plain browser (invariant 7). Per *lesson*
 * rather than global, because a chord is a fact about the material — unlike
 * `settings.keyOverride`, which is a reading preference and rightly global.
 *
 * A bar with no entry is derived, which is the default and stays the default:
 * nothing is written until the player overrides something.
 */

/** Lesson id -> bar index within the loop -> scale degree 1..7. */
type Overrides = Record<string, Record<number, number>>;

export const useChords = defineStore("chords", () => {
  const byLesson = ref<Overrides>({});
  const hydrated = ref(false);

  void persistGet<Overrides>("chordOverrides").then((saved) => {
    // Anything set before the store answered wins, the way `history` does it:
    // the player's most recent word is the one to keep.
    if (saved) {
      const merged: Overrides = { ...saved };
      for (const [id, live] of Object.entries(byLesson.value)) {
        merged[id] = { ...(saved[id] ?? {}), ...live };
      }
      byLesson.value = merged;
    }
    hydrated.value = true;
  });

  /** The degree set by hand for a bar, or null where the ribbon derives it. */
  function overrideFor(lessonId: string, bar: number): number | null {
    const d = byLesson.value[lessonId]?.[bar];
    return typeof d === "number" && d >= 1 && d <= 7 ? d : null;
  }

  /** Every override a lesson carries, for the renderer to mark. */
  function forLesson(lessonId: string): Readonly<Record<number, number>> {
    return byLesson.value[lessonId] ?? {};
  }

  /** Name a bar, or pass null to hand it back to the derivation. */
  function setOverride(lessonId: string, bar: number, degree: number | null): void {
    const forThis = { ...(byLesson.value[lessonId] ?? {}) };
    if (degree === null) delete forThis[bar];
    else forThis[bar] = degree;
    const next = { ...byLesson.value };
    // An empty map is the same as no map, and leaving one behind would grow
    // the store with rows that say nothing.
    if (Object.keys(forThis).length === 0) delete next[lessonId];
    else next[lessonId] = forThis;
    byLesson.value = next;
    void persistSet("chordOverrides", byLesson.value);
  }

  /** Hand a whole lesson back to the derivation. */
  function clearLesson(lessonId: string): void {
    if (!byLesson.value[lessonId]) return;
    const next = { ...byLesson.value };
    delete next[lessonId];
    byLesson.value = next;
    void persistSet("chordOverrides", byLesson.value);
  }

  return { byLesson, hydrated, overrideFor, forLesson, setOverride, clearLesson };
});
