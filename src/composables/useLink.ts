/**
 * Frontend side of the Ableton Link bridge (M6).
 *
 * Same shape as `useMidi`: Rust owns the session, pushes snapshots up as
 * `link://state` events, and this composable holds the latest one. It does no
 * timing work itself — `useTrainer` decides how the transport follows.
 *
 * Link is behind a cargo feature, so `available` may be false in a build made
 * without CMake. Callers should hide the toggle rather than fail loudly.
 */

import { ref, onUnmounted } from "vue";
import type { LinkState } from "@/engine/types";
import { isTauri } from "@/composables/useMidi";

export function useLink(onState?: (s: LinkState) => void) {
  const available = ref(false);
  const enabled = ref(false);
  const peers = ref(0);
  const error = ref("");

  let unlisten: (() => void) | null = null;

  /** Lazily import the Tauri API so browser-only dev doesn't hard-crash. */
  async function api() {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);
    return { invoke, listen };
  }

  function apply(s: LinkState): void {
    enabled.value = s.enabled;
    peers.value = s.peers;
    if (s.enabled) onState?.(s);
  }

  /** Ask Rust whether this build has Link at all. */
  async function probe(): Promise<void> {
    if (!isTauri()) return;
    try {
      const { invoke } = await api();
      available.value = await invoke<boolean>("link_available");
    } catch (e) {
      error.value = String(e);
    }
  }

  /**
   * Join or leave the session. `quantum` is the trainer's loop length in beats
   * — both apps need to agree on where a loop boundary falls. `bpm` seeds the
   * Link instance so that if we end up founding the session rather than joining
   * one, the tempo we contribute is the one on screen.
   */
  async function setEnabled(on: boolean, quantum: number, bpm: number): Promise<void> {
    error.value = "";
    if (!isTauri()) {
      error.value = "Run inside Tauri (npm run tauri dev) to use Ableton Link.";
      return;
    }
    try {
      const { invoke, listen } = await api();
      if (on && !unlisten) {
        unlisten = await listen<LinkState>("link://state", (e) => apply(e.payload));
      }
      apply(await invoke<LinkState>("link_enable", { enabled: on, quantum, bpm }));
    } catch (e) {
      error.value = String(e);
      enabled.value = false;
    }
  }

  /** Push our tempo out to the session — the slider driving Ableton. */
  async function proposeTempo(bpm: number): Promise<void> {
    if (!isTauri() || !enabled.value) return;
    try {
      const { invoke } = await api();
      await invoke("link_set_tempo", { bpm });
    } catch (e) {
      error.value = String(e);
    }
  }

  onUnmounted(() => {
    if (unlisten) unlisten();
    unlisten = null;
  });

  return { available, enabled, peers, error, probe, setEnabled, proposeTempo };
}
