<script setup lang="ts">
/**
 * A song's sections as a row of tiles: each one's best qualifying run against
 * the 80% mark, and a way into it. Shared by the section picker a song opens
 * on and by the run summary, which shows it in place of the history chart —
 * so both say the same thing about the song in the same shapes.
 *
 * **Every tile is a way in.** Nothing is locked; a section is complete once a
 * run at its own tempo reaches the mark, and still to do until then.
 */
import { pointsToGo, type Step } from "@/engine/course";

const props = defineProps<{
  steps: readonly Step[];
  passedCount: number;
  /** The section offered next — ringed. Null once every section is complete. */
  suggested: number | null;
  /** The section just played, when this follows a run. */
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

/** Under a tile: complete or not, and how far off the mark if it was tried. */
function note(t: Step, i: number): string {
  if (t.state === "passed") return i === props.played && props.justPassed ? "PASSED · THIS RUN" : "PASSED";
  if (t.best !== null) return `${pointsToGo(t.best)} TO GO`;
  return i === props.suggested ? "UP NEXT" : "NOT PLAYED";
}
</script>

<template>
  <div class="song">
    <div class="hhead">
      <span class="ttl">SONG PROGRESS</span>
      <b class="hscore num">{{ passedCount }} / {{ steps.length }}</b>
    </div>
    <div class="tiles">
      <button
        v-for="(t, i) in steps"
        :key="t.lessonId"
        class="tile"
        :class="[t.state, { next: i === suggested }]"
        :aria-label="`Play ${sentence(t.label)}`"
        @click="emit('step', t.lessonId)"
      >
        <span class="chip" :class="[t.state, { next: i === suggested }]">
          {{ t.state === "passed" ? "✓ " : "" }}{{ t.label }}
        </span>
        <b class="pct num">
          <template v-if="t.best === null">—</template>
          <template v-else>{{ Math.round(t.best * 100) }}<i>%</i></template>
        </b>
        <span class="meter">
          <i v-if="t.best !== null" :style="{ width: `${t.best * 100}%` }" />
          <em />
        </span>
        <span class="note">{{ note(t, i) }}</span>
      </button>
    </div>
    <div class="sfoot">
      <span class="mark"><i />80% MARKS A PART COMPLETE</span>
      <span>BEST RUN AT FULL TEMPO</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * Two states and a suggestion, and none of them is a rating colour: green,
 * blue and red judge a *run*, and a complete section wearing green would read
 * as one. So they borrow the app's own conventions — complete inverts to the
 * dark chip, the suggested section wears the amber ring the home screen puts
 * on the card you are on, and the rest are the plain hairline.
 */
.song { display: flex; flex-direction: column; gap: 8px; }
.hhead { display: flex; align-items: baseline; justify-content: space-between; }
.ttl {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.hscore { font-size: 15px; color: var(--txt); }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 6px; }
.tile {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 8px 8px 9px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.tile:hover { background: var(--hover); }
.tile.next { box-shadow: inset 0 0 0 1.5px var(--led1); }
.chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px var(--hair);
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt2);
  white-space: nowrap;
}
.chip.passed { background: var(--active); color: var(--active-txt); box-shadow: none; }
.chip.next { box-shadow: inset 0 0 0 1.5px var(--led1); color: var(--txt); }
.pct { font-size: 20px; font-weight: 400; line-height: 1; color: var(--txt); }
.pct i { margin-left: 1px; font-style: normal; font-size: 10px; color: var(--txt3); }
/* The bar is the section's best; the amber tick is the mark it has to reach. */
.meter { position: relative; height: 4px; border-radius: 1px; background: var(--hair); }
.meter i {
  position: absolute;
  inset: 0 auto 0 0;
  max-width: 100%;
  border-radius: 1px;
  background: var(--txt2);
}
.tile.passed .meter i { background: var(--txt); }
.meter em { position: absolute; left: 80%; top: -3px; bottom: -3px; width: 1.5px; background: var(--led1); }
.note {
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile.next .note { color: var(--led1); }
.sfoot {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.sfoot .mark { display: inline-flex; align-items: center; gap: 5px; }
.sfoot .mark i { width: 1.5px; height: 9px; background: var(--led1); }
</style>
