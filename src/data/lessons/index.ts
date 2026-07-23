/**
 * Built-in lessons. M2 ships one pad lesson; the M3 library expands this
 * list and adds progression between them.
 */

import type { Lesson } from "@/engine/types";
import eighthNoteHats from "./eighth-note-hats.json";

export const BUILTIN_LESSONS: Lesson[] = [eighthNoteHats as Lesson];
