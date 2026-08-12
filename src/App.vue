<script setup lang="ts">
/**
 * The app shell. Two screens — pick a lesson (HomeScreen), or practise it —
 * with a single transport bar that doubles as the macOS titlebar.
 *
 * One engine, two views: `useTrainer` owns the transport, scorer and canvas
 * loop for both pads and piano. Hardware, computer-keyboard and mouse hits all
 * route through the same scorer; hardware hits are graded at their midir
 * timestamp mapped onto the audio clock, never at handler time.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useSettings, type PadLayout } from "@/stores/settings";
import { useLessons } from "@/stores/lessons";
import { useMidi } from "@/composables/useMidi";
import { useLink } from "@/composables/useLink";
import { useTrainer } from "@/composables/useTrainer";
import { AudioEngine, type Bus } from "@/engine/audio";
import { PADS, PAD_KEY_MAP, PIANO_KEY_MAP, noteToPad } from "@/engine/gm";
import { parseMidiFile, midiToLesson, type ParsedMidi } from "@/engine/midi-file";
import type { MidiMessage, InstrumentType } from "@/engine/types";

import DeviceMenu from "@/components/DeviceMenu.vue";
import MidiMonitor from "@/components/MidiMonitor.vue";
import HomeScreen from "@/components/HomeScreen.vue";
import ImportDialog from "@/components/ImportDialog.vue";
import RunSummary from "@/components/RunSummary.vue";
import type { LogRow } from "@/components/midi-log";
import PianoKeyboard from "@/views/piano/PianoKeyboard.vue";

const settings = useSettings();
const lessons = useLessons();
const audio = new AudioEngine();

/**
 * Two screens: pick a lesson, or practise it. The trainer has no lesson
 * header of its own — the X in the transport bar comes back here.
 */
const view = ref<"home" | "trainer">("home");

function openLesson(index: number) {
  lessons.selectIndex(index);
  view.value = "trainer";
}

function goHome() {
  if (playing.value) stop();
  view.value = "home";
}

// ------------------------------------------------------------- MIDI import
// The parsed clip is kept and re-projected whenever the chosen instrument
// changes, so the preview updates live between Pads and Piano.
const fileInput = ref<HTMLInputElement | null>(null);
const importOpen = ref(false);
const importFileName = ref("");
const importError = ref<string | null>(null);
const importParsed = ref<ParsedMidi | null>(null);
const importInstrument = ref<InstrumentType>("pads");
/** Reassignments made in the dialog's mapping table, by source pitch. */
const importPadOverrides = ref<Record<number, number>>({});

const importResult = computed(() => {
  if (!importParsed.value) return null;
  try {
    return midiToLesson(importParsed.value, importFileName.value, {
      instrument: importInstrument.value,
      padOverrides: importPadOverrides.value,
    });
  } catch {
    return null;
  }
});
const importAnalysis = computed(() => importResult.value?.analysis ?? null);

function openImport() {
  fileInput.value?.click();
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // allow re-picking the same file
  if (!file) return;

  importFileName.value = file.name;
  importError.value = null;
  importParsed.value = null;
  importPadOverrides.value = {};
  try {
    const parsed = parseMidiFile(await file.arrayBuffer());
    // Seed the instrument toggle from auto-detection; the user can override.
    importInstrument.value = midiToLesson(parsed, file.name).analysis.instrument;
    importParsed.value = parsed;
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  }
  importOpen.value = true;
}

function confirmImport(payload: { name: string; bpm: number }) {
  const built = importResult.value;
  if (built) lessons.addLesson({ ...built.lesson, name: payload.name, bpm: payload.bpm });
  closeImport();
}

function closeImport() {
  importOpen.value = false;
  importParsed.value = null;
  importError.value = null;
  importPadOverrides.value = {};
}

const audioReady = ref(false);
const activePads = ref<Map<number, number>>(new Map());
const activeNotes = ref<Map<number, number>>(new Map());
const log = ref<LogRow[]>([]);

const laneCanvas = ref<HTMLCanvasElement | null>(null);
const overviewCanvas = ref<HTMLCanvasElement | null>(null);
const {
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
  lanes: trainerLanes,
  isPiano,
  pianoRange,
  lessonPitches,
  totalLoops,
  loopBeats,
  play,
  stop,
  setBpm,
  followLink,
  strike,
  release,
  padAtPoint,
  hardwareHitTime,
} = useTrainer(audio, laneCanvas, overviewCanvas);

// ------------------------------------------------------------ Ableton Link
// Link shares tempo and phase with Ableton; the trainer's loop rides its grid.
// `loopBeats` is the quantum, so our loop boundary is one Ableton agrees on.
const {
  available: linkAvailable,
  enabled: linkOn,
  peers: linkPeers,
  probe: probeLink,
  setEnabled: setLinkEnabled,
  proposeTempo: proposeLinkTempo,
} = useLink(followLink);

function toggleLink() {
  void setLinkEnabled(!linkOn.value, loopBeats.value);
}

// A different lesson can mean a different loop length — re-agree the quantum.
watch(loopBeats, (q) => {
  if (linkOn.value) void setLinkEnabled(true, q);
});

let logId = 0;
let lastLogTime = 0;
const MAX_LOG = 60;

// ---------------------------------------------------------------- audio init

/** Browsers require a gesture before audio can start. */
async function ensureAudio() {
  if (audioReady.value) return;
  await audio.init();
  audioReady.value = audio.ready;
}

async function onPlay() {
  await ensureAudio();
  play();
}

