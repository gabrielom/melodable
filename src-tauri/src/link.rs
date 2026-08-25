//! Ableton Link bridge (M6).
//!
//! Link shares *tempo and beat phase* across apps on a local network — not
//! audio, not MIDI content. Ableton Live has it built in (Settings → Link), so
//! enabling it here lets the trainer's loop ride Ableton's grid: falling notes
//! land on the set's downbeats, and moving Ableton's tempo moves the trainer.
//!
//! Built behind the `link` cargo feature because `rusty_link` needs CMake. With
//! the feature off every command still exists and reports "unavailable", so the
//! app compiles, runs, and simply hides the toggle.
//!
//! Shape mirrors `midi.rs`: state parked in Tauri state for the app's lifetime,
//! updates pushed to Vue as events (`link://state`). The frontend maps
//! `clockMicros` onto the AudioContext clock the same way it does midir
//! timestamps — see `src/engine/host-clock.ts`.
//!
//! The `#[tauri::command]` functions must sit in this module rather than in the
//! cfg'd `imp` submodule: `generate_handler!` looks up hidden items the macro
//! generates beside each function, and those don't travel through a re-export.

use serde::Serialize;
use tauri::{AppHandle, State};

/// A snapshot of the Link session, pushed to the frontend as `link://state`.
///
/// `phase` is measured against `quantum` (the trainer's loop length in beats),
/// so phase 0 is a loop boundary both apps agree on.
#[derive(Serialize, Clone, Debug, Default)]
pub struct LinkState {
    /// False when the build has no Link support, or Link is switched off.
    pub enabled: bool,
    /// True when this build can do Link at all (the `link` feature).
    pub available: bool,
    pub tempo: f64,
    /// Position within the current quantum, 0..quantum.
    pub phase: f64,
    /// Other Link participants on the network (Ableton counts as one).
    pub peers: u64,
    /// Link's clock reading for this snapshot. The frontend maps it onto the
    /// audio clock, so a slow event delivery can't skew the phase we align to.
    #[serde(rename = "clockMicros")]
    pub clock_micros: i64,
}

pub use imp::LinkHandle;

/// True when this build can do Link at all.
#[tauri::command]
pub fn link_available() -> bool {
    cfg!(feature = "link")
}

/// Join or leave the Link session. `quantum` is the trainer's loop length in
/// beats, so both sides agree on where a loop boundary is. Returns the state
/// right after the change so the UI doesn't wait for the next poll.
#[tauri::command]
pub fn link_enable(
    app: AppHandle,
    state: State<'_, LinkHandle>,
    enabled: bool,
    quantum: f64,
) -> Result<LinkState, String> {
    if !(quantum.is_finite() && quantum > 0.0) {
        return Err(format!("invalid quantum {quantum}"));
    }
    imp::enable(app, state, enabled, quantum)
}

/// Propose a tempo to the whole session — the trainer's slider driving Ableton,
/// rather than the other way round.
#[tauri::command]
pub fn link_set_tempo(state: State<'_, LinkHandle>, bpm: f64) -> Result<(), String> {
    if !(bpm.is_finite() && bpm > 0.0) {
        return Err(format!("invalid tempo {bpm}"));
    }
    imp::set_tempo(state, bpm)
}

// ---------------------------------------------------------------- with Link

#[cfg(feature = "link")]
mod imp {
    use super::LinkState;
    use rusty_link::{AblLink, SessionState};
    use std::sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    };
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager, State};

    /// How often the poll thread samples the session and emits.
    const POLL: Duration = Duration::from_millis(33); // ~30 Hz
    /// How often it looks up again while Link is switched off.
    const IDLE: Duration = Duration::from_millis(250);

    pub struct LinkHandle {
        link: AblLink,
        /// Loop length in beats, as f64 bits — the trainer sets it per lesson.
        quantum: AtomicU64,
        /// Whether the poll thread has been spawned yet.
        polling: AtomicBool,
        /// Serialises the capture/commit pairs below, which are read-modify-write.
        commit: Mutex<()>,
    }

    impl Default for LinkHandle {
        fn default() -> Self {
            Self {
                // Link needs a starting tempo; a peer's tempo wins once we join.
                link: AblLink::new(120.0),
                quantum: AtomicU64::new(4.0f64.to_bits()),
                polling: AtomicBool::new(false),
                commit: Mutex::new(()),
            }
        }
    }

    impl LinkHandle {
        fn snapshot(&self) -> LinkState {
            let quantum = f64::from_bits(self.quantum.load(Ordering::Relaxed));
            let mut session = SessionState::new();
            self.link.capture_app_session_state(&mut session);
            let now = self.link.clock_micros();
            LinkState {
                enabled: self.link.is_enabled(),
                available: true,
                tempo: session.tempo(),
                phase: session.phase_at_time(now, quantum),
                peers: self.link.num_peers(),
                clock_micros: now,
            }
        }
    }

    impl Drop for LinkHandle {
        fn drop(&mut self) {
            // Leaving the session on the way out is polite to other peers.
            self.link.enable(false);
        }
    }

    pub fn enable(
        app: AppHandle,
        state: State<'_, LinkHandle>,
        enabled: bool,
        quantum: f64,
    ) -> Result<LinkState, String> {
        state.quantum.store(quantum.to_bits(), Ordering::Relaxed);
        state.link.enable(enabled);

        // Spawn the poll thread once, on first enable. Toggling Link off idles
        // it rather than tearing it down and respawning.
        if enabled && !state.polling.swap(true, Ordering::SeqCst) {
            let handle = app.clone();
            std::thread::spawn(move || loop {
                let Some(link) = handle.try_state::<LinkHandle>() else {
                    return; // app is shutting down
                };
                if link.link.is_enabled() {
                    let _ = handle.emit("link://state", link.snapshot());
                    std::thread::sleep(POLL);
                } else {
                    std::thread::sleep(IDLE);
                }
            });
        }

        Ok(state.snapshot())
    }

    pub fn set_tempo(state: State<'_, LinkHandle>, bpm: f64) -> Result<(), String> {
        let mut session = SessionState::new();
        let _guard = state.commit.lock().map_err(|e| e.to_string())?;
        state.link.capture_app_session_state(&mut session);
        session.set_tempo(bpm, state.link.clock_micros());
        state.link.commit_app_session_state(&session);
        Ok(())
    }
}

// ------------------------------------------------------------- without Link

#[cfg(not(feature = "link"))]
mod imp {
    use super::LinkState;
    use tauri::{AppHandle, State};

    /// Nothing to hold, but Tauri still needs the state type to exist.
    #[derive(Default)]
    pub struct LinkHandle;

    pub fn enable(
        _app: AppHandle,
        _state: State<'_, LinkHandle>,
        _enabled: bool,
        _quantum: f64,
    ) -> Result<LinkState, String> {
        // available:false — the UI hides the toggle rather than failing loudly.
        Ok(LinkState::default())
    }

    pub fn set_tempo(_state: State<'_, LinkHandle>, _bpm: f64) -> Result<(), String> {
        Ok(())
    }
}
