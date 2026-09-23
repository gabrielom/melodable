<script setup lang="ts">
/**
 * Home: pick a lesson. This is the app's entry point — the trainer opens on
 * top of it and the X in the transport bar comes back here. It gets the whole
 * window, which is what lets the trainer view drop its lesson header entirely.
 */
import { computed, ref, watch } from "vue";
import type { Lesson } from "@/engine/types";
import { TEMPO_MAX, TEMPO_MIN } from "@/engine/types";
import { noteToPad, PADS } from "@/engine/gm";
import { noteName } from "@/engine/pitch";
import { lessonRepeats } from "@/engine/scoring";
import { type Course, stepLabel } from "@/engine/course";
import { keyName, keySignatureFor } from "@/engine/notation";
import { KEY_RANGE, authoredKey, type LessonEdit } from "@/engine/lesson-edit";

const props = defineProps<{
  lessons: Lesson[];
  currentIndex: number;
  courses: Course[];
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

/** The label a picked card would get if the song were made now. */
function pickLabel(id: string): string | null {
  const at = picked.value.indexOf(id);
  return at < 0 ? null : stepLabel(at, picked.value.length);
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

/** The keys offered: seven flats to seven sharps, as the KEY chip lists them. */
const KEYS = Array.from({ length: KEY_RANGE.max - KEY_RANGE.min + 1 }, (_, i) => KEY_RANGE.min + i);

/** What `AUTO` would read the lesson as — named in the option, so it is not a mystery. */
const autoKey = (l: Lesson) => keySignatureFor(l.notes.map((n) => n.pitch));

/**
 * An edit, sent to the card's owner: a lesson edits itself; a song keeps its
 * own name and description, and its tempo and key are its sections'.
 */
function edit(row: Row, change: LessonEdit): void {
  if (row.kind === "song" && row.course) emit("edit-song", row.course, change);
  else emit("edit-lesson", row.lesson.id, change);
}

const valueOf = (e: Event) => (e.target as HTMLInputElement).value;

function onKey(row: Row, e: Event): void {
  const v = valueOf(e);
  edit(row, { key: v === "auto" ? null : Number(v) });
}

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
    <div v-else class="head">
      <h1>Edit lessons</h1>
      <span class="kicker">CHANGE ANY CARD IN PLACE · PICK PARTS TO COMBINE A SONG</span>
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

        <!-- Editing: the same card, as a form. A div, since a button cannot
             hold fields. Every field commits when it is left, or on Enter. -->
        <div
          v-else
          class="card editing"
          :class="{ picked: pickLabel(row.lesson.id) !== null }"
        >
          <span class="top">
            <span class="kind"><i class="dot" :class="row.lesson.instrument" />{{
              row.lesson.instrument === "piano" ? "PIANO" : "PADS"
            }}</span>
            <button
              v-if="row.kind === 'lesson'"
              class="chip pick"
              :class="{ on: pickLabel(row.lesson.id) !== null }"
              :disabled="!pickable(row.lesson)"
              :aria-pressed="pickLabel(row.lesson.id) !== null"
              :aria-label="pickable(row.lesson) ? 'Pick for a song' : 'A song is one instrument'"
              @click="togglePick(row.lesson)"
            >
              {{ pickLabel(row.lesson.id) ?? "+ SONG" }}
            </button>
            <span v-else class="flag">SONG · {{ row.sections }} SECTIONS</span>
            <label class="bpm num">
              <input
                class="e-bpm"
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

          <span class="foot e-foot">
            <label v-if="row.lesson.instrument === 'piano'" class="e-key">
              <i>KEY</i>
              <select
                :value="authoredKey(row.lesson) ?? 'auto'"
                :aria-label="`${row.name} key`"
                @change="onKey(row, $event)"
              >
                <option value="auto">AUTO · {{ keyName(autoKey(row.lesson)) }}</option>
                <option v-for="f in KEYS" :key="f" :value="f">{{ keyName(f) }}</option>
              </select>
            </label>
            <span v-else class="len">{{ row.length }}</span>
            <button
              v-if="row.kind === 'song' && row.course"
              class="hbtn split"
              aria-label="Split the song back into its sections"
              @click="emit('split', row.course)"
            >
              SPLIT
            </button>
          </span>
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
 * Edit mode. Nothing here draws unless the mode is on — the home screen is
 * otherwise exactly what it was. **Not designed**: built in the bar's control
 * language (20px, mono, hairline) like the calibration dialog, and it wants
 * drawing. A picked card wears the amber ring the current card does, and its
 * chip says which section it would become.
 */
.grow { flex: 1; }
.hbtn {
  align-self: center;
  height: 20px;
  padding: 0 9px;
  border: none;
  border-radius: var(--r-field);
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt2);
  cursor: pointer;
}
.hbtn:hover { background: var(--hover); color: var(--txt); }
.hbtn.primary { background: var(--start); color: var(--start-txt); box-shadow: none; }
.hbtn.primary:disabled {
  background: none;
  color: var(--txt3);
  box-shadow: inset 0 0 0 1px var(--hair);
  cursor: default;
}
.hbtn.ghost { box-shadow: none; }
/* Every field is the bar's field: the track fill and the hairline, which in
   light is what makes it read as a field at all. */
.song-name,
.e-name,
.e-hint,
.e-bpm,
.e-key select {
  border: none;
  border-radius: var(--r-field);
  background: var(--track);
  box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--txt);
}
.song-name {
  align-self: center;
  width: 220px;
  height: 20px;
  padding: 0 7px;
  font-family: var(--sans);
  font-size: 12px;
}

.card.editing { cursor: default; }
.card.editing:hover { background: var(--gutter); }
.card.picked { box-shadow: inset 0 0 0 1.5px var(--led1); }
.chip {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  border: none;
  border-radius: 2px;
  background: none;
  box-shadow: inset 0 0 0 1px var(--hair);
  font-family: var(--mono);
  font-size: 7.5px;
  font-weight: 500;
  letter-spacing: 1.1px;
  color: var(--txt2);
  white-space: nowrap;
  cursor: pointer;
}
.chip:hover { background: var(--hover); color: var(--txt); }
.chip.on { box-shadow: inset 0 0 0 1.5px var(--led1); color: var(--txt); }
.chip:disabled { opacity: 0.4; cursor: default; }
.chip:disabled:hover { background: none; color: var(--txt2); }
/* The fields sit where the text they edit sits, at its size, so the card
   keeps its shape between browsing and editing. */
.e-bpm {
  width: 42px;
  height: 18px;
  padding: 0 4px;
  font-family: var(--mono);
  font-size: 11px;
  text-align: right;
}
.e-name {
  margin-top: 2px;
  height: 24px;
  padding: 0 6px;
  font-family: var(--sans);
  font-size: 14px;
  font-weight: 600;
}
.e-hint {
  height: 42px;
  padding: 4px 6px;
  resize: none;
  font-family: var(--sans);
  font-size: 11.5px;
  line-height: 1.45;
}
/* Doubled up to outrank `.foot`, which is declared later and stacks its
   contents in a column — right for the text it holds when browsing. */
.foot.e-foot { flex-direction: row; align-items: center; justify-content: space-between; }
.e-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.e-key i {
  font-family: var(--mono);
  font-size: 8px;
  font-style: normal;
  letter-spacing: 1.3px;
  color: var(--txt3);
}
.e-key select {
  height: 20px;
  padding: 0 4px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.6px;
}
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
