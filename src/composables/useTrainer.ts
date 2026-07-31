/**
 * The training session: owns the transport, scorer, and adaptive logic, and
 * drives the falling-note canvas from a single requestAnimationFrame loop.
 *
 * All timing reads `audio.now` (the AudioContext clock). Hardware hits are
 * converted from midir timestamps onto that clock via MidiClock before
 * grading — never graded at "whenever the Vue handler ran".
 */

import { computed, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { useSettings } from "@/stores/settings";
import { useLessons } from "@/stores/lessons";
import type { Rating } from "@/engine/types";
import { Transport } from "@/engine/transport";
import { Scorer, lessonTargets } from "@/engine/scoring";
import { nextTempo, AdvanceTracker, PUSH_ACC } from "@/engine/adaptive";
import { MidiClock } from "@/engine/midi-clock";
import { noteToPad, PADS } from "@/engine/gm";
import type { AudioEngine } from "@/engine/audio";
import type { LaneRenderer } from "@/views/lane-frame";
import { PadLanes } from "@/views/pads/PadLanes";
import { PianoRoll } from "@/views/piano/PianoRoll";
import { Overview } from "@/views/Overview";
import { normalizeRange } from "@/views/piano/mapping";

export interface RatingPop {
  id: number;
  lane: number;
  rating: Rating;
}

/** How far ahead (seconds) clicks and guide notes are scheduled. */
const LOOKAHEAD = 1.0;

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
  const autoAdapt = ref(true);
  const guide = ref(false);

  const accuracy = ref(100);
  const combo = ref(0);
  const bestCombo = ref(0);
  const phase = ref("Ready");
  const loopAcc = ref<number | null>(null);
  const toast = ref<string | null>(null);
  const pops = ref<RatingPop[]>([]);

  const midiClock = new MidiClock();

  const isPiano = computed(() => lesson.value.instrument === "piano");

  /**
   * Pitch → lane, the one thing that differs between the two views. For pads
   * a lane is a pad index; for piano it's the pitch itself (invariant 4 — the
   * scorer never knows which instrument it's grading).
   */
  function laneOf(pitch: number): number | null {
    return isPiano.value ? pitch : noteToPad(pitch);
  }

  const targets = computed(() => lessonTargets(lesson.value, laneOf));

  /** Pads: the pad indices this lesson uses, left-to-right. */
  const lanes = computed(() => [...new Set(targets.value.map((t) => t.lane))].sort((a, b) => a - b));

  /**
   * Piano: the visible key range. Covers the lesson's pitches with a little
   * padding, then widens symmetrically to at least three octaves so the
   * keyboard always reads as a real instrument rather than a few stray keys.
   */
  const MIN_PIANO_SPAN = 36; // semitones = 3 octaves
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
      lo = Math.min(...pitches) - 2;
      hi = Math.max(...pitches) + 2;
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

  let transport = new Transport({
    bpm: bpm.value,
    bars: lesson.value.bars,
    beatsPerBar: lesson.value.beatsPerBar,
  });
  let scorer = new Scorer(targets.value);
  const advanceTracker = new AdvanceTracker();

  let renderer: LaneRenderer | null = null;
  let overview: Overview | null = null;
  /** Rating per target index for the loop in progress, for the overview. */
  const loopRatings = new Map<number, Rating>();
  let raf = 0;
  let lastLoop = -1;
  let popId = 0;
  const timers = new Set<number>();
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const timeOf = (loopIndex: number, beat: number) => transport.timeOf(loopIndex, beat);

  /** Build the renderer matching the current lesson's instrument. */
  function buildRenderer(): void {
    const el = canvasEl.value;
    renderer = el ? (isPiano.value ? new PianoRoll(el) : new PadLanes(el)) : null;
    renderer?.resize();

    const oel = overviewEl?.value ?? null;
    overview = oel ? new Overview(oel) : null;
    overview?.resize();
  }

  /** The frame handed to whichever renderer is active this tick. */
  function drawFrame(now: number, pos: { countIn: boolean; countInBeat: number } | null): void {
    if (!renderer) return;
    renderer.resize();
    renderer.draw({
      now,
      secPerBeat: transport.secPerBeat,
      playing: pos !== null,
      countIn: pos?.countIn ?? false,
      countInBeat: pos?.countInBeat ?? 0,
      countInBeats: transport.countInBeats,
      instances: pos ? scorer.instances : [],
      reducedMotion,
      orientation: settings.laneOrientation,
      padLanes: lanes.value,
      padLayout: settings.padLayout,
      lowNote: pianoRange.value[0],
      highNote: pianoRange.value[1],
    });
  }

  /** The strip above the lane: the whole loop, and where the playhead is. */
  function drawOverview(beatInLoop: number | null): void {
    if (!overview) return;
    overview.resize();
    overview.draw({
      targets: targets.value,
      instrument: lesson.value.instrument,
      padLanes: lanes.value,
      lowNote: pianoRange.value[0],
      highNote: pianoRange.value[1],
      loopBeats: transport.loopBeats,
      beatInLoop,
      ratings: loopRatings,
    });
  }

  // ----------------------------------------------------------------- control

  /** Start a run. The caller must have initialized audio (user gesture). */
  function play(): void {
    loopRatings.clear();
    scorer = new Scorer(targets.value);
    advanceTracker.reset();
    transport = new Transport({
      bpm: bpm.value,
      bars: lesson.value.bars,
      beatsPerBar: lesson.value.beatsPerBar,
    });
    transport.start(audio.now);
    lastLoop = -1;
    accuracy.value = 100;
    combo.value = 0;
    bestCombo.value = 0;
    loopAcc.value = null;
    pops.value = [];
    phase.value = "Count-in";
    playing.value = true;
  }

  function stop(): void {
    transport.stop();
    playing.value = false;
    phase.value = "Ready";
  }

  /**
   * Return to an idle, ready state for the current lesson. Called when the
   * lesson changes — from the library or from clearing one — so the tempo,
   * lanes, and HUD all reflect the new lesson before the next Play.
   */
  function resetForLesson(): void {
    loopRatings.clear();
    transport.stop();
    playing.value = false;
    transport = new Transport({
      bpm: lesson.value.bpm,
      bars: lesson.value.bars,
      beatsPerBar: lesson.value.beatsPerBar,
    });
    scorer = new Scorer(targets.value);
    advanceTracker.reset();
    lastLoop = -1;
    bpm.value = lesson.value.bpm;
    accuracy.value = 100;
    combo.value = 0;
    bestCombo.value = 0;
    loopAcc.value = null;
    pops.value = [];
    phase.value = "Ready";
  }

  /** Manual tempo change (the slider). Keeps the playhead continuous. */
  function setBpm(v: number): void {
    bpm.value = v;
    if (playing.value) {
      transport.setBpm(v, audio.now);
      scorer.retime(timeOf);
    }
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

      // keep the current and next loop's notes alive (visible through count-in)
      scorer.spawnLoop(pos.loopIndex, timeOf);
      scorer.spawnLoop(pos.loopIndex + 1, timeOf);

      if (!pos.countIn) {
        if (phase.value === "Count-in") phase.value = "Playing";
        if (lastLoop >= 0 && pos.loopIndex > lastLoop) {
          const acc = scorer.endLoop();
          loopRatings.clear();
          loopAcc.value = Math.round(acc * 100);
          onLoopEnd(acc, now);
          // Keep the previous loop's notes alive: they're still scrolling
          // through the "already played" zone below the hit line.
          scorer.pruneBefore(pos.loopIndex - 1);
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
      drawOverview(pos.countIn ? null : pos.beatInLoop);
    } else {
      drawFrame(now, null);
      drawOverview(null);
    }

    raf = requestAnimationFrame(frame);
  }

  /** A guide note for a lane: the drum voice for pads, the pitch for piano. */
  function guideVoice(lane: number, at: number): void {
    if (isPiano.value) audio.playNote(lane, at, 0.4);
    else audio.playDrum(PADS[lane].type, at, 0.45);
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

  /** Loop boundary: adaptive tempo, then check for lesson advancement. */
  function onLoopEnd(acc: number, now: number): void {
    if (!autoAdapt.value) return;
    const base = lesson.value.bpm;
    const nb = nextTempo(base, transport.bpm, acc);
    if (nb !== transport.bpm) {
      transport.setBpm(nb, now);
      scorer.retime(timeOf);
      bpm.value = nb;
      showToast(acc >= PUSH_ACC ? `Nice — nudging up to ${nb} BPM` : `Easing back to ${nb} BPM`);
    }
    if (advanceTracker.update(acc, transport.bpm, base)) {
      // Clearing the lesson advances the library; the lesson-change watcher
      // resets the transport and HUD for the new lesson (stopped, ready).
      const next = lessons.advance();
      showToast(
        next
          ? `Lesson cleared! → ${next.name}`
          : "Lesson cleared — that was the last one. Nice.",
      );
    }
  }

  // -------------------------------------------------------------- feedback

  /** Instance ids are `loopIndex:targetIndex`, which the overview keys on. */
  function noteTargetIndex(id: string, rating: Rating): void {
    const idx = Number(id.split(":")[1]);
    if (!Number.isNaN(idx)) loopRatings.set(idx, rating);
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
    bpm,
    autoAdapt,
    guide,
    accuracy,
    combo,
    bestCombo,
    phase,
    loopAcc,
    toast,
    pops,
    lanes,
    isPiano,
    pianoRange,
    play,
    stop,
    setBpm,
    strike,
    padAtPoint,
    hardwareHitTime,
  };
}
