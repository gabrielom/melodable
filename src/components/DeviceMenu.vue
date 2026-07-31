<script setup lang="ts">
/**
 * Compact MIDI device control for the transport bar: a button showing the
 * connected device, opening a menu of available ports plus rescan/disconnect.
 * Replaces the old inline <select> + buttons + status text, which needed a
 * toolbar row of its own.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
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

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const label = computed(() => {
  if (props.connectedIndex !== null) return props.connectedName;
  return props.ports.length ? "Select MIDI device" : "No MIDI device";
});

function toggle() {
  open.value = !open.value;
  if (open.value) emit("refresh");
}

function pick(i: number) {
  emit("connect", i);
  open.value = false;
}

function onDocPointer(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer);
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointer);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="wrap">
    <button
      class="trigger"
      :class="{ live: connectedIndex !== null }"
      :title="connectedIndex !== null ? `Connected: ${connectedName}` : 'Choose a MIDI input'"
      @click="toggle"
    >
      <i class="dot" />
      <span class="name">{{ label }}</span>
      <span class="chev">▾</span>
    </button>

    <div v-if="open" class="menu" role="menu">
      <div class="mhead">
        <span>MIDI INPUT</span>
        <button class="rescan" :disabled="busy" @click="emit('refresh')">
          {{ busy ? "scanning…" : "rescan" }}
        </button>
      </div>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-else-if="!ports.length" class="empty">
        No devices found. Plug in your controller and hit rescan.
      </p>

      <button
        v-for="(p, i) in ports"
        :key="i"
        class="item"
        :class="{ on: i === connectedIndex }"
        role="menuitem"
        @click="pick(i)"
      >
        <i class="tick">{{ i === connectedIndex ? "●" : "" }}</i>
        <span class="pname">{{ p }}</span>
      </button>

      <button
        v-if="connectedIndex !== null"
        class="item disconnect"
        @click="emit('disconnect'); open = false"
      >
        <i class="tick" /><span>Disconnect</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; }

.trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 132px;
  background: #1a1e24;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 6px 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dim);
  cursor: pointer;
}
.trigger:hover { border-color: #39414d; color: var(--ink); }
.trigger.live { color: var(--ink); border-color: #37d0c455; }
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--faint);
  flex: none;
}
.trigger.live .dot { background: var(--teal); box-shadow: 0 0 7px var(--teal); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { color: var(--faint); font-size: 10px; flex: none; }

.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 260px;
  max-width: 340px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 11px;
  box-shadow: 0 18px 50px #000000aa;
  padding: 5px;
  z-index: 60;
}
.mhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 8px;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 1.4px;
  color: var(--faint);
}
.rescan {
  background: none;
  border: none;
  color: var(--teal);
  font-family: var(--mono);
  font-size: 10px;
  cursor: pointer;
}
.rescan:disabled { color: var(--faint); cursor: default; }

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  color: var(--ink);
  font-size: 13px;
  text-align: left;
  padding: 8px 9px;
  border-radius: 8px;
  cursor: pointer;
}
.item:hover { background: var(--panel2); }
.item.on { color: var(--teal); }
.tick { width: 10px; font-size: 9px; font-style: normal; flex: none; }
.pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item.disconnect { color: var(--dim); border-top: 1px solid var(--line); margin-top: 4px; }
.item.disconnect:hover { color: #f0a8a2; }

.err, .empty {
  font-size: 12px;
  color: var(--faint);
  padding: 4px 9px 10px;
  margin: 0;
  line-height: 1.5;
}
.err { color: var(--red); }
</style>
