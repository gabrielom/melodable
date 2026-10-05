import { describe, expect, it } from "vitest";
import {
  describeStep,
  handFacts,
  handsOf,
  stepHandsFor,
  stepName,
} from "../src/engine/hands";
import { statedHands, midiToLesson, type ParsedMidi, type RawMidiNote } from "../src/engine/midi-file";
import { Scorer, lessonTargets } from "../src/engine/scoring";
import { noteInk } from "../src/views/lane-geometry";
import { PALETTE } from "../src/engine/theme";
import type { Lesson, NoteEvent } from "../src/engine/types";

/**
 * Handoff 15: each piano song part is learned right hand, left hand, then
 * both. These pin which notes belong to which hand, which steps a part has,
 * what a step says it plays, and that the other hand of a one-hand step is
 * drawn and played but never graded.
 */

const n = (time: number, pitch: number, extra: Partial<NoteEvent> = {}): NoteEvent => ({ time, pitch, ...extra });

/** A part like the frame's Part C: single notes on top, chords underneath. */
const PART: NoteEvent[] = [
  // Left hand: a chord on each beat, F2..B3.
  n(0, 41), n(0, 48), n(0, 53),
  n(1, 43), n(1, 50), n(1, 59),
  // Right hand: a melody, C4..A5.
  n(0, 72), n(0.5, 74), n(1, 81), n(1.5, 60),
];

describe("handsOf", () => {
  it("places notes by the staff's split when the clip says nothing", () => {
    const hands = handsOf(PART);
    expect(hands.slice(0, 6)).toEqual(["L", "L", "L", "L", "L", "L"]);
    expect(hands.slice(6)).toEqual(["R", "R", "R", "R"]);
  });

  it("splits a melody with no chords at middle C, as the handoff says", () => {
    expect(handsOf([n(0, 59), n(1, 60), n(2, 64)])).toEqual(["L", "R", "R"]);
  });

  it("follows the montuno's real line, not middle C", () => {
    // G3 B3 C4 D4 in the left hand, each against the octave above in the
    // right: the left hand's own C4 and D4 stay left.
    const montuno = [55, 59, 60, 62].flatMap((p, i) => [n(i, p), n(i, p + 12)]);
    expect(handsOf(montuno)).toEqual(["L", "R", "L", "R", "L", "R", "L", "R"]);
  });

  it("takes the hand a clip stated over anything the pitch would say", () => {
    expect(handsOf([n(0, 40, { hand: "R" }), n(0, 90, { hand: "L" })])).toEqual(["R", "L"]);
  });
});

describe("stepHandsFor", () => {
  const piano = (notes: NoteEvent[]) => ({ instrument: "piano", notes });

  it("gives a two-handed piano part all three steps", () => {
    expect(stepHandsFor(piano(PART))).toEqual(["R", "L", "BOTH"]);
  });

  it("gives a one-handed part, or a pads part, both hands alone", () => {
    expect(stepHandsFor(piano([n(0, 72), n(1, 74)]))).toEqual(["BOTH"]);
    expect(stepHandsFor({ instrument: "pads", notes: PART })).toEqual(["BOTH"]);
  });
});

describe("what a step says it plays", () => {
  it("reads chords underneath and single notes on top, with the range", () => {
    expect(handFacts(PART, "L")).toEqual({ kind: "chords", count: 2, low: 41, high: 59 });
    expect(handFacts(PART, "R")).toEqual({ kind: "notes", count: 4, low: 60, high: 81 });
  });

  it("writes the frame's sentences", () => {
    expect(describeStep(PART, "R", "Part C")).toBe("Single notes on top · 4 notes, C4 to A5");
    expect(describeStep(PART, "L", "Part C")).toBe("Chords underneath · 2 chords, F2 to B3");
    expect(describeStep(PART, "BOTH", "Part C")).toBe(
      "Both hands together · passing this completes Part C",
    );
  });

  it("names a step for a button, and leaves a part with no hands plain", () => {
    expect(stepName("PART C", "L", true)).toBe("PART C · LEFT HAND");
    expect(stepName("PART C", "BOTH", false)).toBe("PART C");
  });
});

