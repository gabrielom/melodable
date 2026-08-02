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
import { PADS } from "@/engine/gm";
import { noteName } from "@/engine/pitch";

const props = defineProps<{
  fileName: string;
  analysis: MidiAnalysis | null;
  error: string | null;
  instrument: InstrumentType;
}>();

const emit = defineEmits<{
  (e: "confirm", payload: { name: string; bpm: number }): void;
  (e: "instrument", value: InstrumentType): void;
  (e: "remap", payload: { pitch: number; pad: number }): void;
  (e: "close"): void;
}>();

/** Every pad, for the mapping table's reassignment control. */
const padOptions = PADS.map((pad, index) => ({ index, name: pad.name }));

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

          <!--
            Where each source note landed. The GM map gets it right for a
            standard kit; anything else this is how you fix, without going back
            to the DAW.
          -->
          <div v-if="instrument === 'pads' && analysis.mapping.length" class="field">
            <span class="flabel">NOTE MAPPING</span>
            <div class="map">
              <div class="maprow maphead">
                <span>NOTE</span><span>NAME</span><span>PAD</span><span class="r">HITS</span>
              </div>
              <div v-for="m in analysis.mapping" :key="m.pitch" class="maprow">
                <span class="num">{{ m.pitch }}</span>
                <span class="dim">{{ noteName(m.pitch) }}</span>
                <select
                  class="padsel"
                  :value="m.pad"
                  :aria-label="`Pad for note ${m.pitch}`"
                  @change="emit('remap', { pitch: m.pitch, pad: Number(($event.target as HTMLSelectElement).value) })"
                >
                  <option v-for="o in padOptions" :key="o.index" :value="o.index">
                    {{ o.name }}
                  </option>
                </select>
                <span class="num r">{{ m.count }}</span>
              </div>
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
  z-index: 80;
  display: grid;
  place-items: center;
  background: #00000088;
}
/* A sheet, like the summary: part of the window rather than a floating card. */
.panel {
  width: 460px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair), 0 24px 60px #00000066;
  overflow: hidden;
}

.head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  height: 34px;
  border-bottom: 1px solid var(--hair);
}
.kicker {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--head);
}
.close {
  border: none;
  background: none;
  padding: 0;
  color: var(--txt3);
  font-size: 11px;
  cursor: pointer;
}
.close:hover { color: var(--txt); }

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.flabel {
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.input {
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: var(--r-item);
  background: var(--track);
  box-shadow: var(--outline);
  color: var(--txt);
  font-family: var(--sans);
  font-size: 12.5px;
}
.input:focus-visible { outline: 1px solid var(--head); outline-offset: 1px; }
.bpm { width: 68px; font-family: var(--mono); font-variant-numeric: tabular-nums; }
.bpmrow { display: flex; align-items: center; gap: 6px; }
.unit {
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}

.seg {
  align-self: flex-start;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-item);
  background: var(--track);
  box-shadow: var(--outline);
}
.segbtn {
  height: 20px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-item);
  background: none;
  color: var(--txt2);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  cursor: pointer;
}
.segbtn.on { background: var(--active); color: var(--active-txt); }

.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--txt);
}
.lanes { font-size: 12px; line-height: 1.45; color: var(--txt2); }

/* Detection banner — warns when the read disagrees with the choice. */
.detect {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: var(--r-item);
  background: var(--track);
  box-shadow: var(--outline);
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--txt2);
}
.detect .tag {
  flex: none;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--head);
}
.detect.warn .tag { color: var(--led1); border-color: var(--led1); }

.err { display: flex; flex-direction: column; gap: 7px; padding: 14px; }
.err-title { font-size: 13px; font-weight: 600; color: var(--rate-miss); }
.err-msg {
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--txt2);
  word-break: break-word;
}
.err-hint { font-size: 11.5px; line-height: 1.45; color: var(--txt3); }
.err-hint code {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--txt2);
}

.foot {
  flex: none;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--hair);
}
.btn {
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  color: var(--txt2);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  cursor: pointer;
}
.btn:hover { background: var(--hover); color: var(--txt); }
.btn.primary { background: var(--start); color: var(--start-txt); }
.btn.primary:hover { background: var(--start); }
.btn:disabled { opacity: 0.5; cursor: default; }

/* Mapping table: one row per source note, reassignable. */
.map {
  display: flex;
  flex-direction: column;
  max-height: 168px;
  overflow-y: auto;
  border-radius: var(--r-field);
  box-shadow: var(--outline);
}
.maprow {
  display: grid;
  grid-template-columns: 44px 52px 1fr 44px;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 9.5px;
  color: var(--txt);
  border-bottom: 1px solid var(--hair);
}
.maprow:last-child { border-bottom: none; }
.maphead {
  position: sticky;
  top: 0;
  background: var(--bar);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.maprow .dim { color: var(--txt3); }
.maprow .r { text-align: right; }
.padsel {
  width: 100%;
  min-width: 0;
  border: none;
  border-radius: var(--r-item);
  background: var(--track);
  box-shadow: var(--outline);
  color: var(--txt);
  font-family: var(--sans);
  font-size: 11.5px;
  padding: 3px 5px;
  cursor: pointer;
}
</style>
