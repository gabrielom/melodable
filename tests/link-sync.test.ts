import { describe, expect, it } from "vitest";
import { Transport, phaseDelta, START_DELAY } from "@/engine/transport";

/**
 * A simulated Link session: one shared beat timeline, exactly what Ableton and
 * the app both see. `phaseAt` mirrors Rust's `session.phase_at_time(t, q)`.
 */
function session(tempo: number, originSeconds: number) {
  const beatAt = (t: number) => ((t - originSeconds) * tempo) / 60;
  return {
    tempo,
    beatAt,
    phaseAt: (t: number, quantum: number) => {
      const b = beatAt(t);
      return ((b % quantum) + quantum) % quantum;
    },
  };
}

const LINK_DEADBAND = 0.003;

/**
 * `followLink` from `useTrainer`, with the Vue parts removed. Kept byte-for-
 * byte equivalent to the shipped decision so the test measures the real thing.
 */
function follow(t: Transport, s: { tempo: number; phase: number }, at: number, playing: boolean) {
  if (s.tempo > 0 && Math.abs(s.tempo - t.bpm) > 0.01) t.setBpm(s.tempo, playing ? at : undefined);
  if (!playing || !t.isPlaying) return;
  const cur = t.position(at).absBeat;
  const delta = phaseDelta(cur, s.phase, t.loopBeats);
  if (Math.abs(delta) * t.secPerBeat > LINK_DEADBAND) t.anchorTo(cur + delta, at);
}

/** Loop position, 0..loopBeats — what has to equal Link's phase. */
const loopPos = (t: Transport, at: number) => {
  const b = t.position(at).absBeat;
  return ((b % t.loopBeats) + t.loopBeats) % t.loopBeats;
};

/** Signed beats between our loop boundary and Link's, taking the short way. */
const errBeats = (t: Transport, link: ReturnType<typeof session>, at: number) => {
  const d = loopPos(t, at) - link.phaseAt(at, t.loopBeats);
  const half = t.loopBeats / 2;
  return d > half ? d - t.loopBeats : d < -half ? d + t.loopBeats : d;
};

/**
 * Press Play the way `useTrainer` does: hand `start` the grid built from the
 * latest snapshot, so beat 0 is pinned rather than yanked.
 */
function press(t: Transport, link: ReturnType<typeof session>, at: number) {
  t.start(at, START_DELAY, { beat: link.phaseAt(at, t.loopBeats), at });
}

/** Run the 30Hz follower from `from` to `to`, returning the worst error seen. */
function runFollower(
  t: Transport,
  link: ReturnType<typeof session>,
  from: number,
  to: number,
  opts: { after?: number } = {},
) {
  let worst = 0;
  for (let at = from; at <= to; at += 1 / 30) {
    follow(t, { tempo: link.tempo, phase: link.phaseAt(at, t.loopBeats) }, at, true);
    if (at >= (opts.after ?? from)) worst = Math.max(worst, Math.abs(errBeats(t, link, at)));
  }
  return worst;
}

describe("following a Link session", () => {
  /** A one-bar lesson: quantum and count-in are both 4 beats. */
  const oneBar = () =>
    new Transport({ bpm: 120, bars: 1, beatsPerBar: 4, countInBars: 1, totalLoops: 64 });
  /** A two-bar lesson: the loop is 8 beats but the count-in is still 4. */
  const twoBar = () =>
    new Transport({ bpm: 120, bars: 2, beatsPerBar: 4, countInBars: 1, totalLoops: 64 });

  it("pulls a one-bar loop onto the grid and holds it there", () => {
    const link = session(120, 0.317);
    const t = oneBar();
    press(t, link, 10);
    // Settle for a second, then measure.
    expect(runFollower(t, link, 10, 30, { after: 11 })).toBeLessThan(1e-6);
  });

  it("holds a two-bar loop too", () => {
    const link = session(120, 0.317);
    const t = twoBar();
    press(t, link, 10);
    expect(runFollower(t, link, 10, 30, { after: 11 })).toBeLessThan(1e-6);
  });

  it("stays locked when the session changes tempo mid-run", () => {
    let link = session(120, 0.317);
    const t = twoBar();
    press(t, link, 10);
    runFollower(t, link, 10, 20, { after: 11 });
    link = session(132, 0.317);
    expect(runFollower(t, link, 20, 40, { after: 22 })).toBeLessThan(1e-6);
  });

  /**
   * What the count-in is actually worth once Link starts pulling. The bar you
   * hear before the run has to be a whole bar, whenever Play was pressed.
   */
  it("keeps the count-in a whole bar long, whenever Play is pressed", () => {
    const link = session(120, 0.317);
    const heard: number[] = [];
    for (const pressedAt of [10, 10.13, 10.37, 10.61, 10.89]) {
      const t = twoBar();
      press(t, link, pressedAt);
      runFollower(t, link, pressedAt, pressedAt + 8);
      // The count-in bar itself: its first beat → the run's first beat.
      heard.push(+(t.timeOfAbsBeat(0) - t.timeOfAbsBeat(-4)).toFixed(3));
    }
    const want = +(4 * 0.5).toFixed(3);
    expect(heard).toEqual([want, want, want, want, want]);
  });

  /**
   * The one that matters for the report. Where does the run's *first* beat
   * land relative to Link's grid? Pressing Play at an arbitrary moment must
   * still put beat 0 on a boundary both apps agree on.
   */
  it("puts the run's beat 0 on a Link boundary, whenever Play is pressed", () => {
    const link = session(120, 0.317);
    for (const pressedAt of [10, 10.13, 10.37, 10.61, 10.89]) {
      const t = twoBar();
      press(t, link, pressedAt);
      // Follow through the count-in and into the run.
      runFollower(t, link, pressedAt, pressedAt + 8);
      // When is our beat 0? Solve for the time our absBeat crosses zero.
      const beatZero = t.timeOfAbsBeat(0);
      const phaseThere = link.phaseAt(beatZero, t.loopBeats);
      const off = Math.min(phaseThere, t.loopBeats - phaseThere);
      expect({ pressedAt, off: +off.toFixed(6) }).toEqual({ pressedAt, off: 0 });
    }
  });

  /**
   * A grid-aligned start leaves the follower nothing to do. Any correction at
   * all here means we started at the wrong phase and are being dragged onto
   * the grid — the thing that used to eat the count-in.
   */
  it("gives the follower nothing to correct", () => {
    const link = session(120, 0.317);
    const t = twoBar();
    press(t, link, 10.41);
    let corrections = 0;
    for (let at = 10.41; at <= 20; at += 1 / 30) {
      const before = t.timeOfAbsBeat(0);
      follow(t, { tempo: link.tempo, phase: link.phaseAt(at, t.loopBeats) }, at, true);
      if (Math.abs(t.timeOfAbsBeat(0) - before) > 1e-9) corrections++;
    }
    expect(corrections).toBe(0);
  });
});
