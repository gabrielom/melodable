import { describe, it, expect } from "vitest";
import { MidiClock } from "../src/engine/midi-clock";

describe("MidiClock", () => {
  it("falls back to 'now' before any sync", () => {
    const c = new MidiClock();
    expect(c.synced).toBe(false);
    expect(c.toAudioTime(123_000_000, 42)).toBe(42);
  });

  it("maps midi timestamps onto the audio clock", () => {
    const c = new MidiClock();
    // audio clock = midi seconds + 100, delivered instantly
    c.sync(5_000_000, 105);
    expect(c.toAudioTime(6_000_000, 0)).toBeCloseTo(106);
  });

  it("uses the least-delayed observation, ignoring delivery jitter", () => {
    const c = new MidiClock();
    // true offset is +100; deliveries add 5-30ms of jitter
    c.sync(1_000_000, 101.03);
    c.sync(2_000_000, 102.005);
    c.sync(3_000_000, 103.018);
    // best (min) estimate comes from the 5ms delivery
    expect(c.toAudioTime(4_000_000, 0)).toBeCloseTo(104.005);
  });

  it("resets", () => {
    const c = new MidiClock();
    c.sync(1_000_000, 101);
    c.reset();
    expect(c.synced).toBe(false);
    expect(c.toAudioTime(1_000_000, 7)).toBe(7);
  });
});
