/**
 * Standard MIDI File (SMF) import — the Ableton bridge.
 *
 * Workflow: in Ableton, drag a MIDI clip to the desktop (or right-click →
 * Export MIDI Clip), then import the `.mid` here. This module turns that file
 * into a gradable `Lesson` at the clip's own tempo.
 *
 * Pure TypeScript, no DOM: the caller supplies an `ArrayBuffer`. Handles
 * running status, tempo + time-signature meta, and bounds-checks throughout.
 * Drum clips route to pads, melodic clips to piano keys — auto-detected, and
 * overridable in the import dialog.
 */

import type { InstrumentType, Lesson, NoteEvent } from "./types";
import { PADS, PAD_TO_NOTE, looksLikeDrums, noteToPad } from "./gm";
import { noteName } from "./pitch";

export interface RawMidiNote {
  tick: number;
  pitch: number;
  velocity: number;
  channel: number;
}

export interface ParsedMidi {
  notes: RawMidiNote[];
  /** Pulses (ticks) per quarter note. */
  ppq: number;
  /** Tempo from the first set-tempo meta, or 120 if the clip carries none. */
  bpm: number;
  /** Beats per bar from the first time-signature meta (x/4 assumed), else 4. */
  beatsPerBar: number;
}

/** Parse a Standard MIDI File. Throws a readable error on malformed input. */
export function parseMidiFile(buffer: ArrayBuffer): ParsedMidi {
  const dv = new DataView(buffer);
  let p = 0;

  const need = (n: number) => {
    if (p + n > dv.byteLength) throw new Error("Unexpected end of MIDI data");
  };
  const u8 = () => {
    need(1);
    return dv.getUint8(p++);
  };
  const u16 = () => {
    need(2);
    const v = dv.getUint16(p);
    p += 2;
    return v;
  };
  const u32 = () => {
    need(4);
    const v = dv.getUint32(p);
    p += 4;
    return v;
  };
  const str = (n: number) => {
    need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(p++));
    return s;
  };
  // Variable-length quantity, capped so a corrupt byte can't spin forever.
  const vlq = () => {
    let v = 0;
    let b: number;
    let guard = 0;
    do {
      b = u8();
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80 && ++guard < 8);
    return v;
  };

  if (str(4) !== "MThd") throw new Error("Not a MIDI file (missing MThd header)");
  const headerLen = u32();
  const headerEnd = p + headerLen;
  u16(); // format (0/1/2) — we merge all tracks either way
  const ntrks = u16();
  const division = u16();
  p = headerEnd; // tolerate a longer-than-6 header
  const ppq = division & 0x8000 ? 480 : division || 480; // SMPTE → sane fallback

  let tempoUs = 500000; // default 120 bpm
  let tempoSet = false;
  let beatsPerBar = 4;
  let timeSigSet = false;
  const notes: RawMidiNote[] = [];

  for (let t = 0; t < ntrks; t++) {
    if (p + 8 > dv.byteLength) break;
    if (str(4) !== "MTrk") throw new Error("Bad track header (missing MTrk)");
    const len = u32();
    const end = Math.min(p + len, dv.byteLength);
    let tick = 0;
    let running = 0;

    while (p < end) {
      tick += vlq();
      let status = dv.getUint8(p);
      if (status & 0x80) {
        p++;
        running = status;
      } else {
        status = running; // running status: reuse last, data byte stays
      }
      const hi = status & 0xf0;
      const channel = status & 0x0f;

      if (status === 0xff) {
        // meta event
        const meta = u8();
        const l = vlq();
        if (meta === 0x51 && l === 3) {
          const a = u8();
          const b = u8();
          const c = u8();
          if (!tempoSet) {
            tempoUs = (a << 16) | (b << 8) | c;
            tempoSet = true;
          }
        } else if (meta === 0x58 && l >= 2) {
          const numer = u8();
          const denomPow = u8();
          for (let i = 2; i < l; i++) u8();
          if (!timeSigSet) {
            const denom = 2 ** denomPow;
            // Beats are quarter notes. x/4 → numer beats; x/8 compound → numer/3.
            const beats = denom === 4 ? numer : denom === 8 && numer % 3 === 0 ? numer / 3 : numer;
            beatsPerBar = Math.max(1, Math.round(beats));
            timeSigSet = true;
          }
        } else {
          for (let i = 0; i < l; i++) u8();
        }
      } else if (status === 0xf0 || status === 0xf7) {
        // sysex — skip
        const l = vlq();
        for (let i = 0; i < l; i++) u8();
      } else if (hi === 0x90) {
        const pitch = u8();
        const vel = u8();
        if (vel > 0) notes.push({ tick, pitch, velocity: vel, channel });
      } else if (hi === 0x80 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        u8();
        u8();
      } else if (hi === 0xc0 || hi === 0xd0) {
        u8();
      } else {
        // Unrecognized status with no running context — stop this track
        // rather than risk an unbounded loop on garbage.
        break;
      }
    }
    p = end;
  }

  notes.sort((a, b) => a.tick - b.tick);
  const bpm = Math.round(60000000 / tempoUs);
  return { notes, ppq, bpm, beatsPerBar };
}

