import { describe, it, expect } from "vitest";
import { dawCompanion, isDawPort, portToOpen } from "../src/engine/midi-port";

const LAUNCHKEY = ["Launchkey MK4 37 MIDI Out", "Launchkey MK4 37 DAW Out"];

describe("isDawPort", () => {
  it("names a controller's DAW port and nothing else", () => {
    expect(isDawPort("Launchkey MK4 37 DAW Out")).toBe(true);
    expect(isDawPort("LKMK4 DAW In")).toBe(true);
    expect(isDawPort("Launchkey MK4 37 MIDI Out")).toBe(false);
    // A word that merely contains the letters is not the port.
    expect(isDawPort("Dawson Keys")).toBe(false);
  });
});

describe("portToOpen", () => {
  it("opens the remembered device by name, wherever it sits in the list", () => {
    expect(portToOpen(["IAC Bus 1", ...LAUNCHKEY], "Launchkey MK4 37 MIDI Out")).toBe(1);
  });

  it("honours a remembered DAW port — it was picked by hand", () => {
    expect(portToOpen(LAUNCHKEY, "Launchkey MK4 37 DAW Out")).toBe(1);
  });

  it("opens nothing after the player disconnected", () => {
    expect(portToOpen(LAUNCHKEY, null)).toBeNull();
  });

  it("on first run takes the first port that is not a DAW port", () => {
    expect(portToOpen(["Launchkey MK4 37 DAW Out", "Launchkey MK4 37 MIDI Out"], undefined)).toBe(1);
    expect(portToOpen(LAUNCHKEY, undefined)).toBe(0);
  });

  it("falls back to the first-run pick when the remembered device is absent", () => {
    expect(portToOpen(LAUNCHKEY, "Arturia KeyStep")).toBe(0);
  });

  it("opens nothing when there is nothing a player would play", () => {
    expect(portToOpen([], undefined)).toBeNull();
    expect(portToOpen(["Launchkey MK4 37 DAW Out"], undefined)).toBeNull();
  });
});

describe("dawCompanion", () => {
  it("finds the Launchkey's DAW port beside its MIDI port", () => {
    expect(dawCompanion(LAUNCHKEY, "Launchkey MK4 37 MIDI Out")).toBe(1);
    expect(dawCompanion(["IAC Bus 1", "LKMK4 DAW Out", "LKMK4 MIDI Out"], "LKMK4 MIDI Out")).toBe(1);
  });

  it("does not pair a port with another device's DAW port", () => {
    expect(dawCompanion(["Launchkey MK4 49 DAW Out", "Launchkey MK4 37 MIDI Out"], "Launchkey MK4 37 MIDI Out")).toBeNull();
  });

  it("has none for a device without one, or when the DAW port itself was chosen", () => {
    expect(dawCompanion(["Arturia KeyStep"], "Arturia KeyStep")).toBeNull();
    expect(dawCompanion(LAUNCHKEY, "Launchkey MK4 37 DAW Out")).toBeNull();
  });
});
