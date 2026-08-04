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
import { lessonRepeats } from "@/engine/scoring";

const props = defineProps<{
  lessons: Lesson[];
  currentIndex: number;
}>();

const emit = defineEmits<{ (e: "open", index: number): void; (e: "import"): void }>();

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

/**
 * How long a run of this lesson takes at its base tempo. A lesson is a finite
 * piece now, so the length you are committing to matters more than the length
 * of the pattern it repeats.
 */
function runLength(lesson: Lesson): string {
  const repeats = lessonRepeats(lesson);
  const bars = lesson.bars * repeats;
  const secs = Math.round((bars * lesson.beatsPerBar * 60) / lesson.bpm);
  return `${bars} bar${bars === 1 ? "" : "s"} · ${secs}s`;
}

const rows = computed(() =>
  props.lessons.map((l, i) => ({
    lesson: l,
    index: i,
    current: i === props.currentIndex,
    summary: summary(l),
    length: runLength(l),
  })),
);
</script>

<template>
  <div class="home">
    <div class="head">
      <h1>Choose a lesson</h1>
      <span class="kicker">PICK ONE TO START PRACTISING</span>
    </div>

    <div class="grid">
      <button
        v-for="row in rows"
        :key="row.lesson.id"
        class="card"
        :class="{ current: row.current }"
        @click="emit('open', row.index)"
      >
        <span class="top">
          <span class="kind"><i class="dot" :class="row.lesson.instrument" />{{
            row.lesson.instrument === "piano" ? "PIANO" : "PADS"
          }}</span>
          <span v-if="row.lesson.source === 'midi-import'" class="flag">IMPORTED</span>
          <span v-else-if="row.current" class="flag resume">RESUME</span>
          <span class="bpm num">{{ row.lesson.bpm }}<i>BPM</i></span>
        </span>

        <span class="name">{{ row.lesson.name }}</span>
        <span class="hint">{{ row.lesson.hint }}</span>

        <span class="foot">
          <span class="parts">{{ row.summary }}</span>
          <span class="len">{{ row.length }}</span>
        </span>
      </button>

      <!-- The library's last slot is the way to add to it. -->
      <button class="card import" @click="emit('import')">
        <span class="imp-glyph" aria-hidden="true">⇪</span>
        <span class="imp-title">Import a MIDI clip</span>
        <span class="imp-sub">.MID FROM YOUR DAW</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 14px;
  background: var(--win);
}

.head { display: flex; align-items: baseline; gap: 10px; flex: none; }
h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--txt);
}
.kicker {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  color: var(--txt3);
}

/*
 * Sizes from the handoff's "10a home" frame: a 1180px screen with 14px of
 * body padding either side, four columns and an 8px gap gives
 * (1152 - 24) / 4 = 282px, and its two rows measure 196.5.
 *
 * The two axes are deliberately different. 282px is the column's *minimum*,
 * so cards share out whatever width is going and a resize adds or drops a
 * column rather than leaving a ragged margin. The height is a flat 196px and
 * does not negotiate: rows would otherwise stretch to divide the stage, so a
 * library of three lessons would draw three enormous cards.
 *
 * `align-content: start` keeps the rows packed at the top once they no longer
 * fill the height.
 */
.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(282px, 1fr));
  grid-auto-rows: 196px;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 13px 11px;
  border: none;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair);
  text-align: left;
  cursor: pointer;
}
.card:hover { background: var(--hover); }
/* The lesson you are on swaps the outline rather than filling. */
.card.current { box-shadow: inset 0 0 0 1px var(--led1); }
.card:focus-visible { outline: 1px solid var(--head); outline-offset: 1px; }

.top { display: flex; align-items: center; gap: 7px; }
.kind {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt2);
}
.dot { width: 4px; height: 4px; flex: none; border-radius: 50%; background: var(--led1); }
/* Piano's dot names an instrument, not a rating, so it keeps its own hue. */
.dot.piano { background: var(--rate-great); }
.flag {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.flag.resume { color: var(--led1); }
.bpm {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  font-size: 11px;
  color: var(--txt);
}
.bpm i {
  font-style: normal;
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}

.name { margin-top: 2px; font-size: 14px; font-weight: 600; color: var(--txt); }
.hint {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--txt2);
  /* Two lines, always: the min-height reserves the second one so footers line
     up across a row, and the clamp stops a longer hint from pushing the
     footer past the bottom of a card that no longer grows to fit it. Every
     hint in the handoff is one or two lines. */
  min-height: 33px;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  overflow: hidden;
  text-wrap: pretty;
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* The handoff's 5px, not `auto`. `auto` pinned the footer to the bottom of
     the card and left the slack in the middle; the drawing runs the content
     straight down from the top and leaves the slack underneath. */
  margin-top: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--hair);
}
.parts {
  font-size: 11px;
  color: var(--txt2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.len {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: var(--txt3);
}

/* Outline only — it is an action, not a lesson. */
.card.import {
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
}
.card.import:hover { background: var(--hover); }
.imp-glyph { font-size: 17px; color: var(--txt2); }
.imp-title { font-size: 12.5px; color: var(--txt2); }
.imp-sub {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  color: var(--txt3);
}
</style>