export interface MidiAnalysis {
  /** The instrument the lesson was built for (chosen or auto-detected). */
  instrument: InstrumentType;
  bpm: number;
  bars: number;
  beatsPerBar: number;
  noteCount: number;
  /** True if the clip reads as a drum part (channel 10 or GM-drum majority). */
  looksLikeDrums: boolean;
  /** Distinct pad or key names the generated lesson uses, for the preview. */
  lanes: string[];
}

// Pads to fall back to for percussion the GM map doesn't recognize, in a
// visually spread order. Filtered against pads the clip already uses.
const SPARE_PADS = [6, 7, 9, 10, 4, 5, 11, 3, 2, 1, 0, 8, 15, 14, 13, 12];

/**
 * Build a pad lesson from parsed MIDI. Notes route to pads via `GM_TO_PAD`;
 * pitches the map doesn't know are assigned round-robin to spare pads (kept
 * consistent per original pitch) so nothing is silently dropped.
 */
export function midiToLesson(
  parsed: ParsedMidi,
  name: string,
  opts: { bpm?: number; instrument?: InstrumentType } = {},
): { lesson: Lesson; analysis: MidiAnalysis } {
  if (parsed.notes.length === 0) throw new Error("No notes found in this MIDI clip");

  const beatsPerBar = parsed.beatsPerBar || 4;
  const raw = parsed.notes.map((n) => ({ ...n, beat: n.tick / parsed.ppq }));

  // Drop leading empty bars so the clip starts on a downbeat near 0.
  const minBeat = Math.min(...raw.map((n) => n.beat));
  const shift = Math.floor(minBeat / beatsPerBar) * beatsPerBar;

  const isDrums = looksLikeDrums(
    parsed.notes.map((n) => n.pitch),
    parsed.notes.some((n) => n.channel === 9) ? 9 : undefined,
  );
  const instrument: InstrumentType = opts.instrument ?? (isDrums ? "pads" : "piano");

  // For pads, route pitches to pad lanes and place unknown percussion on spare
  // pads (consistent per pitch). For piano the pitch is used directly.
  const usedPads = new Set<number>();
  for (const n of raw) {
    const pad = noteToPad(n.pitch);
    if (pad !== null) usedPads.add(pad);
  }
  const spares = SPARE_PADS.filter((p) => !usedPads.has(p));
  const remap = new Map<number, number>();
  let spareI = 0;
  const padPitchFor = (pitch: number): number => {
    if (noteToPad(pitch) !== null) return pitch;
    if (!remap.has(pitch)) {
      const pad = spares.length ? spares[spareI++ % spares.length] : 12;
      remap.set(pitch, PAD_TO_NOTE[pad] ?? 36);
    }
    return remap.get(pitch)!;
  };

  const notes: NoteEvent[] = raw
    .map((n) => ({
      time: Number((n.beat - shift).toFixed(4)),
      pitch: instrument === "pads" ? padPitchFor(n.pitch) : n.pitch,
      velocity: n.velocity,
    }))
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);

  const maxBeat = Math.max(...notes.map((n) => n.time));
  const bars = Math.max(1, Math.ceil((maxBeat + 1e-4) / beatsPerBar));

  const lanes =
    instrument === "pads"
      ? [...new Set(notes.map((n) => noteToPad(n.pitch)))]
          .filter((p): p is number => p !== null)
          .sort((a, b) => a - b)
          .map((p) => PADS[p].name)
      : [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b).map(noteName);

  const cleanName = name.replace(/\.(mid|midi)$/i, "").slice(0, 40).trim() || "Imported clip";
  const bpm = Math.min(Math.max(Math.round(opts.bpm ?? parsed.bpm ?? 120), 40), 240);

  const lesson: Lesson = {
    id: `import-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    name: cleanName,
    instrument,
    bpm,
    bars,
    beatsPerBar,
    notes,
    source: "midi-import",
    hint:
      instrument === "piano"
        ? "Imported clip — play the melody in time."
        : "Imported clip — play your own part in time.",
  };

  const analysis: MidiAnalysis = {
    instrument,
    bpm,
    bars,
    beatsPerBar,
    noteCount: notes.length,
    looksLikeDrums: isDrums,
    lanes,
  };

  return { lesson, analysis };
}