/** In horizontal pads mode the lane headers are the playable pads. */
function onLanePointer(e: PointerEvent) {
  const el = e.currentTarget as HTMLCanvasElement;
  const r = el.getBoundingClientRect();
  const pad = padAtPoint(e.clientX - r.left, e.clientY - r.top);
  if (pad !== null) {
    e.preventDefault();
    void triggerPad(pad, 110, "click");
  }
}

// ------------------------------------------------------------------- tempo
// The design replaces the slider with a recessed readout you drag: a compact
// control that still gives fine adjustment, which a 54px slider could not.
const TEMPO_MIN = 50;
const TEMPO_MAX = 160;
/** Pixels of vertical drag per BPM. Up is faster. */
const TEMPO_PX_PER_BPM = 3;

function applyTempo(v: number) {
  const clamped = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(v * 10) / 10));
  setBpm(clamped);
  // Linked, the readout drives the session too; Link's next snapshot confirms it.
  void proposeLinkTempo(clamped);
}

/**
 * How far the pointer may wander before a press counts as a drag rather than
 * a click. Also stops a one-pixel tremor on mousedown from nudging the tempo.
 */
const TEMPO_DRAG_SLOP = 3;

const tempoEditing = ref(false);
const tempoDraft = ref("");
const tempoInput = ref<HTMLInputElement | null>(null);

/** Click the readout to type a tempo outright, instead of dragging to it. */
function beginTempoEdit() {
  tempoDraft.value = bpmLabel.value.toFixed(1);
  tempoEditing.value = true;
  void nextTick(() => {
    tempoInput.value?.focus();
    tempoInput.value?.select();
  });
}

function commitTempoEdit() {
  if (!tempoEditing.value) return;
  tempoEditing.value = false;
  // Accept a comma decimal, and a bare "120" as readily as "120.0".
  const v = Number.parseFloat(tempoDraft.value.replace(",", "."));
  if (Number.isFinite(v)) applyTempo(v);
}

function cancelTempoEdit() {
  tempoEditing.value = false;
}

function onTempoDragStart(e: PointerEvent) {
  if (tempoEditing.value) return;
  const el = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startY = e.clientY;
  const startBpm = bpm.value;
  let dragging = false;
  el.setPointerCapture(e.pointerId);

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      const moved = Math.abs(ev.clientY - startY) + Math.abs(ev.clientX - startX);
      if (moved <= TEMPO_DRAG_SLOP) return;
      dragging = true;
    }
    applyTempo(startBpm + (startY - ev.clientY) / TEMPO_PX_PER_BPM);
  };
  const up = (ev: PointerEvent) => {
    el.releasePointerCapture(ev.pointerId);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    // A press that never turned into a drag is a click: open the field.
    if (!dragging && ev.type === "pointerup") beginTempoEdit();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/** Keyboard equivalent, so the control isn't mouse-only. */
function onTempoKey(e: KeyboardEvent) {
  // While typing, the arrows belong to the caret.
  if (tempoEditing.value) return;
  if (e.key === "Enter" || e.key === " ") {
    beginTempoEdit();
    e.preventDefault();
    return;
  }
  const step = e.shiftKey ? 0.1 : 1;
  if (e.key === "ArrowUp" || e.key === "ArrowRight") applyTempo(bpm.value + step);
  else if (e.key === "ArrowDown" || e.key === "ArrowLeft") applyTempo(bpm.value - step);
  else return;
  e.preventDefault();
}

// ------------------------------------------------------------------ logging

function pushLog(
  kind: string,
  note: number,
  velocity: number,
  channel: number,
  source: LogRow["source"],
) {
  const now = performance.now();
  const delta = lastLogTime ? Math.round(now - lastLogTime) : 0;
  lastLogTime = now;
  log.value = [
    { id: logId++, kind, note, velocity, channel, delta, source },
    ...log.value,
  ].slice(0, MAX_LOG);
}

// ----------------------------------------------------------------- triggers

function flashPad(index: number, velocity: number) {
  const next = new Map(activePads.value);
  next.set(index, velocity);
  activePads.value = next;
  window.setTimeout(() => {
    const m = new Map(activePads.value);
    m.delete(index);
    activePads.value = m;
  }, 110);
}

/**
 * A pad strike from any source: sound + flash, then the scorer grades it.
 * `hitTime` is the audio-clock hit time; omitted for mouse/keyboard, where
 * "now" is the best estimate we have.
 *
 * In external-sound mode the synth stays silent — the controller is routed
 * through the DAW (Ableton), which makes the sound; we only track it.
 */
async function triggerPad(
  index: number,
  velocity = 110,
  source: LogRow["source"] = "click",
  hitTime?: number,
) {
  await ensureAudio();
  const pad = PADS[index];
  if (!pad) return;
  if (settings.soundOutput === "internal") {
    audio.playDrum(pad.type, undefined, Math.max(0.25, velocity / 127));
  }
  flashPad(index, velocity);
  if (source !== "hardware") pushLog("noteon", pad.outNote, velocity, 9, source);
  strike(index, hitTime);
}

async function noteOn(
  midi: number,
  velocity = 100,
  source: LogRow["source"] = "click",
  hitTime?: number,
) {
  await ensureAudio();
  if (settings.soundOutput === "internal") {
    audio.playNote(midi, undefined, Math.max(0.25, velocity / 127));
  }
  const next = new Map(activeNotes.value);
  next.set(midi, velocity);
  activeNotes.value = next;
  if (source !== "hardware") pushLog("noteon", midi, velocity, 0, source);
  // For a piano lesson the lane is the pitch; a no-op otherwise.
  strike(midi, hitTime);
}

/**
 * Letting go of a key. `releaseTime` is the audio-clock moment it happened —
 * a hardware note-off carries its own midir timestamp, the same as a strike.
 *
 * The scorer is told even when the key was never lit, because the two can
 * disagree: `activeNotes` is cleared when the view changes, and a hold does
 * not care whether the keyboard is still drawing the key down.
 */
function noteOff(midi: number, releaseTime?: number) {
  // The same pitch→lane mapping the strike used, so a hold closes on the lane
  // it was opened on rather than on the raw pitch.
  const pad = noteToPad(midi);
  release(pad !== null && settings.instrument === "pads" ? pad : midi, releaseTime);
  if (!activeNotes.value.has(midi)) return;
  const next = new Map(activeNotes.value);
  next.delete(midi);
  activeNotes.value = next;
}

// -------------------------------------------------------------- MIDI bridge

/** Hardware input. Scoring uses `m.timestampMicros`, not handler time. */
function onMidiMessage(m: MidiMessage) {
  pushLog(m.kind, m.note, m.velocity, m.channel, "hardware");

  if (m.kind === "noteon") {
    const hitTime = hardwareHitTime(m.timestampMicros);
    const pad = noteToPad(m.note);
    // Drum notes light the grid; everything else is treated as pitched.
    if (pad !== null && settings.instrument === "pads") {
      void triggerPad(pad, m.velocity, "hardware", hitTime);
    } else {
      void noteOn(m.note, m.velocity, "hardware", hitTime);
    }
  } else if (m.kind === "noteoff") {
    // Graded at the timestamp midir stamped it with, like a strike — a hold
    // measured at "whenever the handler ran" would inherit every delivery
    // hiccup between the controller and here.
    noteOff(m.note, hardwareHitTime(m.timestampMicros));
  }
}

const {
  ports,
  connectedIndex,
  connectedName,
  error: midiError,
  busy: midiBusy,
  refreshPorts,
  connect,
  disconnect,
} = useMidi(onMidiMessage);

// ------------------------------------------------------- computer keyboard

const heldKeys = new Set<string>();

/**
 * Whether a Space keystroke is the transport's to take. Anything already
 * focused that does something with Space keeps it: a text field, a button
 * (Space activates it), and the tempo readout (Space opens it for typing).
 * Otherwise Space belongs to the transport, the way it does in a DAW.
 */
function spaceIsTransport(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return true;
  if (el.isContentEditable) return false;
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) return false;
  return el.getAttribute("role") !== "slider";
}

