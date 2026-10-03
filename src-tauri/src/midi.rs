//! MIDI input bridge.
//!
//! Why this lives in Rust instead of the frontend: Tauri renders with the OS
//! webview (WebKit on macOS/Linux), and WebKit does not implement the Web MIDI
//! API. So we own the MIDI connection natively with `midir` and push every
//! message to the Vue side as a Tauri event.
//!
//! IMPORTANT: a `MidiInputConnection` closes as soon as it is dropped, so the
//! live connection is parked in `MidiState` for the lifetime of the app.

use std::sync::Mutex;

use midir::{Ignore, MidiInput, MidiInputConnection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Holds the currently open input connections so they aren't dropped.
///
/// `companion` is the controller's DAW port, opened beside its MIDI port. A
/// Launchkey sends its drum pads down the MIDI port until a DAW takes it over
/// — Ableton's control-surface script does, the moment Live opens — and from
/// then on the pads are expected on the DAW port instead. Everything it
/// carries is passed up, tagged `port: "daw"`: the MIDI monitor shows all of
/// it, and the frontend decides what reaches the trainer (`isDrumPadNote`).
#[derive(Default)]
pub struct MidiState {
    pub conn: Mutex<Option<MidiInputConnection<()>>>,
    pub companion: Mutex<Option<MidiInputConnection<()>>>,
}

/// One parsed MIDI message, shipped to the frontend as `midi://message`.
#[derive(Serialize, Clone, Debug)]
pub struct MidiMsg {
    /// "noteon" | "noteoff" | "cc" | "other"
    pub kind: String,
    /// Note number for note events, controller number for CC.
    pub note: u8,
    /// Velocity for note events, value for CC.
    pub velocity: u8,
    /// 0-15
    pub channel: u8,
    /// The raw status byte, so the monitor can name a message `kind` calls
    /// "other" (aftertouch, pitch bend, program change).
    pub status: u8,
    /// "main" for the port the player chose, "daw" for its companion.
    pub port: &'static str,
    /// midir's monotonic timestamp in microseconds. Grade timing against this,
    /// not against the moment the event reaches JS.
    #[serde(rename = "timestampMicros")]
    pub timestamp_micros: u64,
}

/// List the names of every available MIDI input port, in index order.
#[tauri::command]
pub fn list_midi_ports() -> Result<Vec<String>, String> {
    let input = MidiInput::new("melodable-scan").map_err(|e| e.to_string())?;
    let ports = input.ports();
    let mut names = Vec::with_capacity(ports.len());
    for port in ports.iter() {
        names.push(
            input
                .port_name(port)
                .unwrap_or_else(|_| "Unknown device".to_string()),
        );
    }
    Ok(names)
}

/// Open the port at `index` and start streaming messages to the frontend.
/// Returns the port name on success. Any previously open port is closed first,
/// and so is its companion — the frontend opens a new one if the new port
/// has one.
#[tauri::command]
pub fn open_midi_port(
    app: AppHandle,
    state: State<'_, MidiState>,
    index: usize,
) -> Result<String, String> {
    // Close whatever was open before (dropping the old connections).
    *state.companion.lock().map_err(|e| e.to_string())? = None;
    *state.conn.lock().map_err(|e| e.to_string())? = None;

    let (name, conn) = connect(app, index, "melodable-in", "main")?;
    *state.conn.lock().map_err(|e| e.to_string())? = Some(conn);
    Ok(name)
}

/// Open the port at `index` as the companion of the one already open (see
/// `MidiState`). Replaces any earlier companion.
#[tauri::command]
pub fn open_midi_companion(
    app: AppHandle,
    state: State<'_, MidiState>,
    index: usize,
) -> Result<String, String> {
    *state.companion.lock().map_err(|e| e.to_string())? = None;
    let (name, conn) = connect(app, index, "melodable-daw", "daw")?;
    *state.companion.lock().map_err(|e| e.to_string())? = Some(conn);
    Ok(name)
}

fn connect(
    app: AppHandle,
    index: usize,
    conn_name: &str,
    port_tag: &'static str,
) -> Result<(String, MidiInputConnection<()>), String> {
    let mut input = MidiInput::new("melodable").map_err(|e| e.to_string())?;
    // We want everything except active-sensing noise; sysex/timing are ignored.
    input.ignore(Ignore::All);

    let ports = input.ports();
    let port = ports
        .get(index)
        .ok_or_else(|| format!("MIDI input port {index} not found"))?
        .clone();

    let name = input
        .port_name(&port)
        .unwrap_or_else(|_| "Unknown device".to_string());

    let conn = input
        .connect(
            &port,
            conn_name,
            move |stamp, message, _| {
                if message.is_empty() {
                    return;
                }
                let status = message[0] & 0xF0;
                let channel = message[0] & 0x0F;
                let d1 = *message.get(1).unwrap_or(&0);
                let d2 = *message.get(2).unwrap_or(&0);

                // A note-on with velocity 0 is the conventional note-off.
                let (kind, note, velocity) = match status {
                    0x90 if d2 > 0 => ("noteon", d1, d2),
                    0x80 | 0x90 => ("noteoff", d1, d2),
                    0xB0 => ("cc", d1, d2),
                    _ => ("other", d1, d2),
                };

                let _ = app.emit(
                    "midi://message",
                    MidiMsg {
                        kind: kind.to_string(),
                        note,
                        velocity,
                        channel,
                        status: message[0],
                        port: port_tag,
                        timestamp_micros: stamp,
                    },
                );
            },
            (),
        )
        .map_err(|e| e.to_string())?;

    Ok((name, conn))
}

/// Close the active MIDI input port, if any.
#[tauri::command]
pub fn close_midi_port(state: State<'_, MidiState>) -> Result<(), String> {
    *state.companion.lock().map_err(|e| e.to_string())? = None;
    *state.conn.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
