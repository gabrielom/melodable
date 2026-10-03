import { describe, expect, it } from "vitest";
import { Transport, phaseDelta, START_DELAY } from "@/engine/transport";

/**
 * A simulated Link session: one shared beat timeline, exactly what Ableton and
 * the app both see. `phaseAt` mirrors Rust's `session.phase_at_time(t, q)`.
 *
 * The quantum is one bar throughout, which is what the app now asks Rust for.
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
  const delta = phaseDelta(cur, s.phase, t.beatsPerBar);
  if (Math.abs(delta) * t.secPerBeat > LINK_DEADBAND) t.anchorTo(cur + delta, at);
}

/** Position within the bar, 0..beatsPerBar — what has to equal Link's phase. */
const barPos = (t: Transport, at: number) => {
  const b = t.position(at).absBeat;
  return ((b % t.beatsPerBar) + t.beatsPerBar) % t.beatsPerBar;
};

/** Signed beats between our bar line and Link's, taking the short way. */
const errBeats = (t: Transport, link: ReturnType<typeof session>, at: number) => {
  const d = barPos(t, at) - link.phaseAt(at, t.beatsPerBar);
  const half = t.beatsPerBar / 2;
  return d > half ? d - t.beatsPerBar : d < -half ? d + t.beatsPerBar : d;
};

/**
 * Press Play the way `useTrainer` does: hand `start` the grid built from the
 * latest snapshot, so beat 0 is pinned rather than yanked.
 */
function press(t: Transport, link: ReturnType<typeof session>, at: number) {
  t.start(at, START_DELAY, { beat: link.phaseAt(at, t.beatsPerBar), at });
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
    follow(t, { tempo: link.tempo, phase: link.phaseAt(at, t.beatsPerBar) }, at, true);
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

  it("pulls a one-bar lesson onto the grid and holds it there", () => {
    const link = session(120, 0.317);
    const t = oneBar();
    press(t, link, 10);
    // Settle for a second, then measure.
    expect(runFollower(t, link, 10, 30, { after: 11 })).toBeLessThan(1e-6);
  });

  it("holds a two-bar lesson too", () => {
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
   * Where does the run's *first* beat land relative to Link's grid? Pressing
   * Play at an arbitrary moment must still put beat 0 on a bar line both apps
   * agree on.
   */
  it("puts the run's beat 0 on a Link bar line, whenever Play is pressed", () => {
    const link = session(120, 0.317);
    for (const pressedAt of [10, 10.13, 10.37, 10.61, 10.89]) {
      const t = twoBar();
      press(t, link, pressedAt);
      // Follow through the count-in and into the run.
      runFollower(t, link, pressedAt, pressedAt + 8);
      // When is our beat 0? Solve for the time our absBeat crosses zero.
      const beatZero = t.timeOfAbsBeat(0);
      const phaseThere = link.phaseAt(beatZero, t.beatsPerBar);
      const off = Math.min(phaseThere, t.beatsPerBar - phaseThere);
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
      follow(t, { tempo: link.tempo, phase: link.phaseAt(at, t.beatsPerBar) }, at, true);
      if (Math.abs(t.timeOfAbsBeat(0) - before) > 1e-9) corrections++;
    }
    expect(corrections).toBe(0);
  });

  /**
   * The whole point of a one-bar quantum: *which* of Ableton's bars the run
   * enters on is the player's to choose, by when they press Start.
   *
   * Stepping by the lesson's loop instead put every candidate start a whole
   * loop apart, so all of them shared one parity and the other bars of a
   * longer set were unreachable however you timed the press.
   */
  it("lets the press time choose which of their bars the run starts on", () => {
    const link = session(120, 0.317);
    const bar = 4 * 0.5; // seconds
    // Their loop is four bars; bar 1 is a session bar line, at beat 0 mod 4.
    const theirBarOne = 0.317 + 8 * 0.5; // session beat 8
    expect(link.phaseAt(theirBarOne, 4)).toBeCloseTo(0, 9);

    // Which of their bars we land on, pressing at each bar of their loop.
    const landedOn = [0, 1, 2, 3].map((barsIn) => {
      const t = twoBar();
      // A shade after their downbeat, the way a hand actually lands.
      press(t, link, theirBarOne + barsIn * bar + 0.05);
      const barsAfter = (t.timeOfAbsBeat(0) - theirBarOne) / bar;
      return Math.round(barsAfter) % 4;
    });

    // Every bar of their loop is reachable, and pressing during their bar 3
    // (index 2) counts in over bar 4 and starts the run on their bar 1.
    expect(landedOn).toEqual([2, 3, 0, 1]);
  });
});
