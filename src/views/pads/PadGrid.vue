<script setup lang="ts">
/**
 * 4x4 MPC-style pad grid: trigger sound + visual feedback. During a lesson
 * the lanes in use are emphasized and ratings pop up on the struck pad.
 */
import { PADS } from "@/engine/gm";
import { RATING_COLOR } from "@/engine/types";
import type { RatingPop } from "@/composables/useTrainer";

const props = defineProps<{
  /** pad index -> velocity (0-127) for currently-lit pads */
  active: Map<number, number>;
  /** Pad indices used by the current lesson (emphasized). */
  emphasis?: number[];
  /** Transient rating popups from the scorer. */
  pops?: RatingPop[];
}>();

const emit = defineEmits<{ (e: "trigger", padIndex: number, velocity: number): void }>();

/** Distinct hue per pad, matching the prototype's palette. */
const hue = (i: number) => (i * 47) % 360;
const padColor = (i: number, a = 1) => `hsla(${hue(i)}, 55%, 60%, ${a})`;

const popFor = (i: number) => props.pops?.find((p) => p.lane === i);
const emphasized = (i: number) => props.emphasis?.includes(i) ?? false;

function glow(i: number): Record<string, string> {
  const vel = props.active.get(i);
  if (vel === undefined) {
    return emphasized(i)
      ? { borderColor: padColor(i, 0.7), boxShadow: `0 0 12px ${padColor(i, 0.22)}, inset 0 1px 0 #ffffff10` }
      : {};
  }
  const strength = 0.35 + (vel / 127) * 0.65;
  return {
    background: `radial-gradient(circle at 50% 40%, ${padColor(i, 0.55 * strength)}, #20252d)`,
    boxShadow: `0 0 0 2px ${padColor(i, 0.9)}, 0 0 ${18 * strength}px ${padColor(i, 0.55)}`,
    borderColor: padColor(i, 0.9),
    transform: "translateY(1px) scale(0.985)",
  };
}
</script>

<template>
  <div class="wrap">
    <div class="grid">
      <button
        v-for="(pad, i) in PADS"
        :key="i"
        class="pad"
        :style="glow(i)"
        @pointerdown.prevent="emit('trigger', i, 110)"
      >
        <span class="key" :style="{ color: padColor(i) }">{{ pad.key.toUpperCase() }}</span>
        <span class="name">{{ pad.name }}</span>
        <span class="note">{{ pad.outNote }}</span>
        <span
          v-if="popFor(i)"
          class="pop"
          :style="{ color: RATING_COLOR[popFor(i)!.rating] }"
        >{{ popFor(i)!.rating.toUpperCase() }}</span>
      </button>
    </div>
    <p class="legend">
      Tap a pad, press its key, or play your controller. Note numbers shown bottom-right are
      General MIDI — extend <code>GM_TO_PAD</code> in <code>src/engine/gm.ts</code> if your device
      sends something else.
    </p>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; min-height: 0; }
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 9px;
  max-width: 560px;
}
.pad {
  position: relative;
  aspect-ratio: 1 / 0.74;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #1a1e24;
  box-shadow: inset 0 1px 0 #ffffff08;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-start;
  padding: 9px 10px;
  cursor: pointer;
  transition: transform 0.05s, box-shadow 0.05s, background 0.08s;
}
.pad:active { transform: translateY(1px) scale(0.985); }
.key {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
}
.name {
  font-size: 11.5px;
  font-weight: 600;
  color: #c4ccd6;
  text-align: left;
  line-height: 1.15;
}
.note {
  position: absolute;
  right: 9px;
  bottom: 8px;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--faint);
}
.pop {
  position: absolute;
  top: 4px;
  right: 8px;
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  animation: rise 0.5s ease-out forwards;
  pointer-events: none;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(6px); }
  20% { opacity: 1; }
  to { opacity: 0; transform: translateY(-12px); }
}
.legend {
  font-size: 12px;
  color: var(--faint);
  margin: 14px 0 0;
  max-width: 560px;
  line-height: 1.5;
}
.legend code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--dim);
}
</style>
