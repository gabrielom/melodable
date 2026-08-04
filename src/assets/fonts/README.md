# Geist

Self-hosted subset of the [Geist](https://vercel.com/font) family — the
typefaces the trainer redesign specifies. Vendored rather than pulled from the
`geist` npm package, which depends on Next.js, and rather than Google Fonts,
because the app must render offline inside the Tauri webview.

Five files, the only weights the UI uses:

| File | Used for |
|---|---|
| `Geist-Regular.woff2` | body copy, dropdown rows |
| `Geist-Medium.woff2` | lesson title |
| `Geist-SemiBold.woff2` | home heading, lesson-card names, summary title |
| `GeistMono-Regular.woff2` | score labels |
| `GeistMono-Medium.woff2` | control labels, lane names, tempo, score values |

Licensed under the SIL Open Font License 1.1 — see `LICENSE.txt`. Wired up by
the `@font-face` block at the top of `src/styles.css`.

## Why SemiBold is here

The UI asks for `font-weight: 600` in four places. With only 400 and 500
present the browser took the 500 and *synthesised* the extra weight by
thickening its outlines, which reads as ragged, blobby headings — counters
filling in, terminals smearing. It is easy to miss because it is invisible to
measurement: `measureText` reported the same advance width for 500, 600 and
700. If a new weight is ever asked for, vendor the face rather than letting
the browser fake it.
