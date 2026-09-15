/**
 * A loop region: a stretch of the run, in whole bars, played over and over.
 *
 * Practice, not a run. The trainer's own "loop" is one repeat of the lesson's
 * pattern and a run is several of them end to end; this is a different thing
 * wearing the same word — a window onto the *run*, which may span several
 * pattern repeats or sit inside one, and which repeats until you stop.
 *
 * The trick that keeps this out of the timing engine: a region is turned into
 * a **pattern of its own** and handed to an ordinary `Transport` and `Scorer`.
 * Nothing in either of them learns to run backwards, and none of the scheduling,
 * sweeping or pruning — all of which assume a playhead that only moves forward
 * — has to be reconsidered. What the region costs instead is a translation
 * back: the strip still draws the whole run, so it needs the playhead and the
 * ratings mapped out of region coordinates and into the run's.
 *
 * Whole bars throughout. A loop that began three quavers into a bar would be
 * unusable for practising anything.
 *
 * Pure, per invariant 2.
 */

import type { TargetNote } from "./scoring";

export interface LoopRegion {
  /** First bar of the run the region covers. */
  fromBar: number;
  /** How many bars it spans; at least one. */
  bars: number;
}

/** The region's bounds in run beats, `[from, to)`. */
export function regionBeats(
  region: LoopRegion,
  beatsPerBar: number,
): { from: number; to: number; length: number } {
  const bpb = Math.max(1, beatsPerBar);
  const from = region.fromBar * bpb;
  const length = Math.max(1, region.bars) * bpb;
  return { from, to: from + length, length };
}

/**
 * Keep a region inside the run.
 *
 * The *start* gives way before the length does. Dragging a region to the right
 * should slide it up against the end and stop, not have it shrink as it goes —
 * and a length that has been set by hand is a decision, where a position that
 * has run out of room is just a limit. A region longer than the whole run is
 * the one case where the length must give: it becomes the run.
 */
export function clampRegion(region: LoopRegion, runBars: number): LoopRegion {
  const total = Math.max(1, Math.floor(runBars));
  const bars = Math.max(1, Math.min(Math.round(region.bars), total));
  const fromBar = Math.max(0, Math.min(Math.round(region.fromBar), total - bars));
  return { fromBar, bars };
}

/**
 * A region of `bars` bars starting at the bar the playhead is in.
 *
 * Where the playhead is when the button is pressed is what decides it: you
 * play up to the passage you want to drill and loop from there. The end is
 * clamped to the run rather than the start pulled back, so pressing it two
 * bars from the end gives a two-bar loop — from here to the end, which is what
 * was asked for — rather than silently jumping backwards to fit eight in.
 */
export function regionAt(
  runBeat: number,
  beatsPerBar: number,
  bars: number,
  runBars: number,
): LoopRegion {
  const bpb = Math.max(1, beatsPerBar);
  const total = Math.max(1, Math.floor(runBars));
  const fromBar = Math.max(0, Math.min(Math.floor(Math.max(0, runBeat) / bpb), total - 1));
  return { fromBar, bars: Math.max(1, Math.min(Math.round(bars), total - fromBar)) };
}

/** A note of the region, and where in the run it came from. */
export interface RegionSource {
  /** Which repeat of the lesson's pattern the note belongs to. */
  loopIndex: number;
  /** Its index within that repeat's target list. */
  index: number;
}

/**
 * The region flattened into a pattern of its own, rebased to beat 0.
 *
 * A run is the pattern laid end to end, so a region that spans two repeats
 * simply yields the pattern twice. Notes are taken by their onset: one that
 * *starts* inside the region belongs to it, and keeps its written length even
 * if that reaches past the end — the same way a held note at the end of a
 * pattern already behaves.
 *
 * `sources` runs in step with `targets` and is how a rating found in region
 * coordinates is put back on the right dot of the full run.
 */
export function regionTargets(
  targets: readonly TargetNote[],
  loopBeats: number,
  repeats: number,
  region: LoopRegion,
  beatsPerBar: number,
): { targets: TargetNote[]; sources: RegionSource[] } {
  const span = regionBeats(region, beatsPerBar);
  const loop = Math.max(1e-9, loopBeats);
  const passes = Math.max(1, Math.floor(repeats));
  const out: TargetNote[] = [];
  const sources: RegionSource[] = [];

  // Only the repeats the region actually touches, so a long run is not walked
  // in full to find a couple of bars in the middle of it.
  const first = Math.max(0, Math.floor(span.from / loop));
  const last = Math.min(passes - 1, Math.ceil(span.to / loop));
  for (let r = first; r <= last; r++) {
    targets.forEach((t, index) => {
      const runBeat = r * loop + t.beat;
      if (runBeat < span.from - 1e-9 || runBeat >= span.to - 1e-9) return;
      out.push({ lane: t.lane, beat: runBeat - span.from, duration: t.duration, written: t.written });
      sources.push({ loopIndex: r, index });
    });
  }
  // Sorted the way `lessonTargets` sorts, since this stands in for its output.
  const order = out.map((_, i) => i).sort((a, b) => out[a].beat - out[b].beat);
  return {
    targets: order.map((i) => out[i]),
    sources: order.map((i) => sources[i]),
  };
}

/**
 * Where a looping playhead is in the *run*.
 *
 * The transport is running the region as its own pattern, so its absolute beat
 * counts region passes; the strip draws the whole run and needs the beat under
 * the playhead in run coordinates. Before the region's first beat — the
 * count-in — it reports the region's start, which is where the run is about to
 * resume.
 */
export function runBeatOf(
  absBeat: number,
  region: LoopRegion,
  beatsPerBar: number,
): number {
  const span = regionBeats(region, beatsPerBar);
  if (absBeat <= 0) return span.from;
  return span.from + (absBeat % span.length);
}
