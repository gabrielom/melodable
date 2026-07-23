<script setup lang="ts">
/**
 * MIDI import preview. Shows what the parsed clip will become — name, tempo,
 * bars, hit count, and which pads it uses — before it joins the library.
 * Name and tempo are editable; everything else is derived from the file.
 *
 * An error prop puts the dialog into a failure state (unreadable/empty file)
 * with just a Close action.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { MidiAnalysis } from "@/engine/midi-file";
import type { InstrumentType } from "@/engine/types";

const props = defineProps<{
  fileName: string;
  analysis: MidiAnalysis | null;
  error: string | null;
  instrument: InstrumentType;
}>();

const emit = defineEmits<{
  (e: "confirm", payload: { name: string; bpm: number }): void;
  (e: "instrument", value: InstrumentType): void;
  (e: "close"): void;
}>();

const name = ref(props.fileName.replace(/\.(mid|midi)$/i, "").slice(0, 40));
const bpm = ref(props.analysis?.bpm ?? 120);

/** Does the chosen instrument disagree with what the clip looks like? */
const mismatch = computed(() =>
  props.analysis
    ? props.analysis.looksLikeDrums
      ? props.instrument !== "pads"
      : props.instrument !== "piano"
    : false,
);

const detectMsg = computed(() => {
  const a = props.analysis;
  if (!a) return "";
  const detected = a.looksLikeDrums ? "a drum clip" : "melodic";
  const asWhat = props.instrument === "pads" ? "a pad" : "a piano";
  return mismatch.value
    ? `Reads as ${detected}, but you picked ${props.instrument}. That's fine — switch above if you'd rather.`
    : `Reads as ${detected} — importing as ${asWhat} lesson.`;
});

function confirm() {
  if (!props.analysis) return;
  emit("confirm", { name: name.value.trim() || "Imported clip", bpm: bpm.value });
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <div class="panel" role="dialog" aria-modal="true" aria-label="Import MIDI clip">
        <header class="head">
          <div class="kicker">IMPORT MIDI CLIP</div>
          <button class="close" aria-label="Close" @click="emit('close')">✕</button>
        </header>

        <!-- error state -->
        <div v-if="error" class="err">
          <div class="err-title">Couldn't read that clip</div>
          <div class="err-msg">{{ error }}</div>
          <div class="err-hint">
            In Ableton, drag a MIDI clip to the desktop or right-click → Export MIDI Clip, then pick
            the <code>.mid</code> file.
          </div>
        </div>

        <!-- preview -->
        <div v-else-if="analysis" class="body">
          <label class="field">
            <span class="flabel">NAME</span>
            <input v-model="name" class="input" maxlength="40" />
          </label>

          <div class="field">
            <span class="flabel">IMPORT AS</span>
            <div class="seg">
              <button
                class="segbtn"
                :class="{ on: instrument === 'pads' }"
                @click="emit('instrument', 'pads')"
              >
                Pads
              </button>
              <button
                class="segbtn"
                :class="{ on: instrument === 'piano' }"
                @click="emit('instrument', 'piano')"
              >
                Piano
              </button>
            </div>
          </div>

          <div class="grid">
            <label class="field">
              <span class="flabel">TEMPO</span>
              <div class="bpmrow">
                <input v-model.number="bpm" class="input bpm" type="number" min="40" max="240" />
                <span class="unit">BPM</span>
              </div>
            </label>
            <div class="field">
              <span class="flabel">LENGTH</span>
              <div class="stat">{{ analysis.bars }} bar{{ analysis.bars === 1 ? "" : "s" }} · {{ analysis.beatsPerBar }}/4</div>
            </div>
            <div class="field">
              <span class="flabel">HITS</span>
              <div class="stat">{{ analysis.noteCount }}</div>
            </div>
          </div>

          <div class="field">
            <span class="flabel">{{ instrument === "pads" ? "PADS USED" : "KEYS USED" }}</span>
            <div class="lanes">{{ analysis.lanes.join(" · ") }}</div>
          </div>

          <div class="detect" :class="{ warn: mismatch }">
            <span class="tag">{{ analysis.looksLikeDrums ? "DRUMS" : "MELODIC" }}</span>
            <span>{{ detectMsg }}</span>
          </div>
        </div>

        <footer class="foot">
          <button class="btn ghost" @click="emit('close')">Cancel</button>
          <button v-if="analysis" class="btn primary" @click="confirm">
            Add to library
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: #06070acc;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 24px;
}
.panel {
  width: min(460px, 100%);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 24px 80px #000000aa;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 18px;
  border-bottom: 1px solid var(--line);
}
.kicker { font-family: var(--mono); font-size: 10px; letter-spacing: 2px; color: var(--teal); }
.close {
  background: none;
  border: none;
  color: var(--faint);
  font-size: 15px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}
.close:hover { color: var(--ink); background: var(--panel2); }

.body { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.flabel { font-family: var(--mono); font-size: 9.5px; letter-spacing: 1.2px; color: var(--faint); }
.input {
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 9px 11px;
  color: var(--ink);
  font-size: 14px;
  font-family: var(--sans);
}
.input:focus { outline: none; border-color: #37d0c455; }
.seg {
  display: inline-flex;
  gap: 3px;
  background: #0c0e12;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 3px;
  width: max-content;
}
.segbtn {
  background: none;
  border: none;
  color: var(--dim);
  font-size: 13px;
  font-weight: 600;
  padding: 5px 16px;
  border-radius: 7px;
  cursor: pointer;
}
.segbtn.on { background: var(--panel2); color: var(--ink); box-shadow: 0 0 0 1px var(--line); }

.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.bpmrow { display: flex; align-items: center; gap: 7px; }
.input.bpm { width: 74px; font-family: var(--mono); }
.unit { font-family: var(--mono); font-size: 10px; color: var(--faint); }
.stat { font-family: var(--mono); font-size: 15px; color: var(--ink); padding-top: 4px; }
.lanes { font-size: 13px; color: var(--dim); line-height: 1.5; }

.detect {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--dim);
  background: #0c0e12;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  line-height: 1.45;
}
.detect .tag {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.5px;
  color: var(--teal);
  border: 1px solid #37d0c455;
  border-radius: 20px;
  padding: 2px 8px;
  flex: none;
}
.detect.warn { border-color: #ffb34033; }
.detect.warn .tag { color: var(--amber); border-color: #ffb34055; }

.err { padding: 18px; display: flex; flex-direction: column; gap: 8px; }
.err-title { font-size: 15px; font-weight: 700; color: var(--red); }
.err-msg { font-family: var(--mono); font-size: 12px; color: var(--dim); }
.err-hint { font-size: 12.5px; color: var(--faint); line-height: 1.5; }
.err-hint code { font-family: var(--mono); font-size: 11px; color: var(--dim); }

.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 13px 18px;
  border-top: 1px solid var(--line);
}
.btn {
  border: 1px solid var(--line);
  background: #1a1e24;
  border-radius: 10px;
  padding: 9px 16px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  color: var(--ink);
}
.btn.ghost { background: transparent; color: var(--dim); }
.btn.primary {
  background: linear-gradient(180deg, #37d0c4, #20b3a8);
  color: #04201d;
  border: none;
  font-weight: 700;
}
</style>
