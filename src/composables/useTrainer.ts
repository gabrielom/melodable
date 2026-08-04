/**
 * The training session: owns the transport, scorer, and lesson advancement,
 * and drives the falling-note canvas from a single requestAnimationFrame loop.
 *
 * All timing reads `audio.now` (the AudioContext clock). Hardware hits are
 * converted from midir timestamps onto that clock via HostClock before
 * grading — never graded at "whenever the Vue handler ran".
 */

import { computed, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { useSettings } from "@/stores/settings";
import { useLessons } from "@/stores/lessons";
import type { LinkState, Rating } from "@/engine/types";
import { Transport, phaseDelta } from "@/engine/transport";
import { PALETTE } from "@/engine/theme";
import {
  Scorer,
  lessonTargets,
  lessonRepeats,
  visibleLoopSpan,
  previewInstances,
  type NoteInstance,
} from "@/engine/scoring";
import { AdvanceTracker } from "@/engine/adaptive";
import { HostClock } from "@/engine/host-clock";
import { noteToPad, PADS } from "@/engine/gm";
import type { AudioEngine } from "@/engine/audio";
import type { LaneRenderer } from "@/views/lane-frame";
import { PadLanes } from "@/views/pads/PadLanes";
import { PianoRoll } from "@/views/piano/PianoRoll";
import { Overview } from "@/views/Overview";
import { normalizeRange } from "@/engine/pitch";

export interface RatingPop {
  id: number;
  lane: number;
  rating: Rating;
}

/** How far ahead (seconds) clicks and guide notes are scheduled. */
const LOOKAHEAD = 1.0;

/**
 * Phase error we tolerate before re-anchoring to Link. Below this the drift is
 * inaudible, and correcting it every poll (~30 Hz) would jitter the playhead
 * for nothing.
 */
const LINK_DEADBAND = 0.003;

export function useTrainer(
  audio: AudioEngine,
  canvasEl: Ref<HTMLCanvasElement | null>,
  overviewEl?: Ref<HTMLCanvasElement | null>,
) {
  const settings = useSettings();
  const lessons = useLessons();
  /** The active lesson comes from the library store — one source of truth. */
  const lesson = computed(() => lessons.current);

  const playing = ref(false);
  const bpm = ref(lesson.value.bpm);
  /** Link tempos are fractional; the bar shows one decimal, as designed. */
  const bpmLabel = computed(() => Math.round(bpm.value * 10) / 10);
  const guide = ref(false);

  /**
   * True once a run has played to the end, until the next one starts. The bar
   * keeps the final ACC/CMB on screen rather than blanking them to "—" the
   * instant the music stops — the end-of-run summary the design calls for
   * isn't drawn yet, and losing the result would be worse than showing it.
   */
  const runComplete = ref(false);
  /** The finished run's numbers, frozen for the summary screen. */
  const runResult = ref<{
    accuracy: number;
    bestCombo: number;
    previousBest: number | null;
    tally: Readonly<Record<Rating, number>>;
    lanes: ReturnType<Scorer["laneStats"]>;
  } | null>(null);
  /**
   * Best accuracy per lesson so far. In memory for now — M7 persists it, and
   * this is the shape it will persist.
   */
  const bestByLesson = new Map<string, number>();
  const accuracy = ref(100);
  const combo = ref(0);
  const bestCombo = ref(0);
  const toast = ref<string | null>(null);
  const pops = ref<RatingPop[]>([]);

  const midiClock = new HostClock();

  const isPiano = computed(() => lesson.value.instrument === "piano");

  /** The active palette, handed to the canvas renderers each frame. */
  const palette = computed(() => PALETTE[settings.theme]);

  /**
   * Pitch → lane, the one thing that differs between the two views. For pads
   * a lane is a pad index; for piano it's the pitch itself (invariant 4 — the
   * scorer never knows which instrument it's grading).
   */
  function laneOf(pitch: number): number | null {
    return isPiano.value ? pitch : noteToPad(pitch);
  }

  const targets = computed(() => lessonTargets(lesson.value, laneOf));

  /** Piano: the distinct pitches this lesson asks for — the keys to mark. */
  const lessonPitches = computed(() =>
    isPiano.value ? [...new Set(targets.value.map((t) => t.lane))].sort((a, b) => a - b) : [],
  );

  /** Pads: the pad indices this lesson uses, left-to-right. */
  const lanes = computed(() => [...new Set(targets.value.map((t) => t.lane))].sort((a, b) => a - b));

  /**
   * Piano: the visible key range — deliberately between the two extremes.
   *
   * Showing only the lesson's own keys gives no sense of where the hand sits;
   * showing all 88 makes a five-note lesson a speck. So: the lesson's pitches
   * plus a few semitones of air, widened symmetrically to two octaves. Two is
   * enough context to place the notes on the instrument, and unlike the three
   * this used to force, it does not leave most of the roll empty — which is
   * also what made the rows thin and the keys wide.
   */
  const MIN_PIANO_SPAN = 24; // semitones = 2 octaves
  const PITCH_PAD = 3; // semitones of air either side of the lesson's own notes
  const LOWEST_KEY = 21; // A0
  const HIGHEST_KEY = 108; // C8

  const pianoRange = computed<[number, number]>(() => {
    const pitches = targets.value.map((t) => t.lane);
    let lo: number;
    let hi: number;
    if (pitches.length === 0) {
      lo = settings.pianoLow;
      hi = settings.pianoHigh;
    } else {
      lo = Math.min(...pitches) - PITCH_PAD;
      hi = Math.max(...pitches) + PITCH_PAD;
    }

    const shortfall = MIN_PIANO_SPAN - (hi - lo);
    if (shortfall > 0) {
      lo -= Math.floor(shortfall / 2);
      hi += Math.ceil(shortfall / 2);
    }

    // Slide (don't shrink) the window back inside the playable range.
    if (lo < LOWEST_KEY) {
      hi += LOWEST_KEY - lo;
      lo = LOWEST_KEY;
    }
    if (hi > HIGHEST_KEY) {
      lo -= hi - HIGHEST_KEY;
      hi = HIGHEST_KEY;
    }

    return normalizeRange(Math.max(LOWEST_KEY, lo), Math.min(HIGHEST_KEY, hi));
  });

  /**
   * Run shape. A lesson is a finite piece of music: the pattern plays
   * `totalLoops` times and then ends. `loopBeats` doubles as Ableton Link's
   * quantum, so loop boundaries line up with the session.
   */
  const loopBeats = computed(() => lesson.value.bars * lesson.value.beatsPerBar);
  const totalLoops = computed(() => lessonRepeats(lesson.value));
  /** The whole run in beats — what the overview strip spans. */
  const runBeats = computed(() => totalLoops.value * loopBeats.value);

  let transport = new Transport({
    bpm: bpm.value,
    bars: lesson.value.bars,
    beatsPerBar: lesson.value.beatsPerBar,
    totalLoops: totalLoops.value,
  });
  let scorer = new Scorer(targets.value);
  const advanceTracker = new AdvanceTracker();

  let renderer: LaneRenderer | null = null;
  let overview: Overview | null = null;
  /**
   * Rating per note instance for the whole run, keyed by the scorer's
   * `loop:target` id. The overview strip shows the entire run, so grades have
   * to survive past the repeat that earned them.
   */
  const runRatings = new Map<string, Rating>();
  let raf = 0;
  let lastLoop = -1;
  let popId = 0;
  const timers = new Set<number>();
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const timeOf = (loopIndex: number, beat: number) => transport.timeOf(loopIndex, beat);

  /**
   * The repeats worth having instances for right now, from the window the
   * renderer last drew. With no renderer (audio-only) it falls back to the
   * current repeat and the next, which is what this used to do unconditionally.
   */
  function loopSpan(absBeat: number) {
    const view = renderer?.visibleBeats();
    return visibleLoopSpan(absBeat, transport.loopBeats, view?.behind ?? 0, view?.ahead ?? 0);
  }

  /** Build the renderer matching the current lesson's instrument. */
  function buildRenderer(): void {
    const el = canvasEl.value;
    renderer = el ? (isPiano.value ? new PianoRoll(el) : new PadLanes(el)) : null;
    renderer?.resize();

    const oel = overviewEl?.value ?? null;
    overview = oel ? new Overview(oel) : null;
    overview?.resize();
  }

  /**
   * The idle preview's instances, rebuilt only when the lesson, the run length
   * or the lane's window actually changes. The list is stable and only the
   * times are rewritten each frame, so sitting on the lesson screen does not
   * allocate a fresh set of objects sixty times a second.
   */
  let previewCache: { key: string; list: NoteInstance[] } | null = null;

  function previewFrame(now: number): readonly NoteInstance[] {
    if (!renderer) return [];
    const ahead = renderer.visibleBeats().ahead || transport.loopBeats;
    const key = `${lesson.value.id}|${transport.loopBeats}|${transport.totalLoops}|${Math.ceil(ahead)}`;
    if (!previewCache || previewCache.key !== key) {
      previewCache = {
        key,
        list: previewInstances(
          targets.value,
          transport.loopBeats,
          transport.totalLoops,
          transport.secPerBeat,
          0,
          ahead,
        ),
      };
    }
    // Re-anchored to the clock each frame; also picks up a tempo change,
    // since `secPerBeat` is read here rather than baked into the list.
    const spb = transport.secPerBeat;
    const lb = transport.loopBeats;
    for (const i of previewCache.list) i.time = now + (i.loopIndex * lb + i.beat) * spb;
    return previewCache.list;
  }

  /** The frame handed to whichever renderer is active this tick. */
  function drawFrame(
    now: number,
    pos: { countIn: boolean; countInBeat: number; absBeat: number } | null,
  ): void {
    if (!renderer) return;
    renderer.resize();
    renderer.draw({
      now,
      secPerBeat: transport.secPerBeat,
      absBeat: pos?.absBeat ?? 0,
      beatsPerBar: transport.beatsPerBar,
      lessonName: lesson.value.name,
      playing: pos !== null,
      countIn: pos?.countIn ?? false,
      countInBeat: pos?.countInBeat ?? 0,
      countInBeats: transport.countInBeats,
      // Stopped, the lane previews the run parked at its first beat, so
      // opening a lesson shows what you are about to play rather than an
      // empty field. The scorer is not involved until the transport runs.
      instances: pos ? scorer.instances : previewFrame(now),
      reducedMotion,
      palette: palette.value,
      theme: settings.theme,
      orientation: settings.laneOrientation,
      padLanes: lanes.value,
      padLayout: settings.padLayout,
      lowNote: pianoRange.value[0],
      highNote: pianoRange.value[1],
    });
  }

  /** The strip above the lane: the whole run, and where the playhead is. */
  function drawOverview(runBeat: number | null): void {
    if (!overview) return;
    overview.resize();
    overview.draw({
      targets: targets.value,
      instrument: lesson.value.instrument,
      padLanes: lanes.value,
      lowNote: pianoRange.value[0],
      highNote: pianoRange.value[1],
      loopBeats: transport.loopBeats,
      totalLoops: transport.totalLoops,
      beatsPerBar: transport.beatsPerBar,
      runBeat,
      ratings: runRatings,
      // The renderer reports the window it just drew, so the overview's
      // viewport rectangle always matches what is actually on screen.
      view: runBeat === null ? null : (renderer?.visibleBeats() ?? null),
      palette: palette.value,
      theme: settings.theme,
    });
  }

  // ----------------------------------------------------------------- control

  /** Start a run. The caller must have initialized audio (user gesture). */
  function play(): void {
    runComplete.value = false;
    runResult.value = null;
    runRatings.clear();
    scorer = new Scorer(targets.value);
    advanceTracker.reset();
    transport = new Transport({
      bpm: bpm.value,
      bars: lesson.value.bars,
      beatsPerBar: lesson.value.beatsPerBar,
      totalLoops: totalLoops.value,
    });
    transport.start(audio.now);
    lastLoop = -1;
    accuracy.value = 100;
    combo.value = 0;
    bestCombo.value = 0;
    pops.value = [];
    playing.value = true;
  }

  function stop(): void {
    transport.stop();
    playing.value = false;
    // The click and the guide are queued ahead of the playhead; without this
    // they keep sounding for a beat or two after the transport has stopped.
    audio.cancelScheduled("metronome", "guide");
  }

  /**
   * Return to an idle, ready state for the current lesson. Called when the
   * lesson changes — from the library or from clearing one — so the tempo,
   * lanes, and HUD all reflect the new lesson before the next Play.
   */
  function resetForLesson(): void {
    runComplete.value = false;
    runResult.value = null;
    runRatings.clear();
    transport.stop();
    playing.value = false;
    audio.cancelScheduled("metronome", "guide");
    transport = new Transport({
      bpm: lesson.value.bpm,
      bars: lesson.value.bars,
      beatsPerBar: lesson.value.beatsPerBar,
      totalLoops: totalLoops.value,
    });
    scorer = new Scorer(targets.value);
    advanceTracker.reset();
    lastLoop = -1;
    bpm.value = lesson.value.bpm;
    accuracy.value = 100;
    combo.value = 0;
    bestCombo.value = 0;
    pops.value = [];
  }

  /** Manual tempo change (the slider). Keeps the playhead continuous. */
  function setBpm(v: number): void {
    bpm.value = v;
    if (playing.value) {
      transport.setBpm(v, audio.now);
      scorer.retime(timeOf);
    }
  }

  // ------------------------------------------------------------ Ableton Link

  /**
   * Link's clock is its own; map it onto the audio clock so a slow event
   * delivery can't skew the phase we align to. Separate from the MIDI mapper —
   * midir and Link aren't guaranteed to read the same underlying clock.
   */
  const linkClock = new HostClock();

  /**
   * Follow one Link snapshot: match Ableton's tempo, and slide our loop so its
   * boundary sits on Link's. Rust reports `phase` against a quantum of
   * `loopBeats`, so phase *is* our beat-in-loop as Ableton sees it — we only
   * have to close the gap.
   *
   * This is the whole of M6's transport work: the transport already re-anchors
   * on tempo change, and `anchorTo` handles the phase. Nothing here knows or
   * cares which instrument is on screen.
   */
  function followLink(s: LinkState): void {
    const now = audio.now;
    linkClock.sync(s.clockMicros, now);
    // The instant this snapshot describes, in audio-clock terms.
    const at = linkClock.toAudioTime(s.clockMicros, now);

    let moved = false;

    if (s.tempo > 0 && Math.abs(s.tempo - transport.bpm) > 0.01) {
      bpm.value = s.tempo;
      transport.setBpm(s.tempo, playing.value ? now : undefined);
      moved = true;
    }

    if (playing.value && transport.isPlaying) {
      const cur = transport.position(at).absBeat;
      const delta = phaseDelta(cur, s.phase, transport.loopBeats);
      if (Math.abs(delta) * transport.secPerBeat > LINK_DEADBAND) {
        transport.anchorTo(cur + delta, at);
        moved = true;
      }
    }

    // Note times are derived from the anchor, so they move with it.
    if (moved && playing.value) scorer.retime(timeOf);
  }


  // ------------------------------------------------------------------ input

  /**
   * Grade a strike on a lane — a pad index for pads, a MIDI pitch for piano.
   * `time` is the hit's audio-clock time; defaults to now (mouse/keyboard).
   * Hardware callers pass the converted midir timestamp. Returns the rating,
   * or null for strays/count-in/stopped.
   */
  function strike(lane: number, time?: number): Rating | null {
    if (!playing.value) return null;
    const now = audio.now;
    if (transport.position(now).countIn) return null;
    const res = scorer.hit(lane, time ?? now);
    if (!res) return null;
    noteTargetIndex(res.instance.id, res.rating);
    addPop(lane, res.rating);
    syncStats();
    return res.rating;
  }

  /**
   * Pad under a point on the lane canvas — the gutter rows in horizontal
   * mode, where the lane headers double as playable pads. Null otherwise.
   */
  function padAtPoint(x: number, y: number): number | null {
    if (isPiano.value || settings.laneOrientation !== "horizontal") return null;
    return renderer instanceof PadLanes ? renderer.laneAt(x, y) : null;
  }

  /** Audio-clock time of a hardware hit, from its midir timestamp. */
  function hardwareHitTime(stampMicros: number): number {
    midiClock.sync(stampMicros, audio.now);
    return midiClock.toAudioTime(stampMicros, audio.now);
  }

  // ------------------------------------------------------------------ frame

  function frame(): void {
    const now = audio.now;

    if (playing.value && transport.isPlaying) {
      const pos = transport.position(now);

      // schedule metronome clicks (count-in included) and the guide part.
      // The window always advances so toggling the click mid-run doesn't
      // replay beats that were skipped while it was off.
      const win = transport.advanceScheduler(now, LOOKAHEAD);
      if (win) {
        if (settings.metronome) {
          for (const c of transport.clicksIn(win.from, win.to)) {
            audio.click(transport.timeOfAbsBeat(c.absBeat), c.accent);
          }
        }
        if (guide.value) scheduleGuide(win.from, win.to);
      }

      // Spawn every repeat the lane can actually see, not a fixed two. The
      // pattern is usually one bar and the lane shows five, so "current and
      // next" left most of the track empty and notes popped into existence
      // mid-lane instead of scrolling in from the edge. Derived from the
      // renderer's own window so the two can't disagree.
      const span = loopSpan(pos.absBeat);
      for (let i = span.first; i <= span.last; i++) {
        if (i < transport.totalLoops) scorer.spawnLoop(i, timeOf);
      }

      if (!pos.countIn) {
        if (lastLoop >= 0 && pos.loopIndex > lastLoop) {
          // Close the repeat's tally and let go of notes that have scrolled
          // clear of the lane's trailing edge — never nearer than that, or
          // they would vanish while still on screen.
          scorer.endLoop();
          scorer.pruneBefore(span.first);
        }
        lastLoop = pos.loopIndex;
      }

      const missed = scorer.sweepMisses(now);
      if (missed.length > 0) {
        for (const m of missed) {
          noteTargetIndex(m.id, "miss");
          addPop(m.lane, "miss");
        }
        syncStats();
      }

      drawFrame(now, pos);
      drawOverview(pos.countIn ? null : pos.absBeat);

      // The run is over: grade whatever is left and come to rest.
      if (pos.finished) finishRun();
    } else {
      // Parked at the start: the strip shows the viewport rectangle over the
      // opening bars, which is exactly the slice the lane is previewing.
      drawFrame(now, null);
      drawOverview(0);
    }

    raf = requestAnimationFrame(frame);
  }

  /** A guide note for a lane: the drum voice for pads, the pitch for piano. */
  function guideVoice(lane: number, at: number): void {
    // Its own bus, so the guide can sit under your playing without dragging
    // your own hits down with it.
    if (isPiano.value) audio.playNote(lane, at, 0.4, 0.9, "guide");
    else audio.playDrum(PADS[lane].type, at, 0.45, "guide");
  }

  /** Play the target part quietly so the player can hear what to aim for. */
  function scheduleGuide(fromBeat: number, toBeat: number): void {
    const lb = transport.loopBeats;
    const firstLoop = Math.max(0, Math.floor(fromBeat / lb));
    const lastLoopIdx = Math.floor(toBeat / lb) + 1;
    for (let L = firstLoop; L <= lastLoopIdx; L++) {
      for (const t of targets.value) {
        const ab = L * lb + t.beat;
        if (ab >= Math.max(fromBeat, 0) && ab < toBeat) {
          guideVoice(t.lane, transport.timeOfAbsBeat(ab));
        }
      }
    }
  }

  /**
   * End of the run. A lesson is finite now, so this is where it is judged:
   * on the accuracy over the whole thing, not on a single repeat. Tempo stays
   * the player's to set — there is no adaptive ramp.
   */
  function finishRun(): void {
    // Anything still unresolved at the end is a miss.
    const missed = scorer.sweepMisses(audio.now + 1);
    for (const m of missed) noteTargetIndex(m.id, "miss");
    syncStats();

    const acc = scorer.accuracy;
    const previousBest = bestByLesson.get(lesson.value.id) ?? null;
    runResult.value = {
      accuracy: acc,
      bestCombo: scorer.bestCombo,
      previousBest,
      tally: { ...scorer.tally },
      lanes: scorer.laneStats(),
    };
    if (previousBest === null || acc > previousBest) bestByLesson.set(lesson.value.id, acc);

    transport.stop();
    playing.value = false;
    audio.cancelScheduled("metronome", "guide");
    runComplete.value = true;

    if (advanceTracker.update(acc, transport.bpm, lesson.value.bpm)) {
      // Clearing the lesson advances the library; the lesson-change watcher
      // resets the transport and HUD for the new lesson (stopped, ready).
      const next = lessons.advance();
      showToast(
        next
          ? `Lesson cleared at ${Math.round(acc * 100)}% → ${next.name}`
          : "Lesson cleared — that was the last one. Nice.",
      );
    } else {
      showToast(`Run complete — ${Math.round(acc * 100)}%`);
    }
  }

  // -------------------------------------------------------------- feedback

  /** Instance ids are `loopIndex:targetIndex`, which the overview keys on. */
  function noteTargetIndex(id: string, rating: Rating): void {
    runRatings.set(id, rating);
  }

  function syncStats(): void {
    accuracy.value = Math.round(scorer.accuracy * 100);
    combo.value = scorer.combo;
    bestCombo.value = scorer.bestCombo;
  }

  function addPop(lane: number, rating: Rating): void {
    const id = popId++;
    pops.value = [...pops.value, { id, lane, rating }];
    const t = window.setTimeout(() => {
      pops.value = pops.value.filter((p) => p.id !== id);
      timers.delete(t);
    }, 520);
    timers.add(t);
  }

  function showToast(msg: string): void {
    toast.value = msg;
    const t = window.setTimeout(() => {
      if (toast.value === msg) toast.value = null;
      timers.delete(t);
    }, 2600);
    timers.add(t);
  }

  // ------------------------------------------------------------- lifecycle

  // Switching lessons (library pick or a cleared-lesson advance) returns the
  // trainer to a ready state for the new lesson.
  watch(
    () => lesson.value.id,
    () => resetForLesson(),
  );

  // Rebuild the renderer when the canvas mounts/swaps or the instrument
  // changes (pads ↔ piano use different canvases and renderers).
  watch([canvasEl, overviewEl ?? ref(null), isPiano], () => buildRenderer());

  onMounted(() => {
    raf = requestAnimationFrame(frame);
  });

  onUnmounted(() => {
    cancelAnimationFrame(raf);
    for (const t of timers) window.clearTimeout(t);
    timers.clear();
  });

  return {
    lesson,
    playing,
    runComplete,
    runResult,
    bpm,
    bpmLabel,
    guide,
    accuracy,
    combo,
    bestCombo,
    toast,
    pops,
    lanes,
    isPiano,
    pianoRange,
    lessonPitches,
    totalLoops,
    loopBeats,
    runBeats,
    play,
    stop,
    setBpm,
    followLink,
    strike,
    padAtPoint,
    hardwareHitTime,
  };
}
