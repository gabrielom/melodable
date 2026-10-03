import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCalibration } from "@/composables/useCalibration";
import { CAL_LEAD_CLICKS, CAL_PERIOD, CAL_TAPS } from "@/engine/calibration";
import type { AudioEngine } from "@/engine/audio";

/**
 * A stand-in for the audio engine: a clock the test drives by hand, and a
 * record of every click that was queued and when.
 */
function fakeAudio() {
  const clicks: Array<{ at: number; accent: boolean }> = [];
  let t = 100;
  return {
    clicks,
    advance(sec: number) {
      t += sec;
    },
    engine: {
      get now() {
        return t;
      },
      click(at = t, accent = false) {
        clicks.push({ at, accent });
      },
      cancelScheduled() {},
    } as unknown as AudioEngine,
  };
}

describe("the calibration run", () => {
  let audio: ReturnType<typeof fakeAudio>;
  let cal: ReturnType<typeof useCalibration>;

  beforeEach(() => {
    vi.useFakeTimers();
    audio = fakeAudio();
    cal = useCalibration(audio.engine);
  });

  afterEach(() => {
    cal.cancel();
    vi.useRealTimers();
  });

  /** Move the clock and let the scheduler's interval catch up with it. */
  function run(seconds: number) {
    audio.advance(seconds);
    vi.advanceTimersByTime(seconds * 1000);
  }

  /** The audio-clock time of click `n`, derived the way the runner does. */
  function clickTime(n: number) {
    return audio.clicks[n].at;
  }

  it("queues clicks ahead of the clock, accenting every fourth", () => {
    cal.start();
    expect(audio.clicks.length).toBeGreaterThan(0);
    expect(audio.clicks[0].accent).toBe(true);
    expect(audio.clicks[1].accent).toBe(false);
    // One period apart, exactly.
    expect(clickTime(1) - clickTime(0)).toBeCloseTo(CAL_PERIOD, 9);
    // Only what fits inside the horizon is queued; the rest follow as the
    // clock catches up, each still exactly on the grid.
    const first = audio.clicks.length;
    run(3 * CAL_PERIOD);
    expect(audio.clicks.length).toBeGreaterThan(first);
    expect(audio.clicks[4].accent).toBe(true);
    expect(clickTime(4) - clickTime(0)).toBeCloseTo(4 * CAL_PERIOD, 9);
  });

  it("ignores taps during the lead-in, which is what the lead-in is for", () => {
    cal.start();
    expect(cal.leadIn.value).toBe(true);
    expect(cal.feed(clickTime(1))).toBe(false);
    expect(cal.errors.value).toHaveLength(0);
  });

  it("counts taps once the lead-in has passed", () => {
    cal.start();
    run(CAL_LEAD_CLICKS * CAL_PERIOD);
    expect(cal.leadIn.value).toBe(false);
    expect(cal.feed(clickTime(CAL_LEAD_CLICKS) + 0.03)).toBe(true);
    expect(cal.errors.value).toHaveLength(1);
    expect(cal.errors.value[0]).toBeCloseTo(0.03, 9);
  });

  it("turns away a strike too far from any click to be a tap at it", () => {
    cal.start();
    run(CAL_LEAD_CLICKS * CAL_PERIOD);
    expect(cal.feed(clickTime(CAL_LEAD_CLICKS) + CAL_PERIOD / 2)).toBe(false);
    expect(cal.errors.value).toHaveLength(0);
  });

  it("finishes itself at the last tap and reports the offset", () => {
    cal.start();
    run(CAL_LEAD_CLICKS * CAL_PERIOD);
    for (let i = 0; i < CAL_TAPS; i++) {
      const at = clickTime(CAL_LEAD_CLICKS + i) + 0.025;
      expect(cal.active.value).toBe(true);
      cal.feed(at);
      run(CAL_PERIOD);
    }
    expect(cal.active.value).toBe(false);
    expect(cal.result.value?.offsetMs).toBe(25);
    expect(cal.result.value?.taps).toBe(CAL_TAPS);
    expect(cal.result.value?.steady).toBe(true);
  });

  it("takes nothing further once it has finished", () => {
    cal.start();
    run(CAL_LEAD_CLICKS * CAL_PERIOD);
    for (let i = 0; i < CAL_TAPS; i++) {
      cal.feed(clickTime(CAL_LEAD_CLICKS + i));
      run(CAL_PERIOD);
    }
    expect(cal.feed(audio.engine.now)).toBe(false);
    expect(cal.errors.value).toHaveLength(CAL_TAPS);
  });

  it("stops the clicks when cancelled, and takes no more taps", () => {
    cal.start();
    run(CAL_LEAD_CLICKS * CAL_PERIOD);
    cal.cancel();
    const queued = audio.clicks.length;
    run(4 * CAL_PERIOD);
    expect(audio.clicks.length).toBe(queued);
    expect(cal.feed(audio.engine.now)).toBe(false);
  });

  it("gives up on a short run rather than pretending to a number", () => {
    cal.start();
    run(CAL_LEAD_CLICKS * CAL_PERIOD);
    for (let i = 0; i < 3; i++) {
      cal.feed(clickTime(CAL_LEAD_CLICKS + i) + 0.02);
      run(CAL_PERIOD);
    }
    cal.finishEarly();
    expect(cal.active.value).toBe(false);
    expect(cal.result.value).toBeNull();
  });

  it("clears the previous result when started again", () => {
    cal.start();
    run(CAL_LEAD_CLICKS * CAL_PERIOD);
    for (let i = 0; i < CAL_TAPS; i++) {
      cal.feed(clickTime(CAL_LEAD_CLICKS + i) + 0.02);
      run(CAL_PERIOD);
    }
    expect(cal.result.value).not.toBeNull();
    cal.start();
    expect(cal.result.value).toBeNull();
    expect(cal.errors.value).toHaveLength(0);
  });
});
