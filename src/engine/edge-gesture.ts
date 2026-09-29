/**
 * The four-corner gesture: a transport button made of the controller itself.
 *
 * Hold the **two lowest and the two highest keys** of the keyboard, or the
 * **four corner pads**, together, and the trainer stops a run that is going —
 * holding its last frame — or starts one that is not. Melodics has the same
 * gesture; the point is never having to take your hands off the controller to
 * reach the Space bar.
 *
 * It has to work on a controller whose size, octave or pad bank we are never
 * told, so neither shape is written as note numbers:
 *
 * - **Keys**: two adjacent keys are a semitone apart, always — E–F and B–C
 *   included — so "the two keys at each end" is two semitone pairs, whatever
 *   the keyboard's size or octave shift. They must be at least an octave
 *   apart, which a 25-key controller clears with room to spare (its pairs sit
 *   22 semitones apart at their inner edges).
 * - **Pads**: a bank of sixteen, measured from its lowest note, so a bank
 *   shifted up by 16 is the same shape. Three arrangements are accepted,
 *   because controllers disagree and none of them reports which it is: the
 *   MPC 4×4 (corners 0, 3, 12, 15), a 2×8 made of two 4×2 halves the way an
 *   Ableton drum rack folds onto two rows (0, 4, 11, 15), and a 2×8 filled
 *   row by row (0, 7, 8, 15). The Launchkey MK4 sends its drum pads as notes
 *   36–51 on channel 10; which of the two 2×8s it uses is drawn only as an
 *   image in Novation's guide, so both are here.
 *
 * **What keeps it from firing mid-song** is that it asks for all four notes
 * to be struck within `GESTURE_WINDOW` of each other and for nothing else
 * struck in that window to still be held. Two minor-second clusters an octave or more
 * apart, grabbed at once, is not something music asks for. The pad shapes are
 * narrower still — a C minor triad doubled an octave up is exactly the 4×4's
 * `0, 3, 12, 15` — so they only count when the notes come from pads: MIDI
 * channel 10, where drum pads send by convention and the Launchkey's do, or a
 * pads lesson, where every strike is a pad.
 */

/** A note that is down: which, on what channel (0–15), and when it was struck. */
export interface HeldNote {
  note: number;
  channel: number;
  /** Seconds on any one clock — only the differences are read. */
  at: number;
}

/**
 * How close together the four strikes must land to be one grab.
 *
 * Generous on purpose. It was 0.5s at first and a hand that set down the
 * left pair and then the right took longer than that. Only notes still held
 * count, so a wide window lets in nothing played and released on the way;
 * what it keeps out is a note held down since long before — a sustained bass,
 * or one whose note-off never arrived.
 */
export const GESTURE_WINDOW = 1.5;

/** The two pairs of keys must be at least this far apart, in semitones. */
export const MIN_KEY_SPAN = 12;

/** MIDI channel 10, where drum pads send by convention. Zero-based. */
export const DRUM_CHANNEL = 9;

/** The corner pads of a sixteen-pad bank, relative to its lowest note. */
export const PAD_CORNERS: readonly (readonly number[])[] = [
  [0, 3, 12, 15], // 4×4, MPC-style
  [0, 4, 11, 15], // 2×8, two 4×2 halves side by side
  [0, 7, 8, 15], // 2×8, filled row by row
];

export type EdgeGestureKind = "keys" | "pads";

export interface EdgeGesture {
  kind: EdgeGestureKind;
  /** When the first of the four was struck — its strikes are the gesture's. */
  since: number;
}

/**
 * Whether the notes down right now make the gesture, which one, and when the
 * grab began.
 *
 * Only the strikes inside the window ending at the newest one are looked at,
 * so a note held from earlier — a sustained bass, or one whose note-off never
 * arrived — neither blocks the gesture nor counts towards it.
 */
export function edgeGesture(
  held: readonly HeldNote[],
  padsLesson: boolean,
): EdgeGesture | null {
  if (held.length < 4) return null;
  const newest = Math.max(...held.map((h) => h.at));
  const grab = held.filter((h) => newest - h.at <= GESTURE_WINDOW);
  if (grab.length !== 4) return null;
  const notes = [...new Set(grab.map((h) => h.note))].sort((a, b) => a - b);
  if (notes.length !== 4) return null;
  const [a, b, c, d] = notes;
  const since = Math.min(...grab.map((h) => h.at));

  if (b - a === 1 && d - c === 1 && c - b >= MIN_KEY_SPAN) return { kind: "keys", since };

  const fromPads = padsLesson || grab.every((h) => h.channel === DRUM_CHANNEL);
  if (fromPads) {
    const shape = notes.map((n) => n - a);
    if (PAD_CORNERS.some((corners) => corners.every((v, i) => v === shape[i]))) {
      return { kind: "pads", since };
    }
  }
  return null;
}