function onKeyDown(e: KeyboardEvent) {
  // Escape closes whichever bar menu is open, then stops the run.
  if (e.key === "Escape" && openMenu.value) {
    openMenu.value = null;
    return;
  }
  if (e.key === "Escape" && playing.value) {
    stop();
    return;
  }
  // Space starts and stops the run. Held down it must still swallow the key,
  // or the page scrolls under the lane — but it only toggles on the first
  // press. Not while the import sheet is up: it owns the screen.
  if (
    e.key === " " &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    view.value === "trainer" &&
    !importOpen.value &&
    spaceIsTransport(e)
  ) {
    e.preventDefault();
    if (!e.repeat) {
      if (playing.value) stop();
      else void onPlay();
    }
    return;
  }

  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (heldKeys.has(key)) return;

  if (settings.instrument === "pads") {
    const pad = PAD_KEY_MAP[key];
    if (pad !== undefined) {
      e.preventDefault();
      heldKeys.add(key);
      void triggerPad(pad, 110, "keyboard");
    }
  } else {
    const midiNote = PIANO_KEY_MAP[key];
    if (midiNote !== undefined) {
      e.preventDefault();
      heldKeys.add(key);
      void noteOn(midiNote, 100, "keyboard");
    }
  }
}

function onKeyUp(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  heldKeys.delete(key);
  const midiNote = PIANO_KEY_MAP[key];
  if (settings.instrument === "piano" && midiNote !== undefined) noteOff(midiNote);
}

// ------------------------------------------------------------------- theme
// The palette lives in CSS custom properties keyed off `data-theme` on <html>;
// the canvas renderers get the same values as data via `engine/theme.ts`.
watch(
  () => settings.theme,
  (t) => {
    document.documentElement.dataset.theme = t;
  },
  { immediate: true },
);

// ------------------------------------------------------------------ mounted

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("pointerdown", onPadMenuPointer);
  void refreshPorts();
  void probeLink();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  document.removeEventListener("pointerdown", onPadMenuPointer);
});

// -------------------------------------------------------------------- misc

const padLayouts: Array<{ id: PadLayout; label: string; hint: string }> = [
  { id: "4x4", label: "4×4", hint: "MPC-style grid" },
  { id: "2x8", label: "2×8", hint: "Launchkey, two rows" },
];

/**
 * Only one bar menu is ever open — they overlap each other and the lane, and
 * two open at once reads as a mistake. The bar lifts above the stage while
 * any of them is showing so the panel isn't clipped by the lane canvas.
 */
type BarMenu = "pad" | "device" | "volume" | null;
const openMenu = ref<BarMenu>(null);
const padMenuOpen = computed(() => openMenu.value === "pad");
const volMenuOpen = computed(() => openMenu.value === "volume");
const padMenuRoot = ref<HTMLElement | null>(null);
const volMenuRoot = ref<HTMLElement | null>(null);

