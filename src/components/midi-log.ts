/** One row in the MIDI monitor. Lives outside the SFC because
 *  `<script setup>` blocks cannot export types. */
export interface LogRow {
  id: number;
  kind: string;
  note: number;
  velocity: number;
  channel: number;
  /** milliseconds since the previous message */
  delta: number;
  source: "hardware" | "daw" | "keyboard" | "click";
  /** A notice rather than a message — drawn across the row in place of the
   *  note, velocity and channel columns. */
  text?: string;
}

/** What a message `kind` calls "other" is, read off its status byte. */
export function otherKind(status: number): string {
  switch (status & 0xf0) {
    case 0xa0: return "poly at";
    case 0xc0: return "program";
    case 0xd0: return "pressure";
    case 0xe0: return "bend";
    default: return `0x${status.toString(16).padStart(2, "0")}`;
  }
}
