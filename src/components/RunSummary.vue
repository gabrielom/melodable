<script setup lang="ts">
/**
 * End of run. A lesson is a finite piece, so it earns a result screen rather
 * than a toast that disappears before you have read it.
 *
 * The run-history chart answers whether you are getting better, which takes
 * more than one run. Handoff 09 put it in place of a ranked list of your worst
 * lanes; the user missed the list, so both are here now. Handoff 14 (11i)
 * drew them as one figure: the lanes are bars on the chart's own 0–100 axis,
 * to its right, with this run's score carried across them as a dashed line —
 * so they cost the chart no width and none of its type shrinks.
 */
import { computed, ref } from "vue";
import { PALETTE, hueOf } from "@/engine/theme";
import { PADS } from "@/engine/gm";
import { noteName } from "@/engine/pitch";
import type { WeakLane } from "@/engine/scoring";
import { useSettings } from "@/stores/settings";
import type { HoldResult, InstrumentType, Rating } from "@/engine/types";
import {
  AXIS_DOT_R,
  AXIS_Y,
  BADGE,
  CURRENT_DOT_R,
  DOT_R,
  FOOT_Y,
  LANES,
  PLOT_END,
  VIEW,
  TIP,
  badgeAt,
  chipRight,
  historyChart,
  laneBars,
  tipAt,
  yOf,
} from "@/components/run-history";
import type { StepReport } from "@/engine/course";
import SongProgress from "@/components/SongProgress.vue";
import { useSheetFit } from "@/composables/useSheetFit";

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
  /**
   * Sustain over the run. Kept out of `tally` because a hold is a *second*
   * judgement on a note the tally has already counted — adding them together
   * would make the run look twice as long as it was.
   */
  holds: Readonly<Record<HoldResult, number>>;
  /** Strikes that hit nothing. Not in `tally` — none of them was a lesson note. */
  wrong: number;
  /** Every attempt at this lesson, oldest first, this run last. */
  attempts: readonly number[];
  /**
   * The lanes that need work most, weakest first — empty on a clean run. Each
   * carries its place in the lane order, so it wears the colour it has on the
   * lane stack and reads as that lane without needing to be read.
   */
  lanes: readonly (WeakLane & { hue: number })[];
  /**
   * Where the run left its song, when the lesson is a step of one. Present,
   * the song's progress is shown under the run-history chart — which a section
   * keeps, being a lesson with a history of its own.
   */
  step?: StepReport | null;
  /** The lesson's own tempo — the one a step has to be passed at. */
  baseBpm: number;
}>();

const emit = defineEmits<{
  (e: "again"): void;
  (e: "lessons"): void;
  /** Open another section of the song — any of them; none is locked. */
  (e: "step", lessonId: string): void;
}>();

const settings = useSettings();
const palette = computed(() => PALETTE[settings.theme]);

const sheet = ref<HTMLElement | null>(null);
useSheetFit(sheet, "RunSummary");

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
/** The legend's words — sentence case, as 11i sets them. */
const LEGEND: Record<Rating, string> = {
  perfect: "Perfect",
  great: "Great",
  early: "Early",
  late: "Late",
  miss: "Missed",
};
/** Which way a weak lane leant, in the chart's own capitals. */
const LEAN: Partial<Record<Rating, string>> = { early: "EARLY", late: "LATE" };

const graded = computed(() => ORDER.reduce((n, r) => n + (props.tally[r] ?? 0), 0));
/** Segments of the one stacked bar, skipping bands nothing landed in. */
const bands = computed(() =>
  ORDER.map((r) => ({
    rating: r,
    label: LEGEND[r],
    count: props.tally[r] ?? 0,
    pct: graded.value ? ((props.tally[r] ?? 0) / graded.value) * 100 : 0,
    colour: palette.value.rating[r],
  })).filter((b) => b.count > 0),
);

/**
 * Sustain, as a share of the notes that had one to hold. A lesson with no
 * written durations has nothing to say here, so the figure stays off the
 * screen rather than reading a confident 100% about notes nobody held.
 */