function toggleMenu(which: Exclude<BarMenu, null>) {
  openMenu.value = openMenu.value === which ? null : which;
}

function togglePadMenu() {
  toggleMenu("pad");
  // Opening the layout menu implies you're working with the pads.
  if (padMenuOpen.value && settings.instrument !== "pads") setMode("pads");
}

function pickPadLayout(id: PadLayout) {
  settings.padLayout = id;
  openMenu.value = null;
}

function onPadMenuPointer(e: PointerEvent) {
  const t = e.target as Node;
  if (padMenuOpen.value && padMenuRoot.value && !padMenuRoot.value.contains(t)) openMenu.value = null;
  if (volMenuOpen.value && volMenuRoot.value && !volMenuRoot.value.contains(t)) openMenu.value = null;
}

/**
 * The view follows the *lesson's* instrument. Switching mode jumps to the
 * first lesson of that instrument; the watch below then syncs the view.
 */
function setMode(m: InstrumentType) {
  if (lessons.current.instrument === m) return;
  const idx = lessons.lessons.findIndex((l) => l.instrument === m);
  if (idx >= 0) lessons.selectIndex(idx);
}

// Keep the active view in step with the current lesson's instrument, and clear
// any lit pads/keys when it changes.
watch(
  () => lessons.current.instrument,
  (inst) => {
    if (settings.instrument !== inst) settings.setInstrument(inst);
    activePads.value = new Map();
    activeNotes.value = new Map();
  },
  { immediate: true },
);

/**
 * The three faders, in the order they appear in the popover: what you play,
 * the part playing along with you, then the click.
 */
const MIXER: ReadonlyArray<{ bus: Bus; key: "volNotes" | "volGuide" | "volMetronome"; label: string }> = [
  { bus: "notes", key: "volNotes", label: "YOUR NOTES" },
  { bus: "guide", key: "volGuide", label: "GUIDE NOTES" },
  { bus: "metronome", key: "volMetronome", label: "METRONOME" },
];

function setBusVolume(row: (typeof MIXER)[number], e: Event) {
  const v = Number((e.target as HTMLInputElement).value) / 100;
  settings[row.key] = v;
  audio.setBusVolume(row.bus, v);
}

/** The icon reads the loudest fader, and shows muted only when all are down. */
const loudestBus = computed(() =>
  Math.max(settings.volNotes, settings.volGuide, settings.volMetronome),
);

// Push the stored levels into the engine — before `init` they are held and
// applied when the context opens, so hydration order does not matter.
watch(
  () => [settings.volNotes, settings.volGuide, settings.volMetronome] as const,
  ([n, g, m]) => {
    audio.setBusVolume("notes", n);
    audio.setBusVolume("guide", g);
    audio.setBusVolume("metronome", m);
  },
  { immediate: true },
);

</script>

