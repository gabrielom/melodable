<script setup lang="ts">
/**
 * M2 shell: the shared engine (transport, scoring, adaptive tempo) drives a
 * falling-note canvas above the pad grid. Hardware, computer-keyboard, and
 * mouse hits all route through the same scorer; hardware hits are graded at
 * their midir timestamp mapped onto the audio clock.
 *
 * Next (see build_plan.html §15): M3 adds the lesson library + persistence.
 */
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useSettings } from "@/stores/settings";
import { useLessons } from "@/stores/lessons";
import { useMidi } from "@/composables/useMidi";
import { useTrainer } from "@/composables/useTrainer";
import { AudioEngine } from "@/engine/audio";
import { PADS, PAD_KEY_MAP, PIANO_KEY_MAP, noteToPad } from "@/engine/gm";
import { parseMidiFile, midiToLesson, type ParsedMidi } from "@/engine/midi-file";
import type { MidiMessage, InstrumentType } from "@/engine/types";

import DeviceMenu from "@/components/DeviceMenu.vue";
import MidiMonitor from "@/components/MidiMonitor.vue";
import Hud from "@/components/Hud.vue";
import LessonLibrary from "@/components/LessonLibrary.vue";
import ImportDialog from "@/components/ImportDialog.vue";
import type { LogRow } from "@/components/midi-log";
import PadGrid from "@/views/pads/PadGrid.vue";
import PianoKeyboard from "@/views/piano/PianoKeyboard.vue";

const settings = useSettings();
const lessons = useLessons();
const audio = new AudioEngine();
const libraryOpen = ref(false);

// ------------------------------------------------------------- MIDI import
// The parsed clip is kept and re-projected whenever the chosen instrument
// changes, so the preview updates live between Pads and Piano.
const fileInput = ref<HTMLInputElement | null>(null);
const importOpen = ref(false);
const importFileName = ref("");
const importError = ref<string | null>(null);
const importParsed = ref<ParsedMidi | null>(null);
const importInstrument = ref<InstrumentType>("pads");

