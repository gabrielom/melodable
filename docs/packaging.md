# Packaging and signing

M7's shipping half. Building an installer needs nothing but the toolchain;
*signing* one needs credentials from Apple and from a certificate authority,
and none of them live in this repository.

---

## Building locally

```sh
npm run tauri build            # installers for the machine you are on
npm run tauri build -- --debug # same, with the devtools still in
```

Output lands in `src-tauri/target/release/bundle/`: a `.dmg` and `.app` on
macOS, `.deb`/`.rpm`/`.AppImage` on Linux, `.exe`/`.msi` on Windows.

Prerequisites beyond Rust and Node:

- **CMake 3.14+** — `rusty_link` compiles the C++ Ableton Link library. Without
  it the build fails deep inside a `cc` invocation rather than saying so.
  `brew install cmake`, or `apt install cmake`.
- **Linux only**: `libwebkit2gtk-4.1-dev`, `libasound2-dev`, `pkg-config`,
  `patchelf`, `librsvg2-dev`.

Building without Link at all — no CMake needed, and the chain icon hides
itself:

```sh
npm run tauri build -- --no-default-features
```

## Building for release

`.github/workflows/release.yml` builds all four artefacts (Apple Silicon,
Intel Mac, Linux, Windows) from one tag and opens a **draft** release:

```sh
npm version patch          # or minor / major — updates package.json
# bump "version" in src-tauri/tauri.conf.json to match, then:
git tag v0.1.1 && git push --tags
```

It also runs on `workflow_dispatch`, which is how you find out the matrix is
broken before release day rather than during it.

> The version lives in **two** files — `package.json` and
> `src-tauri/tauri.conf.json` — and nothing checks that they agree. The one in
> `tauri.conf.json` is what the installer carries.

## Signing

The workflow reads every credential from repository secrets. **Leave them
unset and it still completes**, producing unsigned artefacts — installable
past a Gatekeeper or SmartScreen warning, fine for your own machine and not
fine for anyone else's.

### macOS

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | Developer ID Application `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting it |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | The Apple ID that owns the team |
| `APPLE_PASSWORD` | An **app-specific** password, not the account password |
| `APPLE_TEAM_ID` | The 10-character team identifier |

Export the certificate with
`security export -k login.keychain -t identities -f pkcs12 -o cert.p12`, then
`base64 -i cert.p12 | pbcopy`. Notarisation runs automatically once
`APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` are all present.

### Windows

| Secret | What it is |
| --- | --- |
| `WINDOWS_CERTIFICATE` | An Authenticode `.pfx`, base64-encoded |
| `WINDOWS_CERTIFICATE_PASSWORD` | Its password |

### Linux

Nothing to sign. `.deb` and `.AppImage` are distributed unsigned; repository
signing is a separate exercise and only matters if you publish to one.

## The bundle identifier

`io.github.gabrielom.melodable`. Reverse-DNS of a namespace that is
demonstrably ours — Apple does not verify domain ownership, but the convention
wants something you control, and a GitHub account qualifies. Swap it for
`com.<yourdomain>.melodable` if you register one.

**Changing it again resets the app.** The identifier is what decides where the
Tauri store keeps its file, so a new one means a fresh install as far as
settings, calibration, practice history and imported clips are concerned. It
was changed once already, from the `com.local.rhythmtrainer` placeholder, while
the only data at risk was the author's. Past that point it needs a migration
rather than a rename.

## What is not here

- **No auto-updater.** Tauri's updater needs a signing keypair and somewhere to
  host a manifest; the plan does not ask for it, so it is not wired in.
- **No 16px app icon.** `npm run icons` starts at 32px because the design brief
  (§15) asks for hand-tuned geometry at that size rather than a mechanical
  downscale.
