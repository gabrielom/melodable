<script setup lang="ts">
/**
 * Live MIDI log. This is a real tool, not decoration: it's how you discover
 * which note numbers your controller actually sends, which you'll need when
 * extending GM_TO_PAD in src/engine/gm.ts.
 */
import { noteName } from "@/engine/pitch";
import type { LogRow } from "@/components/midi-log";

defineProps<{ rows: LogRow[] }>();

/** The wire names read as one word; the column wants them spaced. */
const KIND_LABEL: Record<string, string> = {
  noteon: "note on",
  noteoff: "note off",
  cc: "cc",
  other: "other",
};
const kindLabel = (k: string) => KIND_LABEL[k] ?? k;
const emit = defineEmits<{ (e: "clear"): void; (e: "collapse"): void }>();
</script>

<template>
  <section class="monitor">
    <header>
      <span class="ttl">MIDI MONITOR</span>
      <span class="acts">
        <button class="clear" @click="emit('clear')">clear</button>
        <button class="collapse" title="Hide the monitor" @click="emit('collapse')">›</button>
      </span>
    </header>

    <div class="head">
      <span>event</span><span>note</span><span>vel</span><span>ch</span><span>Δms</span>
    </div>

    <div class="rows">
      <p v-if="!rows.length" class="empty">
        Hit a pad or key — hardware, mouse, or computer keyboard.
      </p>
      <div v-for="r in rows" :key="r.id" class="row" :class="r.kind">
        <span class="kind">
          <i class="src" :class="r.source" />{{ kindLabel(r.kind) }}
        </span>
        <span>{{ r.note }} <em>{{ noteName(r.note) }}</em></span>
        <span>{{ r.velocity }}</span>
        <span>{{ r.channel + 1 }}</span>
        <span class="dim">{{ r.delta > 0 ? r.delta : "—" }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Part of the window, not a floating card: it sits on `gutter` with the
   panel radius, and in light needs the hairline to separate at all. */
.monitor {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--r-panel);
  background: var(--gutter);
  box-shadow: var(--outline);
}

header {
  height: 26px;
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid var(--hair);
}
.ttl {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--head);
}
.acts { display: inline-flex; align-items: center; gap: 8px; }
.clear,
.collapse {
  border: none;
  background: none;
  padding: 0;
  color: var(--txt3);
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 1.1px;
  cursor: pointer;
}
.clear:hover,
.collapse:hover { color: var(--txt); }
.collapse { font-size: 11px; letter-spacing: 0; }

/* The grid is the app's own; only the type scale changed. */
.head,
.row {
  display: grid;
  grid-template-columns: 1.5fr 1.4fr 0.6fr 0.5fr 0.7fr;
  gap: 6px;
  padding: 5px 10px;
  align-items: baseline;
}
.head {
  flex: none;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--txt3);
  border-bottom: 1px solid var(--hair);
}
.head span:last-child,
.row span:last-child { text-align: right; }

.rows { flex: 1; min-height: 0; overflow-y: auto; }
.empty {
  margin: 0;
  padding: 10px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--txt3);
}

.row {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 9.5px;
  color: var(--txt);
  border-bottom: 1px solid var(--hair);
}
.row em { font-style: normal; font-size: 8px; color: var(--txt3); }
.dim { color: var(--txt3); }

/* The event cell names a message kind, not a rating, so it keeps its own
   literal hues (see handoff 02 §21). */
.kind {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 8.5px;
  letter-spacing: 1.1px;
  text-transform: lowercase;
  color: var(--txt3);
}
.row.noteon .kind { color: var(--rate-great); }
.row.cc .kind { color: var(--led2); }

/* Source dot: where the message came from. */
.src {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  background: var(--txt3);
}
.src.hardware { background: var(--led1); }
.src.keyboard { background: var(--led2); }
</style>
