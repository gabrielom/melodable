import { defineStore } from "pinia";
import { ref } from "vue";
import type { InstrumentType } from "@/engine/types";

/**
 * Session settings. M3 will persist these via the Tauri store plugin;
 * for now they live in memory.
 */
export const useSettings = defineStore("settings", () => {
  const instrument = ref<InstrumentType>("pads");
  const volume = ref(0.9);
  const lastPortName = ref<string>("");

  /** Piano view range — 25 keys (C3..C5) by default. */
  const pianoLow = ref(48);
  const pianoHigh = ref(72);

  function setInstrument(i: InstrumentType) {
    instrument.value = i;
  }

  return { instrument, volume, lastPortName, pianoLow, pianoHigh, setInstrument };
});