<template>
  <div class="app">
    <!-- ===================== transport (window titlebar) =====================
         34px, every control 20px tall. Also the macOS titlebar: the 72px left
         inset clears the traffic lights.

         `data-tauri-drag-region="deep"` makes the whole subtree draggable, and
         Tauri's shim walks up from whatever was clicked and stops at the first
         interactive element — a button, an input, anything with a tabindex or
         an interactive role — so every control here opts out on its own. The
         bare attribute would only catch direct hits on the header itself,
         which at this density is the gaps and the left inset and nothing else:
         with all 21 controls showing, the spacers collapse to zero and there
         is effectively nowhere left to grab.

         Dropdowns hang off the bar in the DOM, so they carry ="false" to stop
         a drag starting on their non-button chrome.

         One row, all controls, down to ~1100px — below that things drop out in
         the order the design specifies (see `.app` media queries at the bottom
         of this file). -->
    <header class="bar" :class="{ 'menu-open': openMenu !== null }" data-tauri-drag-region="deep">
      <template v-if="view === 'trainer'">
        <button class="ico" title="Back to lessons" aria-label="Back to lessons" @click="goHome">
          ✕
        </button>

        <button
          class="transport"
          :class="playing ? 'is-stop' : 'is-start'"
          @click="playing ? stop() : onPlay()"
        >
          <i class="tglyph" :class="playing ? 'sq' : 'tri'" aria-hidden="true" />
          <span>{{ playing ? "STOP" : "START" }}</span>
        </button>

        <i class="divider" />

        <!-- Drag up/down to scrub the tempo, click to type one, arrows step. -->
        <div
          class="field tempo"
          :class="{ editing: tempoEditing }"
          role="slider"
          tabindex="0"
          :aria-valuenow="bpmLabel"
          aria-valuemin="50"
          aria-valuemax="160"
          aria-label="Tempo"
          :title="`Tempo — ${bpmLabel} BPM. Click to type, drag to scrub.`"
          @pointerdown="onTempoDragStart"
          @keydown="onTempoKey"
        >
          <input
            v-if="tempoEditing"
            ref="tempoInput"
            v-model="tempoDraft"
            class="num tempo-val tempo-input"
            type="text"
            inputmode="decimal"
            aria-label="Tempo in BPM"
            @keydown.enter.prevent.stop="commitTempoEdit"
            @keydown.esc.prevent.stop="cancelTempoEdit"
            @blur="commitTempoEdit"
          />
          <span v-else class="num tempo-val">{{ bpmLabel.toFixed(1) }}</span>
          <span class="unit">BPM</span>
        </div>

        <div class="seg" role="group" aria-label="Practice options">
          <button
            class="seg-i"
            :class="{ on: guide }"
            :aria-pressed="guide"
            title="Play the target part quietly as a guide"
            @click="guide = !guide"
          >
            GUIDE
          </button>
          <button
            class="seg-i"
            :class="{ on: settings.metronome }"
            :aria-pressed="settings.metronome"
            title="Metronome click, count-in included"
            @click="settings.metronome = !settings.metronome"
          >
            CLICK
          </button>
        </div>

        <i class="divider" />
      </template>

      <div v-if="view === 'trainer'" class="seg" role="group" aria-label="Note direction">
        <button
          class="seg-i icon"
          :class="{ on: settings.laneOrientation === 'vertical' }"
          title="Notes fall top to bottom"
          aria-label="Falling notes"
          @click="settings.laneOrientation = 'vertical'"
        >
          ↓
        </button>
        <button
          class="seg-i icon"
          :class="{ on: settings.laneOrientation === 'horizontal' }"
          title="Notes scroll right to left"
          aria-label="Scrolling notes"
          @click="settings.laneOrientation = 'horizontal'"
        >
          →
        </button>
      </div>

      <span v-if="view === 'home'" class="wordmark">MELODABLE</span>

      <div class="spacer" />
      <span v-if="view === 'trainer'" class="title">{{ lesson.name }}</span>
      <div class="spacer" />

      <span v-if="view === 'home'" class="count num">
        {{ lessons.lessons.length }}<i>LESSONS</i>
      </span>

      <span v-if="view === 'trainer'" class="scores">
        <span class="score" :title="runComplete ? 'Accuracy for the last run' : 'Accuracy so far'">
          <i class="k">ACC</i>
          <b class="num v-acc" :class="{ idle: !playing && !runComplete }">
            {{ playing || runComplete ? accuracy : "—" }}
          </b>
        </span>
        <span class="score" :title="runComplete ? 'Best combo in the last run' : 'Current combo'">
          <i class="k">CMB</i>
          <b class="num v-cmb" :class="{ idle: !playing && !runComplete }">
            {{ playing || runComplete ? combo : "—" }}
          </b>
        </span>
        <span class="score best" title="Best combo this session">
          <i class="k">BEST</i>
          <b class="num v-best">{{ bestCombo }}</b>
        </span>
      </span>

      <i class="divider" />

      <!-- Which instrument you practise is a decision made before a run, not
           during one, so it lives on the home bar rather than the trainer's.
           The trainer's freed width goes to the loop-overview strip. -->
      <div v-if="view === 'home'" class="seg" role="group" aria-label="Instrument">
        <span ref="padMenuRoot" class="seg-wrap">
          <button
            class="seg-i"
            :class="{ on: settings.instrument === 'pads' }"
            @click="settings.instrument === 'pads' ? togglePadMenu() : setMode('pads')"
          >
            PADS <i class="caret">{{ padMenuOpen ? "▴" : "▾" }}</i>
          </button>

          <div v-if="padMenuOpen" class="menu" role="menu" data-tauri-drag-region="false">
            <div class="menu-head">PAD LAYOUT</div>
            <button
              v-for="opt in padLayouts"
              :key="opt.id"
              class="menu-row"
              :class="{ on: settings.padLayout === opt.id }"
              role="menuitem"
              @click="pickPadLayout(opt.id)"
            >
              <i class="tick">{{ settings.padLayout === opt.id ? "●" : "" }}</i>
              <span>
                <b>{{ opt.label }}</b>
                <em>{{ opt.hint }}</em>
              </span>
            </button>
          </div>
        </span>

        <button
          class="seg-i"
          :class="{ on: settings.instrument === 'piano' }"
          @click="setMode('piano')"
        >
          PIANO
        </button>
      </div>

      <!-- Ableton Link (M6) isn't in the redesign's control list; it sits with
           the other external-gear controls. -->
      <button
        v-if="linkAvailable"
        class="ico link"
        :class="{ on: linkOn }"
        :aria-pressed="linkOn"
        :title="
          linkOn
            ? `Ableton Link on — ${linkPeers} peer(s). Tempo and downbeat follow the session.`
            : 'Ableton Link — lock tempo and downbeat to Ableton'
        "
        @click="toggleLink"
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M6.6 9.4 9.4 6.6" fill="none" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" />
          <path d="M7.1 4.7 8.2 3.6a2.6 2.6 0 0 1 3.6 3.6l-1.1 1.1" fill="none"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M8.9 11.3 7.8 12.4a2.6 2.6 0 0 1-3.6-3.6l1.1-1.1" fill="none"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <i v-if="linkOn" class="peerbadge num">{{ linkPeers }}</i>
      </button>

      <DeviceMenu
        :open="openMenu === 'device'"
        :ports="ports"
        :connected-index="connectedIndex"
        :connected-name="connectedName"
        :busy="midiBusy"
        :error="midiError"
        @refresh="refreshPorts()"
        @connect="(i: number) => connect(i)"
        @disconnect="disconnect()"
        @toggle="toggleMenu('device')"
        @close="openMenu = null"
      />

      <div v-if="view === 'trainer'" class="seg" role="group" aria-label="Instrument sound source">
        <button
          class="seg-i"
          :class="{ on: settings.soundOutput === 'internal' }"
          title="Melodable's built-in synth plays your hits"
          @click="settings.soundOutput = 'internal'"
        >
          SYNTH
        </button>
        <button
          class="seg-i"
          :class="{ on: settings.soundOutput === 'external' }"
          title="Silent: your DAW (Ableton) makes the sound while Melodable tracks timing"
          @click="settings.soundOutput = 'external'"
        >
          DAW
        </button>
      </div>

      <span ref="volMenuRoot" class="volwrap">
        <button
          class="ico"
          :class="{ on: volMenuOpen }"
          title="Mixer — your notes, the guide part and the click"
          aria-label="Mixer"
          :aria-expanded="volMenuOpen"
          @click="toggleMenu('volume')"
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M3 6.2h2.3L8.4 3.6v8.8L5.3 9.8H3z" fill="currentColor" />
            <path v-if="loudestBus > 0" d="M10.6 6a2.9 2.9 0 0 1 0 4" fill="none"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            <path v-if="loudestBus > 0.5" d="M12.4 4.3a5.4 5.4 0 0 1 0 7.4" fill="none"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            <path v-if="loudestBus === 0" d="M11 6.2 14 9.8M14 6.2 11 9.8" fill="none"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>

        <div v-if="volMenuOpen" class="menu vol-menu" data-tauri-drag-region="false">
          <div v-for="row in MIXER" :key="row.bus" class="vol-row">
            <div class="menu-head">
              {{ row.label }}
              <b class="num">{{ Math.round(settings[row.key] * 100) }}</b>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              :aria-label="row.label"
              :value="Math.round(settings[row.key] * 100)"
              @input="setBusVolume(row, $event)"
            />
          </div>
        </div>
      </span>

      <button class="ico glyph-lg" title="Import a MIDI clip from Ableton" @click="openImport">⇪</button>
      <input
        ref="fileInput"
        type="file"
        accept=".mid,.midi,audio/midi"
        hidden
        @change="onImportFile"
      />

      <i class="divider" />

      <div class="seg" role="group" aria-label="Theme">
        <button
          class="seg-i icon"
          :class="{ on: settings.theme === 'dark' }"
          title="Dark theme"
          aria-label="Dark theme"
          @click="settings.theme = 'dark'"
        >
          ◐
        </button>
        <button
          class="seg-i icon"
          :class="{ on: settings.theme === 'light' }"
          title="Light theme"
          aria-label="Light theme"
          @click="settings.theme = 'light'"
        >
          ☀
        </button>
      </div>

      <button
        class="ico mon"
        :class="{ on: settings.monitorOpen }"
        title="Show or hide the MIDI monitor"
        aria-label="Toggle MIDI monitor"
        @click="settings.monitorOpen = !settings.monitorOpen"
      >
        ▤
      </button>
    </header>

    <!-- ============================= body ============================= -->
    <main class="body" :class="{ 'with-monitor': settings.monitorOpen && view === 'trainer' }">
      <HomeScreen
        v-if="view === 'home'"
        :lessons="lessons.lessons"
        :current-index="lessons.currentIndex"
        @open="openLesson"
        @import="openImport"
      />

      <section v-else class="stage">
        <canvas ref="overviewCanvas" class="overview" />

        <template v-if="!isPiano">
          <div class="lane-wrap">
            <canvas ref="laneCanvas" class="lane-canvas" @pointerdown="onLanePointer" />
            <div v-if="toast" class="toast">{{ toast }}</div>
          </div>
        </template>

        <!-- The keyboard rotates to the left edge when notes scroll sideways,
             so every semitone row still lines up with its own key. -->
        <div v-else class="piano-stage" :class="settings.laneOrientation">
          <canvas ref="laneCanvas" class="lane-canvas piano-canvas" />
          <PianoKeyboard
            :rotated="settings.laneOrientation === 'horizontal'"
            :active="activeNotes"
            :low-note="pianoRange[0]"
            :high-note="pianoRange[1]"
            :used="lessonPitches"
            :pops="pops"
            @note-on="(n, v) => noteOn(n, v, 'click')"
            @note-off="noteOff"
          />
          <div v-if="toast" class="toast">{{ toast }}</div>
        </div>
      </section>

      <aside v-if="settings.monitorOpen && view === 'trainer'" class="monitor">
        <MidiMonitor :rows="log" @clear="log = []" @collapse="settings.monitorOpen = false" />
      </aside>
    </main>

    <RunSummary
      v-if="runComplete && runResult && view === 'trainer'"
      :lesson-name="lesson.name"
      :instrument="lesson.instrument"
      :bpm="Math.round(bpm)"
      :bars="lesson.bars"
      :repeats="totalLoops"
      :note-count="lesson.notes.length"
      :accuracy="runResult.accuracy"
      :best-combo="runResult.bestCombo"
      :previous-best="runResult.previousBest"
      :tally="runResult.tally"
      :holds="runResult.holds"
      :lanes="runResult.lanes"
      :lane-order="isPiano ? lessonPitches : trainerLanes"
      @again="onPlay"
      @lessons="goHome"
    />

    <ImportDialog
      v-if="importOpen"
      :file-name="importFileName"
      :analysis="importAnalysis"
      :error="importError"
      :instrument="importInstrument"
      @instrument="(i: InstrumentType) => (importInstrument = i)"
      @remap="(m) => (importPadOverrides = { ...importPadOverrides, [m.pitch]: m.pad })"
      @confirm="confirmImport"
      @close="closeImport"
    />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--win);
}