describe("a clip that kept its hands apart", () => {
  const raw = (pitch: number, channel: number, track: number, tick = 0): RawMidiNote => ({
    tick,
    pitch,
    velocity: 90,
    channel,
    track,
    durationTicks: 480,
  });

  it("puts the higher of two tracks on the right", () => {
    const hands = statedHands([raw(48, 0, 2), raw(72, 0, 1), raw(52, 0, 2), raw(76, 0, 1)]);
    expect(hands?.get(1 * 16)).toBe("R");
    expect(hands?.get(2 * 16)).toBe("L");
  });

  it("reads two channels on one track the same way", () => {
    const hands = statedHands([raw(72, 0, 0), raw(48, 1, 0)]);
    expect(hands?.get(0)).toBe("R");
    expect(hands?.get(1)).toBe("L");
  });

  it("says nothing about one part, or three", () => {
    expect(statedHands([raw(48, 0, 0), raw(72, 0, 0)])).toBeNull();
    expect(statedHands([raw(48, 0, 0), raw(60, 1, 0), raw(72, 2, 0)])).toBeNull();
  });

  it("writes the hand onto every imported note — even one that crosses over", () => {
    // The left hand reaching up to E5 is still the left hand.
    const parsed: ParsedMidi = {
      ppq: 480,
      bpm: 100,
      beatsPerBar: 4,
      notes: [raw(72, 0, 1, 0), raw(48, 0, 2, 0), raw(76, 0, 2, 480), raw(74, 0, 1, 480)],
    };
    const { lesson } = midiToLesson(parsed, "two hands", { instrument: "piano" });
    const byPitch = Object.fromEntries(lesson.notes.map((x) => [x.pitch, x.hand]));
    expect(byPitch).toEqual({ 72: "R", 74: "R", 48: "L", 76: "L" });
  });
});

describe("the other hand of a one-hand step", () => {
  const lesson: Lesson = {
    id: "part",
    name: "Part",
    instrument: "piano",
    bpm: 60,
    bars: 1,
    beatsPerBar: 4,
    notes: [n(0, 72), n(0, 48), n(1, 74), n(1, 50)],
    source: "builtin",
  };
  // Learning the right hand: the left (48, 50) is accompaniment.
  const accompany = handsOf(lesson.notes).map((h) => h !== "R");
  const targets = lessonTargets(lesson, (p) => p, accompany);
  const timeOf = (_loop: number, beat: number) => beat; // 60 BPM: a beat a second

  it("is marked, and only it", () => {
    expect(targets.filter((t) => t.accompaniment).map((t) => t.lane)).toEqual([48, 50]);
    expect(lessonTargets(lesson, (p) => p).some((t) => t.accompaniment)).toBe(false);
  });

  it("is never missed, never counted, and striking it costs nothing", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    expect(s.hit(72, 0).kind).toBe("hit");
    // Played along with the left hand: not a mistake.
    expect(s.hit(48, 0.01).kind).toBe("along");
    s.sweepMisses(10);
    // Only the right hand's 74 is missed; the left hand never resolves.
    expect(s.tally.miss).toBe(1);
    expect(s.wrongCount).toBe(0);
    expect(s.accuracy).toBeCloseTo(0.5, 9);
    expect(s.laneStats().map((l) => l.lane).sort()).toEqual([72, 74]);
  });

  it("still charges a strike on its pitch that lands nowhere near it", () => {
    const s = new Scorer(targets);
    s.spawnLoop(0, timeOf);
    expect(s.hit(48, 2.5).kind).toBe("wrong");
  });

  it("is greyed in every mode, judged or not", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const colourMode of ["all", "results", "mono"] as const) {
        const f = { palette: PALETTE[theme], instrument: "piano" as const, countIn: false, colourMode };
        expect(noteInk(f, { resolved: false, rating: null, accompaniment: true }, 2)).toBe(
          PALETTE[theme].txt3,
        );
      }
    }
  });
});
