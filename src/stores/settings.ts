import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { InstrumentType } from "@/engine/types";
import { persistGet, persistSet } from "./persist";

/**
 * Where the instrument sound comes from when you strike a pad/key.
 * - "internal": Melodable's own Web Audio synth.
 * - "external": silence — your controller is routed through a DAW (Ableton)
 *   which makes the sound; Melodable only tracks visuals and accuracy.
 */
export type SoundOutput = "internal" | "external";

/**
 * The subset of settings we persist across launches (Tauri store, M3).
 * `instrument` is intentionally absent — from M5 the active view follows the
 * restored lesson's instrument, so persisting it separately would conflict.
 */
interface SettingsSnapshot {
  volume: number;
  soundOutput: SoundOutput;
  metronome: boolean;
  monitorOpen: boolean;
  pianoLow: number;
  pianoHigh: number;
}

export const useSettings = defineStore("settings", () => {
  const instrument = ref<InstrumentType>("pads");
  const volume = ref(0.9);
  const lastPortName = ref<string>("");
  const soundOutput = ref<SoundOutput>("internal");
  /** Metronome click, count-in included. Off when the DAW provides the click. */
  const metronome = ref(true);
  /** Side panel with the live MIDI log. Collapsed gives the stage full width. */
  const monitorOpen = ref(true);

  /** Fallback piano range (C3..C6) when a lesson has no notes to frame. */
  const pianoLow = ref(48);
  const pianoHigh = ref(84);

  /** True once persisted values have been loaded (or confirmed absent). */
  const hydrated = ref(false);

  function setInstrument(i: InstrumentType) {
    instrument.value = i;
  }

  // Hydrate from the Tauri store (no-op / undefined in the browser).
  void persistGet<SettingsSnapshot>("settings").then((saved) => {
    if (saved) {
      if (typeof saved.volume === "number") volume.value = saved.volume;
      if (saved.soundOutput) soundOutput.value = saved.soundOutput;
      if (typeof saved.metronome === "boolean") metronome.value = saved.metronome;
      if (typeof saved.monitorOpen === "boolean") monitorOpen.value = saved.monitorOpen;
      if (typeof saved.pianoLow === "number") pianoLow.value = saved.pianoLow;
      if (typeof saved.pianoHigh === "number") pianoHigh.value = saved.pianoHigh;
    }
    hydrated.value = true;
  });

  // Persist on change. Guarded so the async hydrate above doesn't get
  // clobbered by an initial write before it lands.
  watch([volume, soundOutput, metronome, monitorOpen, pianoLow, pianoHigh], () => {
    if (!hydrated.value) return;
    void persistSet("settings", {
      volume: volume.value,
      soundOutput: soundOutput.value,
      metronome: metronome.value,
      monitorOpen: monitorOpen.value,
      pianoLow: pianoLow.value,
      pianoHigh: pianoHigh.value,
    } satisfies SettingsSnapshot);
  });

  return {
    instrument,
    volume,
    lastPortName,
    soundOutput,
    metronome,
    monitorOpen,
    pianoLow,
    pianoHigh,
    hydrated,
    setInstrument,
  };
});
