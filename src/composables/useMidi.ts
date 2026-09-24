/**
 * Frontend side of the MIDI bridge.
 *
 * Do NOT reach for `navigator.requestMIDIAccess()` here: Tauri renders in the
 * OS webview (WebKit on macOS/Linux) which has no Web MIDI. All MIDI comes up
 * from Rust as `midi://message` events.
 */

import { ref, onUnmounted } from "vue";
import type { MidiMessage } from "@/engine/types";

/** True when running inside the Tauri shell (rather than a plain browser tab). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useMidi(onMessage: (m: MidiMessage) => void) {
  const ports = ref<string[]>([]);
  const connectedIndex = ref<number | null>(null);
  const connectedName = ref<string>("");
  const error = ref<string>("");
  const busy = ref(false);

  let unlisten: (() => void) | null = null;

  /** Lazily import the Tauri API so browser-only dev doesn't hard-crash. */
  async function api() {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);
    return { invoke, listen };
  }

  /**
   * `quiet` is the background scan that waits for a device to be plugged in:
   * it leaves `busy` and `error` alone, so an open menu doesn't flicker to
   * "scanning…" every few seconds or lose an error the player is reading.
   */
  async function refreshPorts(quiet = false): Promise<void> {
    if (!quiet) error.value = "";
    if (!isTauri()) {
      ports.value = [];
      if (!quiet) error.value = "Run inside Tauri (npm run tauri dev) to see MIDI devices.";
      return;
    }
    try {
      if (!quiet) busy.value = true;
      const { invoke } = await api();
      const next = await invoke<string[]>("list_midi_ports");
      // Same list, same array: nothing downstream re-renders for a scan
      // that found what was already there.
      if (next.length !== ports.value.length || next.some((p, i) => p !== ports.value[i])) {
        ports.value = next;
      }
    } catch (e) {
      if (!quiet) error.value = String(e);
    } finally {
      if (!quiet) busy.value = false;
    }
  }

  async function connect(index: number): Promise<void> {
    error.value = "";
    if (!isTauri()) return;
    try {
      busy.value = true;
      const { invoke, listen } = await api();
      const name = await invoke<string>("open_midi_port", { index });
      connectedIndex.value = index;
      connectedName.value = name;

      if (!unlisten) {
        unlisten = await listen<MidiMessage>("midi://message", (e) => onMessage(e.payload));
      }
    } catch (e) {
      error.value = String(e);
      connectedIndex.value = null;
      connectedName.value = "";
    } finally {
      busy.value = false;
    }
  }

  async function disconnect(): Promise<void> {
    if (!isTauri()) return;
    try {
      const { invoke } = await api();
      await invoke("close_midi_port");
    } catch (e) {
      error.value = String(e);
    }
    connectedIndex.value = null;
    connectedName.value = "";
  }

  onUnmounted(() => {
    if (unlisten) unlisten();
    unlisten = null;
  });

  return {
    ports,
    connectedIndex,
    connectedName,
    error,
    busy,
    refreshPorts,
    connect,
    disconnect,
  };
}
