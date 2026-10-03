/**
 * The check handoff 14 asks for: a lightbox sheet must fit below the bar.
 *
 * The summary's tallest case — a song section with three weakest lanes and a
 * full tally — and a long song's section picker are both measured against the
 * 1050 × 620 window floor, which leaves 586px under the 34px bar. Nothing here
 * can be a unit test: jsdom has no layout, so the check runs where layout does,
 * in the dev build, and says so in the console the moment a sheet outgrows the
 * room — which is when someone has just added something to it.
 */
import { onMounted, onUnmounted, type Ref } from "vue";

const BAR_H = 34;

export function useSheetFit(sheet: Ref<HTMLElement | null>, name: string): void {
  if (!import.meta.env.DEV) return;
  const check = () => {
    const el = sheet.value;
    if (!el) return;
    const room = window.innerHeight - BAR_H;
    if (el.offsetHeight > room) {
      console.warn(`${name}: sheet is ${el.offsetHeight}px, ${el.offsetHeight - room}px taller than the ${room}px under the bar`);
    }
  };
  onMounted(() => {
    check();
    window.addEventListener("resize", check);
  });
  onUnmounted(() => window.removeEventListener("resize", check));
}
