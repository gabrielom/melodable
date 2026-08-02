<script setup lang="ts">
/**
 * End of run. A lesson is a finite piece, so it earns a result screen rather
 * than a toast that disappears before you have read it.
 *
 * The weakest-lane list is the point of the screen: it names the lane, how
 * accurate it was, and — because the loose band is split by direction — which
 * way it drifted. "You rush the snare" is something you can act on.
 */
import { computed } from "vue";
import { PALETTE, ledOf } from "@/engine/theme";
import { useSettings } from "@/stores/settings";
import { PADS } from "@/engine/gm";
import { noteName } from "@/engine/pitch";
import type { InstrumentType, Rating } from "@/engine/types";

const props = defineProps<{
  lessonName: string;
  instrument: InstrumentType;
  bpm: number;
  bars: number;
  repeats: number;
  noteCount: number;
  /** 0..1 over the whole run. */
  accuracy: number;
  bestCombo: number;
  /** Best accuracy for this lesson before this run, if there was one. */
  previousBest: number | null;
  tally: Readonly<Record<Rating, number>>;
  lanes: Array<{ lane: number; accuracy: number; early: number; late: number; total: number }>;
  /** Lane order on screen, for LED identity. */
  laneOrder: number[];
}>();

const emit = defineEmits<{ (e: "again"): void; (e: "lessons"): void }>();

const settings = useSettings();
const palette = computed(() => PALETTE[settings.theme]);

const score = computed(() => Math.round(props.accuracy * 100));
const isNewBest = computed(
  () => props.previousBest === null || props.accuracy > props.previousBest,
);

const meta = computed(() => {
  const parts = [
    props.instrument === "piano" ? "PIANO" : "PADS",
    `${props.bpm} BPM`,
    `${props.bars * props.repeats} BARS`,
    `${props.noteCount * props.repeats} NOTES`,
  ];
  return parts.join(" · ");
});

const ORDER: Rating[] = ["perfect", "great", "early", "late", "miss"];
const LABEL: Record<Rating, string> = {
  perfect: "PERFECT",
  great: "GREAT",
  early: "EARLY",
  late: "LATE",
  miss: "MISS",
};

const graded = computed(() => ORDER.reduce((n, r) => n + (props.tally[r] ?? 0), 0));
/** Segments of the one stacked bar, skipping bands nothing landed in. */
const bands = computed(() =>
  ORDER.map((r) => ({
    rating: r,
    label: LABEL[r],
    count: props.tally[r] ?? 0,
    pct: graded.value ? ((props.tally[r] ?? 0) / graded.value) * 100 : 0,
    colour: palette.value.rating[r],
  })).filter((b) => b.count > 0),
);

/** The three that need work most; a clean run has nothing to show. */
const weakest = computed(() => props.lanes.filter((l) => l.accuracy < 1).slice(0, 3));

const laneName = (lane: number) =>
  props.instrument === "piano" ? noteName(lane) : PADS[lane].name.toUpperCase();
const laneColour = (lane: number) => {
  const i = props.laneOrder.indexOf(lane);
  return props.instrument === "piano" ? palette.value.instrument : ledOf(palette.value, i < 0 ? 0 : i);
};
/** Which way a lane drifted, when it clearly leant one way. */
const drift = (l: { early: number; late: number }): Rating | null => {
  if (l.early === l.late) return null;
  return l.early > l.late ? "early" : "late";
};
</script>

<template>
  <div class="scrim" role="dialog" aria-modal="true" aria-label="Run complete">
    <div class="sheet">
      <div class="head">
        <span class="ttl">RUN COMPLETE</span>
        <span v-if="isNewBest" class="best-flag">NEW BEST</span>
      </div>

      <div class="score-row">
        <span class="score num">{{ score }}</span>
        <span class="about">
          <span class="lesson">{{ lessonName }}</span>
          <span class="meta">{{ meta }}</span>
        </span>
        <span class="stats">
          <span class="stat">
            <i class="k">BEST</i>
            <b class="num">{{ previousBest === null ? "—" : Math.round(previousBest * 100) }}</b>
          </span>
          <span class="stat"><i class="k">COMBO</i><b class="num">{{ bestCombo }}</b></span>
        </span>
      </div>

      <div class="breakdown">
        <div class="bar8">
          <span
            v-for="b in bands"
            :key="b.rating"
            :style="{ width: `${b.pct}%`, background: b.colour }"
          />
        </div>
        <div class="legend">
          <span v-for="b in bands" :key="b.rating" class="leg">
            <i class="swatch" :style="{ background: b.colour }" />{{ b.label }}
            <b class="num">{{ b.count }}</b>
          </span>
        </div>
      </div>

      <div v-if="weakest.length" class="weak">
        <span class="ttl">WEAKEST LANES</span>
        <div v-for="l in weakest" :key="l.lane" class="wrow">
          <i class="chip" :style="{ background: laneColour(l.lane) }" />
          <span class="wname">{{ laneName(l.lane) }}</span>
          <span class="track">
            <i :style="{ width: `${Math.round(l.accuracy * 100)}%`, background: laneColour(l.lane) }" />
          </span>
          <span
            class="drift"
            :style="{ color: drift(l) ? palette.rating[drift(l)!] : 'var(--txt3)' }"
          >{{ drift(l) ? LABEL[drift(l)!] : "—" }}</span>
          <span class="wpct num">{{ Math.round(l.accuracy * 100) }}</span>
        </div>
      </div>

      <div class="actions">
        <button class="act primary" @click="emit('again')">
          <i class="tri" aria-hidden="true" /><span>RUN AGAIN</span>
        </button>
        <button class="act ghost" @click="emit('lessons')">✕ LESSONS</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.best-flag {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--rate-perfect);
}

.score-row { display: flex; align-items: flex-end; gap: 26px; }
.score { font-size: 54px; line-height: 0.9; color: var(--txt); }
.about { display: flex; flex-direction: column; gap: 4px; margin-bottom: 3px; }
.lesson { font-size: 14px; font-weight: 600; color: var(--txt); }
.meta {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  color: var(--txt3);
}
.stats { margin-left: auto; display: inline-flex; align-items: baseline; gap: 18px; }
.stat { display: inline-flex; align-items: baseline; gap: 4px; }
.stat .k {
  font-family: var(--mono);
  font-size: 7.5px;
  font-style: normal;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.stat b { font-size: 17px; font-weight: 400; color: var(--txt); }

/* One bar across every band, so the shape of the run reads at a glance. */
.breakdown { display: flex; flex-direction: column; gap: 8px; }
.bar8 { display: flex; height: 8px; border-radius: 2px; overflow: hidden; background: var(--track); }
.bar8 span { display: block; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; }
.leg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.leg b { font-size: 9.5px; color: var(--txt2); }
.swatch { width: 6px; height: 6px; border-radius: 1px; }

.weak { display: flex; flex-direction: column; gap: 5px; }
.wrow { display: flex; align-items: center; gap: 9px; }
.chip { width: 6px; height: 6px; flex: none; border-radius: 1px; }
.wname {
  width: 92px;
  flex: none;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track { flex: 1; min-width: 0; height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; }
.track i { display: block; height: 100%; }
.drift {
  width: 52px;
  flex: none;
  text-align: right;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
}
.wpct { width: 26px; flex: none; text-align: right; font-size: 11px; color: var(--txt2); }

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
