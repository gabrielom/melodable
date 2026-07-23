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
  source: "hardware" | "keyboard" | "click";
}
