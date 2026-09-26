<script setup lang="ts">
/**
 * Home: pick a lesson. This is the app's entry point — the trainer opens on
 * top of it and the X in the transport bar comes back here. It gets the whole
 * window, which is what lets the trainer view drop its lesson header entirely.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { Lesson } from "@/engine/types";
import { TEMPO_MAX, TEMPO_MIN } from "@/engine/types";
import { noteToPad, PADS } from "@/engine/gm";
import { noteName } from "@/engine/pitch";
import { lessonRepeats } from "@/engine/scoring";
import { type Course, stepLabel } from "@/engine/course";
import { keyName, keySignatureFor } from "@/engine/notation";
import { authoredKey, type LessonEdit } from "@/engine/lesson-edit";
import KeyMenu from "@/components/KeyMenu.vue";

const props = defineProps<{
  lessons: Lesson[];
  currentIndex: number;
  courses: Course[];
  /** Sections complete per song id — named on a song's card in edit mode. */
  complete: Readonly<Record<string, number>>;
  /**
   * Edit mode, switched from the top bar: every card becomes a form for its
   * own name, description, tempo and key, lessons can be picked to combine
   * into a song, and a song can be split back apart.
   */
  editing: boolean;
}>();

const emit = defineEmits<{
  (e: "open", index: number): void;
  (e: "import"): void;
  /** A song's card: open the song, which puts its section picker up. */
  (e: "open-song", courseId: string): void;
  (e: "combine", name: string, lessonIds: string[]): void;
  (e: "edit-lesson", lessonId: string, edit: LessonEdit): void;
  /** A song's name and description are its own; its tempo and key are its sections'. */
  (e: "edit-song", courseId: string, edit: LessonEdit): void;
  (e: "split", courseId: string): void;
  (e: "done"): void;
}>();

/** What the lesson asks you to play — pads by name, piano by key range. */
function summary(lesson: Lesson): string {
  if (lesson.instrument === "piano") {
    const pitches = lesson.notes.map((n) => n.pitch);
    if (!pitches.length) return "";
    return `${noteName(Math.min(...pitches))} – ${noteName(Math.max(...pitches))}`;
  }
  const names = new Set<string>();
  for (const n of lesson.notes) {
    const pad = noteToPad(n.pitch);
    if (pad !== null) names.add(PADS[pad].name);
  }
  return [...names].join(" · ");
}

/**
 * How long a run of this lesson takes at its base tempo. A lesson is a finite
 * piece now, so the length you are committing to matters more than the length
 * of the pattern it repeats.
 */
function runLength(lesson: Lesson): string {
  const repeats = lessonRepeats(lesson);
  const bars = lesson.bars * repeats;
  const secs = Math.round((bars * lesson.beatsPerBar * 60) / lesson.bpm);
  return `${bars} bar${bars === 1 ? "" : "s"} · ${secs}s`;
}

/** One card on the grid. A song is drawn as its full song's card. */
interface Row {
  kind: "lesson" | "song";
  key: string;
  /** For a song, the full song — the last step, whose card it wears. */
  lesson: Lesson;
  /** What the card is called. A song's is its own, which starts as the full song's. */
  name: string;
  hint: string;
  /** For a song, how many sections it has. */
  sections: number;
  /** Index into the library, for a plain lesson. */
  index: number;
  /** For a song, its id — the card opens the song, not a lesson. */
  course: string | null;
  current: boolean;
  summary: string;
  length: string;
}

const byId = computed(() => new Map(props.lessons.map((l) => [l.id, l])));

/**
 * The grid in library order, with a song standing where its first step would.
 *
 * A song replaces its steps on the grid — they are reached through it — and
 * it is drawn as the card its full song had before it was combined, with the
 * song's own name, and description once one is written. Where it leads is
 * different: it opens the song, whose section picker comes up first.
 */
