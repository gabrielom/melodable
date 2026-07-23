<script setup lang="ts">
/**
 * M2 shell: the shared engine (transport, scoring, adaptive tempo) drives a
 * falling-note canvas above the pad grid. Hardware, computer-keyboard, and
 * mouse hits all route through the same scorer; hardware hits are graded at
 * their midir timestamp mapped onto the audio clock.
 *
 * Next (see build_plan.html §15): M3 adds the lesson library + persistence.
 */
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useSettings } from "@/stores/settings";
import { useMidi, isTauri } from "@/composables/useMidi";
import { useTrainer } from "@/composables/useTrainer";
import { AudioEngine } from "@/engine/audio";
import { PADS, PAD_KEY_MAP, PIANO_KEY_MAP, noteToPad } from "@/engine/gm";
import type { MidiMessage, InstrumentType } from "@/engine/types";

import DevicePicker from "@/components/DevicePicker.vue";
import MidiMonitor from "@/components/MidiMonitor.vue";
import Hud from "@/components/Hud.vue";
import type { LogRow } from "@/components/midi-log";
import PadGrid from "@/views/pads/PadGrid.vue";
import PianoKeyboard from "@/views/piano/PianoKeyboard.vue";

const settings = useSettings();
const audio = new AudioEngine();

const audioReady = ref(false);
const latencyMs = ref(0);
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
  latencyMs.value = Math.round(audio.outputLatency * 1000);
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
  audio.playDrum(pad.type, undefined, Math.max(0.25, velocity / 127));
  flashPad(index, velocity);
  if (source !== "hardware") pushLog("noteon", pad.outNote, velocity, 9, source);
  strike(index, hitTime);
}

async function noteOn(midi: number, velocity = 100, source: LogRow["source"] = "click") {
  await ensureAudio();
  audio.playNote(midi, undefined, Math.max(0.25, velocity / 127));
  const next = new Map(activeNotes.value);
  next.set(midi, velocity);
  activeNotes.value = next;
  if (source !== "hardware") pushLog("noteon", midi, velocity, 0, source);
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
    const pad = noteToPad(m.note);
    // Drum notes light the grid; everything else is treated as pitched.
    if (pad !== null && settings.instrument === "pads") {
      const hitTime = hardwareHitTime(m.timestampMicros);
      void triggerPad(pad, m.velocity, "hardware", hitTime);
    } else {
      void noteOn(m.note, m.velocity, "hardware");
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

function setMode(m: InstrumentType) {
  if (m !== "pads" && playing.value) stop();
  settings.setInstrument(m);
  activePads.value = new Map();
  activeNotes.value = new Map();
}

function onVolume(e: Event) {
  const v = Number((e.target as HTMLInputElement).value) / 100;
  settings.volume = v;
  audio.setVolume(v);
}

const shellLabel = computed(() => (isTauri() ? "TAURI" : "BROWSER"));
</script>

<template>
  <div class="app">
    <!-- ============================ header ============================ -->
    <header class="bar">
      <div class="brand">
        <span class="dots">
          <i style="background: var(--amber)" />
          <i style="background: var(--teal)" />
          <i style="background: var(--blue)" />
        </span>
        <div>
          <div class="title">RHYTHM TRAINER</div>
          <div class="sub">M2 · engine + pad view</div>
        </div>
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

      <div class="right">
        <label class="vol">
          <span>VOL</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="Math.round(settings.volume * 100)"
            @input="onVolume"
          />
        </label>
        <span class="shell">{{ shellLabel }}</span>
      </div>
    </header>

    <!-- ============================ toolbar =========================== -->
    <div class="toolbar">
      <DevicePicker
        :ports="ports"
        :connected-index="connectedIndex"
        :connected-name="connectedName"
        :busy="midiBusy"
        :error="midiError"
        @refresh="refreshPorts()"
        @connect="(i: number) => connect(i)"
        @disconnect="disconnect()"
      />
      <button v-if="!audioReady" class="arm" @click="ensureAudio">
        ▶ Enable audio
      </button>
      <span v-else class="armed">audio running · {{ latencyMs }}ms out</span>
    </div>

    <!-- ============================= body ============================= -->
    <main class="body">
      <section class="stage">
        <template v-if="settings.instrument === 'pads'">
          <div class="trainhead">
            <div class="lessoninfo">
              <div class="lname">{{ lesson.name }}</div>
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

          <div class="lane-wrap">
            <canvas ref="laneCanvas" class="lane-canvas" />
            <div v-if="toast" class="toast">{{ toast }}</div>
          </div>

          <div class="controls">
            <button v-if="!playing" class="btn primary" @click="onPlay">▶ Play</button>
            <button v-else class="btn stopbtn" @click="stop">■ Stop</button>

            <label class="slider">
              <span>TEMPO · {{ bpm }} BPM</span>
              <input type="range" min="50" max="160" :value="bpm" @input="onTempo" />
            </label>

            <button class="toggle" :class="{ on: autoAdapt }" @click="autoAdapt = !autoAdapt">
              <i class="dot" />Adapt tempo
            </button>
            <button class="toggle" :class="{ on: guide }" @click="guide = !guide">
              <i class="dot" />Guide sound
            </button>
          </div>

          <PadGrid
            :active="activePads"
            :emphasis="lanes"
            :pops="pops"
            @trigger="(i, v) => triggerPad(i, v, 'click')"
          />
        </template>

        <template v-else>
          <PianoKeyboard
            :active="activeNotes"
            :low-note="settings.pianoLow"
            :high-note="settings.pianoHigh"
            @note-on="(n, v) => noteOn(n, v, 'click')"
            @note-off="noteOff"
          />
          <div class="next">
            <b>Piano lessons land in M5</b> — the falling-note piano roll reuses this same
            engine; for now the keyboard is free-play.
          </div>
        </template>
      </section>

      <aside class="side">
        <MidiMonitor :rows="log" @clear="log = []" />
      </aside>
    </main>
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* header */
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #15181e, #101318);
  flex: none;
}
.brand { display: flex; align-items: center; gap: 11px; }
.dots { display: inline-flex; gap: 4px; }
.dots i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.title { font-size: 13px; font-weight: 700; letter-spacing: 2px; }
.sub { font-family: var(--mono); font-size: 10px; color: var(--faint); }

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
  font-size: 13px;
  font-weight: 600;
  padding: 6px 18px;
  border-radius: 8px;
  cursor: pointer;
}
.mode.on { background: var(--panel2); color: var(--ink); box-shadow: 0 0 0 1px var(--line); }

