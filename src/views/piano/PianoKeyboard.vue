<script setup lang="ts">
/**
 * On-screen piano. Geometry comes from `engine/pitch` — the same function the
 * piano-roll renderer uses to align falling notes to their keys, so the
 * keyboard must stay flush (no outer padding/margins) for the columns to line
 * up with the canvas above it.
 */
import { computed } from "vue";
import { keyGeometry, isWhiteKey, noteName, normalizeRange } from "@/engine/pitch";
import { PALETTE } from "@/engine/theme";
import { useSettings } from "@/stores/settings";
import type { RatingPop } from "@/composables/useTrainer";

const settings = useSettings();
/** Rating colours follow the active theme. */
const palette = computed(() => PALETTE[settings.theme]);

const props = withDefaults(
  defineProps<{
    lowNote?: number;
    highNote?: number;
    /** midi note -> velocity (0-127) for currently-held notes */
    active: Map<number, number>;
    /** transient rating flashes from the scorer (lane === pitch) */
    pops?: RatingPop[];
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

/** Percentage-based widths keep the keyboard responsive and canvas-aligned. */
const whiteWidth = computed(() => 100 / whiteNotes.value.length);

function blackStyle(n: number) {
  const [lo] = range.value;
  const g = keyGeometry(n, lo, whiteWidth.value);
  return { left: `${g.x}%`, width: `${g.width}%` };
}

const flashColor = (n: number): string | null => {
  const pop = props.pops?.find((p) => p.lane === n);
  return pop ? palette.value.rating[pop.rating] : null;
};

const isC = (n: number) => n % 12 === 0;
</script>

<template>
  <div class="keyboard">
    <!-- white keys -->
    <button
      v-for="n in whiteNotes"
      :key="n"
      class="white"
      :class="{ on: active.has(n) }"
      :style="flashColor(n) ? { boxShadow: `inset 0 0 0 2px ${flashColor(n)}, 0 0 16px ${flashColor(n)}` } : {}"
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
      :style="[blackStyle(n), flashColor(n) ? { boxShadow: `0 0 0 2px ${flashColor(n)}, 0 0 14px ${flashColor(n)}` } : {}]"
      @pointerdown.prevent="emit('noteOn', n, 100)"
      @pointerup="emit('noteOff', n)"
      @pointerleave="emit('noteOff', n)"
    />
  </div>
</template>

<style scoped>
.keyboard {
  position: relative;
  display: flex;
  height: 150px;
  background: var(--gutter);
  overflow: hidden;
}
.white {
  position: relative;
  flex: 1;
  background: linear-gradient(180deg, #f2f4f7 0%, #dfe3e9 92%, #c6ccd4 100%);
  border: 1px solid #0b0d11;
  border-radius: 0 0 5px 5px;
  cursor: pointer;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 7px;
  transition: background 0.06s, box-shadow 0.06s;
}
.white.on {
  background: var(--head);
  box-shadow: 0 0 18px color-mix(in srgb, var(--head) 55%, transparent) inset;
}
.label {
  font-family: var(--mono);
  font-size: 9.5px;
  color: #7b838f;
  pointer-events: none;
}
.black {
  position: absolute;
  top: 0;
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
  background: var(--head);
  box-shadow: 0 0 16px color-mix(in srgb, var(--head) 60%, transparent);
}
</style>
