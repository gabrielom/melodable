<script setup lang="ts">
/**
 * What a song opens on: its sections, to pick from (handoff 14, 11m; handoff
 * 15 for piano).
 *
 * The user's rule — opening a combined song puts this up first, and any
 * section can be chosen from it. It is the run summary's sheet with a list in
 * it.
 *
 * **Pads songs** keep handoff 14's single list: one 38px row per part, then
 * the full song under its own rule. Rows rather than tiles because five tiles
 * already fill the sheet's width, while rows hold eight or ten parts without
 * shrinking anything; past what the window holds, the list scrolls and the
 * header and buttons stay put.
 *
 * **Piano songs** learn each part in three steps — right hand, left hand,
 * then both (handoff 15) — and thirteen rows will not fit the 1050 × 620
 * floor, so the sheet splits in two: the parts down the left, each with its
 * three hand chips and its both-hands best, and the chosen part's steps on
 * the right as cards that say what that hand plays. Choosing a part only
 * shows its steps; a card is what plays one.
 *
 * Nothing is locked. The main button plays the suggested step: the first
 * part not yet complete, at its first step not yet passed — or the full song
 * once every part is done. The three states are the stepper's, so the picker
 * and the summary say the same things about a song in the same colours.
 */
import { computed, ref, watch } from "vue";
import type { InstrumentType } from "@/engine/types";
import { pointsToGo, type HandStep, type SongState, type Step } from "@/engine/course";
import { HAND_TITLE, stepName, type StepHand } from "@/engine/hands";
import { useSheetFit } from "@/composables/useSheetFit";

/** A section's run length and tempo, in the song's order, and what each of its steps plays. */
export interface SectionFacts {
  bars: number;
  bpm: number;
  /** The step card's description, per hand the section has. */
  describe?: Partial<Record<StepHand, string>>;
}

const props = defineProps<{
  song: SongState;
  instrument: InstrumentType;
  sections: readonly SectionFacts[];
}>();

const emit = defineEmits<{
  (e: "step", lessonId: string, hand: StepHand): void;
  (e: "lessons"): void;
}>();

const sheet = ref<HTMLElement | null>(null);
useSheetFit(sheet, "SongLightbox");

/** Two panes once any part has hands to learn separately; pads never do. */
const twoPane = computed(() => props.song.steps.some((s) => s.hands.length > 1));

/** The full song is the last section; the meta line describes it. */
const whole = computed(() => props.sections[props.sections.length - 1] ?? null);
const meta = computed(() =>
  [
    props.instrument === "piano" ? "PIANO" : "PADS",
    whole.value ? `${whole.value.bpm} BPM` : null,
    whole.value ? `${whole.value.bars} BARS` : null,
    `${props.song.steps.length} SECTIONS`,
    twoPane.value ? `${props.song.stepCount} STEPS` : null,
  ]
    .filter(Boolean)
    .join(" · "),
);

type Status = { text: string; tone: "quiet" | "mark" };
function statusOf(t: { state: string; best: number | null }): Status {
  if (t.state === "passed") return { text: "PASSED", tone: "quiet" };
  if (t.best !== null) return { text: `${pointsToGo(t.best)} TO GO`, tone: "mark" };
  return { text: "NOT PLAYED", tone: "quiet" };
}

interface Row {
  step: Step;
  index: number;
  bars: number | null;
  next: boolean;
  status: Status;
}
const rows = computed<Row[]>(() =>
  props.song.steps.map((step, index) => ({
    step,
    index,
    bars: props.sections[index]?.bars ?? null,
    next: index === props.song.suggested,
    status: statusOf(step),
  })),
);
const parts = computed(() => rows.value.slice(0, -1));
const full = computed(() => rows.value[rows.value.length - 1]);

/** The suggested part and step, or the full song once every part is done. */
const primary = computed(() => {
  const s = props.song;
  const index = s.suggested ?? s.steps.length - 1;
  const step = s.steps[index];
  const hand: StepHand = s.suggestedHand ?? "BOTH";
  return { step, hand, name: stepName(step.label, hand, step.hands.length > 1) };
});

/** Whether a hand step is the one the song suggests next. */
const isNext = (index: number, hand: StepHand) =>
  index === props.song.suggested && hand === props.song.suggestedHand;

