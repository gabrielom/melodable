# Playing along with Ableton Live

**Goal:** you play your controller, **Ableton makes the sound** (its instruments,
your track), while **Melodable shows the falling notes and grades your timing**.
The two apps never exchange audio — they just both listen to the same MIDI.

This is the "external sound" workflow. It works today for the pad trainer. The
one thing it does *not* yet do is lock Melodable's tempo and downbeat to
Ableton's transport automatically — see [Tempo & phase sync](#tempo--phase-sync)
at the bottom for where that stands.

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

**Today:** Melodable runs its **own** transport. You hit ▶ Play, get a one‑bar
count‑in, and the lesson loops at its own BPM (adapting as you play). Ableton is
the *sound source*; it isn't driving Melodable's clock. This is the workflow to
test first — pick a lesson, play along, hear your Ableton kit.

If you also run a **backing track** in Ableton, nothing keeps the two transports
phase‑locked yet, so they'll drift. Two ways to close that gap, in order of how
much work they are:

- **MIDI Clock follow (lighter).** Ableton can send MIDI Clock + Start/Stop out a
  port (e.g. IAC). Melodable already has a native MIDI path; teaching it to read
  clock (`0xF8`) and Start (`0xFA`) would let the transport derive Ableton's
  tempo and align its downbeat — no extra Rust dependencies. The Rust bridge
  currently filters clock (`Ignore::All` in `src-tauri/src/midi.rs`); that and a
  small clock‑follower on the frontend are the whole job.
- **Ableton Link (the planned M6).** Bidirectional tempo + beat‑phase sync via
  `rusty_link`. This is the "proper" solution in `build_plan.html` §11b and needs
  CMake to build the Link library.

Neither is built yet — they're the next real step for true play‑along. Everything
in sections 1–4 above works without them.
