/**
 * Editing a lesson's details by hand: its name, its description, its tempo and
 * its key.
 *
 * Pure, so the rules can be tested without a store. What an edit may change is
 * deliberately narrow — the words on the card and the two numbers a player
 * reads the music by. The notes, the bar length and the instrument are the
 * material itself and are not editable here.
 */

import type { Lesson } from "./types";
import { TEMPO_MAX, TEMPO_MIN } from "./types";

/** The keys a lesson can be set to, as fifths: seven flats to seven sharps. */
export const KEY_RANGE = { min: -7, max: 7 } as const;

/**
 * A change to a lesson. Every field is optional; an absent one is left alone.
 * `key: null` hands the key back to being derived from the notes.
 */
export interface LessonEdit {
  name?: string;
  hint?: string;
  bpm?: number;
  key?: number | null;
}

function isKey(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= KEY_RANGE.min && v <= KEY_RANGE.max;
}

/**
 * The key a lesson was set to by hand, or null when it is to be read off its
 * notes. Checked rather than trusted: an imported lesson comes back from a
 * file that nothing stops being edited, the same stance `usableImports` takes.
 */
export function authoredKey(lesson: Pick<Lesson, "key">): number | null {
  return isKey(lesson.key) ? lesson.key : null;
}

/** A tempo the transport can play, as a whole number inside the one range. */
export function clampTempo(bpm: number): number {
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(bpm)));
}

/**
 * The lesson with the edit applied — a new object, so anything watching the
 * lesson by identity sees the change.
 *
 * A name cannot be emptied: a card with no name is a card that cannot be told
 * apart, so a blank one keeps what was there. A description can be, since
 * lessons without one already exist. A tempo that is not a number is ignored,
 * and one outside `TEMPO_MIN`..`TEMPO_MAX` is brought inside it — the same
 * range the transport readout and the import dialog use.
 */
export function applyEdit(lesson: Lesson, edit: LessonEdit): Lesson {
  const out: Lesson = { ...lesson };
  if (typeof edit.name === "string" && edit.name.trim()) out.name = edit.name.trim();
  if (typeof edit.hint === "string") out.hint = edit.hint.trim();
  if (typeof edit.bpm === "number" && Number.isFinite(edit.bpm)) out.bpm = clampTempo(edit.bpm);
  if (edit.key === null) delete out.key;
  else if (isKey(edit.key)) out.key = edit.key;
  return out;
}

/**
 * Edits to built-in lessons, read back from the store.
 *
 * A built-in comes from the code, not the store, so its edits are kept apart
 * and laid over it on every launch. Only fields `applyEdit` understands are
 * kept, and each is checked again when it is applied.
 */
export function usableEdits(saved: unknown): Record<string, LessonEdit> {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const out: Record<string, LessonEdit> = {};
  for (const [id, raw] of Object.entries(saved as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const edit: LessonEdit = {};
    if (typeof e.name === "string") edit.name = e.name;
    if (typeof e.hint === "string") edit.hint = e.hint;
    if (typeof e.bpm === "number") edit.bpm = e.bpm;
    if (e.key === null || isKey(e.key)) edit.key = e.key as number | null;
    out[id] = edit;
  }
  return out;
}
