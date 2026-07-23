<script setup lang="ts">
/**
 * 4x4 MPC-style pad grid. M1 scope: trigger sound + visual feedback.
 * M2 adds the falling-note lane above this (see PadLanes.ts in the plan).
 */
import { PADS } from "@/engine/gm";

const props = defineProps<{
  /** pad index -> velocity (0-127) for currently-lit pads */
  active: Map<number, number>;
}>();

const emit = defineEmits<{ (e: "trigger", padIndex: number, velocity: number): void }>();

/** Distinct hue per pad, matching the prototype's palette. */
const hue = (i: number) => (i * 47) % 360;
const padColor = (i: number, a = 1) => `hsla(${hue(i)}, 55%, 60%, ${a})`;

function glow(i: number): Record<string, string> {
  const vel = props.active.get(i);
  if (vel === undefined) return {};
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