/* ============================ transport bar ============================ */

.bar {
  position: relative;
  height: var(--bar-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gap-bar);
  /* Left inset clears the macOS traffic lights, which end around 66px. 72px
     left the ✕ almost touching the zoom button; 84px gives it the same kind
     of breathing room the controls have between themselves. */
  padding: 0 10px 0 84px;
  background: var(--bar);
  border-bottom: 1px solid var(--bar-line);
  /* This is a titlebar, so it never shows an I-beam and never selects — the
     body rule covers the second part, this one restates it because the bar is
     where it matters most. */
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
  /* One row, always — a second row would break the 34px titlebar. Note this
     must NOT clip: the pad-layout, device and volume dropdowns hang below the
     bar, and `overflow: auto` here would cut them off at 34px. Below the
     measured 921px floor the rightmost controls run past the window edge
     rather than wrapping. */
  flex-wrap: nowrap;
}
.spacer { flex: 1; min-width: 0; }
.divider {
  width: 1px;
  height: 18px;
  flex: none;
  background: var(--bar-line);
}

/* Every bar control is 20px tall; the mono label style is shared. */
.ico,
.transport,
.seg,
.field,
.seg-i {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
}

/* The reference draws these two symbols a shade larger than the ✕ — they are
   open outlines where it is a solid stroke, so they need the extra pixel to
   carry the same weight on screen. */
