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
    /** The pitches this lesson actually asks for. Only these are named. */
    used?: number[];
    /** Stand the keyboard on its side, for the horizontal roll. */
    rotated?: boolean;
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

/**
 * Black keys ride the white-key axis, which is horizontal normally and
 * vertical when the keyboard is rotated. Same geometry either way — only
 * which pair of properties it lands on changes.
 */
function blackStyle(n: number) {
  const [lo] = range.value;
  const g = keyGeometry(n, lo, whiteWidth.value);
  return props.rotated
    ? { bottom: `${g.x}%`, height: `${g.width}%` }
    : { left: `${g.x}%`, width: `${g.width}%` };
}

const flashColor = (n: number): string | null => {
  const pop = props.pops?.find((p) => p.lane === n);
  return pop ? palette.value.rating[pop.rating] : null;
};

/**
 * Melodics names the targets, not the instrument: only the pitches the lesson
 * uses are labelled and edge-lit, so the player reads four keys rather than a
 * full nameplate. Derived from the lesson, so an imported clip highlights
 * whatever it happens to contain.
 */
const usedSet = computed(() => new Set(props.used ?? []));
const isUsed = (n: number) => usedSet.value.has(n);
</script>

<template>
  <div class="keyboard" :class="{ rotated }">
    <!-- white keys -->
    <button
      v-for="n in whiteNotes"
      :key="n"
      class="white"
      :class="{ on: active.has(n), used: isUsed(n) }"
      :style="flashColor(n) ? { boxShadow: `inset 0 0 0 2px ${flashColor(n)}, 0 0 16px ${flashColor(n)}` } : {}"
      @pointerdown.prevent="emit('noteOn', n, 100)"
      @pointerup="emit('noteOff', n)"
      @pointerleave="emit('noteOff', n)"
    >
      <span v-if="isUsed(n)" class="label">{{ noteName(n) }}</span>
    </button>

    <!-- black keys overlaid -->
    <button
      v-for="n in blackNotes"
      :key="n"
      class="black"
      :class="{ on: active.has(n), used: isUsed(n) }"
      :style="[blackStyle(n), flashColor(n) ? { boxShadow: `0 0 0 2px ${flashColor(n)}, 0 0 14px ${flashColor(n)}` } : {}]"
      @pointerdown.prevent="emit('noteOn', n, 100)"
      @pointerup="emit('noteOff', n)"
      @pointerleave="emit('noteOff', n)"
    >
      <span v-if="isUsed(n)" class="label black-label">{{ noteName(n) }}</span>
    </button>
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
/*
 * Rotated: the same geometry, turned a quarter turn so each key lines up with
 * its own semitone row. `keyGeometry` still drives it — the roll and the
 * keyboard must never derive positions separately.
 */
.keyboard.rotated {
  width: 56px;
  height: auto;
  align-self: stretch;
  flex: none;
  flex-direction: column-reverse;
}
.keyboard.rotated .white {
  border-radius: 0 5px 5px 0;
  align-items: center;
  justify-content: flex-start;
  padding: 0 0 0 4px;
}
.keyboard.rotated .white.used { box-shadow: inset -3px 0 0 var(--key-mark); }
.keyboard.rotated .black {
  top: auto;
  left: 0;
  width: 62%;
  height: auto;
  border-radius: 0 5px 5px 0;
  align-items: center;
  justify-content: flex-start;
}
.keyboard.rotated .black.used {
  box-shadow: inset -3px 0 0 var(--key-mark), 3px 0 6px rgba(0, 0, 0, 0.6);
}
.keyboard.rotated .black-label {
  position: static;
  text-align: left;
  padding-left: 4px;
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
/* Target keys carry the same amber as a held key: an inset edge on the side
   facing the roll, plus the pitch name. */
.white.used { box-shadow: inset 0 3px 0 var(--key-mark); }
.white.used .label { color: var(--key-mark); font-weight: 500; }
.white.on {
  background: linear-gradient(180deg, #ffd79a 0%, var(--key-mark) 100%);
  box-shadow: none;
}
.white.on .label { color: #2a1a02; }
.label {
  font-family: var(--mono);
  font-size: 8px;
  color: #7b838f;
  pointer-events: none;
}
.black {
  position: absolute;
  display: flex;
  align-items: flex-end;
  justify-content: center;
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
.black.used { box-shadow: inset 0 3px 0 var(--key-mark), 0 3px 6px rgba(0, 0, 0, 0.6); }
.black.used .label { color: var(--key-mark); }
.black.on {
  background: linear-gradient(180deg, #ffd79a 0%, var(--key-mark) 100%);
}
.black.on .label { color: #2a1a02; }
.black-label {
  position: absolute;
  bottom: 5px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8px;
}
</style>