// ------------------------------------------------------------- two panes

/** The part whose steps the right pane shows: the suggested one to begin with. */
const chosen = ref(props.song.suggested ?? props.song.steps.length - 1);
watch(
  () => props.song.steps.length,
  (n) => {
    if (chosen.value >= n) chosen.value = n - 1;
  },
);
const chosenRow = computed(() => rows.value[chosen.value] ?? full.value);

interface Card {
  hs: HandStep;
  title: string;
  describe: string;
  next: boolean;
  status: Status;
}
const cards = computed<Card[]>(() => {
  const r = chosenRow.value;
  if (!r) return [];
  const facts = props.sections[r.index]?.describe ?? {};
  return r.step.hands.map((hs) => ({
    hs,
    title: HAND_TITLE[hs.hand],
    describe: facts[hs.hand] ?? "",
    next: isNext(r.index, hs.hand),
    status: statusOf(hs),
  }));
});
const paneHead = computed(() => {
  const r = chosenRow.value;
  if (!r) return "";
  const n = r.step.hands.length;
  return [r.step.label, r.bars === null ? null : `${r.bars} BARS`, `${n} ${n === 1 ? "STEP" : "STEPS"}`]
    .filter(Boolean)
    .join(" · ");
});

/** "R", "L", "BOTH" — the chips in the parts pane. */
const chipText = (hand: StepHand) => (hand === "BOTH" ? "BOTH" : hand);

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

      <!-- Pads, and any song with no hands to learn apart: handoff 14's list. -->
      <div v-if="!twoPane" class="table">
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
              @click="emit('step', r.step.lessonId, 'BOTH')"
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
              @click="emit('step', full.step.lessonId, 'BOTH')"
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

      <!-- Piano: the parts on the left, the chosen part's steps on the right. -->
      <div v-else class="panes">
        <div class="parts">
          <div class="pgrid phead">
            <span class="lbl">SECTION</span>
            <span class="lbl">HANDS</span>
            <span class="lbl right">BOTH</span>
          </div>
          <div class="plist">
            <div class="pbody">
              <button
                v-for="r in parts"
                :key="r.step.lessonId"
                class="pgrid prow"
                :class="{ chosen: r.index === chosen }"
                :aria-pressed="r.index === chosen"
                :aria-label="`Show the steps of ${sentence(r.step.label)}`"
                @click="chosen = r.index"
              >
                <span class="chip" :class="[r.step.state, { next: r.next }]">
                  {{ r.step.state === "passed" ? "✓ " : "" }}{{ r.step.label }}
                </span>
                <span class="hands">
                  <span
                    v-for="hs in r.step.hands"
                    :key="hs.hand"
                    class="chip"
                    :class="[hs.state, { next: isNext(r.index, hs.hand) }]"
                  >{{ chipText(hs.hand) }}</span>
                </span>
                <span class="pbest num">
                  <template v-if="r.step.best === null"><span class="none">—</span></template>
                  <template v-else>{{ Math.round(r.step.best * 100) }}<small>%</small></template>
                </span>
              </button>
            </div>
            <template v-if="full">
              <div class="pwhole"><span class="lbl">THE WHOLE SONG</span></div>
              <button
                class="pgrid prow"
                :class="{ chosen: full.index === chosen }"
                :aria-pressed="full.index === chosen"
                :aria-label="`Show ${sentence(full.step.label)}`"
                @click="chosen = full.index"
              >
                <span class="chip" :class="[full.step.state, { next: full.next }]">
                  {{ full.step.state === "passed" ? "✓ " : "" }}{{ full.step.label }}
                </span>
                <span class="hands">
                  <span class="chip" :class="[full.step.state, { next: isNext(full.index, 'BOTH') }]">BOTH</span>
                </span>
                <span class="pbest num">
                  <template v-if="full.step.best === null"><span class="none">—</span></template>
                  <template v-else>{{ Math.round(full.step.best * 100) }}<small>%</small></template>
                </span>
              </button>
            </template>
          </div>
        </div>

        <div class="steps">
          <div class="shead">
            <span class="lbl">{{ paneHead }}</span>
            <span class="key"><i /><span class="lbl">80% AT FULL TEMPO PASSES A STEP</span></span>
          </div>
          <div class="cards">
            <button
              v-for="c in cards"
              :key="c.hs.key"
              class="card"
              :class="[c.hs.state, { next: c.next }]"
              :aria-label="`Play ${sentence(chosenRow.step.label)}, ${c.title.toLowerCase()}`"
              @click="emit('step', chosenRow.step.lessonId, c.hs.hand)"
            >
              <span class="crow">
                <span class="chip" :class="[c.hs.state, { next: c.next }]">{{ chipText(c.hs.hand) }}</span>
                <span class="ctitle">{{ c.title }}</span>
                <span class="cbest num">
                  <template v-if="c.hs.best === null"><span class="none">—</span></template>
                  <template v-else>{{ Math.round(c.hs.best * 100) }}<small>%</small></template>
                </span>
                <span class="lbl cstatus" :class="c.status.tone">{{ c.status.text }}</span>
                <span class="play" aria-hidden="true"><i /></span>
              </span>
              <span class="cdesc">{{ c.describe }}</span>
              <span class="best">
                <i v-if="c.hs.best !== null" class="fill" :style="{ width: `${Math.min(1, c.hs.best) * 100}%` }" />
                <i class="tick" />
              </span>
            </button>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="act primary" @click="emit('step', primary.step.lessonId, primary.hand)">
          <i class="tri" aria-hidden="true" /><span>PLAY {{ primary.name }}</span>
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

