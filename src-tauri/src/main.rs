// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod midi;

fn main() {
    tauri::Builder::default()
        // Parks the live MIDI connection so it is never dropped mid-session.
        .manage(midi::MidiState::default())
        .invoke_handler(tauri::generate_handler![
            midi::list_midi_ports,
            midi::open_midi_port,
            midi::close_midi_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rhythm Trainer");
}