const rows = computed<Row[]>(() => {
  const songOf = new Map<string, Course>();
  for (const c of props.courses) for (const id of c.lessonIds) songOf.set(id, c);
  const current = props.lessons[props.currentIndex]?.id;
  const placed = new Set<string>();
  const out: Row[] = [];
  props.lessons.forEach((l, i) => {
    const c = songOf.get(l.id);
    if (!c) {
      out.push({
        kind: "lesson",
        key: l.id,
        lesson: l,
        name: l.name,
        hint: l.hint ?? "",
        sections: 0,
        index: i,
        course: null,
        current: l.id === current,
        summary: summary(l),
        length: runLength(l),
      });
      return;
    }
    if (placed.has(c.id)) return;
    placed.add(c.id);
    const song = byId.value.get(c.lessonIds[c.lessonIds.length - 1]);
    if (!song) return;
    out.push({
      kind: "song",
      key: c.id,
      lesson: song,
      name: c.name,
      hint: c.hint ?? song.hint ?? "",
      sections: c.lessonIds.length,
      index: props.lessons.indexOf(song),
      course: c.id,
      current: current !== undefined && c.lessonIds.includes(current),
      summary: summary(song),
      length: runLength(song),
    });
  });
  return out;
});

// ----------------------------------------------------------------- editing

/**
 * Picking lessons to combine into a song. The order they are picked in is the
 * order they are learned, and the last one picked is the full song — which is
 * why the chips relabel live as the selection grows: whatever was picked last
 * reads FULL SONG until something is picked after it.
 */
const picked = ref<string[]>([]);
const name = ref("");
const nameTouched = ref(false);

function clearPicks(): void {
  picked.value = [];
  name.value = "";
  nameTouched.value = false;
}

watch(() => props.editing, clearPicks);

const pickedInstrument = computed(
  () => byId.value.get(picked.value[0] ?? "")?.instrument ?? null,
);

function togglePick(l: Lesson): void {
  const at = picked.value.indexOf(l.id);
  if (at >= 0) picked.value = picked.value.filter((id) => id !== l.id);
  else if (pickable(l)) picked.value = [...picked.value, l.id];
  // The song is named after the full song until the player names it.
  if (!nameTouched.value) {
    name.value = byId.value.get(picked.value[picked.value.length - 1] ?? "")?.name ?? "";
  }
}

/**
 * A picked card's corner stamp (handoff 14, 11l): the letter its section would
 * get if the song were made now, or FULL for the newest pick — the full song
 * until something is picked after it.
 */
function stamp(id: string): string | null {
  const at = picked.value.indexOf(id);
  if (at < 0) return null;
  const label = stepLabel(at, picked.value.length);
  return label === "FULL SONG" ? "FULL" : label.slice(-1);
}

/** The words beside the instrument: which pick this was. */
function pickTag(id: string): string | null {
  const at = picked.value.indexOf(id);
  if (at < 0) return null;
  return at === picked.value.length - 1 ? "LAST PICK" : `PICK ${at + 1}`;
}

/** One song is one instrument: the other kind is out once something is picked. */
function pickable(l: Lesson): boolean {
  return pickedInstrument.value === null || pickedInstrument.value === l.instrument;
}

const canCreate = computed(() => picked.value.length >= 2 && name.value.trim().length > 0);

function create(): void {
  if (!canCreate.value) return;
  emit("combine", name.value.trim(), [...picked.value]);
  clearPicks();
}

/** What `AUTO` would read the lesson as — named on the chip, so it is not a mystery. */
const autoKey = (l: Lesson) => keySignatureFor(l.notes.map((n) => n.pitch));

/** The chip's reading: `AUTO · C maj` until a key is set by hand. */
function keyChip(l: Lesson): string {
  const k = authoredKey(l);
  return k === null ? `AUTO · ${keyName(autoKey(l))}` : keyName(k);
}

/**
 * The key menu, opened from one card's chip at a time. It is placed in the
 * viewport rather than under the chip, because the grid scrolls and would
 * clip a menu hanging off a card in its bottom row; it opens upwards when
 * there is no room below, and closes if the grid scrolls away under it.
 */
const keyOpen = ref<string | null>(null);
const keyAt = ref<{ left: number; top?: number; bottom?: number }>({ left: 0 });
const MENU_H = 268;
function toggleKey(row: Row, e: MouseEvent): void {
  if (keyOpen.value === row.key) {
    keyOpen.value = null;
    return;
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  keyAt.value =
    below >= MENU_H + 8 || below >= r.top
      ? { left: r.left, top: r.bottom + 5 }
      : { left: r.left, bottom: window.innerHeight - r.top + 5 };
  keyOpen.value = row.key;
}
function pickKey(row: Row, fifths: number | null): void {
  keyOpen.value = null;
  edit(row, { key: fifths });
}
function onDocPointer(e: PointerEvent): void {
  if (keyOpen.value === null) return;
  const t = e.target as Element | null;
  if (t?.closest(".key-menu, .keychip")) return;
  keyOpen.value = null;
}
function onDocKey(e: KeyboardEvent): void {
  if (e.key === "Escape") keyOpen.value = null;
}
onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer);
  window.addEventListener("keydown", onDocKey);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointer);
  window.removeEventListener("keydown", onDocKey);
  cancelSplit();
});
watch(() => props.editing, () => (keyOpen.value = null));

