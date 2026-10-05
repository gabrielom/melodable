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

import type { StepHand } from "./hands";

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

/**
 * Best qualifying accuracy per step, 0..1, keyed by `stepKey`. Absent = never
 * qualified.
 *
 * A part's both-hands step is keyed by the lesson id alone, which is what
 * every key was before parts had hands (handoff 15) — so a part score saved
 * then reads as that part's both-hands best, and nobody loses progress.
 */
export type CourseProgress = Readonly<Record<string, number>>;

/** Where a step's best is kept: the lesson id, with the hand for one hand. */
export function stepKey(lessonId: string, hand: StepHand): string {
  return hand === "BOTH" ? lessonId : `${lessonId}#${hand}`;
}

/** Complete, or still to do. There is no locked state: any step can be played. */
export type StepState = "passed" | "todo";

/** One of a part's steps: a hand, or both, with its own best. */
export interface HandStep {
  hand: StepHand;
  key: string;
  state: StepState;
  best: number | null;
}

/**
 * A part of the song. `state` and `best` are the part's own, and a part is
 * complete when its **both-hands** step is passed — the one-hand steps are
 * practice on the way there, and passing both hands completes it even if
 * they were never played (handoff 15).
 */
export interface Step {
  lessonId: string;
  label: string;
  state: StepState;
  /** Best qualifying both-hands run, or null if there has not been one. */
  best: number | null;
  /** The part's steps in the order they are learned: R, L, BOTH — or BOTH alone. */
  hands: HandStep[];
}

/** Which steps each part has; a part told nothing has both hands only. */
export type HandsOf = (lessonId: string) => readonly StepHand[];

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
export function stepsOf(course: Course, progress: CourseProgress, handsOf?: HandsOf): Step[] {
  const last = course.lessonIds.length - 1;
  const handStep = (lessonId: string, hand: StepHand): HandStep => {
    const key = stepKey(lessonId, hand);
    const best = progress[key] ?? null;
    return { hand, key, best, state: best !== null && passes(best) ? "passed" : "todo" };
  };
  return course.lessonIds.map((lessonId, i) => {
    // The full song is played with both hands and nothing else: it is the
    // song, and the parts are where the hands are learned.
    const order = i === last || !handsOf ? (["BOTH"] as const) : handsOf(lessonId);
    const hands = (order.includes("BOTH") ? order : [...order, "BOTH" as const]).map((h) =>
      handStep(lessonId, h),
    );
    const both = hands[hands.length - 1];
    return { lessonId, label: stepLabel(i, course.lessonIds.length), state: both.state, best: both.best, hands };
  });
}

/**
 * The part to offer: the first not yet complete, in the song's order. Null
 * once every part is — there is nothing left to suggest.
 */
export function suggestedStep(steps: readonly Step[]): number | null {
  const i = steps.findIndex((s) => s.state !== "passed");
  return i >= 0 ? i : null;
}

/**
 * Which of a part's steps to play when the part is chosen without one: the
 * first not yet passed, right hand then left then both — or both, once the
 * part is complete, since that is the part itself.
 */
export function handToPlay(step: Step): StepHand {
  if (step.state === "passed") return "BOTH";
  return step.hands.find((h) => h.state !== "passed")?.hand ?? "BOTH";
}

/**
 * The part the song opens on: the suggested one, or the full song once
 * everything is complete — which is the thing worth playing again.
 */
export function openingStep(course: Course, progress: CourseProgress): number {
  return suggestedStep(stepsOf(course, progress)) ?? course.lessonIds.length - 1;
}

/** Where a song stands, as the section picker and the run summary show it. */
export interface SongState {
  courseName: string;
  steps: Step[];
  /** Parts complete. Counting stays per part, whatever steps a part has. */
  passedCount: number;
  /** The first part not yet complete; null once they all are. */
  suggested: number | null;
  /** The step of that part to play next; null once every part is complete. */
  suggestedHand: StepHand | null;
  /** Every step of every part, the full song included. */
  stepCount: number;
  /** Every part is complete. */
  complete: boolean;
}

export function songState(course: Course, progress: CourseProgress, handsOf?: HandsOf): SongState {
  const steps = stepsOf(course, progress, handsOf);
  const passedCount = steps.filter((s) => s.state === "passed").length;
  const suggested = suggestedStep(steps);
  return {
    courseName: course.name,
    steps,
    passedCount,
    suggested,
    suggestedHand: suggested === null ? null : handToPlay(steps[suggested]),
    stepCount: steps.reduce((n, s) => n + s.hands.length, 0),
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
 * Progress after a finished run, at the step `key` names (`stepKey`). Only a
 * qualifying run is counted, and only upward — a worse run later never takes
 * a pass away.
 */
export function withRun(
  progress: CourseProgress,
  key: string,
  accuracy: number,
  runBpm: number,
  lessonBpm: number,
): CourseProgress {
  if (!qualifies(runBpm, lessonBpm)) return progress;
  const was = progress[key];
  if (was !== undefined && was >= accuracy) return progress;
  return { ...progress, [key]: accuracy };
}

/** A step to go to: a part, and which of its steps. */
export interface StepTarget {
  index: number;
  step: Step;
  hand: StepHand;
}

/** What the end-of-run lightbox says about the song, given a finished step. */
export interface StepReport extends SongState {
  /** The part just played, and which of its steps. */
  index: number;
  label: string;
  hand: StepHand;
  /** The part has one-hand steps — so the hand is worth naming. */
  handed: boolean;
  /** The run counted towards completing — false when it was played slower. */
  qualified: boolean;
  /** This run is what passed the step it was. */
  justPassed: boolean;
  /** And that step was the part's both-hands one, so the part is now complete. */
  partJustPassed: boolean;
  /** This step, passed or not, as it stands now. */
  passed: boolean;
  /**
   * The step after this one: the part's next hand, or after both hands the
   * next part — at the first of its steps not yet passed. Null on the last.
   */
  following: StepTarget | null;
}

export function stepReport(
  course: Course,
  before: CourseProgress,
  after: CourseProgress,
  lessonId: string,
  qualified: boolean,
  hand: StepHand = "BOTH",
  handsOf?: HandsOf,
): StepReport | null {
  const index = course.lessonIds.indexOf(lessonId);
  if (index < 0) return null;
  const was = stepsOf(course, before, handsOf);
  const now = songState(course, after, handsOf);
  const part = now.steps[index];
  const at = part.hands.findIndex((h) => h.hand === hand);
  if (at < 0) return null;
  const wasPassed = was[index].hands[at].state === "passed";
  const passed = part.hands[at].state === "passed";
  const nextHand = part.hands[at + 1];
  const nextPart = now.steps[index + 1];
  const following: StepTarget | null = nextHand
    ? { index, step: part, hand: nextHand.hand }
    : nextPart
      ? { index: index + 1, step: nextPart, hand: handToPlay(nextPart) }
      : null;
  return {
    ...now,
    index,
    label: part.label,
    hand,
    handed: part.hands.length > 1,
    qualified,
    justPassed: !wasPassed && passed,
    partJustPassed: !wasPassed && passed && hand === "BOTH",
    passed,
    following,
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