const heldTotal = computed(() => props.holds.held + props.holds.short + props.holds.dropped);
const heldPct = computed(() =>
  heldTotal.value ? Math.round((props.holds.held / heldTotal.value) * 100) : null,
);

/**
 * The chart's geometry. The plot stops short of the weakest lanes when there
 * are any and takes the whole figure when there are none; only its end moves.
 */
const hasLanes = computed(() => props.lanes.length > 0);
const chart = computed(() =>
  historyChart(props.attempts, hasLanes.value ? PLOT_END.withLanes : PLOT_END.full),
);
/** How far a hover chip may reach — never into the lanes' column. */
const right = computed(() => chipRight(chart.value.x1));

/**
 * The footer, inside the figure: `FIRST` under the left-hand end, the count
 * centred under the plot, `THIS RUN` at the plot's end — or under the lone dot
 * of a first attempt, which sits at the left where a history begins.
 */
const countX = computed(() => (26 + chart.value.x1) / 2);
const nowLabel = computed(() =>
  props.attempts.length > 1
    ? { x: chart.value.x1, anchor: "end" }
    : { x: 26, anchor: "start" },
);

/**
 * Which dot the pointer is over, if any.
 *
 * The chart is a shape to read at a glance; the numbers behind it are there
 * for when you want them, not stamped over every dot. Hovering one names its
 * score, and names it BEST when it is the best of them.
 */
const hovered = ref<number | null>(null);
const hoveredPoint = computed(() =>
  hovered.value === null ? null : (chart.value.points[hovered.value] ?? null),
);
/** The BEST flag, shown over the best dot only while it is hovered. */
const hoverBadge = computed(() =>
  hovered.value !== null && hovered.value === chart.value.bestIndex && hoveredPoint.value
    ? badgeAt(hoveredPoint.value, right.value)
    : null,
);
/** Where the score chip sits, in the chart's own coordinates. */
const tipBox = computed(() =>
  hoveredPoint.value ? tipAt(hoveredPoint.value, right.value) : null,
);

// ------------------------------------------------------------------- song

/**
 * "PART B" → "Part B", "FULL SONG" → "Full song": the lesson line is in
 * sentence case, and a part's letter is a name, so it keeps its capital.
 */
