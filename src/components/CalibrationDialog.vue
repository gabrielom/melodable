<script setup lang="ts">
/**
 * Timing calibration (M7).
 *
 * Every rig puts delay between striking a pad and the player knowing it landed
 * — the controller's scan, the driver, and when Ableton makes the sound, its
 * output buffer. The player hears the beat late, plays late, and gets marked
 * late for it. This measures that gap so it can be subtracted.
 *
 * Two ways in: tap sixteen times against the click and take the median, or set
 * the number by hand. The manual field is not a fallback — a player who knows
 * their interface's reported latency can simply type it.
 *
 * Not in any design handoff. Built in the dialogs' existing language (the same
 * sheet, kicker, fields and footer as the import dialog) rather than inventing
 * a look for it — worth drawing properly before it is called finished.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { CAL_LEAD_CLICKS, CAL_TAPS, LATENCY_LIMIT_MS, type TapSummary } from "@/engine/calibration";
import { useFocusTrap } from "@/composables/useFocusTrap";

const props = defineProps<{
  /** The stored offset, in milliseconds. */
  latencyMs: number;
  /** True while the click is running and taps are counting. */
  active: boolean;
  /** True during the free clicks before anything counts. */
  leadIn: boolean;
  /** Taps accepted so far. */
  taps: number;
  /** The finished measurement, or null. */
  result: TapSummary | null;
  /** False when no controller is connected — tapping would measure nothing. */
  hasDevice: boolean;
}>();

const emit = defineEmits<{
  (e: "start"): void;
  (e: "stop"): void;
  (e: "set", ms: number): void;
  (e: "close"): void;
}>();

/** One ring per tap wanted, filled as they land. */
const rings = computed(() => Array.from({ length: CAL_TAPS }, (_, i) => i < props.taps));

const sign = (ms: number) => (ms > 0 ? "+" : "");

/** What the measured number means, in the player's terms rather than ours. */
const verdict = computed(() => {
  const r = props.result;
  if (!r) return "";
  if (!r.steady) {
    return `Your taps are ${r.spreadMs}ms apart from each other, which is too loose to read as latency. Try again, and aim at the click rather than the beat you expect.`;
  }
  if (Math.abs(r.offsetMs) < 8) {
    return "Your rig is already in time. Nothing worth correcting.";
  }
  return r.offsetMs > 0
    ? `You strike ${r.offsetMs}ms after the click. Applying this credits that back, so playing as you do now grades in time.`
    : `You strike ${-r.offsetMs}ms before the click. Applying this charges that back.`;
});

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}

/**
 * Where focus was before the dialog opened, so it can be put back. Opening a
 * modal and leaving focus on the page behind it strands a keyboard user
 * outside the thing they just opened.
 */
const panel = ref<HTMLElement | null>(null);
let returnTo: HTMLElement | null = null;

useFocusTrap(panel);

