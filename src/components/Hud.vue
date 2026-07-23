<script setup lang="ts">
/**
 * Session readouts: tempo, running accuracy, combo, and transport phase.
 * Purely presentational — the trainer composable owns the numbers.
 */
defineProps<{
  bpm: number;
  /** 0..100 */
  accuracy: number;
  combo: number;
  bestCombo: number;
  phase: string;
  /** Accuracy of the last finished loop, 0..100, or null before the first. */
  loopAcc: number | null;
}>();
</script>

<template>
  <div class="hud">
    <div class="readout">
      <div class="label">TEMPO</div>
      <div class="value">{{ bpm }}<span class="unit"> BPM</span></div>
    </div>
    <div class="readout">
      <div class="label">ACCURACY</div>
      <div class="value teal">{{ accuracy }}<span class="unit"> %</span></div>
    </div>
    <div class="readout">
      <div class="label">COMBO</div>
      <div class="value amber">{{ combo }}<span class="unit"> ▲{{ bestCombo }}</span></div>
    </div>
    <div class="readout">
      <div class="label">BAR</div>
      <div class="value" :class="loopAcc !== null && loopAcc >= 85 ? 'teal' : ''">
        {{ loopAcc === null ? "—" : loopAcc }}<span v-if="loopAcc !== null" class="unit"> %</span>
      </div>
    </div>
    <div class="readout">
      <div class="label">STATUS</div>
      <div class="value small">{{ phase }}</div>
    </div>
  </div>
</template>

<style scoped>
.hud {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.readout { min-width: 62px; }
.label {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 1.5px;
  color: var(--faint);
}
.value {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 22px;
  line-height: 1.15;
  color: var(--ink);
}
.value.small { font-size: 14px; padding-top: 5px; }
.value.teal { color: var(--teal); }
.value.amber { color: var(--amber); }
.unit { font-size: 11px; color: var(--faint); font-weight: 500; }
</style>
