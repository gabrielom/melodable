<script setup lang="ts">
/**
 * The transport bar's tooltips, drawn by us rather than by the platform.
 *
 * The bar is nineteen controls, most of them a 20px glyph, and the only thing
 * that says what one does is its tooltip. WKWebView's native `title` tooltip
 * is not dependable there — it appears late, often not at all, and sometimes
 * flashes and vanishes. Rather than keep guessing at why, the bar stops using
 * `title` and uses `data-tip`, and this draws it.
 *
 * One element, one set of delegated listeners: a control opts in by carrying
 * the attribute, and nothing has to be wired up per button. `title` must not
 * be left on the same element — the platform would still try to draw its own
 * on top, which is the behaviour we are replacing.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  /**
   * True while one of the bar's dropdowns is open. A tip must not appear then:
   * the panel says more than the tip could and the tip would float over it.
   * Passed in rather than sniffed out of the DOM — the three panels do not
   * share a role (the mixer is sliders, not a menu), and the bar already knows.
   */
  suppressed?: boolean;
}>();

/**
 * How long the pointer has to rest before a tip appears, and how long the bar
 * stays "warm" afterwards.
 *
 * The warm period is what makes a row of small controls feel right: having
 * waited once, sliding along the bar names each control immediately instead of
 * making you wait again at every one. It is also what stops the tip flickering
 * when the pointer crosses the 9px gap between two buttons.
 */
const OPEN_DELAY = 450;
const WARM_FOR = 400;
/** Gap between the control and the tip, and the margin kept from the edges. */
const OFFSET = 6;
const EDGE = 8;

const text = ref("");
const x = ref(0);
const y = ref(0);
const shown = ref(false);
/** Measured before the tip is placed, so it can be centred and clamped. */
const el = ref<HTMLElement | null>(null);

let openTimer = 0;
let warmUntil = 0;
let target: HTMLElement | null = null;

const reducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function place(on: HTMLElement) {
  const r = on.getBoundingClientRect();
  const w = el.value?.offsetWidth ?? 0;
  const h = el.value?.offsetHeight ?? 0;
  const half = w / 2;
  x.value = Math.min(
    Math.max(EDGE + half, r.left + r.width / 2),
    Math.max(EDGE + half, window.innerWidth - EDGE - half),
  );
  // Below the control, unless that would run off the bottom.
  const below = r.bottom + OFFSET;
  y.value = below + h > window.innerHeight - EDGE ? r.top - OFFSET - h : below;
}

function open(on: HTMLElement, tip: string) {
  target = on;
  text.value = tip;
  shown.value = true;
  // The element has to exist at its real size before it can be centred, and
  // `shown` only reaches the DOM after a paint — so place twice.
  place(on);
  requestAnimationFrame(() => {
    if (shown.value && target === on) place(on);
  });
}

function close() {
  window.clearTimeout(openTimer);
  openTimer = 0;
  if (shown.value) warmUntil = performance.now() + WARM_FOR;
  shown.value = false;
  target = null;
}

function onOver(e: PointerEvent) {
  const on = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
  if (!on) return;
  const tip = on.getAttribute("data-tip");
  if (!tip || on === target || props.suppressed) return;
  window.clearTimeout(openTimer);
  if (performance.now() < warmUntil) open(on, tip);
  else openTimer = window.setTimeout(() => open(on, tip), OPEN_DELAY);
}

function onOut(e: PointerEvent) {
  const on = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
  if (!on) return;
  // Moving to a child of the same control is not leaving it.
  const to = e.relatedTarget as Node | null;
  if (to && on.contains(to)) return;
  close();
}

/**
 * Anything that means "I am doing something now, not reading about it": a
 * click, a key, the window going away. A tip left hanging over a menu the
 * click just opened is worse than no tip at all.
 */
function dismiss() {
  warmUntil = 0;
  close();
}

// A panel can open from the keyboard as well as a click, so closing on
// `suppressed` is not the same as closing on pointerdown.
watch(
  () => props.suppressed,
  (on) => {
    if (on) dismiss();
  },
);

onMounted(() => {
  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("pointerdown", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
  window.addEventListener("blur", dismiss);
  window.addEventListener("resize", dismiss);
});

onUnmounted(() => {
  window.clearTimeout(openTimer);
  document.removeEventListener("pointerover", onOver, true);
  document.removeEventListener("pointerout", onOut, true);
  document.removeEventListener("pointerdown", dismiss, true);
  document.removeEventListener("keydown", dismiss, true);
  window.removeEventListener("blur", dismiss);
  window.removeEventListener("resize", dismiss);
});

const style = computed(() => ({
  transform: `translate(${Math.round(x.value)}px, ${Math.round(y.value)}px) translateX(-50%)`,
}));
</script>

<template>
  <div
    v-show="shown"
    ref="el"
    class="tip"
    :class="{ still: reducedMotion }"
    role="tooltip"
    aria-hidden="true"
    :style="style"
  >
    {{ text }}
  </div>
</template>

<style scoped>
/*
 * Fixed and translated rather than positioned with `left`/`top`: the tip has
 * to sit above the bar's own stacking context (which lifts to 30 while a menu
 * is open) and above the lane canvas, and it must never be clipped by either.
 */
.tip {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 90;
  max-width: 260px;
  padding: 4px 7px;
  border-radius: var(--r-field);
  background: var(--gutter);
  box-shadow: inset 0 0 0 1px var(--hair), 0 6px 16px #00000055;
  color: var(--txt);
  font-family: var(--sans);
  font-size: 11px;
  line-height: 1.35;
  /* Wrapping, not `nowrap`: the longest tip on the bar — the DAW mode's — is
     around 380px of text, so a no-wrap tip would simply run past `max-width`
     and off the window. `balance` keeps the two lines close to even rather
     than leaving one word on the second. */
  white-space: normal;
  text-wrap: balance;
  /* The pointer must never find the tip: it would leave the control, close the
     tip, re-enter the control, and flicker forever. */
  pointer-events: none;
  animation: tip-in 90ms ease-out;
}
.still { animation: none; }

@keyframes tip-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
