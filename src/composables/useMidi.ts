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

  async function refreshPorts(): Promise<void> {
    error.value = "";
    if (!isTauri()) {
      ports.value = [];
      error.value = "Run inside Tauri (npm run tauri dev) to see MIDI devices.";
      return;
    }
    try {
      busy.value = true;
      const { invoke } = await api();
      ports.value = await invoke<string[]>("list_midi_ports");
    } catch (e) {
      error.value = String(e);
    } finally {
      busy.value = false;
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
