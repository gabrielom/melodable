/**
 * A song learned in steps.
 *
 * Several lessons combined into one: the parts of a song in order, the whole
 * song last. **Every step is open from the start** — the player moves between
 * them freely — and 80% at the lesson's own tempo marks one complete. The
 * order is only a suggestion: what is offered next is the first step not yet
 * complete.
 *
 * **The parts stay ordinary lessons.** The trainer, the scorer and the run
 * history never learn that a lesson belongs to a song. What a song adds is an
 * order, a pass mark, and a record of the best *qualifying* run at each step —
 * and all of that is here, pure, so it can be tested without a store.
 *
 * **A pass is stored, never re-derived from the run history.** History keeps
 * the last `MAX_ATTEMPTS` runs and drops the oldest, so a passing run would
 * eventually fall out of it and the step would quietly lock again. The best
 * qualifying score per step is kept on its own, and it only ever goes up.
 */

/** Share of a run that has to land for a step to count as passed. */
export const PASS_MARK = 0.8;

/**
 * Whether an accuracy reaches the mark **as the player sees it**. The summary
 * rounds to a whole percent, so a run of 79.6% reads "80" — and a screen that
 * says 80 beside a mark of 80 and then refuses the pass would be arguing with
 * itself. The comparison is made on the number that is shown.
 */
export function passes(accuracy: number): boolean {
  return Math.round(accuracy * 100) >= Math.round(PASS_MARK * 100);
}

/** Whole percentage points still to find, as the summary would count them. */
export function pointsToGo(accuracy: number): number {
  return Math.max(0, Math.round(PASS_MARK * 100) - Math.round(accuracy * 100));
}

export interface Course {
  id: string;
  name: string;
  /**
   * The song's description, when one has been written in edit mode. Absent,
   * the card shows the full song's own — the song wears that card.
   */
  hint?: string;
  /** Lesson ids in the order they are learned. The last is the whole song. */
  lessonIds: string[];
}

/** Best qualifying accuracy per lesson id, 0..1. Absent = never qualified. */
export type CourseProgress = Readonly<Record<string, number>>;

/** Complete, or still to do. There is no locked state: any step can be played. */
export type StepState = "passed" | "todo";

export interface Step {
  lessonId: string;
  label: string;
  state: StepState;
  /** Best qualifying run, or null if there has not been one. */
  best: number | null;
}

/**
 * What a step is called: parts by letter, the last one the full song.
 *
 * Positional on purpose. The lessons being combined were imported as separate
 * clips and their names say nothing reliable about which part they are — the
 * order they were picked in is the only statement the player made about it.
 */
export function stepLabel(index: number, count: number): string {
  if (index === count - 1) return "FULL SONG";
  return `PART ${String.fromCharCode(65 + index)}`;
}

/**
 * Every step with its state: complete once its best qualifying run reached the
 * mark, still to do until then.
 *
 * **Nothing is locked.** An earlier version opened the steps one at a time,
 * each behind the one before; the user asked to move between them freely,
 * with the mark saying only what is done. So the order decides one thing —
 * which step is *suggested* — and nothing about which may be played.
 */
export function stepsOf(course: Course, progress: CourseProgress): Step[] {
  return course.lessonIds.map((lessonId, i) => {
    const best = progress[lessonId] ?? null;
    const label = stepLabel(i, course.lessonIds.length);
    const state: StepState = best !== null && passes(best) ? "passed" : "todo";
    return { lessonId, label, state, best };
  });
}

/**
 * The step to offer: the first not yet complete, in the song's order. Null
 * once every step is — there is nothing left to suggest.
 */
export function suggestedStep(steps: readonly Step[]): number | null {
  const i = steps.findIndex((s) => s.state !== "passed");
  return i >= 0 ? i : null;
}

/**
 * The step the song opens on: the suggested one, or the full song once
 * everything is complete — which is the thing worth playing again.
 */
export function openingStep(course: Course, progress: CourseProgress): number {
  return suggestedStep(stepsOf(course, progress)) ?? course.lessonIds.length - 1;
}