.ico.glyph-lg,
.ico.mon {
  font-size: 10px;
}

.ico {
  /*
   * Regular, not the 500 the shared rule sets, matching the reference. These
   * buttons hold Unicode symbols — ✕ ⇪ ◐ ☀ ▤ — that Geist Mono does not
   * carry, so they come from a fallback face that has no medium weight and
   * synthesises one. Same thickened-outline problem as a missing SemiBold,
   * just at 9px.
   */
  font-weight: 400;
  width: 20px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--r-field);
  background: var(--face);
  box-shadow: var(--outline);
  color: var(--txt2);
  font-size: 9px;
  letter-spacing: 0;
  cursor: pointer;
}
.ico:hover { background: var(--hover); color: var(--txt); }
.ico:focus-visible,
.transport:focus-visible,
.seg-i:focus-visible,
.field:focus-visible {
  outline: 1px solid var(--head);
  outline-offset: 1px;
}

.transport {
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: none;
  border-radius: var(--r-field);
  cursor: pointer;
}
/* Drawn, not typed: a `■` glyph centres on the font's baseline and sits
   visibly high next to the caps of the label. */
.tglyph { flex: none; display: block; background: currentColor; }
.tglyph.sq { width: 6px; height: 6px; }
.tglyph.tri {
  width: 0;
  height: 0;
  background: none;
  border-left: 7px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.transport.is-stop { background: var(--stop); color: var(--stop-txt); }
.transport.is-start { background: var(--start); color: var(--start-txt); }

/* Recessed field — the tempo readout and the volume slider sit in one. */
.field {
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border-radius: var(--r-field);
  background: var(--track);
  box-shadow: var(--outline);
}
.tempo {
  gap: 5px;
  cursor: ns-resize;
  touch-action: none;
}
.tempo-val {
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1;
  /* Untracked, as in the reference. The shared control rule adds 1.1px, which
     on a numeric readout just spaces the digits out and widens the field. */
  letter-spacing: normal;
  color: var(--txt);
  /* Pinned to the widest reading, "160.0". The readout used to size to its
     content, so the whole bar shifted when the tempo crossed 100 — and the
     window floor is measured against this width. Mono plus tabular numerals
     means 5ch is exactly five digits, so the input can match it and opening
     the field moves nothing. */
  display: inline-block;
  width: 5ch;
  text-align: right;
}
.tempo-input {
  padding: 0;
  border: none;
  background: none;
  outline: none;
  caret-color: var(--head);
}
.tempo.editing { cursor: text; }
.tempo .unit {
  font-family: var(--mono);
  font-size: 9.5px;
  /* Lighter than the value it labels — the reference leaves this at 400. */
  font-weight: 400;
  letter-spacing: 1.2px;
  line-height: 1;
  color: var(--txt3);
}

/* Volume isn't in the design's control list; it gets the same 20px icon
   treatment as the others, with the slider in a popover so the bar keeps
   its width budget. */
.volwrap { position: relative; display: inline-flex; }
.ico.on { background: var(--active); color: var(--active-txt); }
/* Right-anchored: this control sits near the window edge, so a left-anchored
   panel would hang off-screen. */
.menu.vol-menu { left: auto; right: 0; width: 172px; padding: 4px 10px 10px; }
/* Three faders stacked; the gap is what separates one row's label from the
   row above it, so the reading belongs to the right slider. */
.vol-row + .vol-row { margin-top: 9px; }
.vol-menu .menu-head { display: flex; justify-content: space-between; padding-left: 0; padding-right: 0; }
.vol-menu .menu-head b { color: var(--txt); font-weight: 500; font-size: 9.5px; }
.vol-menu input {
  width: 100%;
  height: 2px;
  appearance: none;
  background: var(--hair);
  border-radius: 2px;
  cursor: pointer;
}
.vol-menu input::-webkit-slider-thumb {
  appearance: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--txt2);
}

/* 2-up (or n-up) segment on a recessed track. */
.seg {
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-field);
  background: var(--track);
  box-shadow: var(--outline);
}
.seg-wrap { position: relative; display: inline-flex; }
/* This wrapper sits inside the seg's 2px padding, so `.menu`'s top offset
   starts 2px lower than it does for the device and mixer wrappers, which are
   direct children of the bar. Pull it back so all three panels hang from the
   same line. */