const importResult = computed(() => {
  if (!importParsed.value) return null;
  try {
    return midiToLesson(importParsed.value, importFileName.value, {
      instrument: importInstrument.value,
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
}

const audioReady = ref(false);
const activePads = ref<Map<number, number>>(new Map());
const activeNotes = ref<Map<number, number>>(new Map());
const log = ref<LogRow[]>([]);

const laneCanvas = ref<HTMLCanvasElement | null>(null);
const {
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
  hardwareHitTime,
} = useTrainer(audio, laneCanvas);

let logId = 0;
let lastLogTime = 0;
const MAX_LOG = 60;

// ---------------------------------------------------------------- audio init

/** Browsers require a gesture before audio can start. */
async function ensureAudio() {
  if (audioReady.value) return;
  await audio.init();
  audio.setVolume(settings.volume);
  audioReady.value = audio.ready;
}

async function onPlay() {
  await ensureAudio();
  play();
}

function onTempo(e: Event) {
  setBpm(Number((e.target as HTMLInputElement).value));
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

function noteOff(midi: number) {
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
    noteOff(m.note);
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

function onKeyDown(e: KeyboardEvent) {
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

// ------------------------------------------------------------------ mounted

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  void refreshPorts();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
});

// -------------------------------------------------------------------- misc

const modes: Array<{ id: InstrumentType; label: string }> = [
  { id: "pads", label: "Pads" },
  { id: "piano", label: "Piano" },
];

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

function onVolume(e: Event) {
  const v = Number((e.target as HTMLInputElement).value) / 100;
  settings.volume = v;
  audio.setVolume(v);
}

</script>

<template>
  <div class="app">
    <!-- ===================== transport (window titlebar) ===================== -->
    <!-- Left inset clears the macOS window controls, which sit on this bar. -->
    <header class="bar" data-tauri-drag-region>
      <button v-if="!playing" class="btn primary" @click="onPlay">▶ Play</button>
      <button v-else class="btn stopbtn" @click="stop">■ Stop</button>

      <label class="tempo" :title="`Tempo — ${bpm} BPM`">
        <input type="range" min="50" max="160" :value="bpm" @input="onTempo" />
        <span class="bpm">{{ bpm }}</span>
      </label>

      <div class="modes" role="group" aria-label="Practice options">
        <button
          class="mode"
          :class="{ on: autoAdapt }"
          title="Adaptive tempo: clean bars push the BPM up, rough bars ease it off"
          @click="autoAdapt = !autoAdapt"
        >
          Adapt
        </button>
        <button
          class="mode"
          :class="{ on: guide }"
          title="Play the target part quietly as a guide"
          @click="guide = !guide"
        >
          Guide
        </button>
        <button
          class="mode"
          :class="{ on: settings.metronome }"
          title="Metronome click, count-in included"
          @click="settings.metronome = !settings.metronome"
        >
          Click
        </button>
      </div>

      <div class="modes">
        <button
          v-for="m in modes"
          :key="m.id"
          class="mode"
          :class="{ on: settings.instrument === m.id }"
          @click="setMode(m.id)"
        >
          {{ m.label }}
        </button>
      </div>

      <div class="spacer" />

      <button v-if="!audioReady" class="iconbtn arm" title="Enable audio" @click="ensureAudio">▶</button>

      <DeviceMenu
        :ports="ports"
        :connected-index="connectedIndex"
        :connected-name="connectedName"
        :busy="midiBusy"
        :error="midiError"
        @refresh="refreshPorts()"
        @connect="(i: number) => connect(i)"
        @disconnect="disconnect()"
      />

      <div class="modes" role="group" aria-label="Instrument sound source">
        <button
          class="mode"
          :class="{ on: settings.soundOutput === 'internal' }"
          title="Melodable's built-in synth plays your hits"
          @click="settings.soundOutput = 'internal'"
        >
          Synth
        </button>
        <button
          class="mode"
          :class="{ on: settings.soundOutput === 'external' }"
          title="Silent: your DAW (Ableton) makes the sound while Melodable tracks timing"
          @click="settings.soundOutput = 'external'"
        >
          DAW
        </button>
      </div>

      <button class="iconbtn" title="Import a MIDI clip from Ableton" @click="openImport">⇪</button>
      <input
        ref="fileInput"
        type="file"
        accept=".mid,.midi,audio/midi"
        hidden
        @change="onImportFile"
      />

      <label class="vol">
        <input
          type="range"
          min="0"
          max="100"
          :value="Math.round(settings.volume * 100)"
          @input="onVolume"
        />
      </label>

      <button
        class="iconbtn panel"
        :class="{ on: settings.monitorOpen }"
        title="Show or hide the MIDI monitor"
        aria-label="Toggle MIDI monitor"
        @click="settings.monitorOpen = !settings.monitorOpen"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
          <rect x="9.5" y="2.5" width="5" height="11" rx="2" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </header>

    <!-- ============================= body ============================= -->
    <main class="body">
      <section class="stage">
        <div class="trainhead">
          <div class="lessoninfo">
            <button class="lname" title="Open the lesson library" @click="libraryOpen = true">
              {{ lesson.name }}
              <span class="lprog">{{ lessons.currentIndex + 1 }}/{{ lessons.lessons.length }}</span>
              <span class="chev">▾</span>
            </button>
            <div class="lhint">{{ lesson.hint }}</div>
          </div>
          <Hud
            :bpm="bpm"
            :accuracy="accuracy"
            :combo="combo"
            :best-combo="bestCombo"
            :phase="phase"
            :loop-acc="loopAcc"
          />
        </div>

        <!-- Pads: falling-note lane fills the space, grid sits under it -->
        <template v-if="!isPiano">
          <div class="lane-wrap">
            <canvas ref="laneCanvas" class="lane-canvas" />
            <div v-if="toast" class="toast">{{ toast }}</div>
          </div>
          <PadGrid
            :active="activePads"
            :emphasis="lanes"
            :pops="pops"
            @trigger="(i, v) => triggerPad(i, v, 'click')"
          />
        </template>

        <!-- Piano: notes fall the full height onto a keyboard pinned to the bottom -->
        <div v-else class="piano-stage">
          <canvas ref="laneCanvas" class="lane-canvas piano-canvas" />
          <PianoKeyboard
            :active="activeNotes"
            :low-note="pianoRange[0]"
            :high-note="pianoRange[1]"
            :pops="pops"
            :show-legend="false"
            @note-on="(n, v) => noteOn(n, v, 'click')"
            @note-off="noteOff"
          />
          <div v-if="toast" class="toast">{{ toast }}</div>
        </div>
      </section>

      <aside v-if="settings.monitorOpen" class="side">
        <MidiMonitor :rows="log" @clear="log = []" @collapse="settings.monitorOpen = false" />
      </aside>
    </main>

    <LessonLibrary
      v-if="libraryOpen"
      :lessons="lessons.lessons"
      :current-index="lessons.currentIndex"
      @select="(i: number) => lessons.selectIndex(i)"
      @close="libraryOpen = false"
    />

    <ImportDialog
      v-if="importOpen"
      :file-name="importFileName"
      :analysis="importAnalysis"
      :error="importError"
      :instrument="importInstrument"
      @instrument="(i: InstrumentType) => (importInstrument = i)"
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
  min-height: 0;
}

/* Transport bar. Doubles as the window titlebar on macOS (the traffic lights
   are overlaid on its left), so the whole strip is a drag region and the left
   padding keeps the controls clear of them. */
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px 9px 78px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #15181e, #101318);
  flex: none;
  flex-wrap: wrap;
}
.bar > * { -webkit-app-region: no-drag; }
.spacer { flex: 1; min-width: 0; }

.modes {
  display: flex;
  gap: 3px;
  background: #0c0e12;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 3px;
}
.mode {
  background: none;
  border: none;
  color: var(--dim);
  font-size: 12.5px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 7px;
  cursor: pointer;
}
.mode.on { background: var(--panel2); color: var(--ink); box-shadow: 0 0 0 1px var(--line); }

.vol { display: flex; align-items: center; }
.vol input { accent-color: var(--teal); width: 58px; }

.iconbtn.arm { background: linear-gradient(180deg, #37d0c4, #20b3a8); color: #04201d; border: none; }

/* square icon buttons: import, monitor toggle */
.iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: #1a1e24;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--dim);
  font-size: 14px;
  cursor: pointer;
  flex: none;
}
.iconbtn:hover { color: var(--ink); border-color: #39414d; }
.iconbtn.on { color: var(--teal); border-color: #37d0c455; background: #16211f; }

/* body */
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 18px;
  padding: 20px 18px;
}
/* Monitor hidden: the stage takes the whole width. */
.body:not(:has(.side)) { grid-template-columns: minmax(0, 1fr); }

.stage {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* Safety valve: on a short window the stage scrolls rather than clipping
     the pad grid. At normal sizes the flex children absorb the height. */
  overflow-y: auto;
}
/* The pad grid keeps its intrinsic height; the lane above it takes the rest. */
.stage > .wrap { flex: none; }
.side { min-height: 0; display: flex; }
.side > * { flex: 1; }


/* trainer chrome */
.trainhead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.lname {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
}
.lname:hover .chev { color: var(--teal); }
.lprog {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--faint);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 2px 9px;
}
.chev { font-size: 12px; color: var(--dim); }
.lhint { font-size: 12.5px; color: var(--dim); margin-top: 2px; max-width: 380px; }

/* Pads: the lane takes the leftover height; the grid sits beneath it. */
.lane-wrap {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  flex: 1 1 auto;
  min-height: 170px;
  margin-bottom: 14px;
}
.lane-canvas {
  display: block;
  width: 100%;
  height: 100%;
  background: #111318;
  touch-action: none;
}

/* Piano: canvas + keyboard as one flush unit that fills the remaining height,
   so the keys always sit at the bottom of the window. */
.piano-stage {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  flex: 1 1 auto;
  min-height: 260px;
  display: flex;
  flex-direction: column;
}
.piano-canvas {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  background: #0b0d11;
}
.piano-stage :deep(.wrap) { flex: none; }

.toast {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: #1c2026ee;
  border: 1px solid #37d0c455;
  color: #dfe4ea;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.btn {
  border: 1px solid var(--line);
  background: #1a1e24;
  border-radius: 9px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary {
  background: linear-gradient(180deg, #37d0c4, #20b3a8);
  color: #04201d;
  border: none;
}
.btn.stopbtn { background: #2a1c1c; border-color: #e2564d55; color: #f0a8a2; }

.tempo { display: flex; align-items: center; gap: 6px; }
.tempo input { accent-color: var(--teal); width: 68px; }
.bpm {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--dim);
  min-width: 22px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .body { grid-template-columns: 1fr; }
  .side { max-height: 260px; }
}
</style>
