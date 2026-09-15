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
import { useHistory } from "@/stores/history";
import { useChords } from "@/stores/chords";
import type { HoldResult, LinkState, Rating } from "@/engine/types";
import {
  Transport,
  phaseDelta,
  START_DELAY,
  type StartGrid,
  type TransportPosition,
} from "@/engine/transport";
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
import { SheetStaff } from "@/views/sheet/SheetStaff";
import { useNotationFont } from "@/composables/useNotationFont";
import { engraveOnsets, handSplit, keySignatureFor } from "@/engine/notation";
import { chordsForLoop, diatonicTriad, hasHarmony } from "@/engine/harmony";
import {
  clampRegion,
  regionAt,
  regionBeats,
  regionTargets,
  runBeatOf,
  type LoopRegion,
} from "@/engine/loop-region";
import type { WrongMark } from "@/views/lane-geometry";
import { Overview, type LoopGrab } from "@/views/Overview";
import { normalizeRange } from "@/engine/pitch";

export interface RatingPop {
  id: number;
  lane: number;
  rating: Rating;
}

/**
 * How long a loop region is when the button is first pressed.
 *
 * Eight bars — long enough to be a passage rather than a lick, short enough to
 * go round often. Only a starting length; the strip is where it is set.
 */
const LOOP_BARS = 8;

/** How far ahead (seconds) clicks and guide notes are scheduled. */
const LOOKAHEAD = 1.0;

/**
 * Phase error we tolerate before re-anchoring to Link. Below this the drift is
 * inaudible, and correcting it every poll (~30 Hz) would jitter the playhead
 * for nothing.
 */
const LINK_DEADBAND = 0.003;

/**
 * How long a Link snapshot is worth starting against. They arrive at ~30 Hz, so
 * anything this old means the session has gone — Link switched off, or the last
 * peer left — and pressing Start should not pin beat 0 to a dead grid.
 */
const LINK_GRID_TTL = 0.5;

