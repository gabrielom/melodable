import { describe, it, expect } from "vitest";
import { parseMidiFile, midiToLesson } from "../src/engine/midi-file";
import { noteToPad } from "../src/engine/gm";

// ---- minimal Standard MIDI File writer, for building test fixtures ----

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  return out;
}

interface NoteSpec {
  tick: number;
  pitch: number;
  vel: number;
  channel?: number;
  dur?: number;
}

function buildSmf(opts: {
  ppq: number;
  tempoUs?: number;
  timeSig?: [number, number]; // [numerator, denominatorPow]  e.g. [4,2] = 4/4
  notes: NoteSpec[];
}): ArrayBuffer {
  const events: Array<{ tick: number; order: number; bytes: number[] }> = [];
  let order = 0;
  if (opts.tempoUs !== undefined) {
    const t = opts.tempoUs;
    events.push({ tick: 0, order: order++, bytes: [0xff, 0x51, 0x03, (t >> 16) & 0xff, (t >> 8) & 0xff, t & 0xff] });
  }
  if (opts.timeSig) {
    events.push({ tick: 0, order: order++, bytes: [0xff, 0x58, 0x04, opts.timeSig[0], opts.timeSig[1], 24, 8] });
  }
  for (const n of opts.notes) {
    const ch = n.channel ?? 0;
    const dur = n.dur ?? opts.ppq;
    events.push({ tick: n.tick, order: order++, bytes: [0x90 | ch, n.pitch, n.vel] });
    events.push({ tick: n.tick + dur, order: order++, bytes: [0x80 | ch, n.pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  let last = 0;
  for (const ev of events) {
    track.push(...vlq(ev.tick - last));
    last = ev.tick;
    track.push(...ev.bytes);
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // end of track

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1,
    (opts.ppq >> 8) & 0xff, opts.ppq & 0xff,
  ];
  const trkHead = [
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff,
  ];
  return new Uint8Array([...header, ...trkHead, ...track]).buffer;
}

// ---- parser ----

describe("parseMidiFile", () => {
  it("reads ppq, tempo, and note ticks", () => {
    const buf = buildSmf({
      ppq: 480,
      tempoUs: 500000, // 120 bpm
      timeSig: [4, 2],
      notes: [
        { tick: 0, pitch: 36, vel: 100 },
        { tick: 480, pitch: 38, vel: 90 },
        { tick: 960, pitch: 36, vel: 100 },
        { tick: 1440, pitch: 38, vel: 90 },
      ],
    });
    const p = parseMidiFile(buf);
    expect(p.ppq).toBe(480);
    expect(p.bpm).toBe(120);
    expect(p.beatsPerBar).toBe(4);
    expect(p.notes.map((n) => n.tick)).toEqual([0, 480, 960, 1440]);
    expect(p.notes.map((n) => n.pitch)).toEqual([36, 38, 36, 38]);
    expect(p.notes[0].velocity).toBe(100);
  });

  it("derives bpm from the set-tempo meta", () => {
    const buf = buildSmf({ ppq: 96, tempoUs: 600000, notes: [{ tick: 0, pitch: 36, vel: 100 }] });
    expect(parseMidiFile(buf).bpm).toBe(100);
  });

  it("reads beats-per-bar from the time signature", () => {
    const buf = buildSmf({ ppq: 480, timeSig: [3, 2], notes: [{ tick: 0, pitch: 36, vel: 100 }] });
    expect(parseMidiFile(buf).beatsPerBar).toBe(3);
  });

  it("ignores note-offs and zero-velocity note-ons", () => {
    const buf = buildSmf({ ppq: 480, notes: [{ tick: 0, pitch: 36, vel: 100, dur: 240 }] });
    // one note-on + one note-off in the file → exactly one recorded note
    expect(parseMidiFile(buf).notes).toHaveLength(1);
  });

  it("defaults to 120 bpm / 4-4 when the clip carries no meta", () => {
    const buf = buildSmf({ ppq: 480, notes: [{ tick: 0, pitch: 42, vel: 80 }] });
    const p = parseMidiFile(buf);
    expect(p.bpm).toBe(120);
    expect(p.beatsPerBar).toBe(4);
  });

  it("handles running status (note-on without a repeated status byte)", () => {
    // MThd + one track: two note-ons sharing the 0x90 status via running status
    const track = [
      0x00, 0x90, 0x24, 0x64, // t0: note on 36 vel 100
      0x81, 0x70, 0x24, 0x64, // +240: (running) note on 36 vel 100
      0x00, 0xff, 0x2f, 0x00, // end
    ];
    const bytes = [
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, // MThd, ppq 480
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length,
      ...track,
    ];
    const p = parseMidiFile(new Uint8Array(bytes).buffer);
    expect(p.notes).toHaveLength(2);
    expect(p.notes.every((n) => n.pitch === 36)).toBe(true);
    expect(p.notes[1].tick).toBe(240);
  });

  it("rejects a non-MIDI buffer", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(() => parseMidiFile(junk)).toThrow(/MThd/);
  });
});

// ---- lesson builder ----

describe("midiToLesson", () => {
  const backbeat = () =>
    parseMidiFile(
      buildSmf({
        ppq: 480,
        tempoUs: 500000,
        timeSig: [4, 2],
        notes: [
          { tick: 0, pitch: 36, vel: 100 },
          { tick: 480, pitch: 38, vel: 90 },
          { tick: 960, pitch: 36, vel: 100 },
          { tick: 1440, pitch: 38, vel: 90 },
        ],
      }),
    );

  it("builds a one-bar pad lesson at the clip's tempo", () => {
    const { lesson, analysis } = midiToLesson(backbeat(), "My Beat.mid");
    expect(lesson.instrument).toBe("pads");
    expect(lesson.source).toBe("midi-import");
    expect(lesson.name).toBe("My Beat");
    expect(lesson.bpm).toBe(120);
    expect(lesson.bars).toBe(1);
    expect(lesson.beatsPerBar).toBe(4);
    expect(lesson.notes.map((n) => n.time)).toEqual([0, 1, 2, 3]);
    expect(lesson.notes.map((n) => n.pitch)).toEqual([36, 38, 36, 38]);
    expect(analysis.looksLikeDrums).toBe(true);
    expect(analysis.noteCount).toBe(4);
  });

  it("lets the caller override the tempo", () => {
    const { lesson } = midiToLesson(backbeat(), "x.mid", { bpm: 95 });
    expect(lesson.bpm).toBe(95);
  });

  it("drops leading empty bars so the clip starts near beat 0", () => {
    const parsed = parseMidiFile(
      buildSmf({
        ppq: 480,
        timeSig: [4, 2],
        // notes live in the 2nd bar (beats 4..7)
        notes: [
          { tick: 1920, pitch: 36, vel: 100 },
          { tick: 2400, pitch: 38, vel: 100 },
        ],
      }),
    );
    const { lesson } = midiToLesson(parsed, "shifted.mid");
    expect(lesson.notes[0].time).toBe(0);
    expect(lesson.notes[1].time).toBe(1);
    expect(lesson.bars).toBe(1);
  });

  it("spans multiple bars when the clip is longer", () => {
    const parsed = parseMidiFile(
      buildSmf({
        ppq: 480,
        timeSig: [4, 2],
        notes: [
          { tick: 0, pitch: 36, vel: 100 },
          { tick: 480 * 6, pitch: 38, vel: 100 }, // beat 6 → needs 2 bars
        ],
      }),
    );
    expect(midiToLesson(parsed, "long.mid").lesson.bars).toBe(2);
  });

  it("routes every note to a real pad, remapping unknown percussion", () => {
    const parsed = parseMidiFile(
      buildSmf({
        ppq: 480,
        notes: [
          { tick: 0, pitch: 36, vel: 100 }, // known: kick
          { tick: 240, pitch: 99, vel: 100 }, // unknown percussion
          { tick: 480, pitch: 99, vel: 100 }, // same unknown → same pad
          { tick: 720, pitch: 105, vel: 100 }, // another unknown → different pad
        ],
      }),
    );
    const { lesson } = midiToLesson(parsed, "weird.mid", { instrument: "pads" });
    for (const n of lesson.notes) {
      expect(noteToPad(n.pitch), `pitch ${n.pitch}`).not.toBeNull();
    }
    const p99 = lesson.notes.filter((_, i) => [1, 2].includes(i)).map((n) => n.pitch);
    expect(p99[0]).toBe(p99[1]); // 99 mapped consistently
    // the two distinct unknowns land on different pads
    expect(noteToPad(lesson.notes[1].pitch)).not.toBe(noteToPad(lesson.notes[3].pitch));
  });

  it("auto-detects a melodic clip as a piano lesson, pitches untouched", () => {
    const parsed = parseMidiFile(
      buildSmf({
        ppq: 480,
        tempoUs: 500000,
        notes: [
          { tick: 0, pitch: 60, vel: 100 },
          { tick: 480, pitch: 64, vel: 100 },
          { tick: 960, pitch: 67, vel: 100 },
        ],
      }),
    );
    const { lesson, analysis } = midiToLesson(parsed, "melody.mid");
    expect(analysis.looksLikeDrums).toBe(false);
    expect(analysis.instrument).toBe("piano");
    expect(lesson.instrument).toBe("piano");
    // pitches pass straight through — no GM→pad remap
    expect(lesson.notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(analysis.lanes).toEqual(["C4", "E4", "G4"]);
  });

  it("preserves simultaneous notes as a chord (same time, distinct pitches)", () => {
    const parsed = parseMidiFile(
      buildSmf({
        ppq: 480,
        notes: [
          { tick: 0, pitch: 60, vel: 100 },
          { tick: 0, pitch: 64, vel: 100 },
          { tick: 0, pitch: 67, vel: 100 },
        ],
      }),
    );
    const { lesson } = midiToLesson(parsed, "triad.mid", { instrument: "piano" });
    const atZero = lesson.notes.filter((n) => n.time === 0).map((n) => n.pitch);
    expect(atZero).toEqual([60, 64, 67]);
  });

  it("honours an explicit instrument override (drums → piano)", () => {
    const parsed = parseMidiFile(
      buildSmf({ ppq: 480, notes: [{ tick: 0, pitch: 36, vel: 100 }] }),
    );
    const asPiano = midiToLesson(parsed, "kick.mid", { instrument: "piano" });
    expect(asPiano.lesson.instrument).toBe("piano");
    expect(asPiano.lesson.notes[0].pitch).toBe(36); // kept, not remapped
  });

  it("throws on an empty clip", () => {
    const parsed = parseMidiFile(buildSmf({ ppq: 480, notes: [] }));
    expect(() => midiToLesson(parsed, "empty.mid")).toThrow(/No notes/);
  });
});

describe("pad mapping", () => {
  const clip = () =>
    buildSmf({
      ppq: 480,
      notes: [
        { tick: 0, pitch: 36, vel: 100 }, // kick
        { tick: 480, pitch: 38, vel: 100 }, // snare
        { tick: 960, pitch: 36, vel: 100 },
        { tick: 1440, pitch: 36, vel: 100 },
      ],
    });

  it("reports where each source pitch landed, busiest first", () => {
    const { analysis } = midiToLesson(parseMidiFile(clip()), "t", { instrument: "pads" });
    expect(analysis.mapping).toEqual([
      { pitch: 36, pad: noteToPad(36), count: 3 },
      { pitch: 38, pad: noteToPad(38), count: 1 },
    ]);
  });

  it("honours a reassignment, and says so in the mapping", () => {
    const parsed = parseMidiFile(clip());
    const to = 5; // some other pad
    const { lesson, analysis } = midiToLesson(parsed, "t", {
      instrument: "pads",
      padOverrides: { 36: to },
    });
    expect(analysis.mapping.find((m) => m.pitch === 36)!.pad).toBe(to);
    // and the lesson's own notes moved with it
    const lanes = new Set(lesson.notes.map((n) => noteToPad(n.pitch)));
    expect(lanes.has(to)).toBe(true);
    expect(lanes.has(noteToPad(36))).toBe(false);
  });

  it("has nothing to map for a piano import", () => {
    const { analysis } = midiToLesson(parseMidiFile(clip()), "t", { instrument: "piano" });
    expect(analysis.mapping).toEqual([]);
  });
});
