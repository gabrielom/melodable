import { describe, it, expect } from "vitest";
import { isDawPort, portToOpen } from "../src/engine/midi-port";

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
