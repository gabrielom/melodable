/**
 * Putting an imported clip back on a grid.
 *
 * A clip that was *played* rather than drawn never lands on the beat. The
 * imported Ave Maria arpeggiates C E G C E G C E at 0, 0.5, 0.99, 1.469,
 * 1.979, 2.469, 2.953, 3.479 — eight even quavers, none of them where a
 * quaver goes. Nothing downstream can read that:
 *
 * - **The staff cannot zoom.** `sheetPxPerBeat` scales the view so the
 *   closest pair of onsets clears `MIN_NOTE_GAP_PX`. The closest pair in that
 *   clip is a melody note landing 0.031 beats before the chord it belongs to,
 *   which asks for **1090 pixels a beat** — four bars wider than the window,
 *   so the sheet draws an empty staff. That is the symptom that sent us here.
 * - **`restsFor` finds silences that are not there**, and misses the ones
 *   that are, because it measures from a written end to the next onset and
 *   both ends wobble.
 * - **`beamGroups` breaks runs**, since a note 0.02 beats before the beat is
 *   in the previous beat's group.
 * - **`engraveOnsets` names figures off lengths like 0.583**, which is a
 *   quaver by a hair and a dotted quaver if the player leaned on it.
 *
 * The chord ribbon already works around all of this with its own
 * `BEAT_TOLERANCE`, which is the same problem solved once, locally, for one
 * reader. This is that fix made general and moved upstream, so every reader
 * gets it.
 *
 * **Why the grid is found rather than asked for.** An imported clip carries
 * no subdivision — the same trade `keySignatureFor` makes for the key. Asking
 * the player to name one before they can read the staff is worse than reading
 * it off the notes, and a wrong answer here is visible immediately.
 */

/**
 * The grids a clip might be on, in beats, coarsest first.
 *
 * Straight subdivisions and their triplet cousins, no finer than a
 * demisemiquaver. Ordered by spacing rather than by denominator, so "coarsest
 * wins a tie" means what it says: a third of a beat is coarser than a quarter
 * of one.
 */
export const GRIDS: readonly number[] = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8, 1 / 12, 1 / 16];

/**
 * What each step down the list costs, as a share of a grid's spacing.
 *
 * Fit alone cannot choose a grid, because **a finer grid is never a worse
 * fit** and an outlier always prefers one. A clip of plain crotchets with a
 * single expressive note at 6.37 is exactly on every grid in the list but
 * that one note, and 6.37 is a hair off 6.375 — so the semiquaver grid scores
 * 0.4% against the beat's 3.1% and wins on the strength of the one note that
 * is not in time. Every note it got right, the coarse grid got right too.
 *
 * So fineness is charged for, and a finer grid has to be *enough* better to
 * pay. The window is wide and both ends are real: the Ave Maria's quaver grid
 * beats the beat by 12.5 points, so anything under 0.125 keeps it; the
 * expressive-note case needs more than 0.009 to stay on the beat. 0.03 sits
 * near the middle of that on a log scale.
 */
export const FINENESS_COST = 0.03;

/**
 * How close to a grid point counts as *on* it.
 *
 * Small enough that only a written value lands inside — a clip played on a
 * keyboard misses by tens of milliseconds, which at any tempo is thousands of
 * times this. It is here to absorb float arithmetic, not human timing.
 */
const EXACT = 1e-6;

/**
 * Every moment a clip's grid has to explain: each note's onset and its end.
 *
 * Both endpoints, because a length can be finer than the onsets around it and
 * asking the onsets alone gets the wrong answer. A lesson of whole notes
 * struck on the beat, one of which is a dotted quaver, reads as a one-beat
 * grid from its onsets — and rounding that quaver up to a full beat changes
 * what the player is asked to hold. Counting the ends puts the finer
 * subdivision back in evidence, and the search finds it.
 */
export function momentsOf(notes: readonly { time: number; duration?: number }[]): number[] {
  const out: number[] = [];
  for (const n of notes) {
    out.push(n.time);
    if (n.duration && n.duration > 0) out.push(n.time + n.duration);
  }
  return out;
}

/**
 * The grid a set of moments is on.
 *
 * A clip already sitting exactly on one was written rather than played, and
 * is taken at its word — see the first loop. What follows is for the other
 * kind.
 *
 * Every candidate is scored by the **mean distance from a moment to its
 * nearest grid point, as a share of the grid's own spacing**, plus
 * `FINENESS_COST` for each step down the list. Normalised, or a fine grid
 * would win simply by being near everything; charged for, or an outlier would
 * buy one. The lowest score wins, and a tie goes to the coarser grid, so a
 * clip drawn exactly on crotchets is called crotchets rather than
 * hemidemisemiquavers that happen to line up.
 *
 * **The minimum is real, not a threshold that happens to pass.** On the
 * imported Ave Maria the fits run 21.2% at the beat, **8.7% at the quaver**,
 * 23.2% at the triplet, 15.2% at the semiquaver and worse below — a clear
 * trough at the value the piece is actually written in. That is why this is a
 * search for the best fit and not the coarsest fit inside a tolerance: pick a
 * tolerance and a clip whose offbeats are rare slips will pass it at the
 * beat, flattening every one of them onto it.
 *
 * A **maximum** offset cannot do the job either. That same clip sits at ~50%
 * against every grid in the list, because a sung melody line genuinely is
 * off-grid in places; one expressive note would drag the whole piece down to
 * the finest grid available.
 */
export function gridFor(beats: readonly number[]): number {
  const moments = [...new Set(beats)];
  if (moments.length === 0) return GRIDS[0];

  // A clip that is already exactly on a grid was written down rather than
  // played, and there is nothing here to decide: take the coarsest grid that
  // holds all of it and snapping becomes the no-op it should be. This is the
  // whole of the library, and it is a separate question from the one below —
  // an authored dotted quaver sits *on* a sixteenth grid, where an expressive
  // note merely lands near one, and only exactness tells them apart.
  for (const grid of GRIDS) {
    if (moments.every((t) => Math.abs(t - Math.round(t / grid) * grid) < EXACT)) return grid;
  }

  let best = GRIDS[GRIDS.length - 1];
  let bestCost = Infinity;
  for (let i = 0; i < GRIDS.length; i++) {
    const grid = GRIDS[i];
    let sum = 0;
    for (const t of moments) sum += Math.abs(t - Math.round(t / grid) * grid) / grid;
    const cost = sum / moments.length + i * FINENESS_COST;
    // Strictly better, so the coarsest of equal fits is the one that stands.
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = grid;
    }
  }
  return best;
}

/** `beat` on the grid. Kept as a clean multiple, not a float sum. */
export function snapTo(beat: number, grid: number): number {
  return Math.round(beat / grid) * grid;
}

/**
 * A note's written length, snapped by moving its **end** onto the grid.
 *
 * Both endpoints belong on the grid, and snapping the length alone would not
 * put them there: a note struck 0.03 early and released 0.03 late is 0.06
 * long in the wrong direction, and rounding that length leaves the release
 * off the beat it was aimed at. Snapping the end instead fixes both.
 *
 * A length that rounds to nothing keeps one grid unit — a note that sounded
 * is not a note of no length, and zero means "an onset and nothing more",
 * which is a different statement (see `NoteEvent.duration`).
 *
 * A note with no length at all stays that way: a pad hit carries none, and a
 * clip whose note-offs never arrived should not gain them here.
 */
export function snapLength(beat: number, written: number, grid: number): number {
  if (!(written > 0)) return 0;
  const end = snapTo(beat + written, grid);
  return Math.max(grid, end - snapTo(beat, grid));
}
