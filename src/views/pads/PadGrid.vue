<script setup lang="ts">
/**
 * The pads the current lesson actually uses — not the whole 4x4.
 *
 * Each tile names the drum, shows where it sits on the controller (a mini
 * grid with that cell lit, plus a position label like "A1"), its computer-key
 * binding and its MIDI note. Tiles are playable for mouse-only practice.
 *
 * The physical arrangement follows the player's controller: a 4x4 MPC grid,
 * or 2x8 for two-row controllers like the Launchkey.
 */
import { computed } from "vue";
import { PADS, padPosition } from "@/engine/gm";
import { RATING_COLOR } from "@/engine/types";
import type { PadLayout } from "@/stores/settings";
import type { RatingPop } from "@/composables/useTrainer";

const props = withDefaults(
  defineProps<{
    /** pad index -> velocity (0-127) for currently-lit pads */
    active: Map<number, number>;
    /** Pad indices used by the current lesson — the only ones shown. */
    emphasis?: number[];
    pops?: RatingPop[];
    layout?: PadLayout;
  }>(),
  { layout: "4x4" },
);

const emit = defineEmits<{
  (e: "trigger", padIndex: number, velocity: number): void;
}>();

/** Distinct hue per pad, matching the falling-note lane colours. */
const hue = (i: number) => (i * 47) % 360;
const padColor = (i: number, a = 1) => `hsla(${hue(i)}, 55%, 60%, ${a})`;

const shown = computed(() => {
  const list = props.emphasis?.length ? props.emphasis : [];
  return list.map((i) => ({
    index: i,
    pad: PADS[i],
    pos: padPosition(i, props.layout),
  }));
});

/** Cells of the mini grid, in reading order, flagged when they are this pad. */
function cells(index: number) {
  const p = padPosition(index, props.layout);
  const out: boolean[] = [];
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) out.push(r === p.row && c === p.col);
  }
  return out;
}

const popFor = (i: number) => props.pops?.find((p) => p.lane === i);

function tileStyle(i: number): Record<string, string> {
  const vel = props.active.get(i);
  if (vel === undefined) return { borderColor: padColor(i, 0.45) };
  const strength = 0.35 + (vel / 127) * 0.65;
  return {
    borderColor: padColor(i, 0.9),
    background: `radial-gradient(circle at 50% 30%, ${padColor(i, 0.4 * strength)}, #1a1e24)`,
    boxShadow: `0 0 ${16 * strength}px ${padColor(i, 0.45)}`,
  };
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <span class="ttl">PADS IN THIS LESSON</span>
      <span class="lay">{{ layout === "2x8" ? "2×8" : "4×4" }}</span>
    </div>

    <div class="tiles">
      <button
        v-for="t in shown"
        :key="t.index"
        class="tile"
        :style="tileStyle(t.index)"
        @pointerdown.prevent="emit('trigger', t.index, 110)"
      >
        <span
          class="mini"
          :style="{ gridTemplateColumns: `repeat(${t.pos.cols}, 1fr)` }"
          aria-hidden="true"
        >
          <i
            v-for="(on, ci) in cells(t.index)"
            :key="ci"
            :class="{ on }"
            :style="on ? { background: padColor(t.index) } : {}"
          />
        </span>

        <span class="text">
          <span class="name">{{ t.pad.name }}</span>
          <span class="meta">
            <b :style="{ color: padColor(t.index) }">{{ t.pos.label }}</b>
            · {{ t.pad.key.toUpperCase() }} · {{ t.pad.outNote }}
          </span>
        </span>

        <span
          v-if="popFor(t.index)"
          class="pop"
          :style="{ color: RATING_COLOR[popFor(t.index)!.rating] }"
        >{{ popFor(t.index)!.rating.toUpperCase() }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; gap: 9px; }

.head { display: flex; align-items: center; gap: 12px; }
.ttl {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 1.5px;
  color: var(--faint);
}
.lay {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--dim);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 1px 8px;
}

.tiles { display: flex; flex-wrap: wrap; gap: 8px; }

.tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1a1e24;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px 8px 9px;
  cursor: pointer;
  transition: transform 0.05s, box-shadow 0.06s, background 0.08s;
}
.tile:active { transform: translateY(1px) scale(0.99); }

.mini {
  display: grid;
  gap: 2px;
  flex: none;
}
.mini i {
  width: 5px;
  height: 5px;
  border-radius: 1.5px;
  background: #2b313a;
  display: block;
}
.mini i.on { box-shadow: 0 0 5px currentColor; }

.text { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
.name { font-size: 13px; font-weight: 600; color: #dfe4ea; line-height: 1.2; }
.meta {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--faint);
  letter-spacing: 0.3px;
}
.meta b { font-weight: 700; }

.pop {
  position: absolute;
  top: -8px;
  right: 6px;
  font-family: var(--mono);
  font-size: 10px;
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
</style>