const sentence = (label: string) =>
  label
    .split(" ")
    .map((w, i) => (w.length === 1 ? w : i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");

const song = computed(() => props.step ?? null);

const title = computed(() =>
  song.value ? `${song.value.label} · RUN COMPLETE` : "RUN COMPLETE",
);
const heading = computed(() =>
  song.value ? `${song.value.courseName} · ${sentence(song.value.label)}` : props.lessonName,
);

/**
 * The flag in the header. Inside a song, completing a section is the news, so
 * it outranks a new best — and says so in the amber the song's suggestion
 * wears, not in a rating's green.
 */
const flag = computed<{ text: string; song: boolean } | null>(() => {
  const s = song.value;
  if (s?.justPassed) return { text: s.complete ? "SONG COMPLETE" : `${s.label} COMPLETE`, song: true };
  return isNewBest.value ? { text: "NEW BEST", song: false } : null;
});

/** This section, once the run is in. */
const thisPassed = computed(() => song.value?.steps[song.value.index].state === "passed");

/**
 * The run slower than the lesson counts for nothing towards completing it,
 * however well it went — saying so is the difference between "try again" and
 * "try again faster".
 */
const slowNote = computed(() =>
  song.value && !song.value.qualified && !thisPassed.value
    ? `PASSES COUNT AT ${props.baseBpm} BPM`
    : null,
);

// ------------------------------------------------------------ weakest lanes

/**
 * Weakest lanes, on the history's axis. Back after handoff 09 took them out:
 * the user missed them. The chart says whether you are getting better; this
 * says where to look next time — and the dashed line says which lanes fell
 * short of the run as a whole.
 */
const laneName = (lane: number) =>
  props.instrument === "piano" ? noteName(lane) : (PADS[lane]?.name ?? `PAD ${lane + 1}`).toUpperCase();
/** The lane's own dimmed hue — the swatch it wears on the lane stack and the strip. */
const laneColour = (hue: number) => hueOf(palette.value, props.instrument, hue).dim;
/**
 * A name's size under its bar. 9px, as drawn, unless it would run into the
 * next bar: a note name never does, but `CLOSED HAT` is a whole pitch wide at
 * that size, so a long pad name is set smaller rather than colliding.
 */
const NAME_ROOM = LANES.pitch - 6;
const MONO_ADVANCE = 0.6;
const nameSize = (name: string) => Math.min(9, NAME_ROOM / (MONO_ADVANCE * name.length));

const bars = computed(() =>
  laneBars(props.lanes).map((b, i) => {
    const l = props.lanes[i];
    const name = laneName(l.lane);
    return {
      ...b,
      key: l.lane,
      value: Math.round(l.accuracy * 100),
      colour: laneColour(l.hue),
      name,
      size: nameSize(name),
      lean: l.drift ? LEAN[l.drift] ?? null : null,
      leanColour: l.drift ? palette.value.rating[l.drift] : undefined,
    };
  }),
);
/** This run's score, carried from its dot across the lanes. */
const runY = computed(() => yOf(props.accuracy));

/** The chart is a picture; a screen reader gets the same facts as a sentence. */
const chartLabel = computed(() => {
  const n = props.attempts.length;
  const history =
    n <= 1
      ? `First attempt at this lesson, ${score.value}%.`
      : `${n} attempts at this lesson, from ${Math.round(props.attempts[0] * 100)}% to ${score.value}%.`;
  if (!props.lanes.length) return history;
  const weak = bars.value
    .map((b) => `${b.name} ${b.value}%${b.lean ? `, ${b.lean.toLowerCase()}` : ""}`)
    .join("; ");
  return `${history} Weakest lanes: ${weak}.`;
});
</script>
<template>
  <div class="scrim" role="dialog" aria-modal="true" aria-label="Run complete">
    <div ref="sheet" class="sheet">
      <div class="head">
        <span class="ttl">{{ title }}</span>
        <span v-if="flag" class="flag" :class="{ song: flag.song }">{{ flag.text }}</span>
      </div>

      <div class="score-row">
        <span class="score"><b class="num">{{ score }}</b><i>%</i></span>
        <span class="about">
          <span class="lesson">{{ heading }}</span>
          <span class="meta">{{ meta }}</span>
        </span>
        <span class="stats">
          <span class="stat prev">
            <i class="k">PREV</i>
            <b class="num">{{ previousBest === null ? "—" : Math.round(previousBest * 100) }}</b>
          </span>
          <span class="stat combo"><i class="k">COMBO</i><b class="num">{{ bestCombo }}</b></span>
          <span v-if="heldPct !== null" class="stat">
            <i class="k">HELD</i><b class="num">{{ heldPct }}</b>
          </span>
          <!-- Only when there were some: a run with none should not be told
               it scored zero at something. -->
          <span v-if="wrong > 0" class="stat wrong">
            <i class="k">WRONG</i><b class="num">{{ wrong }}</b>
          </span>
        </span>
      </div>

      <!-- One bar across every band, so the shape of the run reads at a glance. -->
      <div class="bar8">
        <span
          v-for="b in bands"
          :key="b.rating"
          :style="{ width: `${b.pct}%`, background: b.colour }"
        />
      </div>
      <div class="legend">
        <span v-for="b in bands" :key="b.rating" class="leg">
          <i class="swatch" :style="{ background: b.colour }" />
          <span class="lword">{{ b.label }}</span>
          <b class="num">{{ b.count }}</b>
        </span>
      </div>

      <div class="rule" />

      <!-- One figure, one scale: the history, and beside it the weakest lanes
           on the same 0–100 axis. A section of a song keeps it too — every
           section is a lesson with a history of its own. -->
      <div class="figure">
        <div class="fhead">
          <span class="fleft" :class="{ full: !hasLanes }">
            <span class="ttl">RUN HISTORY</span>
            <b class="hscore num">{{ score }}%</b>
          </span>
          <span v-if="hasLanes" class="fright">
            <span class="ttl">WEAKEST LANES</span>
            <span class="runkey"><i />THIS RUN</span>
          </span>
        </div>

        <svg
          class="chart"
          :viewBox="`0 0 ${VIEW.w} ${VIEW.h}`"
          role="img"
          :aria-label="chartLabel"
        >
          <!-- Two rules only, across both halves. This is a shape to read. -->
          <line v-for="g in chart.gridlines" :key="g.value" class="grid" x1="26" x2="614" :y1="g.y" :y2="g.y" />
          <text class="tick" x="0" :y="chart.gridlines[0].y + 3.5">100</text>
          <text class="tick" x="6" :y="chart.gridlines[1].y + 3.5">50</text>

          <template v-if="hasLanes">
            <line class="divider" :x1="LANES.divider" :x2="LANES.divider" y1="14" y2="164" />
            <line class="zero" :x1="LANES.x0" :x2="LANES.x1" :y1="yOf(0)" :y2="yOf(0)" />
            <g v-for="b in bars" :key="b.key">
              <rect :x="b.x" :y="b.y" :width="LANES.barW" :height="b.h" rx="1" :fill="b.colour" />
              <text class="lval" :x="b.cx" :y="b.y - 5">{{ b.value }}</text>
              <text class="lname" :x="b.cx" :y="LANES.nameY" :font-size="b.size">{{ b.name }}</text>
              <!-- Which way it leant: a result, so the rating's own colour. -->
              <text class="llean" :x="b.cx" :y="LANES.leanY" :style="{ fill: b.leanColour }">{{ b.lean ?? "—" }}</text>
            </g>
            <line class="runline" :x1="chart.current?.x ?? chart.x1" :x2="LANES.x1" :y1="runY" :y2="runY" />
          </template>

          <!-- Each label sits where the thing it describes sits. -->
          <text v-if="chart.first" class="foot" x="26" :y="FOOT_Y">
            FIRST {{ Math.round(chart.first.value * 100) }}%
          </text>
          <text class="foot mid" :x="countX" :y="FOOT_Y">
            {{ attempts.length }} {{ attempts.length === 1 ? "ATTEMPT" : "ATTEMPTS" }}
          </text>
          <text class="foot now" :x="nowLabel.x" :y="FOOT_Y" :text-anchor="nowLabel.anchor">THIS RUN</text>

          <polyline v-if="chart.path" class="line" :points="chart.path" />
          <circle
            v-for="(pt, i) in chart.points"
            :key="i"
            class="dot"
            :cx="pt.x"
            :cy="pt.y"
            :r="DOT_R"
          />
          <circle
            v-if="chart.current"
            class="now"
            :cx="chart.current.x"
            :cy="chart.current.y"
            :r="CURRENT_DOT_R"
          />

          <!-- A rule with a dot at each end, not a boxed baseline. -->
          <line class="axis" x1="26" :x2="chart.x1" :y1="AXIS_Y" :y2="AXIS_Y" />
          <circle class="axis-cap" cx="26" :cy="AXIS_Y" :r="AXIS_DOT_R" />
          <circle class="axis-cap" :cx="chart.x1" :cy="AXIS_Y" :r="AXIS_DOT_R" />

          <!-- The flag names the best run, and only while that dot is hovered:
               a badge that always shows is decoration, and the header already
               says NEW BEST when this run earned one. -->
          <g v-if="hoverBadge">
            <rect
              class="badge"
              :x="hoverBadge.x"
              :y="hoverBadge.y"
              :width="BADGE.w"
              :height="BADGE.h"
              rx="2"
            />
            <text
              class="badge-t"
              :x="hoverBadge.x + BADGE.w / 2"
              :y="hoverBadge.y + BADGE.h / 2 + 3.6"
            >
              BEST
            </text>
          </g>

          <!-- The score, in the flag's box but not its colour: green is a
               rating here (`--rate-perfect`), and a 62% run wearing it would
               be saying "perfect" about a poor one. -->
          <g v-if="tipBox && hoveredPoint">
            <rect
              class="tipbox"
              :x="tipBox.x"
              :y="tipBox.y"
              :width="TIP.w"
              :height="TIP.h"
              rx="2"
            />
            <text class="tip-t" :x="tipBox.x + TIP.w / 2" :y="tipBox.y + TIP.h / 2 + 3.6">
              {{ Math.round(hoveredPoint.value * 100) }}%
            </text>
          </g>

          <!-- Invisible targets, wider than the dots: a 3px circle is not
               something a pointer should have to find. -->
          <circle
            v-for="(pt, i) in chart.points"
            :key="`hit${i}`"
            class="hit"
            :cx="pt.x"
            :cy="pt.y"
            r="12"
            @mouseenter="hovered = i"
            @mouseleave="hovered = null"
          />
        </svg>
      </div>

      <!-- A section of a song: where the song stands, under the history. -->
      <SongProgress
        v-if="song"
        :steps="song.steps"
        :passed-count="song.passedCount"
        :suggested="song.suggested"
        :played="song.index"
        :just-passed="song.justPassed"
        @step="(id) => emit('step', id)"
      />

      <div class="actions">
        <!-- In a song, moving on is always on offer — nothing is locked. It is
             the main button once this section is complete, and beside another
             go at it until then. -->
        <template v-if="song && song.following && thisPassed">
          <button class="act primary" @click="emit('step', song.following.lessonId)">
            <i class="tri" aria-hidden="true" /><span>NEXT · {{ song.following.label }}</span>
          </button>
          <button class="act plain" @click="emit('again')">RUN {{ song.label }} AGAIN</button>
        </template>
        <template v-else>
          <button class="act primary" @click="emit('again')">
            <i class="tri" aria-hidden="true" />
            <span>{{ song ? `RUN ${song.label} AGAIN` : "RUN AGAIN" }}</span>
          </button>
          <button
            v-if="song && song.following"
            class="act plain"
            @click="emit('step', song.following.lessonId)"
          >
            NEXT · {{ song.following.label }}
          </button>
          <span v-if="slowNote" class="side-note">{{ slowNote }}</span>
        </template>
        <button class="act ghost" @click="emit('lessons')">✕ LESSONS</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The trainer stays on screen behind the scrim, the sheet centred on it. */
.scrim {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: var(--scrim);
}
/*
 * 620px of content, as 11i draws it: the figure below is exactly that wide,
 * so its type is set at the size written and never scaled. The design's
 * 620 is a content-box width; ours is border-box, hence the padding added.
 */
.sheet {
  width: 668px;
  max-width: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  gap: 14px;
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

/* One slot, highest rank wins: a song flag, else NEW BEST. */
.head { display: flex; align-items: baseline; gap: 10px; }
.flag {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--flag-best);
}
/* Completing a section is news about the song, not a rating of the run, so
   it wears the amber the song's suggestion does — never the green. */
.flag.song { color: var(--led1); }

.score-row { display: flex; align-items: flex-end; gap: 26px; }
.score { display: inline-flex; align-items: baseline; gap: 5px; }
.score b { font-size: 54px; line-height: 0.9; font-weight: 500; color: var(--txt); }
.score i { font-family: var(--mono); font-size: 14px; font-style: normal; color: var(--txt3); }
.about { display: flex; flex-direction: column; gap: 3px; padding-bottom: 3px; min-width: 0; }
.lesson {
  font-size: 15px;
  font-weight: 600;
  color: var(--txt);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
  white-space: nowrap;
}
.stats { margin-left: auto; display: flex; gap: 18px; flex: none; }
.stat { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.stat .k {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  font-style: normal;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.stat b { font-size: 17px; font-weight: 400; color: var(--txt); }
.stat.prev b { color: var(--txt2); }
/* The bar's CMB readout is the early amber; the summary's combo matches it. */
.stat.combo b { color: var(--rate-early); }
/* The one stat that is a count of mistakes, so it wears the rating that names
   them. */
.stat.wrong b { color: var(--rate-miss); }

.bar8 { display: flex; height: 8px; border-radius: 1px; overflow: hidden; background: var(--track); }
.bar8 span { display: block; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; }
.leg { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
.swatch { width: 7px; height: 7px; border-radius: 2px; }
.lword { color: var(--txt2); }
.leg b { font-family: var(--mono); font-weight: 400; color: var(--txt); }

.rule { height: 1px; background: var(--hair); }

/* ------------------------------------------------------------- the figure */
.figure { display: flex; flex-direction: column; gap: 6px; }
/* The two headers stand over their halves of the figure, so their widths are
   the figure's own: the plot ends at 424 of 620 and the lanes start at 454. */
.fhead { display: flex; align-items: flex-end; height: 15px; }
.fleft { width: calc(100% * 424 / 620); flex: none; display: flex; align-items: flex-end; }
.fleft.full { width: 100%; }
.hscore { margin-left: auto; font-size: 15px; line-height: 1; font-weight: 400; color: var(--txt); }
.fright {
  margin-left: calc(100% * 30 / 620);
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.runkey {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 0.9px;
  color: var(--txt3);
}
.runkey i { width: 12px; border-top: 1.2px dashed var(--rate-perfect); }

.chart { display: block; width: 100%; height: auto; overflow: visible; }
.chart text { font-family: var(--mono); }
.grid { stroke: var(--chart-grid); stroke-width: 1; }
.tick { font-size: 8px; fill: var(--txt3); }
.divider { stroke: var(--hair); stroke-width: 1; }
.zero { stroke: var(--todo); stroke-width: 1; }
.lval { font-size: 9.5px; fill: var(--txt); text-anchor: middle; }
.lname { font-weight: 500; fill: var(--txt); text-anchor: middle; }
.llean { font-size: 7px; font-weight: 500; letter-spacing: 0.8px; fill: var(--txt3); text-anchor: middle; }
/* This run's score, across the lanes: a lane under the line fell short of
   the run as a whole. The run's own green, as its dot. */
.runline { stroke: var(--rate-perfect); stroke-width: 1.2; stroke-dasharray: 3 3; }
.foot { font-size: 7.5px; font-weight: 500; letter-spacing: 0.9px; fill: var(--txt3); }
.foot.mid { text-anchor: middle; }
/* One step brighter: of the three, this is the one the eye should land on. */
.foot.now { fill: var(--txt2); }

.axis { stroke: var(--todo); stroke-width: 1.4; stroke-linecap: round; }
.axis-cap { fill: var(--todo); }
/* Neutral on purpose: the line is the trend, not a judgement, so it never
   takes a timing colour. */
.line {
  fill: none;
  stroke: var(--chart-line);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.dot { fill: var(--chart-line); }
/* This run: the accuracy colour, a size larger — the one point the eye should
   find without looking for it. */
.now { fill: var(--rate-perfect); }

/* Wider than the dot it covers — a 3px circle is not a pointer target. */
.hit { fill: transparent; cursor: default; }
.badge { fill: var(--rate-perfect); pointer-events: none; }
.badge-t {
  font-size: 10px;
  letter-spacing: 1.2px;
  fill: var(--win);
  text-anchor: middle;
  pointer-events: none;
}
/* The score behind a dot, on demand — the BEST flag's box and type, but never
   its fill: `--rate-perfect` is a *rating*, and a 62% run wearing it would be
   reading as a judgement of that run. */
.tipbox { fill: var(--bar); stroke: var(--hair); stroke-width: 1; pointer-events: none; }
.tip-t {
  font-size: 10px;
  letter-spacing: 1.2px;
  fill: var(--txt);
  text-anchor: middle;
  pointer-events: none;
}

.actions { display: flex; align-items: center; gap: 8px; margin-top: 1px; }
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
.act.plain { background: none; color: var(--txt); box-shadow: inset 0 0 0 1px var(--hair); }
.act.plain:hover { background: var(--hover); }
.side-note {
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.act.ghost { margin-left: auto; background: none; color: var(--txt2); }
.act.ghost:hover { background: var(--hover); color: var(--txt); }
.tri {
  width: 0;
  height: 0;
  flex: none;
  border-left: 6px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
</style>
