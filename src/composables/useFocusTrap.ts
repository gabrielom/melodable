/**
 * Keep Tab inside a modal (M7's focus pass).
 *
 * `aria-modal="true"` tells a screen reader that the rest of the page is inert.
 * It does nothing whatsoever to the Tab key, so without this a keyboard user
 * tabs straight out of the dialog and onto controls sitting behind a backdrop
 * they cannot see past — and then has to tab all the way round to get back.
 *
 * Deliberately small: cycle at the ends, and leave everything else to the
 * browser's own order, which is already the DOM order the dialog is written in.
 */

import { onMounted, onUnmounted, type Ref } from "vue";

/** Things a browser will hand focus to, minus the ones currently disabled. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap(root: Ref<HTMLElement | null>) {
  function stops(): HTMLElement[] {
    const el = root.value;
    if (!el) return [];
    // `offsetParent` is null for anything display:none, which is how the
    // dialog's own conditional controls come and go mid-run.
    return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== "Tab" || !root.value) return;
    const items = stops();
    if (items.length === 0) {
      // Nothing to move to; keep focus on the panel rather than losing it.
      e.preventDefault();
      root.value.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    // Coming from the panel itself, Tab enters at either end.
    if (active === root.value) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }

  onMounted(() => document.addEventListener("keydown", onKey, true));
  onUnmounted(() => document.removeEventListener("keydown", onKey, true));
}