export function useTrainer(
  audio: AudioEngine,
  canvasEl: Ref<HTMLCanvasElement | null>,
  overviewEl?: Ref<HTMLCanvasElement | null>,
) {
  const settings = useSettings();
  const lessons = useLessons();
  const history = useHistory();
  const chords_ = useChords();
  /** The active lesson comes from the library store — one source of truth. */
  const lesson = computed(() => lessons.current);

  const playing = ref(false);
  const bpm = ref(lesson.value.bpm);
  /** Link tempos are fractional; the bar shows one decimal, as designed. */
  const bpmLabel = computed(() => Math.round(bpm.value * 10) / 10);
  /**
   * Whether the guide part sounds — its fader being up, and nothing else.
   *
   * This was a toggle in the bar beside a `CLICK` one, and both were gates on
   * scheduling audio and nothing more: neither touched the scorer, the frame
   * or the run. A fader at zero says the same thing, so the pair went and the
   * mixer took the job. Still gates the *scheduling* rather than letting notes
   * play into a silent bus — same result, no work done for nothing.
   */
  const guide = computed(() => settings.volGuide > 0);

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
    /** Sustain, counted separately — a second judgement on the same notes. */
    holds: Readonly<Record<HoldResult, number>>;
    /**
     * Strikes that hit nothing. Kept out of `tally` for the same reason holds
     * are: the tally answers how the lesson's notes went, and none of these
     * was one of them. It does count against `accuracy`.
     */
    wrong: number;
    /**
     * Every attempt at this lesson, oldest first, this run included — what
     * the summary's history chart draws.
     */
    attempts: readonly number[];
  } | null>(null);
  const accuracy = ref(100);
  const combo = ref(0);
  const bestCombo = ref(0);
  const toast = ref<string | null>(null);
  const pops = ref<RatingPop[]>([]);
  /**
   * Strikes that hit nothing, for the lane to dot where they landed.
   *
   * A plain array rather than a ref: it is read once a frame by the render
   * loop and never by a template, so making it reactive would re-run Vue for
   * something canvas is already drawing (invariant 6).
   */
  const wrongMarks: WrongMark[] = [];
  /** Handed to the lane when there is no run, so no frame allocates one. */
  const NO_MARKS: readonly WrongMark[] = [];

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
   * `totalLoops` times and then ends.
   */
  const loopBeats = computed(() => lesson.value.bars * lesson.value.beatsPerBar);

  /**
   * Ableton Link's quantum: one bar, the unit Ableton itself uses.
   *
   * It was the lesson's whole loop, which sounds tighter and is worse. Phase
   * against an 8-beat quantum only ever names every other bar of the session,
   * and *which* every-other is fixed by a session timeline neither app chose —
   * so a two-bar lesson sat on the wrong half of a four-bar set at even odds,
   * with nothing the player could do about it. A one-bar quantum names every
   * bar, which is what lets the press time choose.
   */
  const linkQuantum = computed(() => lesson.value.beatsPerBar);

  /**
   * What each onset is *worth* as notation, which is not what it is worth as a
   * hold. `lessonTargets` zeroes any duration under the hold floor, so reading
   * the figure off `duration` drew every quaver as a crotchet.
   */
  const noteValues = computed(() =>
    engraveOnsets(patternTargets.value, patternBeats.value),
  );
  /**
   * The key the lesson is written in, derived from its own pitches — imported
   * clips carry no key, and asking the player to name one before they can read
   * the staff would be a worse trade than getting it right from the notes.
   * Pads have no pitch, so there is nothing to derive and nothing that reads it.
   */
  /**
   * Where this lesson's hands divide on a grand staff. Off `lesson.notes`, so
   * it is the lesson's own answer and a loop region cannot move a note from
   * one staff to the other half way through a sitting.
   */
  const staffSplit = computed(() => (isPiano.value ? handSplit(lesson.value.notes) : 0));
  const derivedKey = computed(() =>
    isPiano.value ? keySignatureFor(targets.value.map((t) => t.lane)) : 0,
  );
  /**
   * The key everything reads from: the staff's signature, the degree labels
   * and the chord ribbon. Hand-set when the player has said otherwise —
   * degrees are meaningless without a key, and a clip that uses only part of
   * a scale honestly derives a smaller one (handoff 11 §1.5).
   */
  const keyFifths = computed(() =>
    isPiano.value && settings.keyOverride !== null ? settings.keyOverride : derivedKey.value,
  );
  /**
   * The harmony under the lesson, derived from its notes (handoff 11 §1.5).
   *
   * Only when degrees are on: the ribbon is the harmonic half of that reading
   * and means nothing beside letter names. Empty for pads, and empty when the
   * lesson yields no chords at all, which is the renderers' signal to draw no
   * strip rather than a row of empty blocks.
   */
  const chords = computed(() => {
    if (!isPiano.value || settings.noteLabel !== "degree") return [];
    // The lesson's own notes, not `targets`: the harmony is weighted by how
    // long a note is, and `lessonTargets` zeroes any length under the hold
    // floor. Reading it from there would make every melody a wash of equal
    // notes, which is exactly what the weighting exists to avoid.
    const notes = lesson.value.notes.map((n) => ({
      lane: n.pitch,
      beat: n.time,
      duration: n.duration ?? 0,
      written: n.duration ?? 0,
    }));
    // Looping, the ribbon describes the *region*, because that is the pattern
    // under the playhead. Reading the lesson's chords against a region that
    // starts anywhere but a pattern boundary would put every block a bar or
    // two out — the ribbon's own blocks are indexed from the playing pattern's
    // beat 0, not the lesson's.
    const r = region.value;
    const found = chordsForLoop(
      r
        ? regionTargets(notes, loopBeats.value, totalLoops.value, r, lesson.value.beatsPerBar)
            .targets
        : notes,
      lesson.value.beatsPerBar,
      patternBars.value,
      keyFifths.value,
    );
    // A bar named by hand replaces the derived one outright. Derivation from a
    // melody has a floor it cannot get under — two chords can be the same
    // pitch classes — and when it is wrong the player is the only one who
    // knows. The extras go: `V(add6)` is a reading of the notes, and once the
    // chord itself is disputed that reading is not evidence for anything.
    const overrides = chordOverrides.value;
    const named = found.map((c, bar) => {
      const degree = overrides[patternBarToLesson(bar)];
      if (degree === undefined) return c;
      return diatonicTriad(degree, keyFifths.value);
    });
    return hasHarmony(named) ? named : [];
  });

  /**
   * A bar of the playing pattern, as a bar of the *lesson's* pattern.
   *
   * An override is a fact about the material, so it is stored against the
   * lesson's own bar and has to survive being looked at through a region that
   * starts anywhere. With loop mode off the two are the same bar.
   */
  function patternBarToLesson(bar: number): number {
    const r = region.value;
    if (!r) return bar;
    const bars = Math.max(1, lesson.value.bars);
    return (r.fromBar + bar) % bars;
  }

  /** Bars this lesson has had named by hand, keyed by the lesson's own bar. */
  const lessonOverrides = computed(() => chords_.forLesson(lesson.value.id));

  /**
   * The same, re-keyed to the bars the ribbon is actually drawing, so a named
   * bar wears its dot wherever the region happens to start.
   */
  const chordOverrides = computed(() => {
    const src = lessonOverrides.value;
    if (!region.value) return src;
    const out: Record<number, number> = {};
    for (let bar = 0; bar < patternBars.value; bar++) {
      const degree = src[patternBarToLesson(bar)];
      if (degree !== undefined) out[bar] = degree;
    }
    return out;
  });
  const totalLoops = computed(() => lessonRepeats(lesson.value));
  /** The whole run in beats — what the overview strip spans. */
  const runBeats = computed(() => totalLoops.value * loopBeats.value);
  /** The run in bars — what the strip spans and what a region is placed in. */
  const runBars = computed(() => lesson.value.bars * totalLoops.value);

  /**
   * Looping a stretch of the run, to drill it.
   *
   * **Practice, not a run.** The region repeats until you stop: there is no
   * end, so no summary, nothing written to history and no clearing a lesson by
   * looping its easy eight bars. Accuracy and combo still move so you can see
   * how the pass went; they simply never get totted up into a result.
   *
   * Not persisted, and it needs no default position: pressing the button plants
   * the region at the playhead, so where it goes is decided fresh every time.
   */
  const loopOn = ref(false);
  const loopRegion = ref<LoopRegion>({ fromBar: 0, bars: LOOP_BARS });

  /** The region in force, kept inside the run, or null with loop mode off. */
  const region = computed(() =>
    loopOn.value ? clampRegion(loopRegion.value, runBars.value) : null,
  );

  /**
   * The region flattened into a pattern of its own, and the map back to the
   * run's own notes — which is what puts a rating on the right dot of a strip
   * that is still drawing the whole run.
   */
  const regionPattern = computed(() => {
    const r = region.value;
    return r
      ? regionTargets(
          targets.value,
          loopBeats.value,
          totalLoops.value,
          r,
          lesson.value.beatsPerBar,
        )
      : null;
  });

  /**
   * What the transport actually plays: the lesson's pattern, or the region
   * standing in for one. Everything that describes *the music under the
   * playhead* reads these — the engraved figures, the chord ribbon, the
   * scorer. Everything that describes *the whole run* keeps reading the
   * lesson's own, because the strip still draws all of it.
   */
  const patternTargets = computed(() => regionPattern.value?.targets ?? targets.value);
  const patternBars = computed(() => region.value?.bars ?? lesson.value.bars);
  const patternBeats = computed(() => patternBars.value * lesson.value.beatsPerBar);

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

  /**
   * Sheet mode is available, which is not the same as switched on.
   *
   * Piano only: handoff 10 draws a treble staff read by pitch and a keyboard
   * under it, and neither says anything about a drum pad. Six of the seven
   * built-ins are pads, so for most of the library the ROLL/SHEET pair is
   * simply not there — a percussion staff was never drawn and inventing one
   * is not the same as building this handoff.
   */
  const sheetAvailable = computed(() => isPiano.value);
  /** Canvas cannot wait for a webfont, so the staff holds until it is here. */
  const { ready: notationReady } = useNotationFont();
  /** The view actually in force, once availability is taken into account. */
  const sheetOn = computed(() => sheetAvailable.value && settings.laneMode === "sheet");

  /** Build the renderer matching the current lesson and view mode. */
  function buildRenderer(): void {
    const el = canvasEl.value;
    renderer = el
      ? sheetOn.value && notationReady.value
        ? new SheetStaff(el)
        : isPiano.value
          ? new PianoRoll(el)
          : new PadLanes(el)
      : null;
    renderer?.resize();

    const oel = overviewEl?.value ?? null;
    overview = oel ? new Overview(oel) : null;
    overview?.resize();
  }

  /**
   * Where the playhead sits while stopped: the first beat of the count-in, not
   * the first beat of the run. During a count-in the transport's `absBeat`
   * climbs from `-countInBeats` to 0, so parking there means pressing Start
   * changes nothing about where the notes are drawn — they simply begin to
   * move. Anchoring at 0 instead put the opening note under the playhead and
   * then threw it a bar to the right the moment the count-in began.
   */
  const idleAbsBeat = () =>
    -transport.countInBeats - START_DELAY / transport.secPerBeat;

  /**
   * The frame a stopped run is held on, or null when the lane is parked.
   *
   * Stopping pauses the picture where it is; **Start** is what returns to the
   * top of the exercise, count-in and all. So there are three states here, not
   * two: running, held, and parked — and the middle one is a stopped transport
   * that must still draw a moving run's last frame.
   *
   * The clock is stored with the position because every note's place on screen
   * derives from `now`: an instance carries an absolute audio time, and the
   * renderers draw it at `(inst.time - f.now) / secPerBeat` beats from the
   * playhead. Draw a held frame against the live clock and it scrolls away
   * exactly as if nothing had been stopped — which is the same trap the
   * wrong-note dots fell into, `now` advancing whether the transport does or
   * not.
   */
  let held: { now: number; pos: TransportPosition } | null = null;

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
    // The count-in occupies the first stretch of the visible window, so only
    // the remainder of it can hold run content.
    const runAhead = Math.max(0, ahead - transport.countInBeats);
    const key = `${lesson.value.id}|${transport.loopBeats}|${transport.totalLoops}|${Math.ceil(runAhead)}`;
    if (!previewCache || previewCache.key !== key) {
      previewCache = {
        key,
        list: previewInstances(
          targets.value,
          transport.loopBeats,
          transport.totalLoops,
          transport.secPerBeat,
          0,
          runAhead,
        ),
      };
    }
    // Re-anchored to the clock each frame; also picks up a tempo change,
    // since `secPerBeat` is read here rather than baked into the list.
    const spb = transport.secPerBeat;
    const lb = transport.loopBeats;
    const offset = -idleAbsBeat();
    for (const i of previewCache.list) {
      i.time = now + (offset + i.loopIndex * lb + i.beat) * spb;
      i.endTime = i.time + i.duration * spb;
    }
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
      absBeat: pos?.absBeat ?? idleAbsBeat(),
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
      colourMode: sheetOn.value ? settings.colourMode : "all",
      chordOverrides: chordOverrides.value,
      // A mark belongs to a run. Stopped, the lane is showing the lesson
      // parked at its first beat — there is nothing being played, so there is
      // nothing to have played wrongly. Gated on the same `pos` that decides
      // between live instances and the preview, so a stop path added later
      // cannot forget to do it: it is one question, asked once.
      wrongMarks: pos ? wrongMarks : NO_MARKS,
      keyFifths: keyFifths.value,
      labelMode: isPiano.value ? settings.noteLabel : "note",
      chords: chords.value,
      instrument: lesson.value.instrument,
      hueOrder: isPiano.value ? lessonPitches.value : lanes.value,
      staffSplit: staffSplit.value,
      padLanes: lanes.value,
      padLayout: settings.padLayout,
      lowNote: pianoRange.value[0],
      highNote: pianoRange.value[1],
      noteValues: noteValues.value,
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
      // The lesson's own run, never the transport's. Looping, the transport is
      // playing the region as its pattern and would describe a run eight bars
      // long that repeats for ever — and the strip's whole job here is to show
      // where in the *real* run that region sits.
      loopBeats: loopBeats.value,
      totalLoops: totalLoops.value,
      beatsPerBar: transport.beatsPerBar,
      runBeat,
      ratings: runRatings,
      // The renderer reports the window it just drew, so the overview's
      // viewport rectangle always matches what is actually on screen.
      view: runBeat === null ? null : (renderer?.visibleBeats() ?? null),
      loop: region.value
        ? {
            from: regionBeats(region.value, lesson.value.beatsPerBar).from,
            to: regionBeats(region.value, lesson.value.beatsPerBar).to,
          }
        : null,
      palette: palette.value,
      theme: settings.theme,
    });
  }

  /**
   * The playhead's beat in the *run*, for the strip.
   *
   * Looping, the transport counts passes of the region from its own beat 0, so
   * it has to be put back where it belongs before the strip can mark it.
   */
  function runBeatFor(absBeat: number): number {
    const r = region.value;
    return r ? runBeatOf(absBeat, r, lesson.value.beatsPerBar) : absBeat;
  }

  // ----------------------------------------------------------------- control

  /** Start a run. The caller must have initialized audio (user gesture). */
  function play(): void {
    // Start always returns to the top of the exercise, whatever was held.
    held = null;
    runComplete.value = false;
    runResult.value = null;
    runRatings.clear();
    wrongMarks.length = 0;
    scorer = new Scorer(patternTargets.value);
    advanceTracker.reset();
    transport = new Transport({
      bpm: bpm.value,
      bars: patternBars.value,
      beatsPerBar: lesson.value.beatsPerBar,
      // A region never ends, so the run never finishes: no summary, nothing
      // recorded, no lesson cleared by drilling its easy eight bars. That one
      // value is the whole of "practice, not a run" — `finishRun` is reached
      // from `pos.finished` and nowhere else.
      totalLoops: region.value ? Infinity : totalLoops.value,
    });
    const startedAt = audio.now;
    transport.start(startedAt, START_DELAY, startGrid(startedAt));
    lastLoop = -1;
    accuracy.value = 100;
    combo.value = 0;
    bestCombo.value = 0;
    pops.value = [];
    playing.value = true;
  }

  function stop(): void {
    // Read the position *before* stopping: a stopped transport reports beat 0,
    // which is the one answer this must not get.
    //
    // Nothing is held out of a count-in. It runs *before* the exercise, so
    // there is no place on the timeline to pause at — and a frozen countdown
    // sits there mid-ring still reading ESC TO STOP, which is an instruction
    // for a run that is no longer going. Parking is the honest picture there,
    // and it is what the lane already showed a moment earlier.
    const at = audio.now;
    const pos = playing.value && transport.isPlaying ? transport.position(at) : null;
    held = pos && !pos.countIn ? { now: at, pos } : null;
    transport.stop();
    playing.value = false;
    // The dots are **not** cleared here. They belong to the run, and the run
    // is being held rather than thrown away — so they stay for as long as the
    // frame they were struck in does. What keeps them off a parked lane is the
    // gate in `drawFrame`, which is the mechanism and always was; clearing at
    // each stop path is what shipped first and what missed this one.
    //
    // The click and the guide are queued ahead of the playhead; without this
    // they keep sounding for a beat or two after the transport has stopped.
    audio.cancelScheduled("metronome", "guide");
  }

  /**
   * The bar of the run under a point on the mini strip, or null before it has
   * drawn. Off the strip's own recorded geometry, like every other hit test
   * here — a pointer arrives between frames and has to be answered against the
   * picture actually on screen.
   */
  function stripBarAtPoint(x: number): number | null {
    const beat = overview?.beatAt(x) ?? null;
    return beat === null ? null : Math.floor(beat / lesson.value.beatsPerBar);
  }

  /** What a point on the strip would take hold of, region-wise. */
  function stripGrabAt(x: number): LoopGrab {
    return region.value ? (overview?.grabAt(x) ?? null) : null;
  }

  /**
   * Where the playhead is in the run right now, wherever it is standing.
   *
   * Running, held or parked — the three states the lane can be in, answered as
   * one beat so the loop button does not have to care which.
   */
  function playheadRunBeat(): number {
    if (playing.value && transport.isPlaying) {
      const pos = transport.position(audio.now);
      return pos.countIn ? runBeatFor(0) : runBeatFor(pos.absBeat);
    }
    if (held) return runBeatFor(held.pos.absBeat);
    return region.value ? runBeatFor(0) : 0;
  }

  /**
   * Turn looping on or off. On, the region is planted where the playhead is.
   *
   * **Restarts the run** when it is playing, count-in and all, rather than
   * slipping into the loop on the next pass. The region is played as a pattern
   * of its own by an ordinary transport and scorer — which is what keeps the
   * timing engine out of this entirely — and swapping the pattern under a
   * running transport is exactly the surgery that buys. The count-in is also a
   * fair warning that the music is about to jump somewhere else.
   */
  function setLoop(on: boolean): void {
    if (on === loopOn.value) return;
    if (on) {
      loopRegion.value = regionAt(
        playheadRunBeat(),
        lesson.value.beatsPerBar,
        LOOP_BARS,
        runBars.value,
      );
    }
    loopOn.value = on;
    restartIfPlaying();
  }

  /** Move or resize the region. Same restart rule as the toggle. */
  function setLoopRegion(next: LoopRegion, commit: boolean): void {
    loopRegion.value = clampRegion(next, runBars.value);
    if (commit) restartIfPlaying();
  }

  /**
   * Re-enter the run under whatever the loop is now.
   *
   * Only while playing: stopped, the next Start picks the change up anyway,
   * and a region dragged about on a held lane should leave the held frame
   * alone until it is asked to move.
   */
  function restartIfPlaying(): void {
    if (!playing.value) return;
    stop();
    held = null;
    play();
  }

  /**
   * Drop a held frame and show the lesson parked and ready.
   *
   * Leaving the trainer ends the hold: coming back to a lesson should show
   * what you are about to play, not a half-played lane from the last sitting.
   * `play` and a lesson change do the same thing on their own way there.
   */
  function park(): void {
    held = null;
  }

  /**
   * Return to an idle, ready state for the current lesson. Called when the
   * lesson changes — from the library or from clearing one — so the tempo,
   * lanes, and HUD all reflect the new lesson before the next Play.
   */
  function resetForLesson(): void {
    held = null;
    // A region is placed in *this* run's bars, so it means nothing in another
    // lesson's. Loop mode goes with it rather than pointing somewhere new.
    loopOn.value = false;
    runComplete.value = false;
    runResult.value = null;
    runRatings.clear();
    wrongMarks.length = 0;
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
   * The latest grid Link described, in audio-clock terms — what `play` pins
   * beat 0 to. Null until a snapshot arrives, and treated as gone once it is
   * older than `LINK_GRID_TTL`.
   */
  let linkGrid: StartGrid | null = null;

  /**
   * Follow one Link snapshot: match Ableton's tempo, and slide our playhead so
   * our bar lines sit on Link's. Rust reports `phase` against a quantum of one
   * bar — the same unit Ableton uses — so phase *is* our beat-in-bar as Ableton
   * sees it, and we only have to close the gap.
   *
   * Phase, and nothing else. It is derived from the session's own beat grid, so
   * aligning to it can never put us off the beat. The peer's *transport start*
   * is a tempting alternative — it is the one thing Link says about where their
   * loop begins — but `time_for_is_playing` is the time of an event, not of a
   * beat, so a transport started off the grid drags our whole loop off it too.
   * That was tried, and it cost the downbeat to buy a bar. Don't.
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
    linkGrid = { beat: s.phase, at };

    let moved = false;

    if (s.tempo > 0 && Math.abs(s.tempo - transport.bpm) > 0.01) {
      bpm.value = s.tempo;
      transport.setBpm(s.tempo, playing.value ? now : undefined);
      moved = true;
    }

    if (playing.value && transport.isPlaying) {
      const cur = transport.position(at).absBeat;
      const delta = phaseDelta(cur, s.phase, transport.beatsPerBar);
      if (Math.abs(delta) * transport.secPerBeat > LINK_DEADBAND) {
        transport.anchorTo(cur + delta, at);
        moved = true;
      }
    }

    // Note times are derived from the anchor, so they move with it.
    if (moved && playing.value) scorer.retime(timeOf);
  }

  /** The Link grid to start against, or undefined when there isn't a live one. */
  function startGrid(now: number): StartGrid | undefined {
    if (!linkGrid || now - linkGrid.at > LINK_GRID_TTL) return undefined;
    return linkGrid;
  }


  // ------------------------------------------------------------------ input

  /**
   * Grade a strike on a lane — a pad index for pads, a MIDI pitch for piano.
   * `time` is the hit's audio-clock time; defaults to now (mouse/keyboard).
   * Hardware callers pass the converted midir timestamp. Returns the rating,
   * `"wrong"` for a strike that was charged as one, or null when nothing was
   * scored — count-in, stopped, or a strike too far off to grade but near
   * enough a note to be an attempt at it. That last one still draws a dot.
   */
  function strike(lane: number, time?: number): Rating | "wrong" | null {
    if (!playing.value) return null;
    const now = audio.now;
    if (transport.position(now).countIn) return null;
    const at = time ?? now;
    const res = scorer.hit(lane, at);
    if (res.kind !== "hit") {
      // Both kinds get a dot, because both are a strike the player can see
      // they made. Only `wrong` is charged — an `ignored` one was near enough
      // a note to be an attempt at it, and that note's own miss is the
      // charge. The difference is a scoring rule, not something the eye needs
      // to be told: what it wants to know is *where* the strike landed, and
      // for an attempt that is the gap between the dot and the notehead it
      // sits beside — the timing error, drawn.
      wrongMarks.push({ lane, time: at });
      addPop(lane, "miss");
      if (res.kind === "ignored") return null;
      syncStats();
      return "wrong";
    }
    noteTargetIndex(res.instance.id, res.rating);
    addPop(lane, res.rating);
    syncStats();
    return res.rating;
  }

  /**
   * The player let go of a lane. Closes any hold open there and grades how
   * much of the written note they covered.
   *
   * Silent when nothing was open, which is the common case: every instant
   * note produces a release nobody is waiting for. Only a lesson that writes
   * durations has holds to close at all.
   */
  function release(lane: number, time?: number): void {
    if (!playing.value) return;
    const closed = scorer.release(lane, time ?? audio.now);
    // A dropped hold breaks the combo, so the bar has to hear about it.
    if (closed) syncStats();
  }

  /**
   * Pad under a point on the lane canvas — the gutter rows in horizontal
   * mode, where the lane headers double as playable pads. Null otherwise.
   */
  function padAtPoint(x: number, y: number): number | null {
    if (isPiano.value || settings.laneOrientation !== "horizontal") return null;
    return renderer instanceof PadLanes ? renderer.laneAt(x, y) : null;
  }

  /**
   * The loop bar of the chord block under a point on the lane canvas, or null.
   *
   * Off the renderer's own record of where it painted the ribbon, for the
   * reason `visibleBeats` is: the blocks scroll, so working the geometry out
   * again a frame later would name the wrong bar.
   */
  function chordBarAtPoint(x: number, y: number): number | null {
    return renderer?.ribbonBarAt(x, y) ?? null;
  }

  /** Name a bar's chord by hand, or pass null to hand it back to the notes. */
  function setChordOverride(bar: number, degree: number | null): void {
    chords_.setOverride(lesson.value.id, patternBarToLesson(bar), degree);
  }

  /** Audio-clock time of a hardware hit, from its midir timestamp. */
  function hardwareHitTime(stampMicros: number): number {
    return rawHitTime(stampMicros) - settings.latencyMs / 1000;
  }

  /**
   * The same conversion with the calibration offset left off — what the tap
   * test measures against, since applying the offset it is trying to find
   * would only ever report the residual.
   */
  function rawHitTime(stampMicros: number): number {
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
        if (settings.volMetronome > 0) {
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

      // Wrong-note dots scroll away with the music, so they are dropped once
      // they are past the lane's trailing edge — the same rule the notes get,
      // read off the renderer's own window so the two cannot disagree.
      if (wrongMarks.length > 0) {
        const behindSec =
          (renderer?.visibleBeats().behind ?? transport.loopBeats) * transport.secPerBeat;
        const cutoff = now - behindSec - 1;
        let keep = 0;
        for (const m of wrongMarks) if (m.time >= cutoff) wrongMarks[keep++] = m;
        wrongMarks.length = keep;
      }

      const missed = scorer.sweepMisses(now);
      if (missed.length > 0) {
        for (const m of missed) {
          noteTargetIndex(m.id, "miss");
          addPop(m.lane, "miss");
        }
        syncStats();
      }

      // Holds that have run to the end of their written note close themselves.
      // Overholding is not an error, so this is also what keeps a controller
      // that never sends note-off from scoring every hold as dropped.
      if (scorer.sweepHolds(now).length > 0) syncStats();

      drawFrame(now, pos);
      drawOverview(pos.countIn ? null : runBeatFor(pos.absBeat));

      // The run is over: grade whatever is left and come to rest.
      if (pos.finished) finishRun();
    } else if (held) {
      // Stopped part-way: the last frame of the run, drawn from the clock it
      // was stopped on rather than the live one, so it holds still instead of
      // scrolling on without a transport behind it.
      drawFrame(held.now, held.pos);
      // Never a count-in — `stop` refuses to hold one — so the strip always
      // has a beat to mark.
      drawOverview(runBeatFor(held.pos.absBeat));
    } else {
      // Parked one count-in before the run: the strip's rectangle is clamped
      // to the run, so it still covers exactly the slice of it the lane is
      // previewing — which now starts at beat 0 rather than behind it.
      drawFrame(now, null);
      drawOverview(region.value ? runBeatFor(0) : idleAbsBeat());
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
    // Anything still unresolved at the end is a miss, and anything still held
    // is judged with what we have rather than left ungraded.
    const missed = scorer.sweepMisses(audio.now + 1);
    for (const m of missed) noteTargetIndex(m.id, "miss");
    scorer.closeAllHolds(audio.now);
    syncStats();

    const acc = scorer.accuracy;
    // Read the previous best *before* recording, or this run would be its own
    // predecessor and nothing could ever be a new best.
    const previousBest = history.best(lesson.value.id);
    history.record(lesson.value.id, acc);
    runResult.value = {
      accuracy: acc,
      bestCombo: scorer.bestCombo,
      previousBest,
      tally: { ...scorer.tally },
      holds: { ...scorer.holdTally },
      wrong: scorer.wrongCount,
      attempts: [...history.attempts(lesson.value.id)],
    };

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
  /**
   * Record a rating against the note of the *run* it belongs to.
   *
   * An instance's id is `pass:index` into whatever pattern is playing. Looping,
   * that index is into the region's own list, so it is put back through
   * `sources` to reach the dot the strip is drawing. The pass is dropped on the
   * way: the strip shows one dot per note of the run, and the latest time
   * round is what it should be saying about it.
   */
  function noteTargetIndex(id: string, rating: Rating): void {
    const map = regionPattern.value;
    if (!map) {
      runRatings.set(id, rating);
      return;
    }
    const index = Number(id.slice(id.indexOf(":") + 1));
    const src = map.sources[index];
    if (src) runRatings.set(`${src.loopIndex}:${src.index}`, rating);
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

  // Rebuild the renderer when the canvas mounts/swaps, the instrument changes
  // (pads ↔ piano use different canvases and renderers), or the view mode does.
  watch([canvasEl, overviewEl ?? ref(null), isPiano, sheetOn, notationReady], () =>
    buildRenderer(),
  );

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
    accuracy,
    combo,
    bestCombo,
    toast,
    pops,
    isPiano,
    pianoRange,
    lessonPitches,
    totalLoops,
    loopBeats,
    linkQuantum,
    sheetAvailable,
    sheetOn,
    keyFifths,
    runBeats,
    play,
    stop,
    setBpm,
    followLink,
    strike,
    release,
    padAtPoint,
    park,
    loopOn,
    region,
    runBars,
    setLoop,
    setLoopRegion,
    stripBarAtPoint,
    stripGrabAt,
    chords,
    chordOverrides,
    chordBarAtPoint,
    setChordOverride,
    hardwareHitTime,
    rawHitTime,
  };
}
