/**
 * Pad layout, General MIDI drum mapping, and computer-keyboard bindings.
 *
 * The 4x4 grid is laid out MPC-style: visual row 0 is the top row, and the
 * kick sits bottom-left. `outNote` is the GM note we *play*; `gmNotes` are the
 * incoming note numbers that should light this pad.
 */

export type DrumType =
  | "kick"
  | "kick2"
  | "snare"
  | "snare2"
  | "hatClosed"
  | "hatOpen"
  | "clap"
  | "rim"
  | "cowbell"
  | "shaker"
  | "perc"
  | "tomHi"
  | "tomMid"
  | "tomLo"
  | "crash"
  | "ride";

export interface PadDef {
  name: string;
  type: DrumType;
  /** Computer-keyboard binding for on-screen play. */
  key: string;
  /** GM note this pad emits/represents. */
  outNote: number;
}

/** Index 0..15, reading left-to-right, top row first. */
export const PADS: PadDef[] = [
  { name: "Crash", type: "crash", key: "1", outNote: 49 },
  { name: "Ride", type: "ride", key: "2", outNote: 51 },
  { name: "Open Hat", type: "hatOpen", key: "3", outNote: 46 },
  { name: "Clap", type: "clap", key: "4", outNote: 39 },

  { name: "Tom Hi", type: "tomHi", key: "q", outNote: 50 },
  { name: "Tom Mid", type: "tomMid", key: "w", outNote: 47 },
  { name: "Rim", type: "rim", key: "e", outNote: 37 },
  { name: "Cowbell", type: "cowbell", key: "r", outNote: 56 },

  { name: "Closed Hat", type: "hatClosed", key: "a", outNote: 42 },
  { name: "Shaker", type: "shaker", key: "s", outNote: 82 },
  { name: "Perc", type: "perc", key: "d", outNote: 76 },
  { name: "Tom Lo", type: "tomLo", key: "f", outNote: 45 },

  { name: "Kick", type: "kick", key: "z", outNote: 36 },
  { name: "Snare", type: "snare", key: "x", outNote: 38 },
  { name: "Kick 2", type: "kick2", key: "c", outNote: 35 },
  { name: "Snare 2", type: "snare2", key: "v", outNote: 40 },
];

/** Computer key -> pad index. */
export const PAD_KEY_MAP: Record<string, number> = Object.fromEntries(
  PADS.map((p, i) => [p.key, i]),
);

/**
 * General MIDI drum note -> pad index.
 * Used when importing MIDI clips and when lighting pads from hardware.
 * Extend freely — most pad controllers send 36..51.
 */
export const GM_TO_PAD: Record<number, number> = {
  35: 14, // Acoustic Bass Drum -> Kick 2
  36: 12, // Bass Drum 1        -> Kick
  37: 6, // Side Stick         -> Rim
  38: 13, // Acoustic Snare     -> Snare
  39: 3, // Hand Clap          -> Clap
  40: 15, // Electric Snare     -> Snare 2
  41: 11, // Low Floor Tom      -> Tom Lo
  42: 8, // Closed Hi-Hat      -> Closed Hat
  43: 11, // High Floor Tom     -> Tom Lo
  44: 8, // Pedal Hi-Hat       -> Closed Hat
  45: 5, // Low Tom            -> Tom Mid
  46: 2, // Open Hi-Hat        -> Open Hat
  47: 5, // Low-Mid Tom        -> Tom Mid
  48: 4, // Hi-Mid Tom         -> Tom Hi
  49: 0, // Crash Cymbal 1     -> Crash
  50: 4, // High Tom           -> Tom Hi
  51: 1, // Ride Cymbal 1      -> Ride
  54: 9, // Tambourine         -> Shaker
  56: 7, // Cowbell            -> Cowbell
  57: 0, // Crash Cymbal 2     -> Crash
  59: 1, // Ride Cymbal 2      -> Ride
  70: 9, // Maracas            -> Shaker
  75: 10, // Claves             -> Perc
  76: 10, // Hi Wood Block      -> Perc
  77: 10, // Low Wood Block     -> Perc
  82: 9, // Shaker             -> Shaker
};

/**
 * Where a pad sits on the controller, for the chosen physical arrangement.
 *
 * "4x4" is the MPC-style grid this app's PADS order describes directly.
 * "2x8" re-flows the same 16 pads onto two rows of eight (Launchkey and most
 * two-row controllers): each half of the 4x4 collapses into one long row,
 * with the 4x4's *lowest* row landing leftmost. That keeps the kit's anchors
 * (kick, snare) in the bottom-left corner, where they sit on the hardware.
 *
 * `row` is 0 at the top. Labels count rows from the bottom (A = bottom row),
 * matching how pad grids are described on hardware.
 */
export function padPosition(
  index: number,
  layout: "4x4" | "2x8",
): { row: number; col: number; rows: number; cols: number; label: string } {
  if (layout === "2x8") {
    const r4 = Math.floor(index / 4);
    const c4 = index % 4;
    // 4x4 rows 2,3 (lower half) -> 2x8 bottom row; rows 0,1 -> top row.
    // Within each row the lower 4x4 row takes the left half.
    const row = r4 < 2 ? 0 : 1;
    const col = (r4 % 2 === 1 ? 0 : 4) + c4;
    const rows = 2;
    const cols = 8;
    return { row, col, rows, cols, label: `${"AB"[rows - 1 - row]}${col + 1}` };
  }
  const row = Math.floor(index / 4);
  const col = index % 4;
  return { row, col, rows: 4, cols: 4, label: `${"ABCD"[3 - row]}${col + 1}` };
}

/** Map an incoming MIDI note to a pad index, or null if unmapped. */
export function noteToPad(note: number): number | null {
  const pad = GM_TO_PAD[note];
  return pad === undefined ? null : pad;
}

/**
 * Inverse of `GM_TO_PAD`: a canonical GM note that routes *back* to each pad.
 * Prefers the pad's own `outNote` when that round-trips through `GM_TO_PAD`,
 * otherwise the first GM note that maps to the pad. Used by the MIDI importer
 * to place unmapped percussion on spare pads without dropping notes.
 */
export const PAD_TO_NOTE: Record<number, number> = (() => {
  const map: Record<number, number> = {};
  for (let i = 0; i < PADS.length; i++) {
    if (GM_TO_PAD[PADS[i].outNote] === i) map[i] = PADS[i].outNote;
  }
  for (const [noteStr, pad] of Object.entries(GM_TO_PAD)) {
    if (map[pad] === undefined) map[pad] = Number(noteStr);
  }
  return map;
})();

/**
 * Computer keyboard -> piano note, one octave starting at C4 (60).
 * Home row = white keys, upper row = black keys, like most soft-synths.
 */
export const PIANO_KEY_MAP: Record<string, number> = {
  a: 60, // C4
  w: 61, // C#4
  s: 62, // D4
  e: 63, // D#4
  d: 64, // E4
  f: 65, // F4
  t: 66, // F#4
  g: 67, // G4
  y: 68, // G#4
  h: 69, // A4
  u: 70, // A#4
  j: 71, // B4
  k: 72, // C5
  o: 73, // C#5
  l: 74, // D5
};

/** True if a majority of notes look like GM drums (used to auto-detect on import). */
export function looksLikeDrums(notes: number[], channel?: number): boolean {
  if (channel === 9) return true; // MIDI channel 10, zero-indexed
  if (notes.length === 0) return false;
  const drumHits = notes.filter((n) => n >= 35 && n <= 81 && GM_TO_PAD[n] !== undefined).length;
  return drumHits / notes.length > 0.6;
}
