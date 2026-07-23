/**
 * Built-in pad lessons, in progression order (easy → hard). The trainer
 * advances through this list as the player clears each one; the library lets
 * them jump anywhere. M4 will append MIDI-imported lessons to the runtime
 * list without touching this file.
 */

import type { Lesson } from "@/engine/types";
import fourOnTheFloor from "./four-on-the-floor.json";
import backbeat from "./backbeat.json";
import eighthNoteHats from "./eighth-note-hats.json";
import offBeatHats from "./off-beat-hats.json";
import syncopatedGroove from "./syncopated-groove.json";
import tomFill from "./tom-fill.json";

export const BUILTIN_LESSONS: Lesson[] = [
  fourOnTheFloor as Lesson,
  backbeat as Lesson,
  eighthNoteHats as Lesson,
  offBeatHats as Lesson,
  syncopatedGroove as Lesson,
  tomFill as Lesson,
];
