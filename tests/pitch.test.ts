import { describe, it, expect } from "vitest";
import {
  keyGeometry,
  isWhiteKey,
  noteName,
  countWhiteKeys,
  normalizeRange,
} from "../src/engine/pitch";
import { noteToPad, looksLikeDrums, padPosition, PADS, PAD_KEY_MAP } from "../src/engine/gm";

describe("piano key geometry", () => {
  const W = 20; // white key width

  it("identifies white and black keys", () => {
    expect(isWhiteKey(60)).toBe(true); // C4
    expect(isWhiteKey(61)).toBe(false); // C#4
    expect(isWhiteKey(71)).toBe(true); // B4
    expect(isWhiteKey(70)).toBe(false); // A#4
  });

  it("places the first white key at x=0", () => {
    const g = keyGeometry(60, 60, W);
    expect(g.x).toBe(0);
    expect(g.isBlack).toBe(false);
    expect(g.width).toBe(W);
  });

  it("advances one white-key width per white key", () => {
    expect(keyGeometry(62, 60, W).x).toBe(W); // D4 is the 2nd white key
    expect(keyGeometry(64, 60, W).x).toBe(2 * W); // E4
    expect(keyGeometry(65, 60, W).x).toBe(3 * W); // F4
  });

  it("straddles black keys across the white-key boundary", () => {
    const g = keyGeometry(61, 60, W); // C#4
    expect(g.isBlack).toBe(true);
    expect(g.width).toBeCloseTo(W * 0.6);
    // centre of the black key should sit on the C/D boundary
    expect(g.x + g.width / 2).toBeCloseTo(W);
  });

  it("never lets a black key collide with the next octave's", () => {
    const cSharp = keyGeometry(61, 60, W);
    const dSharp = keyGeometry(63, 60, W);
    expect(cSharp.x + cSharp.width).toBeLessThan(dSharp.x);
  });

  it("names notes with the right octave", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
    expect(noteName(61)).toBe("C#4");
  });

  it("counts white keys in a range", () => {
    expect(countWhiteKeys(60, 72)).toBe(8); // C4..C5 inclusive
  });

  it("snaps ranges out to white keys", () => {
    expect(normalizeRange(61, 70)).toEqual([60, 71]);
  });
});

describe("GM drum mapping", () => {
  it("maps the essentials to the right pads", () => {
    expect(PADS[noteToPad(36)!].type).toBe("kick");
    expect(PADS[noteToPad(38)!].type).toBe("snare");
    expect(PADS[noteToPad(42)!].type).toBe("hatClosed");
    expect(PADS[noteToPad(46)!].type).toBe("hatOpen");
  });

  it("returns null for unmapped notes", () => {
    expect(noteToPad(21)).toBeNull();
  });

  it("detects drum clips", () => {
    expect(looksLikeDrums([36, 38, 42, 42, 36])).toBe(true);
    expect(looksLikeDrums([60, 62, 64, 65])).toBe(false);
    expect(looksLikeDrums([60, 62], 9)).toBe(true); // channel 10
  });
});

describe("pad layout", () => {
  it("has 16 pads with unique keys", () => {
    expect(PADS).toHaveLength(16);
    expect(Object.keys(PAD_KEY_MAP)).toHaveLength(16);
  });

  it("puts the kick bottom-left, MPC style", () => {
    expect(PADS[12].type).toBe("kick");
  });
});

describe("pad positions", () => {
  it("places pads on the 4x4 grid, labelling rows from the bottom", () => {
    expect(padPosition(0, "4x4")).toMatchObject({ row: 0, col: 0, rows: 4, cols: 4, label: "D1" });
    expect(padPosition(12, "4x4").label).toBe("A1"); // kick, bottom-left
    expect(padPosition(15, "4x4").label).toBe("A4");
  });

  it("reflows the same pads onto two rows of eight", () => {
    const p = padPosition(12, "2x8"); // kick stays bottom-left
    expect(p).toMatchObject({ row: 1, col: 0, rows: 2, cols: 8, label: "A1" });
    // the 4x4's bottom row takes the left half of the 2x8's bottom row
    expect(padPosition(15, "2x8").col).toBe(3); // snare 2 -> bottom col 4
    expect(padPosition(8, "2x8").col).toBe(4); // closed hat -> bottom col 5
    expect(padPosition(11, "2x8").col).toBe(7); // tom lo -> bottom col 8
    // 4x4 rows 0-1 form the top row, row 1 on the left
    expect(padPosition(4, "2x8")).toMatchObject({ row: 0, col: 0, label: "B1" });
    expect(padPosition(0, "2x8")).toMatchObject({ row: 0, col: 4, label: "B5" });
  });

  it("gives all 16 pads a unique cell in both layouts", () => {
    for (const layout of ["4x4", "2x8"] as const) {
      const seen = new Set(
        PADS.map((_, i) => {
          const p = padPosition(i, layout);
          return `${p.row}:${p.col}`;
        }),
      );
      expect(seen.size, layout).toBe(16);
    }
  });
});
