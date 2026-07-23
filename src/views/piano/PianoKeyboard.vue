<script setup lang="ts">
/**
 * On-screen piano. Geometry comes from mapping.ts — the same function the
 * M5 piano-roll renderer will use to align falling notes to their keys.
 */
import { computed } from "vue";
import { keyGeometry, isWhiteKey, noteName, normalizeRange } from "./mapping";

const props = withDefaults(
  defineProps<{
    lowNote?: number;
    highNote?: number;
    /** midi note -> velocity (0-127) for currently-held notes */
    active: Map<number, number>;
  }>(),
  { lowNote: 48, highNote: 72 },
);

const emit = defineEmits<{
  (e: "noteOn", midi: number, velocity: number): void;
  (e: "noteOff", midi: number): void;
}>();

const range = computed(() => normalizeRange(props.lowNote, props.highNote));

const allNotes = computed(() => {
  const [lo, hi] = range.value;
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
});

const whiteNotes = computed(() => allNotes.value.filter(isWhiteKey));
const blackNotes = computed(() => allNotes.value.filter((n) => !isWhiteKey(n)));

/** Percentage-based widths keep the keyboard responsive. */
const whiteWidth = computed(() => 100 / whiteNotes.value.length);

function blackStyle(n: number) {
  const [lo] = range.value;
  const g = keyGeometry(n, lo, whiteWidth.value);
  return { left: `${g.x}%`, width: `${g.width}%` };
}

const isC = (n: number) => n % 12 === 0;
</script>

<template>
  <div class="wrap">
    <div class="keyboard">
      <!-- white keys -->
      <button
        v-for="n in whiteNotes"
        :key="n"
        class="white"
        :class="{ on: active.has(n) }"
        @pointerdown.prevent="emit('noteOn', n, 100)"
        @pointerup="emit('noteOff', n)"
        @pointerleave="emit('noteOff', n)"
      >
        <span v-if="isC(n)" class="label">{{ noteName(n) }}</span>
      </button>

      <!-- black keys overlaid -->
      <button
        v-for="n in blackNotes"
        :key="n"
        class="black"
        :class="{ on: active.has(n) }"
        :style="blackStyle(n)"
        @pointerdown.prevent="emit('noteOn', n, 100)"
        @pointerup="emit('noteOff', n)"
        @pointerleave="emit('noteOff', n)"
      />
    </div>

    <p class="legend">
      Home row plays white keys (<code>a s d f g h j k</code>), upper row the blacks
      (<code>w e t y u</code>). Or play your MIDI keyboard — every note lights up here.
    </p>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; }
.keyboard {
  position: relative;
  display: flex;
  height: 190px;
  background: #0b0d11;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 8px 10px;
  overflow: hidden;
}
.white {
  position: relative;
  flex: 1;
  background: linear-gradient(180deg, #f2f4f7 0%, #dfe3e9 92%, #c6ccd4 100%);
  border: 1px solid #0b0d11;
  border-radius: 0 0 6px 6px;
  margin-right: 1px;
  cursor: pointer;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 7px;
  transition: background 0.06s, box-shadow 0.06s;
}
.white:last-of-type { margin-right: 0; }
.white.on {
  background: linear-gradient(180deg, #ffd79a 0%, var(--amber) 100%);
  box-shadow: 0 0 18px rgba(255, 179, 64, 0.55) inset;
}
.label {
  font-family: var(--mono);
  font-size: 9.5px;
  color: #7b838f;
  pointer-events: none;
}
.black {
  position: absolute;
  top: 8px;
  height: 62%;
  background: linear-gradient(180deg, #2b3038 0%, #14171c 88%, #0a0c0f 100%);
  border: 1px solid #05070a;
  border-radius: 0 0 5px 5px;
  cursor: pointer;
  z-index: 2;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.6);
  transition: background 0.06s, box-shadow 0.06s;
}
.black.on {
  background: linear-gradient(180deg, #ffc463 0%, #d68f24 100%);
  box-shadow: 0 0 16px rgba(255, 179, 64, 0.6);
}
.legend {
  font-size: 12px;
  color: var(--faint);
  margin: 14px 0 0;
  line-height: 1.5;
}
.legend code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--dim);
}
</style>
