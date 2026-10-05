/**
 * Which hand plays which note — what a song part's one-hand steps are made of
 * (handoff 15, 11m).
 *
 * Each piano part is learned in three steps: the right hand, the left hand,
 * then both. A one-hand step is the same lesson with the other hand played
 * back by the app and left ungraded; this module only says which notes belong
 * to which hand, which steps a part has, and how each step describes itself.
 *
 * **Where the hands divide.** A clip that kept its hands apart — two tracks,
 * or two channels — says so, and the importer writes that onto each note as
 * `NoteEvent.hand`. Otherwise the line is the one the grand staff already
 * draws (`handSplit`): the handoff says middle C, and middle C is the default
 * that function falls back to, but it reads the real line off the music when
 * the hands play together — a montuno's left hand reaches up to D4, and
 * splitting at C4 handed half of it to the right. Using the staff's own line
 * also means a one-hand step plays exactly the notes on that hand's staff.
 */
import type { NoteEvent } from "./types";
import { handSplit, onBassStaff, staffStep } from "./notation";
import { noteName } from "./pitch";

export type Hand = "R" | "L";
/** A step of a song part: one hand, or both. */
export type StepHand = Hand | "BOTH";

/** The order a part's steps are learned in. */
export const STEP_HANDS: readonly StepHand[] = ["R", "L", "BOTH"];

/** "Right hand", "Left hand", "Both hands" — the step card's title. */
export const HAND_TITLE: Record<StepHand, string> = {
  R: "Right hand",
  L: "Left hand",
  BOTH: "Both hands",
};

/** The same in the capitals buttons and headers use: "LEFT HAND". */
export const HAND_NAME: Record<StepHand, string> = {
  R: "RIGHT HAND",
  L: "LEFT HAND",
  BOTH: "BOTH HANDS",
};

/**
 * A step's name for a button or a header: "PART C · LEFT HAND". A part with
 * no one-hand steps is only ever played with both, so it is just "PART C".
 */
export function stepName(label: string, hand: StepHand, handed: boolean): string {
  return handed ? `${label} · ${HAND_NAME[hand]}` : label;
}

const isHand = (v: unknown): v is Hand => v === "R" || v === "L";

/**
 * The hand each note is played by, index for index with `notes`. A hand the
 * clip stated wins; anything else is placed by the staff's split.
 */
export function handsOf(notes: readonly NoteEvent[]): Hand[] {
  const split = handSplit(notes);
  return notes.map((n) =>
    isHand(n.hand) ? n.hand : onBassStaff(staffStep(n.pitch), split) ? "L" : "R",
  );
}

/**
 * The steps a part is learned in. A piano part with notes in both hands gets
 * all three; anything else — a pads part, or a piano part that is all one
 * hand — gets one, `BOTH`, since a one-hand step there would either be the
 * whole part again or have nothing in it to play.
 */
export function stepHandsFor(lesson: { instrument: string; notes: readonly NoteEvent[] }): StepHand[] {
  if (lesson.instrument !== "piano") return ["BOTH"];
  const hands = handsOf(lesson.notes);
  return hands.includes("R") && hands.includes("L") ? [...STEP_HANDS] : ["BOTH"];
}

/** Onsets closer than this are struck together — a chord, not a run. */
const TOGETHER = 1 / 16;

/** What one hand plays in a part, as the step card says it. */
export interface HandFacts {
  /** Mostly chords, or mostly single notes. */
  kind: "chords" | "notes";
  /** How many chords, or how many notes. */
  count: number;
  low: number;
  high: number;
}

/**
 * What `hand` plays: whether it is mostly chords or single notes, how many,
 * and its lowest and highest pitch. Null for a hand with nothing to play.
 */
export function handFacts(notes: readonly NoteEvent[], hand: Hand): HandFacts | null {
  const hands = handsOf(notes);
  const mine = notes.filter((_, i) => hands[i] === hand);
  if (mine.length === 0) return null;
  const onsets = new Map<number, Set<number>>();
  for (const n of mine) {
    const key = Math.round(n.time / TOGETHER);
    const at = onsets.get(key);
    if (at) at.add(n.pitch);
    else onsets.set(key, new Set([n.pitch]));
  }
  const chords = [...onsets.values()].filter((s) => s.size >= 2).length;
  const pitches = mine.map((n) => n.pitch);
  const kind = chords * 2 > onsets.size ? "chords" : "notes";
  return {
    kind,
    count: kind === "chords" ? chords : mine.length,
    low: Math.min(...pitches),
    high: Math.max(...pitches),
  };
}

/**
 * The step card's second line: "Single notes on top · 38 notes, C4 to A5",
 * "Chords underneath · 12 chords, F2 to B3", or for both hands what passing
 * it does — `completes` is what it completes, "Part C" or "the song".
 */
export function describeStep(
  notes: readonly NoteEvent[],
  hand: StepHand,
  completes: string,
): string {
  if (hand === "BOTH") return `Both hands together · passing this completes ${completes}`;
  const f = handFacts(notes, hand);
  const where = hand === "R" ? "on top" : "underneath";
  if (!f) return `Nothing for this hand ${where}`;
  const what = f.kind === "chords" ? "Chords" : "Single notes";
  const unit = f.kind === "chords" ? (f.count === 1 ? "chord" : "chords") : f.count === 1 ? "note" : "notes";
  return `${what} ${where} · ${f.count} ${unit}, ${noteName(f.low)} to ${noteName(f.high)}`;
}
