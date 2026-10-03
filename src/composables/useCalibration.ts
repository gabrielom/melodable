/**
 * The tap test behind the calibration dialog (M7).
 *
 * Deliberately not the transport. There is no lesson, no scorer and no lane
 * here — just a click on a fixed grid and the strikes that come back, so the
 * only thing being measured is the gap between the two. Running it through the
 * trainer would fold the lesson's own timing windows into the answer.
 *
 * The scheduling loop is a plain interval, not `requestAnimationFrame`:
 * invariant 6 is about the falling-note canvas, and this draws nothing per
 * frame. Clicks are queued a second ahead onto the audio clock, so the interval
 * only has to be punctual to within its own period.
 */

import { computed, ref } from "vue";
import type { AudioEngine } from "@/engine/audio";
import {
  CAL_LEAD_CLICKS,
  CAL_PERIOD,
  CAL_TAPS,
  summarizeTaps,
  tapError,
  type TapSummary,
} from "@/engine/calibration";

/** How often the scheduler wakes, and how far ahead it queues. */
const TICK_MS = 120;
const HORIZON = 1.0;

/** Scheduling lead-in, so the first click is never queued in the past. */
const LEAD_IN = 0.2;

export function useCalibration(audio: AudioEngine) {
  /** True while the click is running and taps are being collected. */
  const active = ref(false);
  /** Signed errors in seconds, one per accepted tap. */
  const errors = ref<number[]>([]);
  /** The finished measurement, or null until there is one. */
  const result = ref<TapSummary | null>(null);

  /** Clicks counted so far, lead-in included — what the rings fill from. */
  const clicksPlayed = ref(0);

  /** Taps still wanted. */
  const remaining = computed(() => Math.max(0, CAL_TAPS - errors.value.length));
  /** True during the free clicks at the top, before anything counts. */
  const leadIn = computed(() => active.value && clicksPlayed.value < CAL_LEAD_CLICKS);

  let timer: ReturnType<typeof setInterval> | null = null;
  /** Audio-clock time of click 0. Taps are measured against this grid. */
  let gridStart = 0;
  /** Clicks queued so far; the scheduler's own high-water mark. */
  let queued = 0;

  function stopTimer(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  /** Queue every click that falls inside the horizon, once each. */
  function pump(): void {
    const ahead = audio.now + HORIZON;
    while (gridStart + queued * CAL_PERIOD < ahead) {
      // The first of each four is accented, so the pulse has a shape to lock
      // onto rather than being an undifferentiated stream.
      audio.click(gridStart + queued * CAL_PERIOD, queued % 4 === 0);
      queued++;
    }
    clicksPlayed.value = Math.max(0, Math.floor((audio.now - gridStart) / CAL_PERIOD) + 1);
  }

  /** Begin. The caller must have initialised audio first (user gesture). */
  function start(): void {
    cancel();
    errors.value = [];
    result.value = null;
    clicksPlayed.value = 0;
    queued = 0;
    gridStart = audio.now + LEAD_IN;
    active.value = true;
    pump();
    timer = setInterval(pump, TICK_MS);
  }

  /** Stop without a result — Escape, or closing the dialog mid-run. */
  function cancel(): void {
    stopTimer();
    active.value = false;
    audio.cancelScheduled("metronome");
  }

  /**
   * Offer a strike. `hitTime` must be the *raw* audio-clock time of the strike
   * — `rawHitTime`, with no existing offset applied — or the test would only
   * ever measure what is left after the offset it is trying to replace.
   *
   * Strikes during the lead-in are ignored, as are ones too far from any click
   * to be a tap at it. Returns true when the tap counted.
   */
  function feed(hitTime: number): boolean {
    if (!active.value) return false;
    if (leadIn.value) return false;
    const err = tapError(hitTime, gridStart);
    if (err === null) return false;

    errors.value = [...errors.value, err];
    if (errors.value.length >= CAL_TAPS) {
      result.value = summarizeTaps(errors.value);
      cancel();
    }
    return true;
  }

  /** Give up on a short run and take what was collected, if it is enough. */
  function finishEarly(): void {
    result.value = summarizeTaps(errors.value);
    cancel();
  }

  return {
    active,
    errors,
    result,
    clicksPlayed,
    remaining,
    leadIn,
    start,
    cancel,
    feed,
    finishEarly,
  };
}
