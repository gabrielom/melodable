import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { InstrumentType } from "@/engine/types";
import type { Theme } from "@/engine/theme";
import { clampLatency } from "@/engine/calibration";
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
 * How the run is drawn: the falling-note roll, or real notation on a staff
 * (handoff 10 §1). Sheet is horizontal only and piano only — a treble staff
 * and a keyboard cannot say anything about a drum pad.
 */
export type LaneMode = "roll" | "sheet";

/**
 * How much colour the staff carries (handoff 12).
 *
 * Colour is not a binary here: the trainer paints two systems, the instrument
 * hues before the playhead and the timing colours after it, and a player
 * reading music may want to silence them independently. These are the two
 * systems taken away one at a time, in that order.
 *
 * - `all` — both, which is the default and the trainer's normal behaviour.
 * - `results` — the hues go and the judgement stays: **plain staff ink ahead
 *   of the playhead, timing colours behind it.** What is coming reads as
 *   notation and nothing else, and how it went still reads at a glance. This
 *   is the state to sight-read in.
 * - `mono` — both go, so the page reads as plain notation throughout.
 *
 * `results` is the state handoff 12 §1 calls "targets only" and describes the
 * other way round — hues kept, judgement dropped. It was built that way and is
 * **deliberately reversed**, on the user's word, given three times: what they
 * want silenced on a staff is the pitch tint, not the mark. Their sentence is
 * the spec — "all the notes to the right of the playhead should have no
 * colour, after the playhead they should all have timing colours". Don't
 * "restore" the handoff's reading without asking.
 *
 * Sheet only. The roll has no such choice: a falling lane is a stack of
 * *lanes*, and stripping their hues would leave nothing to tell one from
 * another.
 */
export type ColourMode = "all" | "results" | "mono";

/**
 * How a note is named: by letter, or by what it *does* in the key.
 *
 * Piano only. A degree is a statement about a scale, and a drum pad is not in
 * one — handoff 11 §3.3 keeps degrees, key and sheet off every pads frame for
 * the same reason.
 */
export type NoteLabel = "note" | "degree";

/**
 * The subset of settings we persist across launches (Tauri store, M3).
 * `instrument` is intentionally absent — from M5 the active view follows the
 * restored lesson's instrument, so persisting it separately would conflict.
 */
interface SettingsSnapshot {
  theme: Theme;
  /** Superseded by the three bus levels; still read so old stores migrate. */
  volume?: number;
  volNotes: number;
  volGuide: number;
  volMetronome: number;
  soundOutput: SoundOutput;
  metronome: boolean;
  monitorOpen: boolean;
  padLayout: PadLayout;
  laneOrientation: LaneOrientation;
  laneMode: LaneMode;
  /** Superseded by `colourMode`; still read so an old store migrates. */
  sheetInk?: "colour" | "mono";
  /** `targets` is the middle state's old name, migrated on read. */
  colourMode?: ColourMode | "targets";
  noteLabel?: NoteLabel;
  keyOverride?: number | null;
  pianoLow: number;
  pianoHigh: number;
  latencyMs: number;
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
  /**
   * One level per audio bus. Three faders rather than one because they
   * compete: the click has to cut through while you are learning the pattern
   * and get out of the way once you are not, and the guide part belongs
   * under your own playing rather than level with it.
   */
  const volNotes = ref(0.9);
  const volGuide = ref(0.6);
  const volMetronome = ref(0.9);
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
  /** Roll or notation. The roll is the default — sheet is the specialist view. */
  const laneMode = ref<LaneMode>("roll");
  /** Sheet's colour. Everything on by default: the hues are how the app names
   *  a pitch everywhere else, so the staff arrives speaking that language. */
  const colourMode = ref<ColourMode>("all");
  /** Letters by default: degrees are the specialist reading, as sheet is. */
  const noteLabel = ref<NoteLabel>("note");
  /**
   * A key chosen by hand, overriding the one derived from the lesson's notes.
   *
   * Null means "read it off the music", which is right nearly always — the
   * override exists because a clip that uses only part of a scale honestly
   * derives a smaller signature, and only the player knows what it is really
   * in. Kept as fifths, the same currency the staff and the degrees both take.
   */
  const keyOverride = ref<number | null>(null);

  /** Fallback piano range (C3..C6) when a lesson has no notes to frame. */
  const pianoLow = ref(48);
  const pianoHigh = ref(84);

