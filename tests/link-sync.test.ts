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

  /**
   * The report itself. Ableton's loop start is wherever its transport was
   * started, which is a boundary of *its* quantum — one bar. Our quantum is
   * the lesson loop, two bars, so half of Ableton's downbeats are not ours.
   * Aligning on session phase alone leaves us a bar out, forever, at even
   * odds; anchoring to the peer's transport start cannot.
   */
  it("starts on the peer's downbeat even when it is off our quantum", () => {
    const link = session(120, 0.317);
    // Ableton pressed Play on a bar line that is an *odd* number of bars from
    // the session's beat 0 — so it is not a multiple of our 8-beat quantum.
    const theirStart = 6.317; // session beat 12: ≡ 0 mod 4, ≡ 4 mod 8
    expect(link.phaseAt(theirStart, 4)).toBeCloseTo(0, 9);
    expect(link.phaseAt(theirStart, 8)).toBeCloseTo(4, 9);

    const t = twoBar();
    // The grid we hand `start` counts from *their* downbeat, not from phase 0.
    const at = 10.41;
    t.start(at, START_DELAY, { beat: link.beatAt(at) - link.beatAt(theirStart), at });

    // Every one of our loop boundaries is a whole number of loops from theirs.
    const sinceTheirs = (t.timeOfAbsBeat(0) - theirStart) / t.secPerBeat;
    expect(sinceTheirs / t.loopBeats).toBeCloseTo(Math.round(sinceTheirs / t.loopBeats), 9);
  });
});

/**
 * Waiting for Ableton, which is the only way to land on the top of *their*
 * loop. Link puts their loop length on the wire nowhere, so counting our own
 * loops from their transport start still lands a bar or two inside a loop
 * longer than ours — a 4-bar loop against a 2-bar lesson is bar 1 or bar 3.
 * Their transport start is the one downbeat Link names outright.
 */
describe("starting on the peer's transport", () => {
  const oneBar = () =>
    new Transport({ bpm: 120, bars: 1, beatsPerBar: 4, countInBars: 1, totalLoops: 64 });
  const twoBar = () =>
    new Transport({ bpm: 120, bars: 2, beatsPerBar: 4, countInBars: 1, totalLoops: 64 });

  /**
   * What the follower does when the peer's transport starts. Their transport
   * turns on with their count-in, so ours runs over theirs and beat 0 lands a
   * count-in later — the beat their loop actually begins on.
   */
  function peerStarted(t: Transport, theirStart: number, now: number) {
    t.startAt(theirStart + t.countInBeats * t.secPerBeat, now);
  }

  /** Their beat timeline, counted from the moment their transport started. */
  const sinceStart = (link: ReturnType<typeof session>, theirStart: number) => ({
    tempo: link.tempo,
    beatAt: (t: number) => link.beatAt(t) - link.beatAt(theirStart),
    phaseAt: (t: number, q: number) => {
      const b = link.beatAt(t) - link.beatAt(theirStart);
      return ((b % q) + q) % q;
    },
  });

  it("counts in over their count-in, so bar 1 is the same beat", () => {
    const theirStart = 7.94; // their transport on: the top of their count-in
    for (const t of [oneBar(), twoBar()]) {
      // Live quantizes its own launch, so we hear about it a little early.
      peerStarted(t, theirStart, theirStart - 0.4);
      // Their loop begins a bar after their transport did; so does our run.
      const theirBarOne = theirStart + 4 * t.secPerBeat;
      expect(t.timeOfAbsBeat(0)).toBeCloseTo(theirBarOne, 9);
      // And our count-in fills exactly their count-in bar.
      expect(t.timeOfAbsBeat(-t.countInBeats)).toBeCloseTo(theirStart, 9);
    }
  });

  /**
   * The report's own shape: their loop is 4 bars, the lesson is 2. Every one
   * of our loop tops has to be one of theirs — not the bar in the middle.
   */
  it("keeps a 2-bar lesson on the tops of a 4-bar loop", () => {
    const link = session(120, 0.317);
    const theirStart = 7.94;
    const theirLoopBeats = 16;
    const t = twoBar();
    peerStarted(t, theirStart, theirStart - 0.4);
    const theirBarOne = theirStart + 4 * t.secPerBeat;

    // Our loop 0 and 2 are their loop tops; 1 and 3 are their halfway bars,
    // which is fine — what matters is that we never start on one.
    const beatOfOurLoop = (i: number) => (t.timeOf(i, 0) - theirBarOne) / t.secPerBeat;
    expect(beatOfOurLoop(0) % theirLoopBeats).toBeCloseTo(0, 9);
    expect(beatOfOurLoop(2) % theirLoopBeats).toBeCloseTo(0, 9);

    // And the follower, now counting from their downbeat, leaves it alone.
    const theirs = sinceStart(link, theirBarOne);
    let corrections = 0;
    for (let at = theirBarOne; at <= theirBarOne + 20; at += 1 / 30) {
      const before = t.timeOfAbsBeat(0);
      follow(t, { tempo: theirs.tempo, phase: theirs.phaseAt(at, t.loopBeats) }, at, true);
      if (Math.abs(t.timeOfAbsBeat(0) - before) > 1e-9) corrections++;
    }
    expect(corrections).toBe(0);
  });

  it("plays the whole count-in when their transport starts on time", () => {
    const t = twoBar();
    const theirStart = 12.0;
    peerStarted(t, theirStart, theirStart);
    const win = t.advanceScheduler(theirStart, 4.0);
    expect(win?.from).toBe(-4);
  });

  /**
   * A peer already a bar into its count-in — a late-delivered snapshot, or a
   * transport that started before we armed. We drop into whatever is left
   * rather than clicking into the past.
   */
  it("never schedules a click behind the playhead", () => {
    const t = twoBar();
    const theirStart = 12.0;
    peerStarted(t, theirStart, theirStart + 2.0);
    const win = t.advanceScheduler(theirStart + 2.0, 4.0);
    expect(win?.from).toBe(0);
    expect(t.clicksIn(win!.from, win!.to).every((c) => c.absBeat >= 0)).toBe(true);
  });
});