/** Where a song stands, as the section picker and the run summary show it. */
export interface SongState {
  courseName: string;
  steps: Step[];
  passedCount: number;
  /** The first step not yet complete; null once they all are. */
  suggested: number | null;
  /** Every step is complete. */
  complete: boolean;
}

export function songState(course: Course, progress: CourseProgress): SongState {
  const steps = stepsOf(course, progress);
  const passedCount = steps.filter((s) => s.state === "passed").length;
  return {
    courseName: course.name,
    steps,
    passedCount,
    suggested: suggestedStep(steps),
    complete: passedCount === steps.length,
  };
}

/**
 * Whether a run is eligible to pass a step: played at the lesson's own tempo
 * or faster. Slowing a hard part down until it lands is practice, and good
 * practice — but it is not the part. Same rule `AdvanceTracker` applies to
 * clearing a lesson.
 */
export function qualifies(runBpm: number, lessonBpm: number): boolean {
  return runBpm >= lessonBpm;
}

/**
 * Progress after a finished run. Only a qualifying run is counted, and only
 * upward — a worse run later never takes a pass away.
 */
export function withRun(
  progress: CourseProgress,
  lessonId: string,
  accuracy: number,
  runBpm: number,
  lessonBpm: number,
): CourseProgress {
  if (!qualifies(runBpm, lessonBpm)) return progress;
  const was = progress[lessonId];
  if (was !== undefined && was >= accuracy) return progress;
  return { ...progress, [lessonId]: accuracy };
}

/** What the end-of-run lightbox says about the song, given a finished step. */
export interface StepReport extends SongState {
  /** The step just played. */
  index: number;
  label: string;
  /** The run counted towards completing — false when it was played slower. */
  qualified: boolean;
  /** This run is what completed the step. */
  justPassed: boolean;
  /** The step after this one in the song's order; null on the last. */
  following: Step | null;
}

export function stepReport(
  course: Course,
  before: CourseProgress,
  after: CourseProgress,
  lessonId: string,
  qualified: boolean,
): StepReport | null {
  const index = course.lessonIds.indexOf(lessonId);
  if (index < 0) return null;
  const was = stepsOf(course, before);
  const now = songState(course, after);
  return {
    ...now,
    index,
    label: now.steps[index].label,
    qualified,
    justPassed: was[index].state !== "passed" && now.steps[index].state === "passed",
    following: now.steps[index + 1] ?? null,
  };
}

/**
 * Songs read back from the store, with anything that no longer holds together
 * dropped.
 *
 * A step whose lesson is gone is removed rather than left as a hole, and a
 * song that ends up with fewer than two steps is not a song any more. Nothing
 * in the store is trusted to be well-formed: it may have been written by an
 * older build, or edited by hand — the same stance `usableImports` takes.
 */
export function usableCourses(saved: unknown, lessonIds: readonly string[]): Course[] {
  if (!Array.isArray(saved)) return [];
  const known = new Set(lessonIds);
  const claimed = new Set<string>();
  const out: Course[] = [];
  for (const c of saved) {
    if (!c || typeof c !== "object") continue;
    const { id, name, hint, lessonIds: ids } = c as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string" || !Array.isArray(ids)) continue;
    // A lesson belongs to at most one song, and the first to claim it keeps it.
    const steps = ids.filter(
      (x): x is string => typeof x === "string" && known.has(x) && !claimed.has(x),
    );
    if (steps.length < 2) continue;
    for (const s of steps) claimed.add(s);
    out.push(typeof hint === "string" ? { id, name, hint, lessonIds: steps } : { id, name, lessonIds: steps });
  }
  return out;
}

/** Progress read back from the store: numbers in 0..1, keyed by string. */
export function usableProgress(saved: unknown): Record<string, CourseProgress> {
  if (!saved || typeof saved !== "object") return {};
  const out: Record<string, CourseProgress> = {};
  for (const [courseId, p] of Object.entries(saved as Record<string, unknown>)) {
    if (!p || typeof p !== "object") continue;
    const clean: Record<string, number> = {};
    for (const [lessonId, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === "number" && v >= 0 && v <= 1) clean[lessonId] = v;
    }
    out[courseId] = clean;
  }
  return out;
}
