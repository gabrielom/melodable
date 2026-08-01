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
import { PALETTE, ledOf, ledUpcoming } from "@/engine/theme";
import { useSettings } from "@/stores/settings";
import type { PadLayout } from "@/stores/settings";
import type { RatingPop } from "@/composables/useTrainer";

const settings = useSettings();
/** Rating colours follow the active theme. */
const palette = computed(() => PALETTE[settings.theme]);

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

/**
 * The pad's LED, matching the lane it catches in the note view. Indexed by
 * position on screen (not the pad number) so the two always agree.
 */
const ledIndex = (i: number) => (props.emphasis ?? []).indexOf(i);
const padColor = (i: number) => ledOf(palette.value, ledIndex(i));
const padGlow = (i: number) => ledUpcoming(palette.value, ledIndex(i));

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
  // Idle: the LED reads as a left edge, echoing the lane gutter's stripe.
  if (vel === undefined) return { boxShadow: `inset 3px 0 0 ${padColor(i)}` };
  const strength = 0.35 + (vel / 127) * 0.65;
  return {
    background: padGlow(i),
    boxShadow: `inset 3px 0 0 ${padColor(i)}, 0 0 ${14 * strength}px ${padGlow(i)}`,
  };
}
</script>

<template>
  <div class="wrap">
    <div class="tiles">
      <button
        v-for="t in shown"
        :key="t.index"
        class="tile"
        :style="tileStyle(t.index)"
        :title="`${t.pad.name} — pad ${t.pos.label}, key ${t.pad.key.toUpperCase()}, MIDI note ${t.pad.outNote}`"
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

        <span class="name">{{ t.pad.name }}</span>

        <span
          v-if="popFor(t.index)"
          class="pop"
          :style="{ color: palette.rating[popFor(t.index)!.rating] }"
        >{{ popFor(t.index)!.rating.toUpperCase() }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; padding-top: 10px; }

/* Always a single row: tiles share the width rather than wrapping, so a
   six-pad lesson costs the same height as a three-pad one. */
.tiles {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 5px;
}

.tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  background: var(--gutter);
  border: none;
  box-shadow: var(--outline);
  border-radius: var(--r-panel);
  padding: 6px 8px;
  cursor: pointer;
  transition: transform 0.05s, box-shadow 0.06s, background 0.08s;
}
.tile:active { transform: translateY(1px) scale(0.99); }

.mini {
  display: grid;
  gap: 1px;
  flex: none;
}
.mini i {
  width: 3px;
  height: 3px;
  border-radius: 1px;
  background: var(--hair);
  display: block;
}
.mini i.on { box-shadow: 0 0 5px currentColor; }

/* The name wraps to a second line rather than truncating; position is
   carried by the mini grid, and the tile's title has the full detail. */
.name {
  min-width: 0;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--txt);
  line-height: 1.15;
  text-align: left;
  overflow-wrap: break-word;
}

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
