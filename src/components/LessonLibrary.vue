<script setup lang="ts">
/**
 * Lesson library — a modal list of every lesson. The current one is marked;
 * clicking any lesson selects it and closes. Keyboard: ↑/↓ move, Enter picks,
 * Esc closes. Built-in lessons carry a progression number; imported lessons
 * (M4) will land in the same list.
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { Lesson } from "@/engine/types";
import { noteToPad, PADS } from "@/engine/gm";

const props = defineProps<{
  lessons: Lesson[];
  currentIndex: number;
}>();

const emit = defineEmits<{
  (e: "select", index: number): void;
  (e: "close"): void;
}>();

const focused = ref(props.currentIndex);
const panel = ref<HTMLElement | null>(null);

/** Distinct pads this lesson touches — a quick glance at what's involved. */
function padSummary(lesson: Lesson): string {
  const names = new Set<string>();
  for (const n of lesson.notes) {
    const pad = noteToPad(n.pitch);
    if (pad !== null) names.add(PADS[pad].name);
  }
  return [...names].join(" · ");
}

const rows = computed(() =>
  props.lessons.map((l, i) => ({
    lesson: l,
    index: i,
    current: i === props.currentIndex,
    hits: l.notes.length,
    pads: padSummary(l),
  })),
);

function pick(index: number): void {
  emit("select", index);
  emit("close");
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    focused.value = Math.min(focused.value + 1, props.lessons.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    focused.value = Math.max(focused.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    pick(focused.value);
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  await nextTick();
  panel.value?.focus();
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <div
        ref="panel"
        class="panel"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-label="Lesson library"
      >
        <header class="head">
          <div>
            <div class="kicker">LESSON LIBRARY</div>
            <div class="count">{{ lessons.length }} lessons</div>
          </div>
          <button class="close" aria-label="Close" @click="emit('close')">✕</button>
        </header>

        <ul class="list">
          <li
            v-for="row in rows"
            :key="row.lesson.id"
            class="row"
            :class="{ current: row.current, focus: row.index === focused }"
            @click="pick(row.index)"
            @mouseenter="focused = row.index"
          >
            <span class="num">{{ row.index + 1 }}</span>
            <span class="body">
              <span class="name">
                {{ row.lesson.name }}
                <span v-if="row.current" class="badge">current</span>
                <span v-if="row.lesson.source === 'midi-import'" class="badge import">imported</span>
              </span>
              <span class="hint">{{ row.lesson.hint || row.pads }}</span>
            </span>
            <span class="meta">
              <span class="bpm">{{ row.lesson.bpm }}<i>BPM</i></span>
              <span class="hits">{{ row.hits }} hits</span>
            </span>
          </li>
        </ul>

        <footer class="foot">
          <span>↑↓ move · Enter select · Esc close</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: #06070acc;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 24px;
}
.panel {
  width: min(560px, 100%);
  max-height: min(80vh, 680px);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 24px 80px #000000aa;
  outline: none;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--line);
}
.kicker {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--teal);
}
.count { font-size: 13px; color: var(--dim); margin-top: 3px; }
.close {
  background: none;
  border: none;
  color: var(--faint);
  font-size: 15px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}
.close:hover { color: var(--ink); background: var(--panel2); }

.list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  min-height: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;
}
.row.focus { background: var(--panel2); }
.row.current { border-color: #ffb34055; }
.num {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--faint);
  width: 20px;
  text-align: center;
  flex: none;
}
.row.current .num { color: var(--amber); }
.body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--amber);
  border: 1px solid #ffb34055;
  border-radius: 20px;
  padding: 1px 7px;
}
.badge.import { color: var(--teal); border-color: #37d0c455; }
.hint {
  font-size: 12px;
  color: var(--dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex: none;
}
.bpm { font-family: var(--mono); font-size: 13px; color: var(--ink); }
.bpm i { font-style: normal; font-size: 9px; color: var(--faint); margin-left: 3px; }
.hits { font-size: 10.5px; color: var(--faint); }
.foot {
  padding: 9px 16px;
  border-top: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
  text-align: center;
}
</style>
