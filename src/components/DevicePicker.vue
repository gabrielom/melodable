<script setup lang="ts">
/** Presentational device picker — App.vue owns the MIDI state. */
defineProps<{
  ports: string[];
  connectedIndex: number | null;
  connectedName: string;
  busy: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "connect", index: number): void;
  (e: "disconnect"): void;
}>();

function onSelect(ev: Event) {
  const value = (ev.target as HTMLSelectElement).value;
  if (value === "") return;
  emit("connect", Number(value));
}
</script>

<template>
  <div class="picker">
    <span class="label">MIDI IN</span>

    <select
      class="select"
      :value="connectedIndex === null ? '' : String(connectedIndex)"
      :disabled="busy"
      @change="onSelect"
    >
      <option value="" disabled>
        {{ ports.length ? "Select a device…" : "No devices found" }}
      </option>
      <option v-for="(name, i) in ports" :key="i" :value="String(i)">
        {{ name }}
      </option>
    </select>

    <button class="btn" :disabled="busy" title="Rescan ports" @click="emit('refresh')">
      ⟳
    </button>

    <button
      v-if="connectedIndex !== null"
      class="btn ghost"
      :disabled="busy"
      @click="emit('disconnect')"
    >
      Disconnect
    </button>

    <span v-if="connectedIndex !== null" class="status ok">
      <i class="dot" /> {{ connectedName }}
    </span>
    <span v-else class="status idle"><i class="dot" /> not connected</span>

    <span v-if="error" class="err" :title="error">{{ error }}</span>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.label {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--faint);
}
.select {
  background: var(--panel2);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 13px;
  max-width: 260px;
}
.btn {
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 7px 11px;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover:not(:disabled) { border-color: #39414d; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.ghost { background: transparent; color: var(--dim); }
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 11.5px;
}
.status.ok { color: var(--teal); }
.status.idle { color: var(--faint); }
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
}
.status.ok .dot { box-shadow: 0 0 8px var(--teal); }
.err {
  font-size: 11.5px;
  color: var(--red);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
