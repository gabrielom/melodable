/**
 * Pitch naming and keyboard geometry.
 *
 * Pure functions over MIDI note numbers — no Vue, no DOM. The piano renderer,
 * the on-screen keyboard, the MIDI monitor and the clip importer all read note
 * names from here, so there is exactly one definition of "what C#4 is called"
 * and one definition of where a key sits.
 */

/** Semitone offsets within an octave that are white keys. */
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function pitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}

export function isWhiteKey(note: number): boolean {
  return WHITE_OFFSETS.includes(pitchClass(note));
}

/** "C4", "F#3", etc. MIDI 60 = C4. */
export function noteName(note: number): string {
  return `${NAMES[pitchClass(note)]}${Math.floor(note / 12) - 1}`;
}

/** How many white keys lie in [low, high] inclusive. */
export function countWhiteKeys(low: number, high: number): number {
  let n = 0;
  for (let i = low; i <= high; i++) if (isWhiteKey(i)) n++;
  return n;
}

/**
 * Map a MIDI note to keyboard geometry.
 * White keys advance x; black keys overlay, straddling the boundary between
 * the two white keys they sit between.
 */
export function keyGeometry(
  note: number,
  lowNote: number,
  whiteWidth: number,
): { x: number; isBlack: boolean; width: number } {
  let whiteIndex = 0;
  for (let n = lowNote; n < note; n++) if (isWhiteKey(n)) whiteIndex++;

  const isBlack = !isWhiteKey(note);
  const x = isBlack ? whiteIndex * whiteWidth - whiteWidth * 0.3 : whiteIndex * whiteWidth;

  return { x, isBlack, width: isBlack ? whiteWidth * 0.6 : whiteWidth };
}

/** Snap a requested range to start and end on white keys (nicer edges). */
export function normalizeRange(low: number, high: number): [number, number] {
  let lo = low;
  let hi = high;
  while (!isWhiteKey(lo)) lo--;
  while (!isWhiteKey(hi)) hi++;
  return [lo, hi];
}
