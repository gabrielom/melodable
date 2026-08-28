# Bundled fonts

All three are vendored rather than fetched at runtime: the app is a desktop
build that has to work offline, and a webview has no business reaching out to
a CDN to draw its own UI.

| Family | Files | Licence |
| --- | --- | --- |
| Geist | `Geist-*.woff2` | SIL Open Font License 1.1 |
| Geist Mono | `GeistMono-*.woff2` | SIL Open Font License 1.1 |
| Noto Music | `NotoMusic.woff2` | SIL Open Font License 1.1 |

## Noto Music

Copyright 2022 The Noto Project Authors — <https://github.com/notofonts/music>.
Licence text: <https://scripts.sil.org/OFL>.

Added for the sheet view (handoff 10 §1.3), which draws real notation rather
than hand-built shapes. Converted from the Google Fonts TTF
(`notomusic/v21`, 174KB) to woff2 (73KB) with `fonttools`.

Two numbers are measured from the font binary rather than estimated, and
`src/engine/notation.ts` depends on both:

- **notehead height = 0.252em**, so `fontSize = staffSpace / 0.252`
- **notehead centre sits 0.134em above the alphabetic baseline**

Both were read off the glyph bounds of `U+1D15D` (the whole note, which is a
bare head with no stem) at `unitsPerEm = 1000`, and they agree with the figures
handoff 10 §1.3 quotes. `tests/notation.test.ts` pins them; if the font is ever
replaced, re-measure rather than assuming they carry over.
