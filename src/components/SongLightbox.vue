<script setup lang="ts">
/**
 * What a song opens on: its sections, to pick from (handoff 14, 11m).
 *
 * The user's rule — opening a combined song puts this up first, and any
 * section can be chosen from it. It is the run summary's sheet with a list in
 * it: one 38px row per part, then the full song under its own rule. Rows
 * rather than tiles because five tiles already fill the sheet's width, while
 * rows hold eight or ten parts without shrinking anything; past what the
 * window holds, the list scrolls and the header and buttons stay put.
 *
 * Every row plays its part — nothing is locked. The main button plays the
 * suggested one: the first not yet complete, or the full song once they all
 * are. The three states are the stepper's, so the picker and the summary say
 * the same things about a song in the same colours.
 */
import { computed, ref } from "vue";
import type { InstrumentType } from "@/engine/types";
import { pointsToGo, type SongState, type Step } from "@/engine/course";
import { useSheetFit } from "@/composables/useSheetFit";

/** A section's run length and tempo, in the song's order. */
export interface SectionFacts {
  bars: number;
  bpm: number;
}

const props = defineProps<{
  song: SongState;
  instrument: InstrumentType;
  sections: readonly SectionFacts[];
}>();

const emit = defineEmits<{
  (e: "step", lessonId: string): void;
  (e: "lessons"): void;
}>();

const sheet = ref<HTMLElement | null>(null);
useSheetFit(sheet, "SongLightbox");

/** The full song is the last section; the meta line describes it. */
const whole = computed(() => props.sections[props.sections.length - 1] ?? null);
const meta = computed(() =>
  [
    props.instrument === "piano" ? "PIANO" : "PADS",
    whole.value ? `${whole.value.bpm} BPM` : null,
    whole.value ? `${whole.value.bars} BARS` : null,
    `${props.song.steps.length} SECTIONS`,
  ]
    .filter(Boolean)
    .join(" · "),
);

interface Row {
  step: Step;
  index: number;
  bars: number | null;
  next: boolean;
  status: { text: string; tone: "quiet" | "mark" };
}
const rows = computed<Row[]>(() =>
  props.song.steps.map((step, index) => ({
    step,
    index,
    bars: props.sections[index]?.bars ?? null,
    next: index === props.song.suggested,
    status:
      step.state === "passed"
        ? { text: "PASSED", tone: "quiet" }
        : step.best !== null
          ? { text: `${pointsToGo(step.best)} TO GO`, tone: "mark" }
          : { text: "NOT PLAYED", tone: "quiet" },
  })),
);
const parts = computed(() => rows.value.slice(0, -1));
const full = computed(() => rows.value[rows.value.length - 1]);

/** What the main button plays: the suggestion, or the song itself when all is done. */
const primary = computed(() => {
  const s = props.song;
  return s.steps[s.suggested ?? s.steps.length - 1];
});

