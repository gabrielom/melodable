/**
 * Which MIDI input to open without being asked.
 *
 * The device is remembered by **name**, never by index: the index is only a
 * position in whatever the OS listed this time, and it moves as soon as
 * another device is plugged in ahead of it.
 *
 * `remembered` has three meanings, and the difference is the whole rule:
 *
 * - a name — the player picked this one. It wins whenever it is present.
 * - `null` — the player pressed Disconnect. Nothing is opened for them until
 *   they pick again; reconnecting behind their back would undo the one thing
 *   they just asked for.
 * - `undefined` — they have never chosen. Take the first port that is a
 *   player's port rather than a DAW's.
 *
 * A remembered device that is absent today does not stop a first-run style
 * pick from the others, and does not get forgotten either: the pick is not
 * written back, so the remembered one wins again the day it returns.
 */

/**
 * A controller's DAW port — Novation's Launchkey lists one beside its MIDI
 * port, and so do Akai's and Arturia's control-surface ranges. It carries the
 * control-surface conversation (pads in session mode, encoders, transport,
 * LED feedback), not the keys, so opening it would grade a pad press meant for
 * a clip launcher as a wrong note.
 */
export function isDawPort(name: string): boolean {
  return /\bDAW\b/i.test(name);
}

export function portToOpen(ports: readonly string[], remembered: string | null | undefined): number | null {
  if (remembered === null) return null;
  if (remembered !== undefined) {
    const i = ports.indexOf(remembered);
    if (i >= 0) return i;
  }
  const i = ports.findIndex((p) => !isDawPort(p));
  return i >= 0 ? i : null;
}
