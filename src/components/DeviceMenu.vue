<script setup lang="ts">
/**
 * Compact MIDI device control for the transport bar: a button showing the
 * connected device, opening a menu of available ports plus rescan/disconnect.
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
  if (props.connectedIndex !== null) return props.connectedName.toUpperCase();
  return props.ports.length ? "SELECT DEVICE" : "NO DEVICE";
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
      <span class="name label">{{ label }}</span>
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

/* Face chip: 20px like every other bar control, LED dot showing connection. */
.trigger {
  height: 20px;
  max-width: 112px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 7px;
  border: none;
  border-radius: var(--r-field);
  background: var(--face);
  box-shadow: var(--outline);
  color: var(--txt2);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  cursor: pointer;
}
.trigger:hover { background: var(--hover); color: var(--txt); }
.trigger:focus-visible { outline: 1px solid var(--head); outline-offset: 1px; }

.dot {
  width: 4px;
  height: 4px;
  flex: none;
  border-radius: 50%;
  background: var(--txt3);
}
.trigger.live .dot { background: var(--led0); }
.trigger.live { color: var(--txt); }

.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { flex: none; font-size: 6.5px; color: var(--txt3); }

/* Menu — one surface, hairline outline, 12.5px sans rows. */
.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: 260px;
  max-width: 340px;
  padding: 4px;
  border-radius: var(--r-panel);
  background: var(--bar);
  box-shadow: inset 0 0 0 1px var(--hair), 0 10px 24px #00000044;
}

.mhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px 4px;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}
.rescan {
  border: none;
  background: none;
  color: var(--head);
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  cursor: pointer;
}
.rescan:disabled { color: var(--txt3); cursor: default; }

.err,
.empty {
  margin: 0;
  padding: 6px 8px 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--txt2);
}
.err { color: var(--stop); }

.item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--r-item);
  background: none;
  color: var(--txt2);
  font-family: var(--sans);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.item:hover { background: var(--hover); }
.item.on { color: var(--txt); }
.tick { width: 10px; flex: none; font-size: 8px; font-style: normal; color: var(--head); }
.pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.disconnect { color: var(--stop); }
</style>
