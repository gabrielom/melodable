<script setup lang="ts">
/**
 * The key list: `AUTO` with what it reads the notes as, then the fifteen
 * major keys, flats to sharps. The trainer's `KEY` chip opens it, and so does
 * the chip on a piano card in edit mode (handoff 14, 11l) — one menu, so the
 * two can never offer different choices.
 *
 * Where it hangs is the opener's business: the bar anchors it under its chip,
 * a card places it in the viewport so the scrolling grid cannot clip it.
 */
import { keyName } from "@/engine/notation";
import { KEY_RANGE } from "@/engine/lesson-edit";

defineProps<{
  /** The key chosen by hand, in fifths; null when it is read off the notes. */
  value: number | null;
  /** What `AUTO` reads the notes as. */
  auto: number;
}>();

const emit = defineEmits<{ (e: "pick", fifths: number | null): void }>();

const KEYS = Array.from({ length: KEY_RANGE.max - KEY_RANGE.min + 1 }, (_, i) => KEY_RANGE.min + i);
const marks = (f: number) => (f === 0 ? "—" : `${Math.abs(f)} ${f > 0 ? "♯" : "♭"}`);
</script>

<template>
  <div class="menu key-menu" role="menu" data-tauri-drag-region="false">
    <div class="menu-head">KEY</div>
    <button
      class="menu-row"
      :class="{ on: value === null }"
      role="menuitemradio"
      :aria-checked="value === null"
      @click="emit('pick', null)"
    >
      AUTO<i>{{ keyName(auto) }}</i>
    </button>
    <button
      v-for="f in KEYS"
      :key="f"
      class="menu-row"
      :class="{ on: value === f }"
      role="menuitemradio"
      :aria-checked="value === f"
      @click="emit('pick', f)"
    >
      {{ keyName(f) }}<i>{{ marks(f) }}</i>
    </button>
  </div>
</template>

<style scoped>
/* The dropdowns' one surface, hairline outline — the same as every menu the
   bar opens. */
.menu {
  z-index: 40;
  /* What the trainer's menu has always rendered at: the bar's shared `.menu`
     width, which outranks its own narrower `.key-menu` rule on source order. */
  width: 200px;
  max-height: 268px;
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair), 0 12px 30px #00000055;
}
.menu-head {
  padding: 6px 8px 5px;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.menu-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--r-item);
  background: none;
  color: var(--txt2);
  font-family: var(--sans);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.menu-row:hover { background: var(--hover); }
.menu-row.on { background: var(--active); color: var(--active-txt); }
/* The key a choice spells, pushed right and set in mono so the column reads
   down the list. */
.menu-row i {
  margin-left: auto;
  font-style: normal;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--txt3);
}
.menu-row.on i { color: var(--active-txt); opacity: 0.7; }
</style>
