/**
 * Restoring the lesson library from the store (M7).
 *
 * Imported clips are persisted, which means they come back from a file that a
 * previous build wrote and that nothing stops the player editing. Anything
 * that reaches `Scorer` or `Transport` has to be the shape they expect, so it
 * is checked here rather than trusted — a lesson with no notes or no bar
 * length would not fail at the store, it would fail three screens later.
 */

import type { Lesson, NoteEvent } from "@/engine/types";

function isNote(n: unknown): n is NoteEvent {
  if (!n || typeof n !== "object") return false;
  const e = n as Partial<NoteEvent>;
  return (
    typeof e.time === "number" &&
    Number.isFinite(e.time) &&
    typeof e.pitch === "number" &&
    Number.isInteger(e.pitch) &&
    e.pitch >= 0 &&
    e.pitch <= 127
  );
}

/** Is this stored value a lesson the rest of the app can actually run? */
export function isUsableLesson(value: unknown): value is Lesson {
  if (!value || typeof value !== "object") return false;
  const l = value as Partial<Lesson>;
  return (
    typeof l.id === "string" &&
    l.id.length > 0 &&
    typeof l.name === "string" &&
    (l.instrument === "pads" || l.instrument === "piano") &&
    typeof l.bpm === "number" &&
    l.bpm > 0 &&
    Number.isFinite(l.bpm) &&
    typeof l.bars === "number" &&
    Number.isInteger(l.bars) &&
    l.bars > 0 &&
    typeof l.beatsPerBar === "number" &&
    Number.isInteger(l.beatsPerBar) &&
    l.beatsPerBar > 0 &&
    Array.isArray(l.notes) &&
    l.notes.length > 0 &&
    l.notes.every(isNote)
  );
}

/**
 * The stored imports worth adding back, in order.
 *
 * Drops anything malformed, anything whose id is already in the library — a
 * built-in that gained an import's id would otherwise be shadowed — and
 * anything duplicated inside the stored list itself.
 */
export function usableImports(saved: unknown, knownIds: Iterable<string>): Lesson[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set(knownIds);
  const out: Lesson[] = [];
  for (const entry of saved) {
    if (!isUsableLesson(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
