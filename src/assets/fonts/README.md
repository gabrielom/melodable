# Geist

Self-hosted subset of the [Geist](https://vercel.com/font) family — the
typefaces the trainer redesign specifies. Vendored rather than pulled from the
`geist` npm package, which depends on Next.js, and rather than Google Fonts,
because the app must render offline inside the Tauri webview.

Four files, the only weights the UI uses:

| File | Used for |
|---|---|
| `Geist-Regular.woff2` | body copy, dropdown rows |
| `Geist-Medium.woff2` | lesson title |
| `GeistMono-Regular.woff2` | score labels |
| `GeistMono-Medium.woff2` | control labels, lane names, tempo, score values |

Licensed under the SIL Open Font License 1.1 — see `LICENSE.txt`. Wired up by
the `@font-face` block at the top of `src/styles.css`.
