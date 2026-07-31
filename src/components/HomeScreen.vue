<script setup lang="ts">
/**
 * Home: pick a lesson. This is the app's entry point — the trainer opens on
 * top of it and the X in the transport bar comes back here. It gets the whole
 * window, which is what lets the trainer view drop its lesson header entirely.
 */
import { computed } from "vue";
import type { Lesson } from "@/engine/types";
import { noteToPad, PADS } from "@/engine/gm";
import { noteName } from "@/engine/pitch";

const props = defineProps<{
  lessons: Lesson[];
  currentIndex: number;
}>();

const emit = defineEmits<{ (e: "open", index: number): void }>();

/** What the lesson asks you to play — pads by name, piano by key range. */
function summary(lesson: Lesson): string {
  if (lesson.instrument === "piano") {
    const pitches = lesson.notes.map((n) => n.pitch);
    if (!pitches.length) return "";
    return `${noteName(Math.min(...pitches))} – ${noteName(Math.max(...pitches))}`;
  }
  const names = new Set<string>();
  for (const n of lesson.notes) {
    const pad = noteToPad(n.pitch);
    if (pad !== null) names.add(PADS[pad].name);
  }
  return [...names].join(" · ");
}

const rows = computed(() =>
  props.lessons.map((l, i) => ({
    lesson: l,
    index: i,
    current: i === props.currentIndex,
    summary: summary(l),
  })),
);
</script>

<template>
  <div class="home">
    <header class="head">
      <h1>Choose a lesson</h1>
      <p>{{ lessons.length }} lessons · pick one to start practising</p>
    </header>

    <div class="grid">
      <button
        v-for="row in rows"
        :key="row.lesson.id"
        class="card"
        :class="{ current: row.current }"
        @click="emit('open', row.index)"
      >
        <span class="top">
          <span class="tag" :class="row.lesson.instrument">
            {{ row.lesson.instrument === "piano" ? "PIANO" : "PADS" }}
          </span>
          <span v-if="row.lesson.source === 'midi-import'" class="tag import">IMPORTED</span>
          <span class="bpm">{{ row.lesson.bpm }}<i>BPM</i></span>
        </span>

        <span class="name">{{ row.lesson.name }}</span>
        <span class="hint">{{ row.lesson.hint }}</span>

        <span class="foot">
          <span class="parts">{{ row.summary }}</span>
          <span class="len">
            {{ row.lesson.bars }} bar{{ row.lesson.bars === 1 ? "" : "s" }} ·
            {{ row.lesson.notes.length }} notes
          </span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  overflow-y: auto;
  padding: 8px 4px 24px;
}

.head { margin-bottom: 22px; }
.head h1 {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.4px;
  margin: 0;
}
.head p { margin: 5px 0 0; font-size: 13px; color: var(--dim); }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  text-align: left;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 14px 15px 13px;
  cursor: pointer;
  transition: border-color 0.1s, transform 0.06s, background 0.1s;
}
.card:hover { border-color: #39414d; background: var(--panel2); }
.card:active { transform: translateY(1px); }
.card.current { border-color: #ffb34066; }

.top { display: flex; align-items: center; gap: 6px; width: 100%; }
.tag {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.8px;
  border-radius: 20px;
  padding: 2px 7px;
  border: 1px solid var(--line);
  color: var(--dim);
}
.tag.piano { color: var(--teal); border-color: #37d0c455; }
.tag.pads { color: var(--amber); border-color: #ffb34055; }
.tag.import { color: var(--blue); border-color: #6ea8ff55; }
.bpm {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.bpm i { font-style: normal; font-size: 8.5px; color: var(--faint); margin-left: 3px; }

.name { font-size: 16px; font-weight: 700; color: var(--ink); margin-top: 3px; }
.hint {
  font-size: 12.5px;
  color: var(--dim);
  line-height: 1.45;
  min-height: 2.9em;
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin-top: 4px;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}
.parts {
  font-size: 11.5px;
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.len { font-family: var(--mono); font-size: 10px; color: var(--faint); }
</style>