.seg-wrap .menu { top: 23px; }
.seg-i {
  height: var(--seg-item-h);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border: none;
  border-radius: var(--r-item);
  background: none;
  color: var(--txt2);
  cursor: pointer;
  white-space: nowrap;
}
.seg-i.icon {
  /* Regular, like `.ico`: these are Unicode symbols from a fallback face, and
     a medium weight there is synthesised rather than drawn. */
  font-weight: 400;
  width: 20px;
  padding: 0;
  justify-content: center;
  font-size: 9px;
  letter-spacing: 0;
}
.seg-i:hover { background: var(--hover); }
/* Light inverts on-state to a dark chip rather than lightening it — every
   surface is the same grey, so a lighter fill would read as nothing. */
.seg-i.on { background: var(--active); color: var(--active-txt); }
.seg-i.on:hover { background: var(--active); }
/* Direction icons take the accent when active in dark, the inverted ink in light. */
:root[data-theme="dark"] .seg-i.icon.on { color: var(--head); }
.caret { font-size: 6.5px; font-style: normal; opacity: 0.7; }

.wordmark {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt);
  pointer-events: none;
}
.count {
  flex: none;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 11px;
  color: var(--txt2);
}
.count i {
  font-style: normal;
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}

.title {
  /* The one elastic thing in the bar. Every control is a fixed size, so the
     lesson name is what has to give: `flex: none` let an imported clip with a
     long name push the controls off the edge. Shrinking with an ellipsis
     means no name can break the row, whatever it is called. */
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--sans);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--txt);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scores {
  flex: none;
  display: inline-flex;
  align-items: baseline;
  gap: 11px;
}
.score { display: inline-flex; align-items: baseline; gap: 3px; }
.score .k {
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 400;
  font-style: normal;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.score b { font-size: 13px; font-weight: 400; }
.v-acc { color: var(--rate-perfect); }
.v-cmb { color: var(--rate-early); }
.v-best { color: var(--txt); }
.score b.idle { color: var(--txt3); }

/* Link (M6) — the peer count is a badge so the control stays 20px wide. */
.link { position: relative; }
/* Dark only. `.link.on` and `.ico.on` have equal specificity and this is the
   later rule, so it replaces the on-chip's `--active-txt`; in light `--head`
   IS `--active`, which painted the chain icon in the chip's own colour and
   made it disappear exactly when Link was running. Light keeps
   `--active-txt` from `.ico.on`. */
:root[data-theme="dark"] .link.on { color: var(--head); }
.peerbadge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 11px;
  padding: 0 2px;
  border-radius: 6px;
  background: var(--head);
  color: var(--win);
  font-size: 7.5px;
  font-style: normal;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 11px;
  text-align: center;
}

.mon.on { background: var(--mon-tab); color: var(--mon-icon); }

/* Dropdown — one surface, hairline outline, anchored under its control. */
.menu {
  position: absolute;
  top: 25px;
  left: 0;
  z-index: 40;
  width: 200px;
  padding: 4px;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair), 0 12px 30px #00000055;
}
/* An open panel hangs below the bar and over the lane canvas. */
.bar.menu-open { z-index: 30; }
.menu-head {
  padding: 6px 8px 5px;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.menu-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--r-item);
  background: none;
  color: var(--txt2);
  font-family: var(--sans);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.menu-row:hover { background: var(--hover); }
.menu-row.on { background: var(--active); color: var(--active-txt); }
.menu-row.on .tick { color: var(--active-txt); }
.menu-row .tick { width: 10px; flex: none; font-size: 8px; font-style: normal; color: var(--head); }
.menu-row b { font-weight: 500; }
.menu-row em { font-style: normal; color: var(--txt3); margin-left: 6px; font-size: 11.5px; }

/* ================================ body ================================ */

/* The monitor is a real column, so the lane area reflows into what is left
   rather than being covered. Nothing else moves. */
.body {
  flex: 1;
  min-height: 0;
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.body.with-monitor { grid-template-columns: minmax(0, 1fr) 268px; }

.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--pad-win);
}

.overview {
  height: var(--overview-h);
  flex: none;
  width: 100%;
  border-radius: var(--r-panel);
}

.lane-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}
.lane-canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--r-panel);
}

.piano-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
}
/* Rows are semitones, so the keyboard stands on its side beside them. */
.piano-stage.horizontal { flex-direction: row-reverse; }
.piano-canvas { flex: 1; min-height: 0; min-width: 0; }

.toast {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  padding: 7px 12px;
  border-radius: var(--r-field);
  background: var(--bar);
  box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--txt);
  font-family: var(--sans);
  font-size: 12.5px;
  white-space: nowrap;
}

.monitor {
  min-width: 0;
  display: flex;
  padding: var(--pad-win) var(--pad-win) var(--pad-win) 0;
}

/* ============================== responsive ==============================
   Drop order is the design's: lesson title, then the device chip's label
   (the LED dot stays), then BEST. Thresholds are measured, not guessed —
   each is the width at which the remaining controls stop fitting.

   Everything visible fits down to 1118px — 18px above the design's ~1100px
   budget, because this bar carries two controls the design doesn't list (the
   Ableton Link toggle and volume). Verified single-row with no overflow from
   1400px down to 912px; below that the design's drop list is exhausted and
   the rightmost controls run past the window edge rather than wrapping. */
/* No responsive drop-outs any more. The window floor (`minWidth` in
   tauri.conf.json) is set to the measured width at which every control fits
   at its natural size, so nothing has to be hidden to keep the single row —
   and the elastic title above absorbs any lesson name. The old rules hid the
   title at 1118px, the device label at 1018px and BEST at 956px; all three
   are below the floor now and could never fire. If the floor is ever lowered,
   they need to come back. */
</style>