/**
 * SPLIT takes a one-second hold, and letting go early cancels it (11l): a
 * song's progress goes with it, so a stray click must not be enough. There is
 * no confirmation dialog — the hold is the confirmation. While it is held the
 * button fills with the amber, left to right, over that second, which is the
 * designer's suggestion for the feedback the frame leaves undrawn.
 */
const SPLIT_HOLD_MS = 1000;
const splitting = ref<string | null>(null);
let splitTimer: ReturnType<typeof setTimeout> | null = null;
function startSplit(courseId: string): void {
  cancelSplit();
  splitting.value = courseId;
  splitTimer = setTimeout(() => {
    splitTimer = null;
    splitting.value = null;
    emit("split", courseId);
  }, SPLIT_HOLD_MS);
}
function cancelSplit(): void {
  if (splitTimer) clearTimeout(splitTimer);
  splitTimer = null;
  splitting.value = null;
}
/** Space or Enter held on the focused button is the same hold, for the keyboard. */
function splitKey(courseId: string, e: KeyboardEvent): void {
  if (e.key !== " " && e.key !== "Enter") return;
  e.preventDefault();
  if (!e.repeat) startSplit(courseId);
}

/**
 * An edit, sent to the card's owner: a lesson edits itself; a song keeps its
 * own name and description, and its tempo and key are its sections'.
 */
function edit(row: Row, change: LessonEdit): void {
  if (row.kind === "song" && row.course) emit("edit-song", row.course, change);
  else emit("edit-lesson", row.lesson.id, change);
}

const valueOf = (e: Event) => (e.target as HTMLInputElement).value;

/** Enter commits a one-line field, the way it would in any form. */
function commitOnEnter(e: KeyboardEvent): void {
  (e.target as HTMLElement).blur();
}

function onCard(row: Row): void {
  if (row.course) emit("open-song", row.course);
  else emit("open", row.index);
}
</script>

