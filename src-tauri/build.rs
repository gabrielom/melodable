fn main() {
    // `generate_context!` embeds the app icon into the binary at compile time —
    // on macOS in dev that icns *is* the Dock icon, since there is no .app
    // bundle to read one from. tauri-build emits rerun-if-changed for the
    // config, the capabilities and resources, but not for the icons, so
    // editing an icon leaves Cargo with no reason to recompile and the old
    // artwork stays baked in. `tauri build` hides this by compiling a
    // different profile from scratch; `tauri dev` shows the stale icon
    // indefinitely.
    println!("cargo:rerun-if-changed=icons");

    tauri_build::build()
}
