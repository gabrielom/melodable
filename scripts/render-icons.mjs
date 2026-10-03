/**
 * Renders `src-tauri/icons/icon.svg` to the icon set Tauri bundles.
 *
 * Two shapes come out of the one master:
 *
 *  - **Full-bleed PNGs** for Windows and Linux, where the artwork fills the
 *    tile. These are what `bundle.icon`'s `*.png` entries point at.
 *
 *  - **`icon.icns` for macOS**, where it does not. Apple's icon grid puts the
 *    rounded-rect body in 824x824 of a 1024x1024 canvas — a 100px transparent
 *    margin all round — and the Dock, Launchpad and the cmd-tab switcher all
 *    lay icons out on that assumption. A full-bleed macOS icon is not clipped
 *    or rejected, it simply renders about 24% larger in area than everything
 *    beside it, which is exactly how it looked. The master's corner radius is
 *    already 22.4% of its tile against Apple's 22.5%, so scaling the whole
 *    thing to 824 and centring it lands on the grid without redrawing
 *    anything.
 *
 * The master is pure percentage geometry, so every size above 32px is a clean
 * mechanical render. 16px is deliberately not designed: handoff 02 §15 asks
 * for hand-snapped block widths there, and for dropping the faintest note so
 * the remaining two stay distinct. The icns needs *something* in its 16px
 * slot, so it carries the 32px image, which is what the previous icns did too
 * — replace it by hand when §15 gets done.
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

/** Apple's macOS icon grid: 824 of 1024, centred. */
const MACOS_BODY = 824 / 1024;

/** size -> filename Tauri expects (see src-tauri/tauri.conf.json). */
const OUT = {
  32: "32x32.png",
  64: "64x64.png",
  128: "128x128.png",
  256: "128x128@2x.png",
  512: "icon-512.png",
  1024: "icon-1024.png",
};

/**
 * icns chunk type -> pixel size. Same set the previous icns carried, so
 * nothing that resolved an icon before stops finding one.
 */
const ICNS = {
  icp4: 16,
  icp5: 32,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
};

const browser = await chromium.launch();

/** Render the master at `size`, optionally inset to Apple's grid. */
async function render(size, inset) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const art = inset ? Math.round(size * MACOS_BODY) : size;
  await page.setContent(
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">` +
      svg.replace(/width="1024" height="1024"/, `width="${art}" height="${art}"`) +
      `</body>`,
  );
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

for (const [size, name] of Object.entries(OUT)) {
  writeFileSync(join(icons, name), await render(Number(size), false));
}

// --- icns -------------------------------------------------------------
// The container is trivial: "icns", total length, then one 8-byte-header
// chunk per image. Modern chunk types take a PNG payload verbatim, so there
// is nothing to encode beyond the table.
const chunks = [];
for (const [type, size] of Object.entries(ICNS)) {
  // 16px is not designed (see above): carry the 32px image in its slot.
  const png = await render(size === 16 ? 32 : size, true);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(png.length + 8, 4);
  chunks.push(header, png);
}
const body = Buffer.concat(chunks);
const head = Buffer.alloc(8);
head.write("icns", 0, 4, "ascii");
head.writeUInt32BE(body.length + 8, 4);
writeFileSync(join(icons, "icon.icns"), Buffer.concat([head, body]));

await browser.close();
console.log(`rendered ${Object.values(OUT).join(", ")}, icon.icns`);
