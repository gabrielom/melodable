/**
 * Renders `src-tauri/icons/icon.svg` to the PNG set Tauri bundles.
 *
 * The master is pure percentage geometry, so every size above 32px is a clean
 * mechanical render. 16px is deliberately not generated: handoff 02 §15 asks
 * for hand-snapped block widths there, and for dropping the faintest note so
 * the remaining two stay distinct — do that by hand when it's needed.
 *
 * Uses the Chromium that Playwright already provides rather than adding a
 * rasteriser dependency for a file that changes once a year.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const icons = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const svg = readFileSync(join(icons, "icon.svg"), "utf8");

/** size -> filename Tauri expects (see src-tauri/tauri.conf.json). */
const OUT = {
  32: "32x32.png",
  64: "64x64.png",
  128: "128x128.png",
  256: "128x128@2x.png",
  512: "icon-512.png",
  1024: "icon-1024.png",
};

const browser = await chromium.launch();
for (const [size, name] of Object.entries(OUT)) {
  const s = Number(size);
  const page = await browser.newPage({ viewport: { width: s, height: s } });
  await page.setContent(
    `<body style="margin:0">${svg.replace(/width="1024" height="1024"/, `width="${s}" height="${s}"`)}</body>`,
  );
  writeFileSync(join(icons, name), await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
console.log(`rendered ${Object.values(OUT).join(", ")}`);
