<script setup lang="ts">
/**
 * End of run. A lesson is a finite piece, so it earns a result screen rather
 * than a toast that disappears before you have read it.
 *
 * The run-history chart is the point of the screen. It replaced a ranked list
 * of your worst lanes (handoff 09): that told you something you already knew
 * — you felt the snare drag — in the most discouraging frame available, and
 * duplicated the judgement breakdown directly above it. The question worth
 * answering here is whether you are getting better, and it takes more than
 * one run to answer.
 */
import { computed, ref } from "vue";
import { PALETTE } from "@/engine/theme";
import { useSettings } from "@/stores/settings";
import type { HoldResult, InstrumentType, Rating } from "@/engine/types";
import {
  AXIS_DOT_R,
  AXIS_Y,
  BADGE,
  CURRENT_DOT_R,
  DOT_R,
  VIEW,
  TIP,
  badgeAt,
  historyChart,
  tipAt,
} from "@/components/run-history";

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
  /** Every attempt at this lesson, oldest first, this run last. */
  attempts: readonly number[];
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
 * The chart's geometry. Laid out against the full capacity rather than the
 * attempts in hand, so the dots march rightwards as history accumulates
 * instead of the whole chart rescaling under you after every run.
 */
const chart = computed(() => historyChart(props.attempts));

/**
 * The two dot-anchored footer labels, as percentages across the chart.
 *
 * A label sits where the thing it describes sits. Now that the attempts always
 * span the full axis, `FIRST` reads from the left-hand dot rightwards and
 * `THIS RUN` sits under the right-hand one, clamped so it cannot be pushed off
 * the edge.
 */
const pctOf = (x: number) => (x / VIEW.w) * 100;
const firstLeft = computed(() => `${pctOf(chart.value.first?.x ?? 0)}%`);
const nowPct = computed(() => Math.min(pctOf(chart.value.current?.x ?? 0), 92));
const nowLeft = computed(() => `${nowPct.value}%`);

/**
 * The attempt count is centred under the axis, and now always can be.
 *
 * It used to have to step aside: with fixed spacing the current dot drifted
 * across the middle as history accumulated, and around a dozen attempts in it
 * collided with the centred count. The dots span the full axis now, so
 * `THIS RUN` is always hard right and the two can never meet.
 */
const countAside = computed(() => false);

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
    ? badgeAt(hoveredPoint.value)
    : null,
);
/** Where the score chip sits, in the chart's own coordinates. */
const tipBox = computed(() => (hoveredPoint.value ? tipAt(hoveredPoint.value) : null));

/** The chart is a picture; a screen reader gets the same facts as a sentence. */
const chartLabel = computed(() => {
  const n = props.attempts.length;
  if (n <= 1) return `First attempt at this lesson, ${score.value}%.`;
  return `${n} attempts at this lesson, from ${Math.round(props.attempts[0] * 100)}% to ${score.value}%.`;
});
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
          <span v-if="heldPct !== null" class="stat">
            <i class="k">HELD</i><b class="num">{{ heldPct }}</b>
          </span>
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

      <!-- Handoff 09: run history replaces weakest lanes. -->
      <div class="history">
        <div class="hhead">
          <span class="ttl">RUN HISTORY</span>
          <b class="hscore num">{{ score }}%</b>
        </div>

        <svg
          class="chart"
          :viewBox="`0 0 ${VIEW.w} ${VIEW.h}`"
          role="img"
          :aria-label="chartLabel"
        >
          <!-- Two rules only. This is a shape to read, not a table. -->
          <g class="grid">
            <line v-for="g in chart.gridlines" :key="g.value" x1="26" x2="614" :y1="g.y" :y2="g.y" />
            <text v-for="g in chart.gridlines" :key="`t${g.value}`" x="20" :y="g.y + 3">
              {{ g.value }}
            </text>
          </g>

          <line class="axis" x1="26" x2="614" :y1="AXIS_Y" :y2="AXIS_Y" />
          <circle class="axis-cap" cx="26" :cy="AXIS_Y" :r="AXIS_DOT_R" />
          <circle class="axis-cap" cx="614" :cy="AXIS_Y" :r="AXIS_DOT_R" />

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
              :y="hoverBadge.y + BADGE.h / 2 + 3"
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
            <text class="tip-t" :x="tipBox.x + TIP.w / 2" :y="tipBox.y + TIP.h / 2 + 3">
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

        <!-- Each label sits where the thing it describes sits: the two ends
             track their own dots, the count is centred under the axis. -->
        <div class="hfoot">
          <span v-if="chart.first" class="hfirst" :style="{ left: firstLeft }">
            FIRST {{ Math.round(chart.first.value * 100) }}%
          </span>
          <span class="hcount" :class="{ aside: countAside }">
            {{ attempts.length }} {{ attempts.length === 1 ? "ATTEMPT" : "ATTEMPTS" }}
          </span>
          <span class="hnow" :style="{ left: nowLeft }">THIS RUN</span>
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

