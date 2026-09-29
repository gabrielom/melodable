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

/**
 * The DAW port that belongs to the MIDI port `name`, if the device has one:
 * the same name with its `MIDI` token swapped for `DAW` — "Launchkey MK4 37
 * MIDI Out" and "Launchkey MK4 37 DAW Out". Compared with both tokens taken
 * out, so it does not matter which word order or suffix a platform gives them.
 *
 * It is opened beside the chosen port and read for drum pads only (the Rust
 * side filters to channel-10 notes). A Launchkey's pads leave the MIDI port for
 * this one the moment a DAW takes the controller over — Ableton does as soon
 * as Live opens — and without it they went silent in Melodable while the keys
 * went on working.
 */
export function dawCompanion(ports: readonly string[], name: string): number | null {
  if (isDawPort(name)) return null;
  const base = (p: string) => p.replace(/\b(MIDI|DAW)\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  const own = base(name);
  const i = ports.findIndex((p) => p !== name && isDawPort(p) && base(p) === own);
  return i >= 0 ? i : null;
}
