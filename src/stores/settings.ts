import { defineStore } from "pinia";
import { ref } from "vue";
import type { InstrumentType } from "@/engine/types";

/**
 * Session settings. M3 will persist these via the Tauri store plugin;
 * for now they live in memory.
 */
/**
 * Where the instrument sound comes from when you strike a pad/key.
 * - "internal": Melodable's own Web Audio synth.
 * - "external": silence — your controller is routed through a DAW (Ableton)
 *   which makes the sound; Melodable only tracks visuals and accuracy.
 */
export type SoundOutput = "internal" | "external";

export const useSettings = defineStore("settings", () => {
  const instrument = ref<InstrumentType>("pads");
  const volume = ref(0.9);
  const lastPortName = ref<string>("");
  const soundOutput = ref<SoundOutput>("internal");
  /** Metronome click, count-in included. Off when the DAW provides the click. */
  const metronome = ref(true);

  /** Piano view range — 25 keys (C3..C5) by default. */
  const pianoLow = ref(48);
  const pianoHigh = ref(72);

  function setInstrument(i: InstrumentType) {
    instrument.value = i;
  }

  return {
    instrument,
    volume,
    lastPortName,
    soundOutput,
    metronome,
    pianoLow,
    pianoHigh,
    setInstrument,
  };
});