/* Run history. The 620x148 viewBox scales uniformly to whatever width the
   panel column has — deliberately *not* `preserveAspectRatio: none`, which
   would squash the gridline labels and the badge's text along one axis.
   Since handoff 10 §2 doubled the plot's range the badge sits *inside* the
   box even on a full-marks run, so nothing depends on `overflow` any more;
   it stays visible only so a stroke on the edge is not clipped. */
.history { display: flex; flex-direction: column; gap: 6px; }
.hhead { display: flex; align-items: baseline; justify-content: space-between; }
/* The headline figure of the block, so the largest thing in it. */
.hscore { font-size: 15px; color: var(--txt); }

.chart { display: block; width: 100%; height: auto; overflow: visible; }

/* Wider than the dot it covers — a 3px circle is not a pointer target. */
.hit { fill: transparent; cursor: default; }

/* The score behind a dot, on demand — the BEST flag's box, in the flag's
   type, but never the flag's fill: `--rate-perfect` is a *rating*, and a 62%
   run wearing it would be reading as a judgement of that run. So the chip is
   the panel's own surface with the standard hairline, which is what every
   other neutral field in the app wears.
   Below the dot, not above: the flag owns the space above and the two would
   overlap on the best run's dot, which is the one you hover first. */
.tipbox { fill: var(--bar); stroke: var(--hair); stroke-width: 1; }
.tip-t {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.1px;
  fill: var(--txt);
  text-anchor: middle;
}

.grid line { stroke: #00000014; stroke-width: 1; }
:root[data-theme="dark"] .grid line { stroke: #ffffff10; }
.grid text {
  font-family: var(--mono);
  font-size: 8px;
  fill: var(--txt3);
  text-anchor: end;
}

/* A rule with a dot at each end, not a boxed baseline. */
.axis { stroke: var(--hair); stroke-width: 1.4; stroke-linecap: round; }
.axis-cap { fill: var(--hair); }

/* Neutral on purpose: the line is the trend, not a judgement, so it never
   takes a timing colour. */
.line {
  fill: none;
  stroke: #8f9196;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.dot { fill: #8f9196; }
:root[data-theme="dark"] .line { stroke: #5c5e64; }
:root[data-theme="dark"] .dot { fill: #5c5e64; }

/* This run: the accuracy colour, a size larger — the one point the eye should
   find without looking for it. */
.now { fill: var(--rate-perfect); }
.badge { fill: var(--rate-perfect); }
.badge-t {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.1px;
  fill: var(--win);
  text-anchor: middle;
}

.hfoot {
  position: relative;
  height: 11px;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
  white-space: nowrap;
}
.hfirst,
.hnow { position: absolute; top: 0; }
/* Centred under the axis line, the way Melodics places THIS SESSION — until
   THIS RUN needs that space, when it steps aside to the right. */
.hcount {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
}
.hcount.aside { left: auto; right: 0; transform: none; }
/* One step brighter: of the three, this is the one the eye should land on. */
.hnow { color: var(--txt2); transform: translateX(-50%); }

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
