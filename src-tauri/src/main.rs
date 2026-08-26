// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod link;
mod midi;

fn main() {
    tauri::Builder::default()
        // Persists settings + last lesson (see src/stores/persist.ts).
        .plugin(tauri_plugin_store::Builder::new().build())
        // Parks the live MIDI connection so it is never dropped mid-session.
        .manage(midi::MidiState::default())
        // Holds the Ableton Link session for the app's lifetime.
        .manage(link::LinkHandle::default())
        .invoke_handler(tauri::generate_handler![
            midi::list_midi_ports,
            midi::open_midi_port,
            midi::close_midi_port,
            link::link_available,
            link::link_enable,
            link::link_set_tempo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Melodable");
}
