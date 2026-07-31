/**
 * Lesson advancement.
 *
 * Tempo is the player's to set — there is no automatic ramp. What remains is
 * the "clear the lesson" rule: consistently strong loops at or above the
 * lesson's base tempo earn advancement to the next lesson.
 */

/** Consecutive strong loops (>= ADVANCE_ACC at >= base bpm) to clear a lesson. */
const ADVANCE_ACC = 0.9;
const ADVANCE_STREAK = 2;

/**
 * Tracks the "clear the lesson" streak. Feed it every finished loop; it
 * returns true when the player has earned advancement to the next lesson.
 */
export class AdvanceTracker {
  private streak = 0;

  update(loopAcc: number, currentBpm: number, baseBpm: number): boolean {
    this.streak = loopAcc >= ADVANCE_ACC && currentBpm >= baseBpm ? this.streak + 1 : 0;
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
