<script setup lang="ts">
/**
 * A song's sections as a stepper, under the run summary's history chart
 * (handoff 14, 11i). One node per section in the song's order — a dot, its
 * positional label, its best qualifying run — on a track filled as far as the
 * section the song suggests next.
 *
 * **Every node is a way in.** Nothing is locked; a section is complete once a
 * run at its own tempo reaches the mark, and still to do until then. The
 * section picker says the same things as a list (`SongLightbox`), in the same
 * three states.
 */
import { computed } from "vue";
import { pointsToGo, type Step } from "@/engine/course";

const props = defineProps<{
  steps: readonly Step[];
  passedCount: number;
  /** The section offered next — ringed. Null once every section is complete. */
  suggested: number | null;
  /** The section just played. */
  played?: number | null;
  /** That run is what completed it. */
  justPassed?: boolean;
}>();

const emit = defineEmits<{ (e: "step", lessonId: string): void }>();

/** "PART B" → "Part B", "FULL SONG" → "Full song". */
const sentence = (label: string) =>
  label
    .split(" ")
    .map((w, i) => (w.length === 1 ? w : i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");

/**
 * The track runs centre to centre; the fill from the first centre to the
 * suggested section's, or to the last once there is nothing left to suggest.
 */
const n = computed(() => props.steps.length);
const track = computed(() => {
  const edge = 50 / n.value;
  const to = props.suggested ?? n.value - 1;
  return { edge: `${edge}%`, fill: `${(to * 100) / n.value}%` };
});

type Status = { text: string; tone: "quiet" | "ink" | "mark" };
function status(t: Step, i: number): Status {
  if (t.state === "passed") {
    return i === props.played && props.justPassed
      ? { text: "JUST PASSED", tone: "ink" }
      : { text: "PASSED", tone: "quiet" };
  }
  if (t.best !== null) return { text: `${pointsToGo(t.best)} TO GO`, tone: "mark" };
  return { text: "NOT PLAYED", tone: "quiet" };
}
</script>

<template>
  <div class="song">
    <div class="shead">
      <span class="ttl">SONG PROGRESS</span>
      <span class="key"><i />80% AT FULL TEMPO COMPLETES A PART</span>
      <b class="count num">{{ passedCount }} / {{ steps.length }}</b>
    </div>
    <div class="stepper" :style="{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }">
      <i class="track" :style="{ left: track.edge, right: track.edge }" />
      <i class="fill" :style="{ left: track.edge, width: track.fill }" />
      <button
        v-for="(t, i) in steps"
        :key="t.lessonId"
        class="node"
        :class="[t.state, { next: i === suggested }]"
        :aria-label="`Play ${sentence(t.label)}`"
        @click="emit('step', t.lessonId)"
      >
        <span class="dot">{{ t.state === "passed" ? "✓" : "" }}</span>
        <span class="label">{{ t.label }}</span>
        <span class="result">
          <b class="pct num" :class="{ none: t.best === null }">{{ t.best === null ? "—" : `${Math.round(t.best * 100)}%` }}</b>
          <span class="status" :class="status(t, i).tone">{{ status(t, i).text }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/*
 * Two states and a suggestion, and none of them is a rating colour: green,
 * blue and red judge a *run*, and a complete section wearing green would read
 * as one. Complete is the solid mark, the suggestion the amber ring the home
 * screen puts on the card you are on, the rest the to-do hairline.
 */
.song { display: flex; flex-direction: column; gap: 10px; }
.shead { display: flex; align-items: center; gap: 10px; }
.ttl {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 0.9px;
  color: var(--txt3);
}
.key i { width: 2px; height: 9px; background: var(--led1); }
.count { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--txt); }

.stepper { position: relative; display: grid; }
.track { position: absolute; top: 7px; height: 1px; background: var(--hair); }
.fill { position: absolute; top: 6.5px; height: 2px; background: var(--mark); }

.node {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 0 0 2px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.node:hover .label { color: var(--txt); text-decoration: underline; text-underline-offset: 2px; }

.dot {
  width: 15px;
  height: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--todo);
  transform: scale(0.85);
  font-size: 8px;
  line-height: 1;
  color: var(--mark-ink);
}
.node.passed .dot { background: var(--mark); box-shadow: none; transform: none; }
.node.next .dot { box-shadow: inset 0 0 0 2.5px var(--led1); transform: none; }

.label {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt2);
  white-space: nowrap;
}
.node.passed .label,
.node.next .label { color: var(--txt); }

.result { display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
.pct { font-size: 11px; font-weight: 400; color: var(--txt); }
.pct.none { color: var(--txt3); }
.status {
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 0.9px;
}
.status.quiet { color: var(--txt3); }
.status.ink { color: var(--txt); }
.status.mark { color: var(--led1); }
</style>
