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

/**
 * Classify a timing offset in seconds, signed: negative is ahead of the note,
 * positive behind it. Null = outside every window.
 *
 * Inside the `great` window the direction isn't worth showing — you were on
 * it. Outside that, the sign is the whole point: `early` means you rushed,
 * `late` means you dragged.
 */
export function classify(dtSeconds: number): Exclude<Rating, "miss"> | null {
  const dt = Math.abs(dtSeconds);
  if (dt <= TIMING_WINDOWS.perfect) return "perfect";
  if (dt <= TIMING_WINDOWS.great) return "great";
  if (dt <= TIMING_WINDOWS.loose) return dtSeconds < 0 ? "early" : "late";
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

  /** How many notes landed in each band, for the end-of-run breakdown. */
  private counts: Record<Rating, number> = {
    perfect: 0,
    great: 0,
    early: 0,
    late: 0,
    miss: 0,
  };

  constructor(targets: TargetNote[]) {
    this.targets = targets;
  }

  /** All live instances (for the renderer). */
  get instances(): readonly NoteInstance[] {
    return this.all;
  }

  /** How many notes landed in each band over the whole run. */
  get tally(): Readonly<Record<Rating, number>> {
    return this.counts;
  }

  /**
   * Per-lane breakdown for the summary: how accurate the lane was, and which
   * way it drifted. The drift column is the reason splitting `early` from
   * `late` is worth doing — "you rush the snare" is actionable in a way that
   * "you are 78% on the snare" is not.
   */
  laneStats(): Array<{ lane: number; accuracy: number; early: number; late: number; total: number }> {
    const by = new Map<number, { points: number; total: number; early: number; late: number }>();
    for (const inst of this.all) {
      if (!inst.resolved || !inst.rating) continue;
      const e = by.get(inst.lane) ?? { points: 0, total: 0, early: 0, late: 0 };
      e.points += RATING_SCORE[inst.rating] / 100;
      e.total += 1;
      if (inst.rating === "early") e.early += 1;
      if (inst.rating === "late") e.late += 1;
      by.set(inst.lane, e);
    }
    return [...by.entries()]
      .map(([lane, e]) => ({
        lane,
        accuracy: e.total === 0 ? 1 : e.points / e.total,
        early: e.early,
        late: e.late,
        total: e.total,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);
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
    if (!best || bestDt > TIMING_WINDOWS.loose) return null;

    const rating = classify(time - best.time)!;
    best.resolved = true;
    best.rating = rating;
    const pts = RATING_SCORE[rating] / 100;
    this.counts[rating] += 1;
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
      if (!inst.resolved && inst.time < now - TIMING_WINDOWS.loose) {
        inst.resolved = true;
        inst.rating = "miss";
        this.counts.miss += 1;
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

/** Inclusive range of repeats that overlap the visible slice of the run. */
export interface LoopSpan {
  first: number;
  last: number;
}

/**
 * Which repeats need instances for the lane to be able to draw them.
 *
 * The lane shows a fixed number of bars either side of the playhead, and the
 * pattern is usually shorter than that — a one-bar groove in a five-bar lane
 * fits five times over. Spawning a fixed "current and next" left the rest of
 * the track empty, so notes appeared partway across it rather than scrolling
 * in from the edge.
 *
 * `behind`/`ahead` come from the renderer's own last-drawn window, so what is
 * spawned and what is drawn are derived from the same numbers. The current
 * repeat and the one after it are always included: during a count-in the
 * window is not meaningful yet, and a strike landing just before a repeat's
 * first note still needs that instance to exist to be graded against.
 */
/**
 * The run parked at its first beat, for the lane to draw before the transport
 * starts — so opening a lesson shows what you are about to play instead of an
 * empty field.
 *
 * These are throwaway instances for a single frame: never graded, never held.
 * The real ones come from `spawnLoop` once the transport is running, which is
 * why this does not touch the scorer at all.
 *
 * `now` is the clock time the playhead sits at, so beat 0 lands exactly on it
 * and everything after it falls to the right. That is the same position the
 * lane reaches the instant the count-in ends.
 */
export function previewInstances(
  targets: readonly TargetNote[],
  loopBeats: number,
  totalLoops: number,
  secPerBeat: number,
  now: number,
  aheadBeats: number,
): NoteInstance[] {
  const lb = Math.max(1e-9, loopBeats);
  const ahead = Math.max(0, aheadBeats);
  const loops = Number.isFinite(totalLoops) ? Math.max(1, Math.floor(totalLoops)) : 1;
  const lastLoop = Math.min(loops - 1, Math.floor(ahead / lb));
  const out: NoteInstance[] = [];
  for (let l = 0; l <= lastLoop; l++) {
    for (let i = 0; i < targets.length; i++) {
      const beat = l * lb + targets[i].beat;
      if (beat > ahead) continue;
      out.push({
        id: `${l}:${i}`,
        lane: targets[i].lane,
        beat: targets[i].beat,
        loopIndex: l,
        time: now + beat * secPerBeat,
        resolved: false,
        rating: null,
      });
    }
  }
  return out;
}

export function visibleLoopSpan(
  absBeat: number,
  loopBeats: number,
  behind: number,
  ahead: number,
): LoopSpan {
  const lb = Math.max(1e-9, loopBeats);
  const current = Math.floor(absBeat / lb);
  const first = Math.max(0, Math.min(current, Math.floor((absBeat - Math.max(0, behind)) / lb)));
  const last = Math.max(first, current + 1, Math.floor((absBeat + Math.max(0, ahead)) / lb));
  return { first, last };
}
