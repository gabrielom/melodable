<script setup lang="ts">
/**
 * What a song opens on: its sections, to pick from.
 *
 * The user's rule — opening a combined song puts this up first, and any
 * section can be chosen from it. The tiles are `SongProgress`, the same block
 * the run summary shows, so the picker and the result of a run describe the
 * song in one set of shapes. The shell is the run summary's too — same scrim,
 * sheet, head and actions — so the two read as one family of lightbox.
 *
 * Picking a tile plays that section. The main button plays the suggested one —
 * the first not yet complete, or the full song once they all are.
 */
import { computed } from "vue";
import type { InstrumentType } from "@/engine/types";
import type { SongState } from "@/engine/course";
import SongProgress from "@/components/SongProgress.vue";

const props = defineProps<{
  song: SongState;
  instrument: InstrumentType;
}>();

const emit = defineEmits<{
  (e: "step", lessonId: string): void;
  (e: "lessons"): void;
}>();

const meta = computed(() =>
  [
    props.instrument === "piano" ? "PIANO" : "PADS",
    `${props.song.steps.length} SECTIONS`,
    `${props.song.passedCount} COMPLETE`,
  ].join(" · "),
);

/** What the main button plays: the suggestion, or the song itself when all is done. */
const primary = computed(() => {
  const s = props.song;
  return s.steps[s.suggested ?? s.steps.length - 1];
});
</script>

<template>
  <div class="scrim" role="dialog" aria-modal="true" :aria-label="`${song.courseName}: choose a section`">
    <div class="sheet">
      <div class="head">
        <span class="ttl">CHOOSE A SECTION</span>
        <span v-if="song.complete" class="flag">SONG COMPLETE</span>
      </div>

      <div class="about">
        <span class="name">{{ song.courseName }}</span>
        <span class="meta">{{ meta }}</span>
      </div>

      <SongProgress
        :steps="song.steps"
        :passed-count="song.passedCount"
        :suggested="song.suggested"
        @step="(id) => emit('step', id)"
      />

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
  display: grid;
  place-items: center;
  background: #00000088;
}
.sheet {
  width: 620px;
  max-width: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 24px;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair), 0 24px 60px #00000066;
}
.head { display: flex; align-items: center; }
.ttl {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
/* The song's own news, in the amber its suggestion wears — never a rating. */
.flag {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--led1);
}
.about { display: flex; flex-direction: column; gap: 4px; }
/* The home screen's heading size: this is the song's title, not a run's. */
.name { font-size: 17px; font-weight: 600; letter-spacing: -0.2px; color: var(--txt); }
.meta {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  color: var(--txt3);
}

.actions { display: flex; align-items: center; gap: 8px; }
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
.tri {
  width: 0;
  height: 0;
  border-left: 7px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
</style>