/** "PART B" → "Part B", "FULL SONG" → "Full song". */
const sentence = (label: string) =>
  label
    .split(" ")
    .map((w, i) => (w.length === 1 ? w : i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
</script>

<template>
  <div class="scrim" role="dialog" aria-modal="true" :aria-label="`${song.courseName}: choose a section`">
    <div ref="sheet" class="sheet">
      <div class="head">
        <span class="ttl">CHOOSE A SECTION</span>
        <b class="count num">{{ song.passedCount }} / {{ song.steps.length }}</b>
      </div>

      <div class="about">
        <span class="name">{{ song.courseName }}</span>
        <span class="ttl">{{ meta }}</span>
      </div>

      <div class="table">
        <div class="cols thead">
          <span class="lbl">SECTION</span>
          <span class="lbl">LENGTH</span>
          <span class="bestlbl">
            <span class="lbl">BEST AT FULL TEMPO</span>
            <span class="key"><i /><span class="lbl">80% AT FULL TEMPO COMPLETES A PART</span></span>
          </span>
          <span />
          <span class="lbl">STATUS</span>
          <span />
        </div>

        <div class="list">
          <template v-for="(r, i) in parts" :key="r.step.lessonId">
            <i v-if="i > 0" class="sep" />
            <button
              class="cols row"
              :class="[r.step.state, { next: r.next }]"
              :aria-label="`Play ${sentence(r.step.label)}`"
              @click="emit('step', r.step.lessonId)"
            >
              <span class="chip">{{ r.step.state === "passed" ? "✓ " : "" }}{{ r.step.label }}</span>
              <span class="lbl">{{ r.bars === null ? "" : `${r.bars} BARS` }}</span>
              <span class="best">
                <i v-if="r.step.best !== null" class="fill" :style="{ width: `${Math.min(1, r.step.best) * 100}%` }" />
                <i class="tick" />
              </span>
              <span class="score num">
                <template v-if="r.step.best === null"><span class="none">—</span></template>
                <template v-else>{{ Math.round(r.step.best * 100) }}<small>%</small></template>
              </span>
              <span class="lbl status" :class="r.status.tone">{{ r.status.text }}</span>
              <span class="play" aria-hidden="true"><i /></span>
            </button>
          </template>

          <template v-if="full">
            <i class="rule" />
            <span class="lbl whole">THE WHOLE SONG</span>
            <button
              class="cols row full"
              :class="[full.step.state, { next: full.next }]"
              :aria-label="`Play ${sentence(full.step.label)}`"
              @click="emit('step', full.step.lessonId)"
            >
              <span class="chip">{{ full.step.state === "passed" ? "✓ " : "" }}{{ full.step.label }}</span>
              <span class="lbl">{{ full.bars === null ? "" : `${full.bars} BARS` }}</span>
              <span class="best">
                <i v-if="full.step.best !== null" class="fill" :style="{ width: `${Math.min(1, full.step.best) * 100}%` }" />
                <i class="tick" />
              </span>
              <span class="score num">
                <template v-if="full.step.best === null"><span class="none">—</span></template>
                <template v-else>{{ Math.round(full.step.best * 100) }}<small>%</small></template>
              </span>
              <span class="lbl status" :class="full.status.tone">{{ full.status.text }}</span>
              <span class="play" aria-hidden="true"><i /></span>
            </button>
          </template>
        </div>
      </div>

      <div class="actions">
        <button class="act primary" @click="emit('step', primary.lessonId)">
          <i class="tri" aria-hidden="true" /><span>PLAY {{ primary.label }}</span>
        </button>
        <button class="act ghost" @click="emit('lessons')">✕ LESSONS</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The run summary's shell, value for value, so the two lightboxes match. */
.scrim {
  position: absolute;
  inset: 0;
  z-index: 60;
  /* Flex, not the summary's grid: the sheet's percentage max-height has to
     resolve against the scrim, and a grid item in an auto-sized track has
     nothing to resolve it against — it silently grew past the window. */
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--scrim);
}
/* 620px of content, border-box. Never taller than the window leaves under
   the bar with a bar's height to spare below: past that the list scrolls. */
.sheet {
  width: 668px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 68px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 24px;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: 0 24px 60px #00000066, inset 0 0 0 1px var(--hair);
}

.ttl {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.lbl {
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 0.9px;
  color: var(--txt3);
}

.head { display: flex; align-items: baseline; gap: 10px; }
/* The same figure the summary's SONG PROGRESS carries. */
.count { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--txt); }
.about { display: flex; flex-direction: column; gap: 5px; }
.name { font-size: 19px; font-weight: 600; letter-spacing: -0.2px; color: var(--txt); }

.table { display: flex; flex-direction: column; min-height: 0; }
.cols {
  display: grid;
  grid-template-columns: 96px 58px 1fr 44px 74px 20px;
  gap: 12px;
}
.thead { padding: 0 10px 6px; border-bottom: 1px solid var(--hair); }
.bestlbl { display: flex; gap: 12px; }
.key { display: flex; align-items: center; gap: 5px; }
.key i { width: 2px; height: 9px; flex: none; background: var(--led1); }

.list { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.sep { height: 1px; flex: none; background: var(--bed); }
.rule { height: 1px; flex: none; margin-top: 4px; background: var(--hair); }
.whole { padding: 8px 10px 0; }

.row {
  align-items: center;
  height: 38px;
  flex: none;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.row.full { margin-top: 2px; }
.row:hover { background: var(--hover); }
.row.next { box-shadow: inset 0 0 0 1.5px var(--led1); }

.chip {
  display: flex;
  align-items: center;
  height: 15px;
  width: fit-content;
  padding: 0 5px;
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px var(--hair);
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 0.9px;
  color: var(--txt2);
  white-space: nowrap;
}
.row.passed .chip { background: var(--active); color: var(--active-txt); box-shadow: none; }
.row.next .chip { box-shadow: inset 0 0 0 1px var(--led1); color: var(--txt); }

/* The section's best against the mark it has to reach. */
.best {
  position: relative;
  display: block;
  height: 4px;
  border-radius: 1px;
  background: var(--bed);
  box-shadow: inset 0 0 0 1px var(--hair);
}
.best .fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 1px;
  background: var(--chart-line);
}
.row.passed .best .fill { background: var(--mark); }
.best .tick {
  position: absolute;
  left: calc(80% - 1px);
  top: -3px;
  width: 2px;
  height: 10px;
  background: var(--led1);
}

.score { text-align: right; font-size: 14px; line-height: 1; color: var(--txt); }
.score small { font-size: 8px; color: var(--txt3); }
.score .none { color: var(--txt3); }
.status.mark { color: var(--led1); }

.play {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-field);
  box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--txt2);
}
.row.next .play { background: var(--start); color: var(--start-txt); box-shadow: none; }
.play i,
.tri {
  width: 0;
  height: 0;
  flex: none;
  border-left: 6px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.play i { margin-left: 1px; }

.actions { display: flex; align-items: center; gap: 8px; margin-top: 2px; flex: none; }
.act {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: none;
  border-radius: var(--r-field);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  cursor: pointer;
}
.act.primary { background: var(--start); color: var(--start-txt); }
.act.ghost { margin-left: auto; background: none; color: var(--txt2); }
.act.ghost:hover { background: var(--hover); color: var(--txt); }
</style>
