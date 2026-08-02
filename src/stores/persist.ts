/**
 * Tiny persistence layer over the Tauri store plugin.
 *
 * Invariant 7: no localStorage/sessionStorage. Persistence uses the Tauri
 * store plugin, so it only actually saves inside the Tauri shell. In a plain
 * browser (`npm run dev`) every call is a safe no-op — settings just stay in
 * memory for that session.
 *
 * The plugin module is imported lazily and only when running under Tauri, so
 * it never loads (or throws) in the browser. Every call is wrapped: if the
 * store is unavailable for any reason, the app keeps working unpersisted
 * rather than crashing.
 */

import { isTauri } from "@/composables/useMidi";

interface StoreLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

const STORE_FILE = "melodable-settings.json";

let storePromise: Promise<StoreLike | null> | null = null;

function getStore(): Promise<StoreLike | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (!storePromise) {
    // LazyStore defers its backend load until the first get/set and
    // debounce-saves on change (autoSave = ms).
    storePromise = import("@tauri-apps/plugin-store")
      .then(({ LazyStore }) => new LazyStore(STORE_FILE, { autoSave: 400 }) as unknown as StoreLike)
      .catch((e) => {
        console.warn("persist: Tauri store unavailable, running unpersisted", e);
        return null;
      });
  }
  return storePromise;
}

export async function persistGet<T>(key: string): Promise<T | undefined> {
  try {
    const store = await getStore();
    return store ? await store.get<T>(key) : undefined;
  } catch (e) {
    console.warn(`persist: failed to read "${key}"`, e);
    return undefined;
  }
}

export async function persistSet(key: string, value: unknown): Promise<void> {
  try {
    const store = await getStore();
    if (store) await store.set(key, value);
  } catch (e) {
    console.warn(`persist: failed to write "${key}"`, e);
  }
}
