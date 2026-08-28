/**
 * Make sure Noto Music is loaded before the sheet view draws with it.
 *
 * A `@font-face` in the stylesheet is enough for the DOM, which reflows when
 * the font arrives. Canvas has no such luxury: `ctx.font = '67px "Noto Music"'`
 * silently falls back to the serif behind it if the face has not loaded yet,
 * and the frame is already painted by the time it does. Every notehead in the
 * first second would be a wrong glyph, and nothing would report it.
 *
 * So: ask for it explicitly, and let the caller hold off drawing until it is
 * there. The load is cached by the browser, so this costs one round trip on
 * the first sheet lesson of a session and nothing after.
 */

import { ref } from "vue";
import { NOTEHEAD_EM_HEIGHT } from "@/engine/notation";

/** Nominal size to request. Any size loads the whole face; this is arbitrary. */
const PROBE = `${Math.round(17 / NOTEHEAD_EM_HEIGHT)}px "Noto Music"`;

/** Shared across callers — the font is loaded once per document, not per view. */
const ready = ref(false);
let started = false;

export function useNotationFont() {
  if (!started && typeof document !== "undefined" && "fonts" in document) {
    started = true;
    document.fonts
      .load(PROBE)
      .then(() => {
        ready.value = true;
      })
      .catch(() => {
        // Vendored locally, so this should not happen — but a missing face is
        // a wrong-looking staff, not a broken app, and the roll still works.
        console.warn("notation: Noto Music failed to load; the staff will fall back");
        ready.value = true;
      });
  } else if (!started) {
    // No font loading API (tests, older webviews): draw and hope.
    started = true;
    ready.value = true;
  }
  return { ready };
}