<template>
  <div class="home">
    <div v-if="!editing" class="head">
      <h1>Choose a lesson</h1>
      <span class="kicker">PICK ONE TO START PRACTISING</span>
    </div>
    <div v-else class="head edit">
      <h1>Edit lessons</h1>
      <span class="hint-line">PICK IN PLAYING ORDER · THE LAST PICK IS THE FULL SONG</span>
      <span class="grow" />
      <!-- Combining appears once there is something picked to combine. -->
      <template v-if="picked.length">
        <input
          v-model="name"
          class="song-name"
          type="text"
          placeholder="Song name"
          aria-label="Song name"
          spellcheck="false"
          @input="nameTouched = true"
          @keydown.enter="create"
        />
        <button class="hbtn primary" :disabled="!canCreate" @click="create">
          COMBINE · {{ picked.length }}
        </button>
        <button class="hbtn ghost" @click="clearPicks">CLEAR</button>
      </template>
      <button class="hbtn" @click="emit('done')">DONE</button>
    </div>

    <div class="grid">
      <template v-for="row in rows" :key="row.key">
        <!-- Browsing: the card as it has always been. -->
        <button
          v-if="!editing"
          class="card"
          :class="{ current: row.current }"
          @click="onCard(row)"
        >
          <span class="top">
            <span class="kind"><i class="dot" :class="row.lesson.instrument" />{{
              row.lesson.instrument === "piano" ? "PIANO" : "PADS"
            }}</span>
            <span v-if="row.lesson.source === 'midi-import'" class="flag">IMPORTED</span>
            <span v-else-if="row.current" class="flag resume">RESUME</span>
            <span class="bpm num">{{ row.lesson.bpm }}<i>BPM</i></span>
          </span>

          <span class="name">{{ row.name }}</span>
          <span class="hint">{{ row.hint }}</span>

          <span class="foot">
            <span class="parts">{{ row.summary }}</span>
            <span class="len">{{ row.length }}</span>
          </span>
        </button>

        <!-- Editing (handoff 14, 11l): the same card as a form. A div, since
             a button cannot hold fields. Every field commits when it is left,
             or on Enter. -->
        <div
          v-else
          class="card editing"
          :class="{
            picked: stamp(row.lesson.id) !== null,
            off: row.kind === 'lesson' && !pickable(row.lesson),
          }"
        >
          <!-- The corner: a pick's stamp, an empty slot to pick with, or on a
               song its SPLIT. The other instrument's cards have none. -->
          <button
            v-if="row.kind === 'lesson' && stamp(row.lesson.id) !== null"
            class="stamp"
            :class="{ full: stamp(row.lesson.id) === 'FULL' }"
            :aria-label="`Picked as ${stamp(row.lesson.id) === 'FULL' ? 'the full song' : `part ${stamp(row.lesson.id)}`}; unpick`"
            @click="togglePick(row.lesson)"
          >
            {{ stamp(row.lesson.id) }}
          </button>
          <button
            v-else-if="row.kind === 'lesson' && pickable(row.lesson)"
            class="slot"
            aria-label="Pick for a song"
            @click="togglePick(row.lesson)"
          >
            +
          </button>

          <span class="top e-top" :class="{ song: row.kind === 'song' }">
            <span class="kind"><i class="dot" :class="row.lesson.instrument" />{{
              row.lesson.instrument === "piano" ? "PIANO" : "PADS"
            }}</span>
            <span v-if="row.kind === 'lesson' && pickTag(row.lesson.id)" class="tag">
              {{ pickTag(row.lesson.id) }}
            </span>
            <span v-else-if="row.kind === 'song' && row.course" class="tag">
              SONG · {{ row.sections }} PARTS · {{ complete[row.course] ?? 0 }} COMPLETE
            </span>
            <button
              v-if="row.kind === 'song' && row.course"
              class="split"
              :class="{ holding: splitting === row.course }"
              aria-label="Split the song back into its sections — hold for one second"
              @pointerdown="startSplit(row.course)"
              @pointerup="cancelSplit"
              @pointerleave="cancelSplit"
              @pointercancel="cancelSplit"
              @keydown="splitKey(row.course, $event)"
              @keyup="cancelSplit"
              @blur="cancelSplit"
            >
              <span>⤢ SPLIT</span>
            </button>
          </span>

          <input
            class="e-name"
            type="text"
            :value="row.name"
            spellcheck="false"
            :aria-label="row.kind === 'song' ? 'Song name' : 'Lesson name'"
            @change="edit(row, { name: valueOf($event) })"
            @keydown.enter="commitOnEnter"
          />
          <textarea
            class="e-hint"
            rows="2"
            :value="row.hint"
            placeholder="Description"
            aria-label="Description"
            @change="edit(row, { hint: valueOf($event) })"
          />

          <span class="e-foot">
            <button
              v-if="row.lesson.instrument === 'piano'"
              class="keychip"
              :class="{ open: keyOpen === row.key }"
              :aria-expanded="keyOpen === row.key"
              :aria-label="`${row.name} key`"
              @click="toggleKey(row, $event)"
            >
              <i class="k">KEY</i>
              <b>{{ keyChip(row.lesson) }}</b>
              <i class="caret">{{ keyOpen === row.key ? "\u25b4" : "\u25be" }}</i>
            </button>
            <span v-else class="meta">{{ row.length }}</span>
            <label class="e-tempo">
              <input
                class="e-bpm num"
                type="number"
                :min="TEMPO_MIN"
                :max="TEMPO_MAX"
                step="1"
                :value="row.lesson.bpm"
                :aria-label="`${row.name} tempo`"
                @change="edit(row, { bpm: Number(valueOf($event)) })"
                @keydown.enter="commitOnEnter"
              /><i>BPM</i>
            </label>
          </span>
          <span v-if="row.kind === 'song'" class="caption">
            HOLD ⤢ SPLIT FOR 1 S — RELEASING EARLY CANCELS
          </span>

          <!-- In the body, not the card: a greyed card's opacity would dim a
               menu drawn inside it. -->
          <Teleport to="body">
          <KeyMenu
            v-if="keyOpen === row.key"
            class="card-key-menu"
            :style="{
              left: `${keyAt.left}px`,
              top: keyAt.top === undefined ? undefined : `${keyAt.top}px`,
              bottom: keyAt.bottom === undefined ? undefined : `${keyAt.bottom}px`,
            }"
            :value="authoredKey(row.lesson)"
            :auto="autoKey(row.lesson)"
            @pick="(f) => pickKey(row, f)"
          />
          </Teleport>
        </div>
      </template>

      <!-- The library's last slot is the way to add to it. -->
      <button v-if="!editing" class="card import" @click="emit('import')">
        <span class="imp-glyph" aria-hidden="true">⇪</span>
        <span class="imp-title">Import a MIDI clip</span>
        <span class="imp-sub">.MID FROM YOUR DAW</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 14px;
  background: var(--win);
}

