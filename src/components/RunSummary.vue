<script setup lang="ts">
/**
 * End of run. A lesson is a finite piece, so it earns a result screen rather
 * than a toast that disappears before you have read it.
 *
 * The run-history chart answers whether you are getting better, which takes
 * more than one run. Handoff 09 put it in place of a ranked list of your worst
 * lanes; the user missed the list, so both are here now — the lanes beside the
 * chart, where you look next, and only when a lane was short of 100.
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
  VIEW,
  TIP,
  badgeAt,
  historyChart,
  tipAt,
} from "@/components/run-history";
import type { StepReport } from "@/engine/course";
import SongProgress from "@/components/SongProgress.vue";

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
 * Weakest lanes, beside the history chart (the user's pick of three layouts).
 * Back after handoff 09 took them out: the user missed them. The chart says
 * whether you are getting better; this says where to look next time.
 */
const laneName = (lane: number) =>
  props.instrument === "piano" ? noteName(lane) : (PADS[lane]?.name ?? `PAD ${lane + 1}`).toUpperCase();
/** The lane's own dimmed hue — the swatch it wears on the lane stack and the strip. */
const laneColour = (hue: number) => hueOf(palette.value, props.instrument, hue).dim;

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
        <span class="ttl">{{ title }}</span>
        <span v-if="flag" class="best-flag" :class="{ song: flag.song }">{{ flag.text }}</span>
      </div>

      <div class="score-row">
        <span class="score num">{{ score }}</span>
        <span class="about">
          <span class="lesson">{{ heading }}</span>
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
          <!-- Only when there were some: a run with none should not be told
               it scored zero at something. -->
          <span v-if="wrong > 0" class="stat wrong">
            <i class="k">WRONG</i><b class="num">{{ wrong }}</b>
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

      <!-- The history, with the weakest lanes beside it when there are any.
           A clean run has none, and the chart keeps the whole width. -->
      <div class="pair">
        <!-- Handoff 09: run history replaces weakest lanes. A section of a song
             keeps it too: every section is a lesson with a history of its own,
             and "am I getting better at this part" is still the question. -->
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

        <div v-if="lanes.length" class="weak">
          <span class="ttl">WEAKEST LANES</span>
          <div v-for="l in lanes" :key="l.lane" class="wrow">
            <i class="wchip" :style="{ background: laneColour(l.hue) }" />
            <span class="wname">{{ laneName(l.lane) }}</span>
            <!-- Which way it leant: a result, so the rating's own colour. -->
            <span
              class="wdrift"
              :style="{ color: l.drift ? palette.rating[l.drift] : undefined }"
            >{{ l.drift ? LABEL[l.drift] : "—" }}</span>
            <span class="wpct num">{{ Math.round(l.accuracy * 100) }}</span>
            <span class="wtrack">
              <i :style="{ width: `${l.accuracy * 100}%`, background: laneColour(l.hue) }" />
            </span>
          </div>
        </div>
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
/* Completing a section is news about the song, not a rating of the run, so
   it wears the amber the song's suggestion does — never the green. */
.best-flag.song { color: var(--led1); }

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
/* The one stat that is a count of mistakes, so it wears the rating that names
   them. Every other stat here is neutral. */
.stat.wrong .num { color: var(--rate-miss); }
.swatch { width: 6px; height: 6px; border-radius: 1px; }

/* Run history. The 620x158 viewBox scales uniformly to whatever width the
   panel column has — deliberately *not* `preserveAspectRatio: none`, which
   would squash the gridline labels and the badge's text along one axis.
   Since handoff 10 §2 doubled the plot's range the badge sits *inside* the
   box even on a full-marks run, so nothing depends on `overflow` any more;
   it stays visible only so a stroke on the edge is not clipped. */
.history { display: flex; flex-direction: column; gap: 6px; }

/* The chart and the weakest lanes share a row. Without lanes the chart has
   it to itself, exactly as before; with them it gives up about a third, and
   its type shrinks with it — the trade the user chose over a taller sheet. */
.pair { display: flex; gap: 20px; align-items: stretch; }
.pair > .history { flex: 1.7; min-width: 0; }
.weak {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-left: 18px;
  box-shadow: inset 1px 0 0 var(--hair);
}
.wrow { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 9px; }
.wchip { width: 6px; height: 6px; flex: none; border-radius: 1px; }
.wname {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wdrift {
  flex: none;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.wpct { width: 26px; flex: none; text-align: right; font-size: 11px; color: var(--txt2); }
/* A full-width bar under the name, since the row is narrow beside the chart.
   The hairline is what makes the empty part read in light, where the track
   fill is the panel's own grey. */
.wtrack {
  order: 3;
  flex: 0 0 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--track);
  box-shadow: inset 0 0 0 1px var(--hair);
  overflow: hidden;
}
.wtrack i { display: block; height: 100%; }
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
.tipbox { fill: var(--bar); stroke: var(--hair); stroke-width: 1; pointer-events: none; }
.tip-t {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 1.2px;
  fill: var(--txt);
  text-anchor: middle;
  pointer-events: none;
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
.badge { fill: var(--rate-perfect); pointer-events: none; }
.badge-t {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 1.2px;
  fill: var(--win);
  text-anchor: middle;
  pointer-events: none;
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
  border-left: 7px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
</style>
