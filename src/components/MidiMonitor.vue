<script setup lang="ts">
/**
 * Live MIDI log. This is a real tool, not decoration: it's how you discover
 * which note numbers your controller actually sends, which you'll need when
 * extending GM_TO_PAD in src/engine/gm.ts.
 */
import { noteName } from "@/engine/pitch";
import type { LogRow } from "@/components/midi-log";

defineProps<{ rows: LogRow[] }>();
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
          <i class="src" :class="r.source" />{{ r.kind }}
        </span>
        <span class="mono">{{ r.note }} <em>{{ noteName(r.note) }}</em></span>
        <span class="mono">{{ r.velocity }}</span>
        <span class="mono">{{ r.channel + 1 }}</span>
        <span class="mono dim">{{ r.delta > 0 ? r.delta : "—" }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.monitor {
  border: 1px solid var(--hair);
  border-radius: 12px;
  background: var(--bar);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--hair);
}
.ttl {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 1.6px;
  color: var(--head);
}
.acts { display: inline-flex; align-items: center; gap: 4px; }
.clear {
  background: none;
  border: none;
  color: var(--txt3);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--mono);
}
.clear:hover { color: var(--txt); }
.collapse {
  background: none;
  border: none;
  color: var(--txt3);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.collapse:hover { color: var(--txt); background: var(--active); }

.head,
.row {
  display: grid;
  grid-template-columns: 1.5fr 1.4fr 0.6fr 0.5fr 0.7fr;
  gap: 6px;
  padding: 5px 12px;
  align-items: center;
}
.head {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 1px;
  color: var(--txt3);
  text-transform: uppercase;
  border-bottom: 1px solid var(--hair);
}
.rows {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.row {
  font-size: 12px;
  border-bottom: 1px solid #1e222a;
}
.row.noteon .kind { color: var(--head); }
.row.noteoff .kind { color: var(--txt3); }
.row.cc .kind { color: var(--rate-great); }
.kind {
  font-family: var(--mono);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.src {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}
.src.hardware { background: var(--rate-good); box-shadow: 0 0 6px var(--rate-good); }
.src.keyboard { background: var(--rate-great); }
.src.click { background: var(--txt3); }
.mono { font-family: var(--mono); font-size: 11.5px; }
.mono em { color: var(--txt3); font-style: normal; font-size: 10.5px; }
.dim { color: var(--txt3); }
.empty {
  color: var(--txt3);
  font-size: 12.5px;
  padding: 16px 12px;
  margin: 0;
}
</style>
