import { defineStore } from "pinia";
import { ref, watch } from "vue";
import {
  type Course,
  type CourseProgress,
  usableCourses,
  usableProgress,
  withRun,
} from "@/engine/course";
import { useLessons } from "./lessons";
import { persistGet, persistSet } from "./persist";

/**
 * Songs: lessons combined into steps, and how far the player has got in each.
 *
 * Two persisted keys, kept apart because they change at different rates and
 * mean different things — `courses` is what the player built, `courseProgress`
 * is what they have done with it. The rules are in `engine/course.ts`; this is
 * only where they are kept.
 */
export const useCourses = defineStore("courses", () => {
  const lessons = useLessons();
  const courses = ref<Course[]>([]);
  const progress = ref<Record<string, CourseProgress>>({});
  const hydrated = ref(false);

  // A song names lessons by id, and an imported lesson is not in the library
  // until the lessons store has read it back — so this waits for that, or it
  // would find every step missing and throw the song away.
  let loading = false;
  watch(
    () => lessons.hydrated,
    (ready) => {
      if (!ready || loading) return;
      loading = true;
      void Promise.all([persistGet<unknown>("courses"), persistGet<unknown>("courseProgress")]).then(
        ([saved, savedProgress]) => {
          // Anything combined before the store answered goes after what was
          // saved, rather than being thrown away.
          courses.value = [
            ...usableCourses(saved, lessons.lessons.map((l) => l.id)),
            ...courses.value,
          ];
          progress.value = { ...usableProgress(savedProgress), ...progress.value };
          hydrated.value = true;
        },
      );
    },
    { immediate: true },
  );

  /** The song a lesson is a step of, if any. */
  function courseOf(lessonId: string): Course | null {
    return courses.value.find((c) => c.lessonIds.includes(lessonId)) ?? null;
  }

  function progressOf(courseId: string): CourseProgress {
    return progress.value[courseId] ?? {};
  }

  /** Every lesson that is a step of some song — the home grid hides these. */
  function members(): Set<string> {
    return new Set(courses.value.flatMap((c) => c.lessonIds));
  }

  /**
   * Combine lessons into a song, in the order given. A lesson already in a
   * song is not taken again — it belongs to one.
   */
  function combine(name: string, lessonIds: readonly string[]): Course | null {
    const taken = members();
    const ids = lessonIds.filter((id) => !taken.has(id));
    if (ids.length < 2) return null;
    const course: Course = {
      id: `course-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      name: name.trim() || "Untitled song",
      lessonIds: ids,
    };
    courses.value = [...courses.value, course];
    void persistSet("courses", courses.value);
    return course;
  }

  /**
   * Rename a song or rewrite its description (edit mode). A blank name keeps
   * the old one, for the reason `applyEdit` gives: a card with no name cannot
   * be told apart. Its tempo and key are its sections', so they are edited
   * there, not here.
   */
  function editCourse(courseId: string, edit: { name?: string; hint?: string }): void {
    courses.value = courses.value.map((c) => {
      if (c.id !== courseId) return c;
      const next: Course = { ...c };
      if (typeof edit.name === "string" && edit.name.trim()) next.name = edit.name.trim();
      if (typeof edit.hint === "string") next.hint = edit.hint.trim();
      return next;
    });
    void persistSet("courses", courses.value);
  }

  /**
   * Take a song apart: its sections go back to being lessons of their own on
   * the home grid. Its progress goes with it — a record of which sections of a
   * song were complete means nothing once there is no song, and a song made
   * again from the same lessons starts fresh.
   */
  function split(courseId: string): void {
    courses.value = courses.value.filter((c) => c.id !== courseId);
    const { [courseId]: _gone, ...rest } = progress.value;
    progress.value = rest;
    void persistSet("courses", courses.value);
    void persistSet("courseProgress", progress.value);
  }

  /** Count a finished run towards its song. See `withRun` for what counts. */
  function record(
    courseId: string,
    lessonId: string,
    accuracy: number,
    runBpm: number,
    lessonBpm: number,
  ): void {
    const was = progressOf(courseId);
    const next = withRun(was, lessonId, accuracy, runBpm, lessonBpm);
    if (next === was) return;
    progress.value = { ...progress.value, [courseId]: next };
    void persistSet("courseProgress", progress.value);
  }

  return {
    courses,
    progress,
    hydrated,
    courseOf,
    progressOf,
    members,
    combine,
    editCourse,
    split,
    record,
  };
});
