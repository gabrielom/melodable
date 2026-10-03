/**
 * Web Audio engine: a synthesized drum kit, a polyphonic piano voice, and a
 * metronome click. Everything is scheduled against `AudioContext.currentTime`,
 * which is also the clock the transport and scorer grade against.
 *
 * No samples required — the whole kit is synthesized, so the bundle stays tiny.
 * Swap in AudioBuffer playback later without touching callers.
 */

import type { DrumType } from "./gm";

/**
 * The three things that make sound, each on its own fader. They are separate
 * because they compete: the click has to cut through while you are learning
 * and get out of the way once you are not, and the guide part needs to sit
 * under your own playing rather than alongside it.
 */
export type Bus = "notes" | "guide" | "metronome";

export const BUSES: readonly Bus[] = ["notes", "guide", "metronome"];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** Levels set before `init` — kept so hydration order cannot lose them. */
  private pending: Record<Bus, number> = { notes: 1, guide: 1, metronome: 1 };

  /** Must be called from a user gesture (browsers block autoplay). */
  async init(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      // Fixed headroom. There is no master fader in the UI; the three buses
      // below are what the player actually adjusts.
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      const bus = () => {
        const g = this.ctx!.createGain();
        g.connect(this.master!);
        return g;
      };
      this.buses = { notes: bus(), guide: bus(), metronome: bus() };
      for (const b of BUSES) this.buses[b].gain.value = this.pending[b];
      this.noiseBuffer = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Current audio clock in seconds. The single source of truth for timing. */
  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Level for one bus, 0..1. Safe to call before `init` — the value is held
   * and applied when the context is created, so settings that hydrate before
   * the first user gesture are not lost.
   */
  setBusVolume(bus: Bus, v: number): void {
    const level = Math.max(0, Math.min(1, v));
    this.pending[bus] = level;
    if (this.buses) this.buses[bus].gain.value = level;
  }

  /** Where a voice should land. Falls back to master before `init`. */
  private out(bus: Bus): GainNode {
    return this.buses ? this.buses[bus] : this.master!;
  }

  /**
   * Drop anything already queued on these buses.
   *
   * The metronome and the guide part are scheduled up to a second ahead of
   * the playhead, so they are sitting in the audio graph with future start
   * times long before you hear them. Stopping the transport stops *adding* to
   * that queue; it does not empty it, which is why the click used to carry on
   * for a beat or two after Stop.
   *
   * Rather than track and chase every scheduled source, the bus node itself
   * is replaced: disconnecting the old one takes everything still pointing at
   * it out of the graph in one move, and a fresh node takes over at the same
   * level. The orphans finish silently and are collected. Deliberately not
   * used on "notes" — your own hits are immediate, and a stray tail there
   * would be a note you actually played.
   */
  cancelScheduled(...buses: Bus[]): void {
    if (!this.ctx || !this.master || !this.buses) return;
    for (const b of buses) {
      const old = this.buses[b];
      old.disconnect();
      const fresh = this.ctx.createGain();
      fresh.gain.value = old.gain.value;
      fresh.connect(this.master);
      this.buses[b] = fresh;
    }
  }

  // ---------------------------------------------------------------- helpers

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Percussive envelope: near-instant attack, exponential decay. */
  private env(node: AudioNode, t: number, peak: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    node.connect(g);
    return g;
  }

  // ------------------------------------------------------------------ drums

  /**
   * Fire a drum voice. `at` defaults to now; pass a future time to schedule
   * (the metronome and guide track rely on this).
   */
  playDrum(type: DrumType, at?: number, vol = 1, bus: Bus = "notes"): void {
    if (!this.ctx || !this.master) return;
    const t = at ?? this.ctx.currentTime;
    const out = this.out(bus);

    const tom = (f0: number, f1: number, dec: number) => {
      const o = this.ctx!.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.9);
      this.env(o, t, 0.9 * vol, dec).connect(out);
      o.start(t);
      o.stop(t + dec + 0.02);
    };

    const hat = (dec: number, hp: number) => {
      const s = this.noise();
      const f = this.filter("highpass", hp, 0.7);
      s.connect(f);
      this.env(f, t, 0.5 * vol, dec).connect(out);
      s.start(t);
      s.stop(t + dec + 0.02);
    };

    switch (type) {
      case "kick":
      case "kick2": {
        const o = this.ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(type === "kick2" ? 180 : 150, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
        this.env(o, t, 1.0 * vol, 0.22).connect(out);
        o.start(t);
        o.stop(t + 0.25);
        // click transient
        const c = this.noise();
        const cf = this.filter("lowpass", 1200);
        c.connect(cf);
        this.env(cf, t, 0.25 * vol, 0.03).connect(out);
        c.start(t);
        c.stop(t + 0.05);
        break;
      }
      case "snare":
      case "snare2": {
        const o = this.ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = type === "snare2" ? 210 : 180;
        this.env(o, t, 0.5 * vol, 0.12).connect(out);
        o.start(t);
        o.stop(t + 0.15);
        const s = this.noise();
        const f = this.filter("highpass", 1400, 0.6);
        s.connect(f);
        this.env(f, t, 0.7 * vol, 0.16).connect(out);
        s.start(t);
        s.stop(t + 0.2);
        break;
      }
      case "hatClosed":
        hat(0.035, 7000);
        break;
      case "hatOpen":
        hat(0.32, 6500);
        break;
      case "shaker":
        hat(0.05, 6800);
        break;
      case "clap": {
        const f = this.filter("bandpass", 1200, 1.2);
        f.connect(out);
        [0, 0.012, 0.024].forEach((d, i) => {
          const s = this.noise();
          const g = this.env(s, t + d, (0.6 - i * 0.12) * vol, 0.1);
          g.connect(f);
          s.start(t + d);
          s.stop(t + d + 0.12);
        });
        break;
      }
      case "rim": {
        const s = this.noise();
        const f = this.filter("bandpass", 2400, 3);
        s.connect(f);
        this.env(f, t, 0.5 * vol, 0.03).connect(out);
        s.start(t);
        s.stop(t + 0.05);
        const o = this.ctx.createOscillator();
        o.type = "square";
        o.frequency.value = 420;
        this.env(o, t, 0.3 * vol, 0.03).connect(out);
        o.start(t);
        o.stop(t + 0.05);
        break;
      }
      case "cowbell": {
        [540, 800].forEach((fr) => {
          const o = this.ctx!.createOscillator();
          o.type = "square";
          o.frequency.value = fr;
          this.env(o, t, 0.3 * vol, 0.16).connect(out);
          o.start(t);
          o.stop(t + 0.2);
        });
        break;
      }
      case "perc": {
        const o = this.ctx.createOscillator();
        o.type = "square";
        o.frequency.value = 900;
        this.env(o, t, 0.35 * vol, 0.08).connect(out);
        o.start(t);
        o.stop(t + 0.1);
        break;
      }
      case "tomHi":
        tom(260, 150, 0.22);
        break;
      case "tomMid":
        tom(190, 110, 0.25);
        break;
      case "tomLo":
        tom(140, 80, 0.3);
        break;
      case "crash": {
        const s = this.noise();
        const f = this.filter("highpass", 5000, 0.5);
        s.connect(f);
        this.env(f, t, 0.5 * vol, 1.1).connect(out);
        s.start(t);
        s.stop(t + 1.2);
        break;
      }
      case "ride": {
        const s = this.noise();
        const f = this.filter("bandpass", 4200, 0.8);
        s.connect(f);
        this.env(f, t, 0.35 * vol, 0.5).connect(out);
        s.start(t);
        s.stop(t + 0.6);
        const o = this.ctx.createOscillator();
        o.type = "square";
        o.frequency.value = 3200;
        this.env(o, t, 0.12 * vol, 0.4).connect(out);
        o.start(t);
        o.stop(t + 0.45);
        break;
      }
      default:
        hat(0.05, 6000);
    }
  }

  // ------------------------------------------------------------------ piano

  /**
   * Simple additive piano voice: three detuned partials through a lowpass,
   * with a fast attack and a long-ish decay. Good enough to practise against;
   * swap for samples later if you want realism.
   */
  playNote(midi: number, at?: number, vol = 1, duration = 0.9, bus: Bus = "notes"): void {
    if (!this.ctx || !this.master) return;
    const t = at ?? this.ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    const lp = this.filter("lowpass", Math.min(freq * 6 + 800, 12000), 0.7);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.32 * vol, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.12 * vol, t + 0.16);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    lp.connect(amp);
    amp.connect(this.out(bus));

    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1.0, "triangle"],
      [2, 0.28, "sine"],
      [3, 0.12, "sine"],
    ];
    for (const [mult, gain, type] of partials) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      o.detune.value = mult === 1 ? 0 : 4;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(lp);
      o.start(t);
      o.stop(t + duration + 0.05);
    }
  }

  // -------------------------------------------------------------- metronome

  /** Metronome tick. `accent` marks beat 1 of the bar. */
  click(at?: number, accent = false): void {
    if (!this.ctx || !this.master) return;
    const t = at ?? this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = accent ? 1500 : 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.28 : 0.16, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g);
    g.connect(this.out("metronome"));
    o.start(t);
    o.stop(t + 0.05);
  }
}
