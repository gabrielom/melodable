/**
 * Lesson advancement.
 *
 * Tempo is the player's to set — there is no automatic ramp. What remains is
 * the "clear the lesson" rule: a strong *run* at or above the lesson's base
 * tempo earns advancement to the next lesson.
 *
 * The unit here is a whole run, not a single repeat. A lesson is ~16 bars, so
 * one clean pass is a real result and clears it — the streak is kept at one.
 * (It stays a streak rather than a plain check because M7 persists it.)
 */

/** Consecutive strong runs (>= ADVANCE_ACC at >= base bpm) to clear a lesson. */
const ADVANCE_ACC = 0.9;
const ADVANCE_STREAK = 1;

/**
 * Tracks the "clear the lesson" streak. Feed it every finished run; it
 * returns true when the player has earned advancement to the next lesson.
 */
export class AdvanceTracker {
  private streak = 0;

  update(runAcc: number, currentBpm: number, baseBpm: number): boolean {
    this.streak = runAcc >= ADVANCE_ACC && currentBpm >= baseBpm ? this.streak + 1 : 0;
    if (this.streak >= ADVANCE_STREAK) {
      this.streak = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.streak = 0;
  }
}