.right { display: flex; align-items: center; gap: 14px; }
.vol { display: flex; align-items: center; gap: 7px; }
.vol span { font-family: var(--mono); font-size: 9.5px; color: var(--faint); letter-spacing: 1px; }
.vol input { accent-color: var(--teal); width: 84px; }
.shell {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 1.2px;
  color: var(--faint);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 3px 9px;
}

/* toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 11px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  flex: none;
}
.arm {
  background: linear-gradient(180deg, #37d0c4, #20b3a8);
  color: #04201d;
  border: none;
  border-radius: 9px;
  padding: 7px 15px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.armed { font-family: var(--mono); font-size: 11px; color: var(--teal); }

/* body */
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 18px;
  padding: 20px 18px;
  overflow: auto;
}
.stage { min-width: 0; display: flex; flex-direction: column; }
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
.lname { font-size: 20px; font-weight: 700; }
.lhint { font-size: 12.5px; color: var(--dim); margin-top: 2px; max-width: 380px; }

.lane-wrap {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  flex: none;
}
.lane-canvas {
  display: block;
  width: 100%;
  height: 250px;
  background: #111318;
  touch-action: none;
}
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

.controls {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin: 12px 0;
}
.btn {
  border: 1px solid var(--line);
  background: #1a1e24;
  border-radius: 10px;
  padding: 9px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary {
  background: linear-gradient(180deg, #37d0c4, #20b3a8);
  color: #04201d;
  border: none;
}
.btn.stopbtn { background: #2a1c1c; border-color: #e2564d55; color: #f0a8a2; }

.slider {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--faint);
  letter-spacing: 0.5px;
}
.slider input { accent-color: var(--teal); width: 130px; }

.toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  background: #1a1e24;
  border: 1px solid var(--line);
  color: var(--dim);
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.toggle .dot { width: 8px; height: 8px; border-radius: 8px; background: #404750; }
.toggle.on { color: var(--ink); border-color: #37d0c455; }
.toggle.on .dot { background: var(--teal); box-shadow: 0 0 8px var(--teal); }

.next {
  margin-top: auto;
  padding-top: 18px;
  font-size: 12.5px;
  color: var(--faint);
  line-height: 1.55;
  max-width: 560px;
}
.next b { color: var(--amber); font-family: var(--mono); font-size: 11px; letter-spacing: 0.5px; }

@media (max-width: 900px) {
  .body { grid-template-columns: 1fr; }
  .side { max-height: 260px; }
}
</style>
