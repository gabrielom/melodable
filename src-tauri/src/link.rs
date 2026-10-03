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
    bpm: f64,
) -> Result<LinkState, String> {
    if !(quantum.is_finite() && quantum > 0.0) {
        return Err(format!("invalid quantum {quantum}"));
    }
    if !(bpm.is_finite() && bpm > 0.0) {
        return Err(format!("invalid tempo {bpm}"));
    }
    imp::enable(app, state, enabled, quantum, bpm)
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
        /// Built on the first *enable*, never at startup — see `enable`. Also
        /// dropped on disable, so every join is by a freshly built instance.
        /// The mutex serialises that against the poll thread, and against the
        /// capture/commit pair in `set_tempo`, which is read-modify-write.
        link: Mutex<Option<AblLink>>,
        /// Loop length in beats, as f64 bits — the trainer sets it per lesson.
        quantum: AtomicU64,
        /// Whether the poll thread has been spawned yet.
        polling: AtomicBool,
    }

    impl Default for LinkHandle {
        fn default() -> Self {
            Self {
                link: Mutex::new(None),
                quantum: AtomicU64::new(4.0f64.to_bits()),
                polling: AtomicBool::new(false),
            }
        }
    }

    impl LinkHandle {
        fn snapshot(&self) -> LinkState {
            let quantum = f64::from_bits(self.quantum.load(Ordering::Relaxed));
            let guard = match self.link.lock() {
                Ok(g) => g,
                Err(_) => return LinkState { available: true, ..LinkState::default() },
            };
            let Some(link) = guard.as_ref() else {
                // Built but never joined: available, switched off, nothing to say.
                return LinkState { available: true, ..LinkState::default() };
            };
            let mut session = SessionState::new();
            link.capture_app_session_state(&mut session);
            let now = link.clock_micros();
            LinkState {
                enabled: link.is_enabled(),
                available: true,
                tempo: session.tempo(),
                phase: session.phase_at_time(now, quantum),
                peers: link.num_peers(),
                clock_micros: now,
            }
        }
    }

    impl Drop for LinkHandle {
        fn drop(&mut self) {
            // Leaving the session on the way out is polite to other peers.
            if let Ok(mut slot) = self.link.lock() {
                if let Some(link) = slot.take() {
                    link.enable(false);
                }
            }
        }
    }

    /// Join or leave the session.
    ///
    /// **The `AblLink` is built here rather than in `Default`, and dropped
    /// again on leaving.** When two Link sessions meet, the one that has been
    /// running longer wins the merge and its timeline — tempo included — is
    /// adopted by everyone else. Link measures "longer" from the moment the
    /// instance was constructed: `initXForm` in Link's `Controller.hpp` maps
    /// construction to ghost time 0, and `Sessions.hpp` prefers the session
    /// with the larger ghost time. An instance alive since app launch is
    /// therefore older than the one inside a DAW the user opened afterwards,
    /// so *we* won and pushed our own seed tempo of 120 onto their running set.
    /// Building it at the moment of joining makes us the newcomer instead, and
    /// the newcomer is the one that adopts.
    pub fn enable(
        app: AppHandle,
        state: State<'_, LinkHandle>,
        enabled: bool,
        quantum: f64,
        bpm: f64,
    ) -> Result<LinkState, String> {
        state.quantum.store(quantum.to_bits(), Ordering::Relaxed);
        {
            let mut slot = state.link.lock().map_err(|e| e.to_string())?;
            if enabled {
                // Seeded with the tempo on screen, not a constant. A founding
                // instance's tempo becomes the session's, and a stray 120 that
                // appears nowhere in the UI is the worst possible thing to hand
                // a set that is already playing.
                slot.get_or_insert_with(|| AblLink::new(bpm)).enable(true);
            } else if let Some(link) = slot.take() {
                link.enable(false);
            }
        }

        // Spawn the poll thread once, on first enable. Toggling Link off idles
        // it rather than tearing it down and respawning.
        if enabled && !state.polling.swap(true, Ordering::SeqCst) {
            let handle = app.clone();
            std::thread::spawn(move || loop {
                let Some(state) = handle.try_state::<LinkHandle>() else {
                    return; // app is shutting down
                };
                let snap = state.snapshot();
                if snap.enabled {
                    let _ = handle.emit("link://state", snap);
                    std::thread::sleep(POLL);
                } else {
                    std::thread::sleep(IDLE);
                }
            });
        }

        Ok(state.snapshot())
    }

    pub fn set_tempo(state: State<'_, LinkHandle>, bpm: f64) -> Result<(), String> {
        let slot = state.link.lock().map_err(|e| e.to_string())?;
        let Some(link) = slot.as_ref() else { return Ok(()) };
        let mut session = SessionState::new();
        link.capture_app_session_state(&mut session);
        session.set_tempo(bpm, link.clock_micros());
        link.commit_app_session_state(&session);
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
        _bpm: f64,
    ) -> Result<LinkState, String> {
        // available:false — the UI hides the toggle rather than failing loudly.
        Ok(LinkState::default())
    }

    pub fn set_tempo(_state: State<'_, LinkHandle>, _bpm: f64) -> Result<(), String> {
        Ok(())
    }
}
