/**
 * Adaptive difficulty — Melodics' Auto-BPM idea, generalized.
 *
 * Tempo moves at loop boundaries based on that loop's accuracy: clean loops
 * nudge the tempo up (capped at 135% of the lesson's base), rough loops ease
 * it back down (floored at 60% of base). Consistently strong loops at or
 * above base tempo clear the lesson.
 */

/** Loops >= this accuracy push the tempo up. */
export const PUSH_ACC = 0.85;
/** Loops below this accuracy ease the tempo down. */
export const EASE_ACC = 0.6;
/** Consecutive strong loops (>= ADVANCE_ACC at >= base bpm) to clear a lesson. */
export const ADVANCE_ACC = 0.9;
export const ADVANCE_STREAK = 2;

/**
 * Next tempo given the lesson's base bpm, the current bpm, and the accuracy
 * (0..1) of the loop that just ended.
 */
export function nextTempo(base: number, current: number, loopAcc: number): number {
  if (loopAcc >= PUSH_ACC) return Math.min(Math.round(base * 1.35), current + 4);
  if (loopAcc < EASE_ACC) return Math.max(Math.round(base * 0.6), current - 5);
  return current;
}

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