  /**
   * Timing calibration: milliseconds subtracted from every hardware strike
   * before it is graded (M7). Positive means the rig makes you play late —
   * a DAW's output buffer, a controller's own scan — and this cancels it.
   *
   * Only hardware carries it. A mouse click or a computer key has no rig
   * between the intent and the timestamp, so there is nothing to cancel.
   */
  const latencyMs = ref(0);

  /** True once persisted values have been loaded (or confirmed absent). */
  const hydrated = ref(false);

  function setInstrument(i: InstrumentType) {
    instrument.value = i;
  }

  // Hydrate from the Tauri store (no-op / undefined in the browser).
  void persistGet<SettingsSnapshot>("settings").then((saved) => {
    if (saved) {
      if (saved.theme === "dark" || saved.theme === "light") theme.value = saved.theme;
      // A store written before the split has one level; seed all three from
      // it so an upgrade does not silently reset the player's volume.
      if (typeof saved.volume === "number") {
        volNotes.value = saved.volume;
        volGuide.value = saved.volume;
        volMetronome.value = saved.volume;
      }
      if (typeof saved.volNotes === "number") volNotes.value = saved.volNotes;
      if (typeof saved.volGuide === "number") volGuide.value = saved.volGuide;
      if (typeof saved.volMetronome === "number") volMetronome.value = saved.volMetronome;
      if (saved.soundOutput) soundOutput.value = saved.soundOutput;
      if (typeof saved.metronome === "boolean") metronome.value = saved.metronome;
      if (typeof saved.monitorOpen === "boolean") monitorOpen.value = saved.monitorOpen;
      if (saved.padLayout) padLayout.value = saved.padLayout;
      if (saved.laneOrientation) laneOrientation.value = saved.laneOrientation;
      if (saved.laneMode === "roll" || saved.laneMode === "sheet") laneMode.value = saved.laneMode;
      // The two-state toggle this replaced maps straight onto the ends of
      // the new three, so an upgrade keeps whatever was chosen.
      if (saved.sheetInk === "colour") colourMode.value = "all";
      if (saved.sheetInk === "mono") colourMode.value = "mono";
      // `targets` was the middle state before it was reversed. It is the same
      // slot on the toggle, so a store written under the old name lands on
      // the middle state rather than silently falling back to the default.
      if (saved.colourMode === "targets") colourMode.value = "results";
      if (saved.colourMode === "all" || saved.colourMode === "results" || saved.colourMode === "mono") {
        colourMode.value = saved.colourMode;
      }
      if (saved.noteLabel === "note" || saved.noteLabel === "degree") noteLabel.value = saved.noteLabel;
      if (typeof saved.keyOverride === "number" || saved.keyOverride === null) {
        keyOverride.value = saved.keyOverride;
      }
      if (typeof saved.pianoLow === "number") pianoLow.value = saved.pianoLow;
      if (typeof saved.pianoHigh === "number") pianoHigh.value = saved.pianoHigh;
      if (typeof saved.latencyMs === "number") latencyMs.value = clampLatency(saved.latencyMs);
    }
    hydrated.value = true;
  });

  // Persist on change. Guarded so the async hydrate above doesn't get
  // clobbered by an initial write before it lands.
  watch(
    [theme, volNotes, volGuide, volMetronome, soundOutput, metronome, monitorOpen, padLayout, laneOrientation, laneMode, colourMode, noteLabel, keyOverride, pianoLow, pianoHigh, latencyMs],
    () => {
    if (!hydrated.value) return;
    void persistSet("settings", {
      theme: theme.value,
      volNotes: volNotes.value,
      volGuide: volGuide.value,
      volMetronome: volMetronome.value,
      soundOutput: soundOutput.value,
      metronome: metronome.value,
      monitorOpen: monitorOpen.value,
      padLayout: padLayout.value,
      laneOrientation: laneOrientation.value,
      laneMode: laneMode.value,
      colourMode: colourMode.value,
      noteLabel: noteLabel.value,
      keyOverride: keyOverride.value,
      pianoLow: pianoLow.value,
      pianoHigh: pianoHigh.value,
      latencyMs: latencyMs.value,
    } satisfies SettingsSnapshot);
    },
  );

  return {
    instrument,
    theme,
    volNotes,
    volGuide,
    volMetronome,
    soundOutput,
    metronome,
    monitorOpen,
    padLayout,
    laneOrientation,
    laneMode,
    colourMode,
    noteLabel,
    keyOverride,
    pianoLow,
    pianoHigh,
    latencyMs,
    hydrated,
    setInstrument,
  };
});
