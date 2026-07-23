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
import type { Rating } from "@/engine/types";
import { Transport } from "@/engine/transport";
import { Scorer, lessonTargets } from "@/engine/scoring";
import { nextTempo, AdvanceTracker, PUSH_ACC } from "@/engine/adaptive";
import { MidiClock } from "@/engine/midi-clock";
import { noteToPad, PADS } from "@/engine/gm";
import type { AudioEngine } from "@/engine/audio";
import { PadLanes } from "@/views/pads/PadLanes";
import { BUILTIN_LESSONS } from "@/data/lessons";

export interface RatingPop {
  id: number;
  lane: number;
  rating: Rating;
}

/** How far ahead (seconds) clicks and guide notes are scheduled. */
const LOOKAHEAD = 1.0;

export function useTrainer(audio: AudioEngine, canvasEl: Ref<HTMLCanvasElement | null>) {
  const settings = useSettings();
  const lesson = ref(BUILTIN_LESSONS[0]);

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

  const targets = computed(() => lessonTargets(lesson.value, noteToPad));
  /** Pad indices this lesson uses, in display order — the visible lanes. */
  const lanes = computed(() => [...new Set(targets.value.map((t) => t.lane))].sort((a, b) => a - b));

  let transport = new Transport({
    bpm: bpm.value,
    bars: lesson.value.bars,
    beatsPerBar: lesson.value.beatsPerBar,
  });
  let scorer = new Scorer(targets.value);
  const advance = new AdvanceTracker();

  let renderer: PadLanes | null = null;
  let raf = 0;
  let lastLoop = -1;
  let popId = 0;
  const timers = new Set<number>();
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const timeOf = (loopIndex: number, beat: number) => transport.timeOf(loopIndex, beat);

  // ----------------------------------------------------------------- control

  /** Start a run. The caller must have initialized audio (user gesture). */
  function play(): void {
    scorer = new Scorer(targets.value);
    advance.reset();
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
   * Grade a strike on a pad. `time` is the hit's audio-clock time; defaults
   * to now (mouse/keyboard). Hardware callers pass the converted midir
   * timestamp. Returns the rating, or null for strays/count-in/stopped.
   */
  function strike(pad: number, time?: number): Rating | null {
    if (!playing.value) return null;
    const now = audio.now;
    if (transport.position(now).countIn) return null;
    const res = scorer.hit(pad, time ?? now);
    if (!res) return null;
    addPop(pad, res.rating);
    syncStats();
    return res.rating;
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
          loopAcc.value = Math.round(acc * 100);
          onLoopEnd(acc, now);
          scorer.pruneBefore(pos.loopIndex);
        }
        lastLoop = pos.loopIndex;
      }

      const missed = scorer.sweepMisses(now);
      if (missed.length > 0) {
        for (const m of missed) addPop(m.lane, "miss");
        syncStats();
      }

      if (renderer) {
        renderer.resize();
        renderer.draw({
          now,
          secPerBeat: transport.secPerBeat,
          playing: true,
          countIn: pos.countIn,
          countInBeat: pos.countInBeat,
          countInBeats: transport.countInBeats,
          lanes: lanes.value,
          instances: scorer.instances,
          reducedMotion,
        });
      }
    } else if (renderer) {
      renderer.resize();
      renderer.draw({
        now,
        secPerBeat: transport.secPerBeat,
        playing: false,
        countIn: false,
        countInBeat: 0,
        countInBeats: transport.countInBeats,
        lanes: lanes.value,
        instances: [],
        reducedMotion,
      });
    }

    raf = requestAnimationFrame(frame);
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
          audio.playDrum(PADS[t.lane].type, transport.timeOfAbsBeat(ab), 0.45);
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
    if (advance.update(acc, transport.bpm, base)) {
      showToast("Lesson cleared! More lessons and the library land in M3.");
    }
  }

  // -------------------------------------------------------------- feedback

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

  watch(canvasEl, (el) => {
    renderer = el ? new PadLanes(el) : null;
    renderer?.resize();
  });

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
    play,
    stop,
    setBpm,
    strike,
    hardwareHitTime,
  };
}