.head { display: flex; align-items: baseline; gap: 10px; flex: none; }

/*
 * Edit mode (handoff 14, 11l). Nothing here draws unless the mode is on — the
 * home screen is otherwise exactly what it was.
 */
.head.edit { align-items: center; }
.hint-line {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.grow { flex: 1; }
.hbtn {
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 11px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  white-space: nowrap;
  color: var(--txt);
  cursor: pointer;
}
.hbtn:hover { background: var(--hover); }
.hbtn.primary { background: var(--start); color: var(--start-txt); box-shadow: none; }
.hbtn.primary:disabled {
  background: none;
  color: var(--txt3);
  box-shadow: inset 0 0 0 1px var(--hair);
  cursor: default;
}
.hbtn.ghost { box-shadow: none; color: var(--txt2); }
.hbtn.ghost:hover { color: var(--txt); }
/* The one filled field on the screen, which is what sets it apart from the
   cards' outline-only ones: this is the song about to be made. */
.song-name {
  width: 200px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--r-field);
  background: var(--field-fill);
  box-shadow: inset 0 0 0 1px var(--hair);
  font-family: var(--sans);
  font-size: 12.5px;
  color: var(--txt);
}

.card.editing {
  position: relative;
  padding: 11px 12px 10px;
  cursor: default;
}
.card.editing:hover { background: var(--gutter); }
.card.picked { box-shadow: inset 0 0 0 1.5px var(--led1); }
/* The other instrument, once the first pick has set this song's: out of the
   running, and it loses its slot. Dark needs less dimming to read as off. */
.card.off { opacity: 0.42; }
:root[data-theme="dark"] .card.off { opacity: 0.7; }

/* The corner: a stamp for a pick, in pick order; a dashed slot to pick with. */
.stamp,
.slot {
  position: absolute;
  top: 9px;
  right: 10px;
  height: 26px;
  min-width: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-field);
  font-family: var(--mono);
  cursor: pointer;
  /* Above the instrument row, which is positioned (it anchors SPLIT) and
     comes later in the card, so it would otherwise take the corner's clicks. */
  z-index: 1;
}
.stamp {
  padding: 0;
  border: none;
  background: var(--led1);
  color: var(--on-led1);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
}
.stamp.full { padding: 0 7px; font-size: 9px; letter-spacing: 1px; }
.slot {
  width: 26px;
  padding: 0;
  border: 1px dashed var(--todo);
  background: none;
  color: var(--txt3);
  font-size: 13px;
}
.slot:hover { background: var(--hover); color: var(--txt); }

/* 26px tall so the row lines up with the stamp beside it; the padding keeps
   the words clear of it. */
.e-top { position: relative; height: 26px; padding-right: 40px; }
/* Room for SPLIT, which is wider than a stamp. */
.e-top.song { padding-right: 60px; }
.tag {
  min-width: 0;
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 0.9px;
  color: var(--led1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* SPLIT takes the stamp's corner. Held for a second it fires; the amber
   fills it left to right while it is held. */
.split {
  position: absolute;
  right: -2px;
  top: 0;
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  overflow: hidden;
  border: none;
  border-radius: var(--r-field);
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
  font-family: var(--mono);
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 1px;
  white-space: nowrap;
  color: var(--txt2);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.split:hover { color: var(--txt); }
.split span { position: relative; }
.split::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--led1);
  transform: scaleX(0);
  transform-origin: left;
}
.split.holding { color: var(--on-led1); }
.split.holding::before { transform: scaleX(1); transition: transform 1s linear; }

/* Fields are outline only, so edit mode reads calmer than a form; in light
   the hairline is the only thing that makes them read as fields at all. */
.e-name,
.e-hint,
.e-bpm {
  border: none;
  border-radius: var(--r-field);
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--txt);
}
.e-name {
  padding: 4px 7px;
  font-family: var(--sans);
  font-size: 14px;
  font-weight: 600;
}
.e-hint {
  height: 42px;
  padding: 4px 7px;
  resize: none;
  font-family: var(--sans);
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--txt2);
}
.e-hint::placeholder { color: var(--txt3); }

