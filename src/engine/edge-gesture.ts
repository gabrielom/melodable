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
 * - **Keys**: "the two keys at each end" is two tight pairs — a semitone for
 *   the outermost keys counting the black one, a whole tone for the outermost
 *   white keys — whatever the keyboard's size or octave shift. They must be at least an octave
 *   apart, which a 25-key controller clears with room to spare (its pairs sit
 *   22 semitones apart at their inner edges).
 * - **Pads**: four pads of a sixteen-pad bank whose lowest and highest are
 *   exactly 15 apart. Every layout puts the bank's first and last note on two
 *   of its corners — the MPC 4×4 (0, 3, 12, 15), a 2×8 of two 4×2 halves
 *   (0, 4, 11, 15), a 2×8 filled row by row (0, 7, 8, 15) — and they disagree
 *   only about where the other two corners are. The first version listed
 *   those three layouts and accepted nothing else, and the Launchkey MK4's
 *   pads were refused: its drum pads send 36–51 on channel 10, but its grid is
 *   drawn only as a picture in Novation's guide and was guessed wrong. So the
 *   rule now holds only what every layout shares, and a bank shifted up by 16
 *   is the same shape.
 *
 * **What keeps it from firing mid-song** is that it asks for all four notes
 * to be struck within `GESTURE_WINDOW` of each other and for nothing else
 * struck in that window to still be held. Two minor-second clusters an octave or more
 * apart, grabbed at once, is not something music asks for. The pad shape is
 * looser — a C minor triad doubled an octave up is exactly the 4×4's
 * `0, 3, 12, 15` — so it only counts when the notes come from pads: MIDI
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

/**
 * Whether two keys at one end can be "the two keys at the edge". A semitone is
 * the two outermost keys counting the black one (C and C♯); a whole tone is
 * the two outermost *white* keys (C and D), which is what a hand reaching for
 * the corners of a keyboard actually lands on — the user's first try on the
 * Launchkey was C3 D3 at the bottom and B6 C7 at the top, and the semitone-only
 * rule turned it down. At the top the two readings agree, B and C being a
 * semitone apart either way.
 */
const edgePair = (gap: number) => gap === 1 || gap === 2;

/** The two pairs of keys must be at least this far apart, in semitones. */
export const MIN_KEY_SPAN = 12;

/** MIDI channel 10, where drum pads send by convention. Zero-based. */
export const DRUM_CHANNEL = 9;

/** A sixteen-pad bank's lowest and highest notes, which are always corners. */
export const PAD_BANK_SPAN = 15;

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

  if (edgePair(b - a) && edgePair(d - c) && c - b >= MIN_KEY_SPAN) return { kind: "keys", since };

  const fromPads = padsLesson || grab.every((h) => h.channel === DRUM_CHANNEL);
  if (fromPads) {
    if (d - a === PAD_BANK_SPAN) return { kind: "pads", since };
  }
  return null;
}
