# Playing along with Ableton Live

**Goal:** you play your controller, **Ableton makes the sound** (its instruments,
your track), while **Melodable shows the falling notes and grades your timing**.
The two apps never exchange audio — they just both listen to the same MIDI.

This is the "external sound" workflow. To keep the two apps on the same grid as
well, turn on Ableton Link — see [Tempo & phase sync](#tempo--phase-sync) at the
bottom.

---

## 1. Switch Melodable to DAW sound

In the toolbar, set **SOUND → `Ableton / DAW`**. Melodable's built‑in synth goes
silent; it still flashes pads, drops falling notes, and scores every hit. Leave
it on `Synth` if you want Melodable to make the sound itself.

You can independently turn the **Click** (metronome + count‑in click) off in the
transport controls if you'd rather take the beat from Ableton. The visual
count‑in (4·3·2·1) still shows either way.

> The AudioContext still starts in DAW mode even though nothing is audible —
> the transport clock lives on it. Click **Enable audio** once, as usual.

## 2. Get your controller's MIDI into *both* apps (macOS)

MIDI has to reach Ableton **and** Melodable. On macOS CoreMIDI a single hardware
input can be opened by several apps at once, so you have two good options.

### Option A — both apps listen to the controller directly (simplest)

1. In **Ableton → Settings → Link/Tempo/MIDI**, enable **Track** (and
   **Remote** if you use it) for your controller under *MIDI Ports → Input*.
2. In **Melodable**, hit **⟳** and pick the **same controller** from the MIDI‑IN
   dropdown.
3. Play. Ableton's armed track makes the sound; Melodable tracks the timing.

Nothing routes *through* Ableton here — both apps independently hear the pads.

### Option B — route through Ableton via the IAC bus

Use this if you want Ableton to process/remap the MIDI first (e.g. a Drum Rack
mapping) and have Melodable see the *result*.

1. **Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver →** tick
   **Device is online**. Keep the default "Bus 1".
2. In Ableton, on the track receiving your controller, set **MIDI To →
   IAC Driver (Bus 1)** and set **Monitor** to **In** (so it echoes while you
   play). The track's instrument still sounds locally.
3. In **Melodable**, pick **IAC Driver Bus 1** as the MIDI input.

Now: controller → Ableton (sound + optional remap) → IAC → Melodable (tracking).

> **Windows note:** WinMM MIDI inputs are *exclusive* — only one app can open a
> given port. On Windows you'd need a virtual‑MIDI tool (e.g. loopMIDI) and route
> like Option B. On the Mac this isn't a concern.

## 3. Match the pad mapping

Melodable lights/scores pads from General‑MIDI drum notes (36 = kick, 38 = snare,
42 = closed hat, …) via `GM_TO_PAD` in `src/engine/gm.ts`. If your controller or
Ableton Drum Rack sends different note numbers, watch the **MIDI monitor** (right
panel) while you hit a pad, note the number, and extend `GM_TO_PAD`. Unmapped
notes simply won't score.

## 4. Grading & latency (what to expect)

Melodable grades the instant you **strike** the pad — it timestamps the MIDI
message (`midir` timestamp, mapped onto the audio clock) rather than when the
sound comes back. So even if Ableton's output has some latency, your *score* is
still fair. You may perceive a small gap between a note visually landing and
hearing Ableton — that's Ableton's output latency, and the M7 calibration screen
is where a fixed input/audio offset will be dialled in later.

---

## Tempo & phase sync

Melodable follows **Ableton Link** (M6). Link shares tempo and beat phase
between apps on the same machine or local network — no cables, no MIDI routing,
and it works alongside everything in sections 1–4.

### Turning it on

1. In Ableton: **Settings → Link / Tempo / MIDI → Link: Show / On**.
2. In Melodable: click the **chain icon** in the transport bar, left of the MIDI
   device menu. It turns teal and shows the peer count as a small badge.
3. Hit ▶ Play. The trainer's loop now rides Ableton's grid: the loop boundary
   lands on Ableton's, and moving Ableton's tempo moves the trainer.

The tempo slider still works while linked — dragging it *proposes* the tempo to
the whole session, so Melodable can drive Ableton as well as follow it. That's
normal Link behaviour, the same as between two Live sets.

### How it works

- `src-tauri/src/link.rs` owns the session and polls it at ~30 Hz, emitting
  `link://state` — the same Rust→Vue event pattern as MIDI. The `AblLink`
  instance is built when you *join* and dropped when you leave, never held open
  from app launch — see below.

### Why joining must not change Ableton's tempo

When two Link sessions meet, the one that has been running longer wins the
merge, and its timeline — tempo included — is adopted by everyone else. Link
measures "longer" from the moment the instance was **constructed**: `initXForm`
in Link's `Controller.hpp` maps construction to ghost time 0, and `Sessions.hpp`
picks the session with the larger ghost time.

Melodable used to build its `AblLink` at app launch. If the app had been open
longer than the Link instance inside Live, Melodable's session was the older one,
so it won — and pushed its own seed tempo of **120** onto your running set the
moment you switched the chain icon on. Building the instance at the moment of
joining makes Melodable the newcomer, and the newcomer is the one that adopts.
Leaving drops it again, so the next join is a newcomer too.
- Each snapshot carries Link's own clock reading. The frontend maps that onto
  the `AudioContext` clock (`src/engine/host-clock.ts`, shared with the midir
  path) so a slow event delivery can't skew the phase we align to.
- `useTrainer` closes the gap: `Transport.setBpm` for tempo, `Transport.anchorTo`
  for phase. Corrections under 3 ms are ignored, so a locked transport isn't
  jittered 30 times a second.
- Link's quantum is the *lesson's loop length*, so a 2-bar lesson lines up with
  Ableton every 2 bars rather than every beat.
- ▶ Play does not start the run where you pressed it. `Transport.start` takes
  the grid Link last described and pins beat 0 to it, so the count-in begins on
  a boundary and the follower has nothing left to correct. Without that the run
  started at whatever phase the press landed on and was dragged onto the grid a
  frame later — up to half a loop, which ate the count-in it landed in and
  dropped the clicks it skipped. The gap between the press and the count-in is
  silent and never longer than one loop.

### What it can and cannot line up

Tempo and beat are exact: Melodable follows Ableton's clock, and the alignment
comes from Link's *phase*, which is derived from the session's own beat grid.

Which **bar** of your loop the lesson starts on is not something Link can settle.
Phase names a boundary of some quantum, and the two apps do not use the same
one — Ableton's is a bar, ours is the whole lesson loop — so a 2-bar lesson
against a 4-bar Ableton loop begins on bar 1 or bar 3, fixed for the session but
decided by where Ableton's transport started against a session timeline neither
app chose. **Link puts your loop length on the wire nowhere.** A 1-bar lesson
lands on one of your downbeats every time; longer ones may sit a bar in.

Ableton's *transport start* looks like the answer to that and is not:
`time_for_is_playing` is the time of an event, not of a beat, so aligning to it
takes a loop that was on the beat and pulls it off. It was tried and reverted —
it traded the downbeat for the bar, which is the worse of the two.

### Building it

Link needs CMake (`brew install cmake`) because `rusty_link` compiles the C++
Link library. It is behind a cargo feature, on by default:

```sh
cargo build                        # with Link
cargo build --no-default-features  # without — the chain icon simply hides
```

### The lighter alternative, if you ever want it

Ableton can also send **MIDI Clock + Start/Stop** out a port (e.g. IAC), and
Melodable already has a native MIDI path. Teaching it to read clock (`0xF8`) and
Start (`0xFA`) would need no extra Rust dependencies and no CMake — the bridge
currently filters clock (`Ignore::All` in `src-tauri/src/midi.rs`). Link is
better (bidirectional, phase-accurate, no routing to set up), so this is only
worth doing if CMake is a problem on your build machine.
