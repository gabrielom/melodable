import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { InstrumentType } from "@/engine/types";
import type { Theme } from "@/engine/theme";
import { persistGet, persistSet } from "./persist";

/**
 * Where the instrument sound comes from when you strike a pad/key.
 * - "internal": Melodable's own Web Audio synth.
 * - "external": silence — your controller is routed through a DAW (Ableton)
 *   which makes the sound; Melodable only tracks visuals and accuracy.
 */
export type SoundOutput = "internal" | "external";

/** Physical arrangement of the 16 pads on the player's controller. */
export type PadLayout = "4x4" | "2x8";

/** Which way the notes travel: down to a hit line, or right-to-left to it. */
export type LaneOrientation = "vertical" | "horizontal";

/**
 * The subset of settings we persist across launches (Tauri store, M3).
 * `instrument` is intentionally absent — from M5 the active view follows the
 * restored lesson's instrument, so persisting it separately would conflict.
 */
interface SettingsSnapshot {
  theme: Theme;
  volume: number;
  soundOutput: SoundOutput;
  metronome: boolean;
  monitorOpen: boolean;
  padLayout: PadLayout;
  laneOrientation: LaneOrientation;
  pianoLow: number;
  pianoHigh: number;
}

/** The OS preference, used until the player picks a side themselves. */
function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export const useSettings = defineStore("settings", () => {
  const instrument = ref<InstrumentType>("pads");
  /**
   * Dark (Maschine chassis) or light (one flat Ableton grey). Follows the OS
   * on first run, then whatever the player last chose.
   *
   * Persisted through the Tauri store like everything else — invariant 7 rules
   * out localStorage, so the design brief's "persist in localStorage" is met
   * with the store plugin instead.
   */
  const theme = ref<Theme>(systemTheme());
  const volume = ref(0.9);
  const soundOutput = ref<SoundOutput>("internal");
  /** Metronome click, count-in included. Off when the DAW provides the click. */
  const metronome = ref(true);
  /** MIDI log, shown as an overlay over the lane. Off by default — it is a
   *  diagnostic, and the design gives the lane the whole stage. */
  const monitorOpen = ref(false);
  /** 4x4 (MPC style) or 2x8 (Launchkey and most 2-row controllers). */
  const padLayout = ref<PadLayout>("4x4");
  /** Scrolling (right-to-left) is the designed view; falling is the alternative. */
  const laneOrientation = ref<LaneOrientation>("horizontal");

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
      if (saved.theme === "dark" || saved.theme === "light") theme.value = saved.theme;
      if (typeof saved.volume === "number") volume.value = saved.volume;
      if (saved.soundOutput) soundOutput.value = saved.soundOutput;
      if (typeof saved.metronome === "boolean") metronome.value = saved.metronome;
      if (typeof saved.monitorOpen === "boolean") monitorOpen.value = saved.monitorOpen;
      if (saved.padLayout) padLayout.value = saved.padLayout;
      if (saved.laneOrientation) laneOrientation.value = saved.laneOrientation;
      if (typeof saved.pianoLow === "number") pianoLow.value = saved.pianoLow;
      if (typeof saved.pianoHigh === "number") pianoHigh.value = saved.pianoHigh;
    }
    hydrated.value = true;
  });

  // Persist on change. Guarded so the async hydrate above doesn't get
  // clobbered by an initial write before it lands.
  watch(
    [theme, volume, soundOutput, metronome, monitorOpen, padLayout, laneOrientation, pianoLow, pianoHigh],
    () => {
    if (!hydrated.value) return;
    void persistSet("settings", {
      theme: theme.value,
      volume: volume.value,
      soundOutput: soundOutput.value,
      metronome: metronome.value,
      monitorOpen: monitorOpen.value,
      padLayout: padLayout.value,
      laneOrientation: laneOrientation.value,
      pianoLow: pianoLow.value,
      pianoHigh: pianoHigh.value,
    } satisfies SettingsSnapshot);
    },
  );

  return {
    instrument,
    theme,
    volume,
    soundOutput,
    metronome,
    monitorOpen,
    padLayout,
    laneOrientation,
    pianoLow,
    pianoHigh,
    hydrated,
    setInstrument,
  };
});