/* ------------------------------------------------ piano: two panes (15) */
/* Stretched, so the parts pane is exactly as tall as the sheet leaves room
   for and its list can scroll inside that; the steps pane sits at the top. */
.panes { display: flex; gap: 16px; align-items: stretch; flex: 1 1 auto; min-height: 0; }
.parts {
  width: 222px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pgrid {
  display: grid;
  grid-template-columns: 76px 1fr 34px;
  align-items: center;
  gap: 10px;
}
.phead { height: 15px; padding: 0 10px 6px; border-bottom: 1px solid var(--hair); }
.right { text-align: right; }
/* Past about eight parts this scrolls on its own; the steps pane holds still. */
.plist { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.pbody { display: flex; flex-direction: column; padding-top: 4px; }
.prow {
  height: 36px;
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
.prow:hover { background: var(--hover); }
.prow.chosen { background: var(--bed); box-shadow: inset 0 0 0 1px var(--hair); }
.pwhole { margin-top: 4px; padding: 8px 10px 2px; border-top: 1px solid var(--hair); }
.hands { display: flex; gap: 3px; }
.pbest { text-align: right; font-size: 11px; color: var(--txt); }
.pbest small { font-size: 7.5px; color: var(--txt3); }
.pbest .none { color: var(--txt3); }

/* The chips in the parts pane and on the cards: the stepper's three states. */
.panes .chip { box-shadow: inset 0 0 0 1px var(--todo); color: var(--txt2); }
.panes .chip.passed { background: var(--active); color: var(--active-txt); box-shadow: none; }
.panes .chip.next { background: none; box-shadow: inset 0 0 0 1px var(--led1); color: var(--txt); }

.steps { flex: 1; min-width: 0; align-self: flex-start; display: flex; flex-direction: column; }
.shead {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 15px;
  padding: 0 0 6px;
  border-bottom: 1px solid var(--hair);
}
.shead .key { margin-left: auto; }
.cards { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
.card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.card:hover { background: var(--hover); }
.card.next { box-shadow: inset 0 0 0 1.5px var(--led1); }
.crow { display: flex; align-items: center; gap: 8px; }
.ctitle { font-size: 13px; font-weight: 600; letter-spacing: -0.1px; color: var(--txt); }
.cbest { margin-left: auto; font-size: 14px; line-height: 1; color: var(--txt); }
.cbest small { font-size: 8px; color: var(--txt3); }
.cbest .none { color: var(--txt3); }
.cstatus { width: 58px; flex: none; text-align: right; }
.cstatus.mark { color: var(--led1); }
.card .play { flex: none; }
.card.next .play { background: var(--start); color: var(--start-txt); box-shadow: none; }
.cdesc { font-size: 11.5px; line-height: 1.4; color: var(--txt2); }
.card.passed .best .fill { background: var(--mark); }

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
