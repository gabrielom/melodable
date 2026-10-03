import { describe, it, expect } from "vitest";
import { dawCompanion, isDawPort, isDrumPadNote, portToOpen } from "../src/engine/midi-port";
import { otherKind } from "../src/components/midi-log";

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

describe("isDrumPadNote", () => {
  it("lets everything from the chosen port through", () => {
    expect(isDrumPadNote({ kind: "noteon", channel: 0, port: "main" })).toBe(true);
    expect(isDrumPadNote({ kind: "cc", channel: 3, port: "main" })).toBe(true);
  });

  it("lets only channel-10 notes through from the DAW port", () => {
    expect(isDrumPadNote({ kind: "noteon", channel: 9, port: "daw" })).toBe(true);
    expect(isDrumPadNote({ kind: "noteoff", channel: 9, port: "daw" })).toBe(true);
    // Session pads, encoders and buttons: the control-surface conversation.
    expect(isDrumPadNote({ kind: "noteon", channel: 0, port: "daw" })).toBe(false);
    expect(isDrumPadNote({ kind: "cc", channel: 9, port: "daw" })).toBe(false);
  });
});

describe("otherKind", () => {
  it("names what the monitor would otherwise call 'other'", () => {
    expect(otherKind(0xa9)).toBe("poly at");
    expect(otherKind(0xd0)).toBe("pressure");
    expect(otherKind(0xe1)).toBe("bend");
    expect(otherKind(0xc0)).toBe("program");
    expect(otherKind(0xf8)).toBe("0xf8");
  });
});