.e-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 7px;
  border-top: 1px solid var(--hair);
}
.meta,
.e-tempo i,
.caption {
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  font-style: normal;
  letter-spacing: 0.9px;
  color: var(--txt3);
}
.meta { text-transform: uppercase; }
.caption { margin-top: 3px; }
.e-tempo { margin-left: auto; display: flex; align-items: center; gap: 4px; }
/* Sized to three digits and nothing more; the spinners would double it. */
.e-bpm {
  width: 36px;
  padding: 2px 6px;
  font-family: var(--mono);
  font-size: 11px;
  text-align: right;
  -moz-appearance: textfield;
}
.e-bpm::-webkit-inner-spin-button,
.e-bpm::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

/* The trainer bar's KEY chip plus a caret, opening the same menu. Light is
   the surface with its hairline; dark is the bar's own face, no outline. */
.keychip {
  height: 20px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: none;
  border-radius: var(--r-field);
  background: var(--face);
  box-shadow: var(--outline);
  cursor: pointer;
}
.keychip .k {
  font-family: var(--mono);
  font-size: 9.5px;
  font-style: normal;
  letter-spacing: 1.2px;
  line-height: 1;
  color: var(--txt3);
}
.keychip b {
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1;
  color: var(--txt);
}
.keychip .caret { font-size: 6.5px; font-style: normal; color: var(--txt3); }
.keychip:hover { background: var(--hover); }
.keychip.open { background: var(--active); box-shadow: none; }
.keychip.open .k { color: var(--active-txt); opacity: 0.65; }
.keychip.open b,
.keychip.open .caret { color: var(--active-txt); }
.card-key-menu { position: fixed; z-index: 70; }

h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--txt);
}
.kicker {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  color: var(--txt3);
}

/*
 * Sizes from the handoff's "10a home" frame: a 1180px screen with 14px of
 * body padding either side, four columns and an 8px gap gives
 * (1152 - 24) / 4 = 282px, and its two rows measure 196.5.
 *
 * The two axes are deliberately different. 282px is the column's *minimum*,
 * so cards share out whatever width is going and a resize adds or drops a
 * column rather than leaving a ragged margin. The height is a flat 196px and
 * does not negotiate: rows would otherwise stretch to divide the stage, so a
 * library of three lessons would draw three enormous cards.
 *
 * `align-content: start` keeps the rows packed at the top once they no longer
 * fill the height.
 */
.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(282px, 1fr));
  grid-auto-rows: 196px;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 13px 11px;
  border: none;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair);
  text-align: left;
  cursor: pointer;
}
.card:hover { background: var(--hover); }
/* The lesson you are on swaps the outline rather than filling. */
.card.current { box-shadow: inset 0 0 0 1px var(--led1); }
.card:focus-visible { outline: 1px solid var(--head); outline-offset: 1px; }

.top { display: flex; align-items: center; gap: 7px; }
.kind {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt2);
}
.dot { width: 4px; height: 4px; flex: none; border-radius: 50%; background: var(--led1); }
/* Piano's dot names an instrument, not a rating, so it keeps its own hue. */
.dot.piano { background: var(--rate-great); }
.flag {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt3);
}
.flag.resume { color: var(--led1); }
.bpm {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  font-size: 11px;
  color: var(--txt);
}
.bpm i {
  font-style: normal;
  font-size: 7.5px;
  letter-spacing: 1.2px;
  color: var(--txt3);
}

.name { margin-top: 2px; font-size: 14px; font-weight: 600; color: var(--txt); }
.hint {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--txt2);
  /* Two lines, always: the min-height reserves the second one so footers line
     up across a row, and the clamp stops a longer hint from pushing the
     footer past the bottom of a card that no longer grows to fit it. Every
     hint in the handoff is one or two lines. */
  min-height: 33px;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  overflow: hidden;
  text-wrap: pretty;
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* The handoff's 5px, not `auto`. `auto` pinned the footer to the bottom of
     the card and left the slack in the middle; the drawing runs the content
     straight down from the top and leaves the slack underneath. */
  margin-top: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--hair);
}
.parts {
  font-size: 11px;
  color: var(--txt2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.len {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: var(--txt3);
}

/* Outline only — it is an action, not a lesson. */
.card.import {
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
}
.card.import:hover { background: var(--hover); }
.imp-glyph { font-size: 17px; color: var(--txt2); }
.imp-title { font-size: 12.5px; color: var(--txt2); }
.imp-sub {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 1.3px;
  color: var(--txt3);
}
</style>
