/**
 * Scoring: grade incoming hits against the lesson's notes.
 *
 * The scorer is instrument-agnostic — it thinks in *lanes*, not pads or keys.
 * For pads a lane is a pad index; for piano (M5) it's the MIDI pitch. That's
 * the "one engine, two views" rule: the views only supply a pitch→lane map.
 *
 * Notes are spawned per loop as `NoteInstance`s carrying an absolute clock
 * time, and every hit is graded as |hitTime - noteTime| against
 * TIMING_WINDOWS. Hit times must come from the audio clock (or a MIDI
 * timestamp mapped onto it) — never Date.now().
 */

import type { Lesson, Rating } from "./types";
import { RATING_SCORE, TIMING_WINDOWS } from "./types";

/** A lesson note routed to a lane, still in musical time. */
export interface TargetNote {
  lane: number;
  beat: number;
}

/** One occurrence of a target note in a specific loop, in clock time. */
export interface NoteInstance {
  id: string;
  lane: number;
  beat: number;
  loopIndex: number;
  time: number;
  resolved: boolean;
  rating: Rating | null;
}

/**
 * How long a run should last when the lesson doesn't specify `repeats` — long
 * enough to settle into the groove, short enough to retry without groaning.
 */
export const TARGET_RUN_SECONDS = 40;
/** Guard against a pathologically short pattern generating a huge run. */
const MAX_REPEATS = 64;

/**
 * How many times a lesson's pattern plays in one run.
 *
 * Built-in lessons state `repeats` so their length is musically tidy. Imported
 * clips usually don't, so the count is derived from the lesson's base tempo to
 * land near `TARGET_RUN_SECONDS` — a clip that is already a minute long gets
 * one pass, a one-bar pattern gets repeated into a real exercise.
 */
export function lessonRepeats(lesson: Lesson): number {
  if (lesson.repeats && lesson.repeats > 0) {
    return Math.min(MAX_REPEATS, Math.floor(lesson.repeats));
  }
  const loopSeconds = (lesson.bars * lesson.beatsPerBar * 60) / lesson.bpm;
  if (!Number.isFinite(loopSeconds) || loopSeconds <= 0) return 1;
  return Math.min(MAX_REPEATS, Math.max(1, Math.round(TARGET_RUN_SECONDS / loopSeconds)));
}

/** Classify a timing offset (seconds). Null = outside every window. */
export function classify(dtSeconds: number): Exclude<Rating, "miss"> | null {
  const dt = Math.abs(dtSeconds);
  if (dt <= TIMING_WINDOWS.perfect) return "perfect";
  if (dt <= TIMING_WINDOWS.great) return "great";
  if (dt <= TIMING_WINDOWS.good) return "good";
  return null;
}

/**
 * Route a lesson's notes into lanes. Notes whose pitch has no lane (an
 * unmapped drum note, say) are dropped — better than grading a lane the
 * player can't see.
 */
export function lessonTargets(lesson: Lesson, laneOf: (pitch: number) => number | null): TargetNote[] {
  const out: TargetNote[] = [];
  for (const n of lesson.notes) {
    const lane = laneOf(n.pitch);
    if (lane !== null) out.push({ lane, beat: n.time });
  }
  return out.sort((a, b) => a.beat - b.beat);
}

export class Scorer {
  private targets: TargetNote[];
  private all: NoteInstance[] = [];
  private spawned = new Set<number>();

  // running tallies. `hitPoints` accumulates score/100 per resolved note so
  // accuracy is score-weighted (a "good" is worth less than a "perfect").
  private hitPoints = 0;
  private total = 0;
  private loopHitPoints = 0;
  private loopTotal = 0;

  combo = 0;
  bestCombo = 0;

  constructor(targets: TargetNote[]) {
    this.targets = targets;
  }

  /** All live instances (for the renderer). */
  get instances(): readonly NoteInstance[] {
    return this.all;
  }

  /** Score-weighted accuracy 0..1 over everything resolved so far. */
  get accuracy(): number {
    return this.total === 0 ? 1 : this.hitPoints / this.total;
  }

  /**
   * Create instances for a loop if not already spawned. `timeOf` converts
   * (loopIndex, beat) to clock time — pass the transport's `timeOf`.
   */
  spawnLoop(loopIndex: number, timeOf: (loopIndex: number, beat: number) => number): void {
    if (this.spawned.has(loopIndex)) return;
    this.spawned.add(loopIndex);
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      this.all.push({
        id: `${loopIndex}:${i}`,
        lane: t.lane,
        beat: t.beat,
        loopIndex,
        time: timeOf(loopIndex, t.beat),
        resolved: false,
        rating: null,
      });
    }
  }

  /**
   * Grade a strike on `lane` at clock time `time` against the nearest
   * unresolved instance in that lane. Returns null for a stray hit (nothing
   * within the "good" window) — unpenalized in v1, per the plan.
   */
  hit(lane: number, time: number): { rating: Exclude<Rating, "miss">; instance: NoteInstance } | null {
    let best: NoteInstance | null = null;
    let bestDt = Infinity;
    for (const inst of this.all) {
      if (inst.lane !== lane || inst.resolved) continue;
      const dt = Math.abs(inst.time - time);
      if (dt < bestDt) {
        bestDt = dt;
        best = inst;
      }
    }
    if (!best || bestDt > TIMING_WINDOWS.good) return null;

    const rating = classify(time - best.time)!;
    best.resolved = true;
    best.rating = rating;
    const pts = RATING_SCORE[rating] / 100;
    this.hitPoints += pts;
    this.total += 1;
    this.loopHitPoints += pts;
    this.loopTotal += 1;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    return { rating, instance: best };
  }

  /**
   * Resolve overdue notes as misses: anything unresolved whose window has
   * fully passed at clock time `now`. Returns the newly-missed instances so
   * the view can flash them. Resets the combo.
   */
  sweepMisses(now: number): NoteInstance[] {
    const missed: NoteInstance[] = [];
    for (const inst of this.all) {
      if (!inst.resolved && inst.time < now - TIMING_WINDOWS.good) {
        inst.resolved = true;
        inst.rating = "miss";
        this.total += 1;
        this.loopTotal += 1;
        missed.push(inst);
      }
    }
    if (missed.length > 0) this.combo = 0;
    return missed;
  }

  /**
   * Close out the loop that just ended: returns its score-weighted accuracy
   * 0..1 (1 when the loop had no gradable notes) and resets the per-loop
   * tally for the next one.
   */
  endLoop(): number {
    const acc = this.loopTotal === 0 ? 1 : this.loopHitPoints / this.loopTotal;
    this.loopHitPoints = 0;
    this.loopTotal = 0;
    return acc;
  }

  /** Drop instances from loops before `loopIndex` (they've scrolled away). */
  pruneBefore(loopIndex: number): void {
    this.all = this.all.filter((i) => i.loopIndex >= loopIndex);
    for (const l of this.spawned) if (l < loopIndex) this.spawned.delete(l);
  }

  /** Recompute unresolved instance times after a tempo change. */
  retime(timeOf: (loopIndex: number, beat: number) => number): void {
    for (const inst of this.all) {
      if (!inst.resolved) inst.time = timeOf(inst.loopIndex, inst.beat);
    }
  }
}