onMounted(() => {
  window.addEventListener("keydown", onKey);
  returnTo = document.activeElement as HTMLElement | null;
  // The panel itself rather than the first control: it carries the dialog's
  // accessible name, so a screen reader announces what opened before what is
  // in it, and Tab from here reaches the controls in order.
  panel.value?.focus();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  returnTo?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <div
        ref="panel"
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Timing calibration"
        tabindex="-1"
      >
        <header class="head">
          <div class="kicker">TIMING CALIBRATION</div>
          <button class="close" aria-label="Close" @click="emit('close')">✕</button>
        </header>

        <div class="body">
          <p class="lede">
            If your controller or your DAW puts delay between the strike and the sound, you play
            late to compensate — and get marked late for it. Tap along with the click and Melodable
            will measure the gap.
          </p>

          <div class="field">
            <span class="flabel">CURRENT OFFSET</span>
            <div class="bpmrow">
              <input
                class="input bpm"
                type="number"
                :min="-LATENCY_LIMIT_MS"
                :max="LATENCY_LIMIT_MS"
                :value="latencyMs"
                aria-label="Timing offset in milliseconds"
                @change="emit('set', Number(($event.target as HTMLInputElement).value))"
              />
              <span class="unit">MS</span>
              <button
                v-if="latencyMs !== 0"
                class="btn tiny"
                aria-label="Clear the offset"
                @click="emit('set', 0)"
              >
                Clear
              </button>
            </div>
          </div>

          <!-- The test itself. -->
          <div class="field">
            <span class="flabel">TAP TEST</span>

            <div v-if="!hasDevice" class="note">
              No controller connected. Connect one from the device menu — a mouse click or a
              computer key has no rig between the intent and the timestamp, so there would be
              nothing to measure.
            </div>

            <template v-else>
              <div class="rings" :class="{ lead: leadIn }" aria-hidden="true">
                <i v-for="(on, i) in rings" :key="i" :class="{ on }" />
              </div>

              <div v-if="active" class="stat" role="status">
                <template v-if="leadIn">
                  Listen — counting you in for {{ CAL_LEAD_CLICKS }} clicks.
                </template>
                <template v-else> Strike any pad on each click. {{ taps }} of {{ CAL_TAPS }}. </template>
              </div>
              <div v-else-if="result" class="stat" role="status">
                <b class="num">{{ sign(result.offsetMs) }}{{ result.offsetMs }} ms</b>
                <span class="dim">· {{ result.taps }} taps · ±{{ result.spreadMs }} ms</span>
              </div>
              <div v-else class="stat dim">
                {{ CAL_TAPS }} taps against a steady click. Takes about fifteen seconds.
              </div>

              <p v-if="verdict" class="verdict" :class="{ warn: result && !result.steady }">
                {{ verdict }}
              </p>
            </template>
          </div>
        </div>

        <footer class="foot">
          <button v-if="active" class="btn ghost" @click="emit('stop')">Stop</button>
          <button v-else class="btn ghost" :disabled="!hasDevice" @click="emit('start')">
            {{ result ? "Measure again" : "Start tapping" }}
          </button>
          <button
            v-if="result && result.steady"
            class="btn primary"
            @click="emit('set', result.offsetMs)"
          >
            Apply {{ sign(result.offsetMs) }}{{ result.offsetMs }} ms
          </button>
          <button v-else class="btn primary" @click="emit('close')">Done</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: #00000088;
}
/* A sheet, like the import dialog and the summary. */
.panel {
  width: 460px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair), 0 24px 60px #00000066;
  overflow: hidden;
}

.panel:focus {
  outline: none;
}

.head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  height: 34px;
  border-bottom: 1px solid var(--hair);
}
.kicker {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--head);
}
.close {
  border: none;
  background: none;
  padding: 0;
  color: var(--txt3);
  font-size: 11px;
  cursor: pointer;
}
.close:hover {
  color: var(--txt);
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

.lede {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--txt2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.flabel {
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}

.bpmrow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.input {
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: var(--r-field);
  background: var(--field);
  box-shadow: var(--outline);
  color: var(--txt);
  font-family: var(--mono);
  font-size: 11px;
}
.input.bpm {
  width: 74px;
}
.unit {
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}

/* One ring per tap wanted, filling left to right — the count-in's language. */
.rings {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.rings i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px var(--txt3);
  transition: background-color 90ms linear, box-shadow 90ms linear;
}
.rings i.on {
  background: var(--start);
  box-shadow: none;
}
.rings.lead i {
  opacity: 0.4;
}

.stat {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.6px;
  color: var(--txt2);
}
.stat .num {
  font-size: 13px;
  color: var(--txt);
}
.dim {
  color: var(--txt3);
}

.note,
.verdict {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--txt3);
}
.verdict.warn {
  color: var(--txt2);
}

.foot {
  flex: none;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--hair);
}
.btn {
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  color: var(--txt2);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  cursor: pointer;
}
.btn.tiny {
  height: 22px;
  padding: 0 8px;
  font-size: 8px;
}
.btn:hover {
  background: var(--hover);
  color: var(--txt);
}
.btn.primary {
  background: var(--start);
  color: var(--start-txt);
}
.btn.primary:hover {
  background: var(--start);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
