import React, { useState, useRef, useEffect, useCallback } from "react";

/*
  Pad Trainer — a Melodics-style timing trainer for a 4x4 (MPC-style) grid.
  - Tap on-screen pads or use the mapped computer keys.
  - Notes fall down each lane toward the hit line; strike when they land.
  - Scores timing (Perfect / Great / Good / Miss), tracks a combo + accuracy.
  - Adaptive tempo: eases off when you struggle, pushes when you're clean.
  - Load a MIDI clip exported from Ableton to turn your own part into a lesson.
*/

// ---- 4x4 pad layout (visual row 0 = top). Bottom-left is the kick, MPC-style. ----
const PADS = [
  { name: "Crash",      type: "crash",     key: "1" },
  { name: "Ride",       type: "ride",      key: "2" },
  { name: "Open Hat",   type: "hatOpen",   key: "3" },
  { name: "Clap",       type: "clap",      key: "4" },
  { name: "Tom Hi",     type: "tomHi",     key: "q" },
  { name: "Tom Mid",    type: "tomMid",    key: "w" },
  { name: "Rim",        type: "rim",       key: "e" },
  { name: "Cowbell",    type: "cowbell",   key: "r" },
  { name: "Closed Hat", type: "hatClosed", key: "a" },
  { name: "Shaker",     type: "shaker",    key: "s" },
  { name: "Perc",       type: "perc",      key: "d" },
  { name: "Tom Lo",     type: "tomLo",     key: "f" },
  { name: "Kick",       type: "kick",      key: "z" },
  { name: "Snare",      type: "snare",     key: "x" },
  { name: "Kick 2",     type: "kick2",     key: "c" },
  { name: "Snare 2",    type: "snare2",    key: "v" },
];
const KEY_TO_PAD = Object.fromEntries(PADS.map((p, i) => [p.key, i]));

// pad indices we reference in lessons
const K = 12, S = 13, CH = 8, OH = 2, CL = 3, TH = 4, TM = 5, TL = 11, RI = 1, CR = 0;

// pad colors (hue spread, kept muted; hits glow brighter)
const PAD_HUE = i => (i * 47) % 360;
const padColor = (i, a = 1) => `hsla(${PAD_HUE(i)}, 55%, 60%, ${a})`;

// ---- built-in lesson progression: gets busier + a touch faster ----
const LESSONS = [
  {
    name: "Four on the Floor",
    hint: "Steady kick on every beat. Lock to the click.",
    bpm: 78, beats: 4,
    notes: [[K, 0], [K, 1], [K, 2], [K, 3]],
  },
  {
    name: "Backbeat",
    hint: "Kick on 1 & 3, snare answers on 2 & 4.",
    bpm: 82, beats: 4,
    notes: [[K, 0], [S, 1], [K, 2], [S, 3]],
  },
  {
    name: "Eighth-Note Hats",
    hint: "Closed hat drives the 8ths over the backbeat.",
    bpm: 86, beats: 4,
    notes: [
      [K, 0], [S, 1], [K, 2], [S, 3],
      [CH, 0], [CH, 0.5], [CH, 1], [CH, 1.5], [CH, 2], [CH, 2.5], [CH, 3], [CH, 3.5],
    ],
  },
  {
    name: "Off-Beat Hats",
    hint: "Hats sit on the 'and' of each beat — feel the space.",
    bpm: 90, beats: 4,
    notes: [
      [K, 0], [S, 1], [K, 2], [S, 3],
      [CH, 0.5], [CH, 1.5], [CH, 2.5], [CH, 3.5],
    ],
  },
  {
    name: "Syncopated Groove",
    hint: "Ghost kick before beat 3, open hat lifts into 2.",
    bpm: 94, beats: 4,
    notes: [
      [K, 0], [K, 2.5], [S, 1], [S, 3],
      [CH, 0.5], [OH, 1.5], [CH, 2], [CH, 3.5],
    ],
  },
  {
    name: "Tom Fill",
    hint: "Groove for three beats, then roll the toms into the turn.",
    bpm: 98, beats: 4,
    notes: [
      [K, 0], [S, 1], [K, 2],
      [CH, 0.5], [CH, 1.5], [CH, 2.5],
      [TH, 3], [TM, 3.25], [TL, 3.5], [S, 3.75],
    ],
  },
];

// ---- General MIDI drum note -> pad type (used when importing MIDI) ----
const GM_TO_PAD = {
  35: K, 36: K, 37: RI, 38: S, 40: S, 39: CL, 42: CH, 44: CH, 46: OH,
  41: TL, 43: TL, 45: TM, 47: TM, 48: TH, 50: TH, 49: CR, 57: CR,
  51: RI, 59: RI, 56: 7, 54: 9, 70: 9, 82: 9, 75: 6, 76: 6, 77: 6,
};

// ---------- Web Audio drum synthesis ----------
function makeNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function env(ctx, node, t, peak, decay, start = 0.001) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(start, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  node.connect(g);
  return g;
}
function playSound(ctx, out, noiseBuf, type, t, vol = 1) {
  const now = t;
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s; };
  const filt = (kind, freq, q = 1) => { const f = ctx.createBiquadFilter(); f.type = kind; f.frequency.value = freq; f.Q.value = q; return f; };

  const tom = (f0, f1, dec) => {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f1, now + dec * 0.9);
    const g = env(ctx, o, now, 0.9 * vol, dec); g.connect(out); o.start(now); o.stop(now + dec + 0.02);
  };
  const hat = (dec, hp) => {
    const s = noise(); const f = filt("highpass", hp, 0.7);
    s.connect(f); const g = env(ctx, f, now, 0.5 * vol, dec); g.connect(out); s.start(now); s.stop(now + dec + 0.02);
  };

  switch (type) {
    case "kick": case "kick2": {
      const o = ctx.createOscillator(); o.type = "sine";
      const f0 = type === "kick2" ? 180 : 150;
      o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(48, now + 0.12);
      const g = env(ctx, o, now, 1.0 * vol, 0.22); g.connect(out); o.start(now); o.stop(now + 0.25);
      const cl = noise(); const cf = filt("lowpass", 1200); cl.connect(cf);
      const cg = env(ctx, cf, now, 0.25 * vol, 0.03); cg.connect(out); cl.start(now); cl.stop(now + 0.05);
      break;
    }
    case "snare": case "snare2": {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = type === "snare2" ? 210 : 180;
      const og = env(ctx, o, now, 0.5 * vol, 0.12); og.connect(out); o.start(now); o.stop(now + 0.15);
      const s = noise(); const f = filt("highpass", 1400, 0.6); s.connect(f);
      const g = env(ctx, f, now, 0.7 * vol, 0.16); g.connect(out); s.start(now); s.stop(now + 0.2);
      break;
    }
    case "hatClosed": hat(0.035, 7000); break;
    case "hatOpen": hat(0.32, 6500); break;
    case "shaker": hat(0.05, 6800); break;
    case "clap": {
      const f = filt("bandpass", 1200, 1.2);
      [0, 0.012, 0.024].forEach((d, i) => {
        const s = noise(); s.connect(f); const g = env(ctx, f, now + d, (0.6 - i * 0.12) * vol, 0.1); g.connect(out);
        s.start(now + d); s.stop(now + d + 0.12);
      });
      break;
    }
    case "rim": {
      const s = noise(); const f = filt("bandpass", 2400, 3); s.connect(f);
      const g = env(ctx, f, now, 0.5 * vol, 0.03); g.connect(out); s.start(now); s.stop(now + 0.05);
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 420;
      const og = env(ctx, o, now, 0.3 * vol, 0.03); og.connect(out); o.start(now); o.stop(now + 0.05);
      break;
    }
    case "cowbell": {
      [540, 800].forEach(fr => {
        const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = fr;
        const g = env(ctx, o, now, 0.3 * vol, 0.16); g.connect(out); o.start(now); o.stop(now + 0.2);
      });
      break;
    }
    case "perc": {
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 900;
      const g = env(ctx, o, now, 0.35 * vol, 0.08); g.connect(out); o.start(now); o.stop(now + 0.1);
      break;
    }
    case "tomHi": tom(260, 150, 0.22); break;
    case "tomMid": tom(190, 110, 0.25); break;
    case "tomLo": tom(140, 80, 0.3); break;
    case "crash": { const s = noise(); const f = filt("highpass", 5000, 0.5); s.connect(f);
      const g = env(ctx, f, now, 0.5 * vol, 1.1); g.connect(out); s.start(now); s.stop(now + 1.2); break; }
    case "ride": { const s = noise(); const f = filt("bandpass", 4200, 0.8); s.connect(f);
      const g = env(ctx, f, now, 0.35 * vol, 0.5); g.connect(out); s.start(now); s.stop(now + 0.6);
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 3200;
      const og = env(ctx, o, now, 0.12 * vol, 0.4); og.connect(out); o.start(now); o.stop(now + 0.45); break; }
    default: hat(0.05, 6000);
  }
}
function click(ctx, out, t, accent) {
  const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = accent ? 1500 : 900;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.28 : 0.16, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.05);
}

// timing windows (seconds)
const W_PERFECT = 0.032, W_GREAT = 0.06, W_GOOD = 0.10;
const RATING = {
  perfect: { label: "PERFECT", color: "#ffb340", score: 100 },
  great:   { label: "GREAT",   color: "#37d0c4", score: 75 },
  good:    { label: "GOOD",    color: "#6ea8ff", score: 40 },
  miss:    { label: "MISS",    color: "#e2564d", score: 0 },
};

export default function PadTrainer() {
  const [lessonIdx, setLessonIdx] = useState(0);
  const [lessons, setLessons] = useState(LESSONS);
  const lesson = lessons[lessonIdx];

  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(lesson.bpm);
  const [autoAdapt, setAutoAdapt] = useState(true);
  const [guide, setGuide] = useState(false); // play the target part as a guide

  const [hud, setHud] = useState({ acc: 100, combo: 0, best: 0, phase: "Ready", loopAcc: null });
  const [pops, setPops] = useState([]);   // rating popups
  const [flash, setFlash] = useState({}); // pad -> {rating, t}
  const [toast, setToast] = useState(null);

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const noiseRef = useRef(null);
  const outRef = useRef(null);

  // transport state kept in a ref so the audio/animation loop isn't tied to React renders
  const T = useRef({
    playing: false, bpm: lesson.bpm, beats: lesson.beats, notes: [],
    loopStart: 0, loopIndex: 0, countIn: true,
    instances: [], scheduledUntilLoop: -1,
    tallyHit: 0, tallyTotal: 0, combo: 0, best: 0,
    loopHit: 0, loopTotal: 0,
  });

  const activePads = React.useMemo(() => {
    const set = new Set(lesson.notes.map(n => n[0]));
    return [...set].sort((a, b) => a - b);
  }, [lesson]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(t => (t === msg ? null : t)), 2600);
  }, []);

  // build fresh note instances for a given loop
  const buildInstances = (loopIndex, loopStart, spb, notes) =>
    notes.map(([pad, beat], i) => ({
      id: `${loopIndex}:${i}`, pad, beat, loopIndex,
      time: loopStart + beat * spb, resolved: false, rating: null,
    }));

  const start = useCallback(async () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const out = ctx.createGain(); out.gain.value = 0.9; out.connect(ctx.destination);
      ctxRef.current = ctx; outRef.current = out; noiseRef.current = makeNoise(ctx);
    }
    const ctx = ctxRef.current; await ctx.resume();

    const spb = 60 / bpm;
    const t0 = ctx.currentTime + 0.15;
    Object.assign(T.current, {
      playing: true, bpm, beats: lesson.beats, notes: lesson.notes,
      loopStart: t0, loopIndex: 0, countIn: true,
      instances: [], scheduledUntilLoop: -1,
      tallyHit: 0, tallyTotal: 0, combo: 0, best: 0, loopHit: 0, loopTotal: 0,
    });
    setHud(h => ({ ...h, acc: 100, combo: 0, best: 0, phase: "Count-in", loopAcc: null }));
    setPlaying(true);
  }, [bpm, lesson]);

  const stop = useCallback(() => {
    T.current.playing = false;
    setPlaying(false);
    setHud(h => ({ ...h, phase: "Ready" }));
  }, []);

  // strike a pad: play sound + score against nearest unresolved note in that lane
  const strike = useCallback((pad) => {
    const ctx = ctxRef.current;
    if (ctx) playSound(ctx, outRef.current, noiseRef.current, PADS[pad].type, ctx.currentTime, 1);

    const t = T.current;
    if (!t.playing || t.countIn) { pulse(pad, null); return; }

    const now = ctx.currentTime;
    let best = null, bestDt = Infinity;
    for (const inst of t.instances) {
      if (inst.pad !== pad || inst.resolved) continue;
      const dt = Math.abs(inst.time - now);
      if (dt < bestDt) { bestDt = dt; best = inst; }
    }
    if (best && bestDt <= W_GOOD) {
      const r = bestDt <= W_PERFECT ? "perfect" : bestDt <= W_GREAT ? "great" : "good";
      best.resolved = true; best.rating = r;
      t.tallyHit += RATING[r].score / 100; t.tallyTotal += 1;
      t.loopHit += RATING[r].score / 100; t.loopTotal += 1;
      if (r === "miss") t.combo = 0; else { t.combo += 1; t.best = Math.max(t.best, t.combo); }
      pulse(pad, r);
      addPop(pad, r);
      syncHud();
    } else {
      // struck with nothing to hit — just a flash, no penalty in this prototype
      pulse(pad, null);
    }
  }, []);

  const pulse = (pad, rating) => {
    setFlash(f => ({ ...f, [pad]: { rating, t: performance.now() } }));
    setTimeout(() => setFlash(f => {
      const c = { ...f }; if (c[pad] && performance.now() - c[pad].t >= 110) delete c[pad]; return c;
    }), 130);
  };
  const addPop = (pad, rating) => {
    const id = Math.random();
    setPops(p => [...p, { id, pad, rating }]);
    setTimeout(() => setPops(p => p.filter(x => x.id !== id)), 520);
  };
  const syncHud = () => {
    const t = T.current;
    const acc = t.tallyTotal ? Math.round((t.tallyHit / t.tallyTotal) * 100) : 100;
    setHud(h => ({ ...h, acc, combo: t.combo, best: t.best }));
  };

  // main audio-scheduling + animation loop
  useEffect(() => {
    let raf;
    const loop = () => {
      const ctx = ctxRef.current; const t = T.current;
      const cvs = canvasRef.current;
      if (ctx && t.playing && cvs) {
        const spb = 60 / t.bpm;
        const now = ctx.currentTime;
        const beatPos = (now - t.loopStart) / spb;

        // ---- schedule clicks + optional guide for current & next loop (lookahead) ----
        for (let L = t.loopIndex; L <= t.loopIndex + 1; L++) {
          if (L <= t.scheduledUntilLoop) continue;
          const ls = t.loopStart + (L - t.loopIndex) * t.beats * spb;
          for (let b = 0; b < t.beats; b++) click(ctx, outRef.current, ls + b * spb, b === 0);
          if (guide && !(L === t.loopIndex && t.countIn)) {
            for (const [pad, beat] of t.notes)
              playSound(ctx, outRef.current, noiseRef.current, PADS[pad].type, ls + beat * spb, 0.5);
          }
          t.scheduledUntilLoop = L;
        }

        // spawn scoring instances for the current scoring loop + the next
        if (!t.countIn) {
          [t.loopIndex, t.loopIndex + 1].forEach(L => {
            if (!t.instances.some(i => i.loopIndex === L)) {
              const ls = t.loopStart + (L - t.loopIndex) * t.beats * spb;
              t.instances.push(...buildInstances(L, ls, spb, t.notes));
            }
          });
        }

        // ---- loop boundary ----
        if (beatPos >= t.beats) {
          const finishedCountIn = t.countIn;
          t.loopStart += t.beats * spb;
          t.loopIndex += 1;
          if (finishedCountIn) {
            t.countIn = false;
            setHud(h => ({ ...h, phase: "Playing" }));
          } else {
            // grade the loop that just ended
            const la = t.loopTotal ? t.loopHit / t.loopTotal : 1;
            setHud(h => ({ ...h, loopAcc: Math.round(la * 100) }));
            adapt(la);
            t.loopHit = 0; t.loopTotal = 0;
          }
          // drop instances from loops now in the past
          t.instances = t.instances.filter(i => i.loopIndex >= t.loopIndex);
        }

        // ---- mark misses (note fell past the window, never struck) ----
        for (const inst of t.instances) {
          if (!inst.resolved && inst.time < now - W_GOOD && inst.loopIndex < t.loopIndex + 1) {
            inst.resolved = true; inst.rating = "miss";
            t.tallyTotal += 1; t.loopTotal += 1; t.combo = 0;
            addPop(inst.pad, "miss"); syncHud();
          }
        }

        draw(cvs, t, now, spb, activePads);
      } else if (cvs) {
        draw(cvs, T.current, 0, 0.5, activePads, true);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [guide, activePads]);

  // adaptive tempo / progression
  const adapt = useCallback((loopAcc) => {
    if (!autoAdapt) return;
    const t = T.current;
    const base = lesson.bpm;
    let nb = t.bpm;
    if (loopAcc >= 0.85) nb = Math.min(Math.round(base * 1.35), t.bpm + 4);
    else if (loopAcc < 0.6) nb = Math.max(Math.round(base * 0.6), t.bpm - 5);
    if (nb !== t.bpm) {
      t.bpm = nb; setBpm(nb);
      showToast(loopAcc >= 0.85 ? `Nice — nudging up to ${nb} BPM` : `Easing back to ${nb} BPM`);
    }
    // advance when consistently strong at/above base tempo
    t._streak = loopAcc >= 0.9 && t.bpm >= base ? (t._streak || 0) + 1 : 0;
    if (t._streak >= 2 && lessonIdx < lessons.length - 1) {
      t._streak = 0;
      showToast(`Lesson cleared → ${lessons[lessonIdx + 1].name}`);
      setTimeout(() => { stop(); setLessonIdx(i => Math.min(i + 1, lessons.length - 1)); }, 400);
    }
  }, [autoAdapt, lesson, lessonIdx, lessons, showToast, stop]);

  // keyboard input
  useEffect(() => {
    const down = (e) => {
      if (e.repeat) return;
      const pad = KEY_TO_PAD[e.key.toLowerCase()];
      if (pad !== undefined) { e.preventDefault(); strike(pad); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [strike]);

  // when lesson changes while stopped, reset shown bpm
  useEffect(() => { if (!playing) setBpm(lesson.bpm); }, [lessonIdx]); // eslint-disable-line

  // ---- MIDI import (the Ableton bridge) ----
  const onMidi = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseMidi(buf);
      const les = midiToLesson(parsed, file.name);
      setLessons(ls => { const copy = [...ls, les]; return copy; });
      setLessonIdx(lessons.length);
      showToast(`Loaded "${les.name}" — ${les.notes.length} hits @ ${les.bpm} BPM`);
    } catch (err) {
      showToast(`Could not read that MIDI file: ${err.message}`);
    }
    e.target.value = "";
  };

  const flashFor = (pad) => flash[pad];

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      <header style={S.header}>
        <div>
          <div style={S.kicker}>PAD TRAINER</div>
          <div style={S.lessonName}>{lesson.name}</div>
          <div style={S.hint}>{lesson.hint}</div>
        </div>
        <div style={S.readouts}>
          <Readout label="TEMPO" value={`${bpm}`} unit="BPM" />
          <Readout label="ACCURACY" value={`${hud.acc}`} unit="%" tint="#37d0c4" />
          <Readout label="COMBO" value={`${hud.combo}`} unit={`▲${hud.best}`} tint="#ffb340" />
          <Readout label="STATUS" value={hud.phase} small />
        </div>
      </header>

      <div style={S.laneWrap}>
        <canvas ref={canvasRef} width={720} height={300} style={S.canvas} />
        {toast && <div style={S.toast}>{toast}</div>}
        {hud.loopAcc != null && playing && (
          <div style={S.loopBadge}>bar {hud.loopAcc}%</div>
        )}
      </div>

      <div style={S.controls}>
        {!playing ? (
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={start}>▶ Play</button>
        ) : (
          <button style={{ ...S.btn, ...S.btnStop }} onClick={stop}>■ Stop</button>
        )}

        <label style={S.slider}>
          <span>Tempo</span>
          <input type="range" min={50} max={160} value={bpm}
            onChange={e => { const v = +e.target.value; setBpm(v); T.current.bpm = v; }} />
        </label>

        <Toggle on={autoAdapt} set={setAutoAdapt} label="Adapt tempo" />
        <Toggle on={guide} set={setGuide} label="Guide sound" />

        <select style={S.select} value={lessonIdx}
          onChange={e => { stop(); setLessonIdx(+e.target.value); }}>
          {lessons.map((l, i) => <option key={i} value={i}>{l.name}</option>)}
        </select>

        <label style={{ ...S.btn, ...S.btnGhost, cursor: "pointer" }}>
          ⇪ Load MIDI clip
          <input type="file" accept=".mid,.midi" onChange={onMidi} style={{ display: "none" }} />
        </label>
      </div>

      <div style={S.gridWrap}>
        <div style={S.grid}>
          {PADS.map((p, i) => {
            const f = flashFor(i);
            const active = activePads.includes(i);
            const rc = f?.rating ? RATING[f.rating].color : null;
            const pop = pops.find(x => x.pad === i);
            return (
              <button key={i}
                onPointerDown={(e) => { e.preventDefault(); strike(i); }}
                className="pad"
                style={{
                  ...S.pad,
                  borderColor: active ? padColor(i, 0.8) : "#2b313a",
                  boxShadow: f
                    ? `0 0 0 2px ${rc}, 0 0 22px ${rc}88, inset 0 1px 0 #ffffff14`
                    : active
                      ? `0 0 14px ${padColor(i, 0.25)}, inset 0 1px 0 #ffffff10`
                      : "inset 0 1px 0 #ffffff08",
                  background: f
                    ? `radial-gradient(circle at 50% 40%, ${rc}44, #20252d)`
                    : active ? "#232a33" : "#1a1e24",
                  transform: f ? "translateY(1px) scale(0.985)" : "none",
                }}>
                <span style={{ ...S.padKey, color: active ? padColor(i) : "#5a626d" }}>{p.key.toUpperCase()}</span>
                <span style={{ ...S.padName, color: active ? "#dfe4ea" : "#6b7280" }}>{p.name}</span>
                {pop && <span className="pop" style={{ color: RATING[pop.rating].color }}>{RATING[pop.rating].label}</span>}
              </button>
            );
          })}
        </div>
        <div style={S.legend}>
          Tap the lit pads or press their key. Notes fall to the line — strike when they land.
          Highlighted pads are the ones this lesson uses.
        </div>
      </div>
    </div>
  );
}

// ---------- canvas drawing ----------
function draw(cvs, t, now, spb, activePads, idle = false) {
  const ctx = cvs.getContext("2d");
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#111318"; ctx.fillRect(0, 0, W, H);

  const lanes = activePads.length || 1;
  const padL = 6, laneGap = 6;
  const laneW = (W - padL * 2 - laneGap * (lanes - 1)) / lanes;
  const hitY = H - 54;           // where notes should be struck
  const pxPerBeat = 118;         // fall speed
  const pxPerSec = pxPerBeat / spb;

  // lane backgrounds + labels + hit targets
  activePads.forEach((pad, li) => {
    const x = padL + li * (laneW + laneGap);
    ctx.fillStyle = "#15181e"; ctx.fillRect(x, 0, laneW, H);
    // hit target
    ctx.fillStyle = padColorC(pad, 0.14); ctx.fillRect(x, hitY - 3, laneW, 6);
    ctx.strokeStyle = padColorC(pad, 0.5); ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, hitY - 12, laneW - 1, 24);
    // label
    ctx.fillStyle = padColorC(pad, 0.85);
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(PADS[pad].name.toUpperCase(), x + laneW / 2, 16);
  });

  // hit line across
  ctx.strokeStyle = "#37d0c4"; ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padL, hitY); ctx.lineTo(W - padL, hitY); ctx.stroke();
  ctx.globalAlpha = 1;

  if (idle) {
    ctx.fillStyle = "#5a626d";
    ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Press Play to start the count-in", W / 2, hitY - 40);
    return;
  }

  // falling notes
  for (const inst of t.instances) {
    const li = activePads.indexOf(inst.pad); if (li < 0) continue;
    const x = padL + li * (laneW + laneGap);
    const y = hitY - (inst.time - now) * pxPerSec;
    if (y < -30 || y > H + 30) continue;
    const w = laneW - 10, h = 20, rx = x + 5;
    let col = padColorC(inst.pad, 0.95);
    if (inst.resolved) col = inst.rating === "miss" ? "#4a2a2a" : ratingColor(inst.rating);
    roundRect(ctx, rx, y - h / 2, w, h, 6);
    ctx.fillStyle = col; ctx.globalAlpha = inst.resolved ? 0.55 : 1; ctx.fill();
    ctx.globalAlpha = 1;
    if (!inst.resolved) {
      ctx.strokeStyle = "#ffffff33"; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}
function padColorC(i, a) { return `hsla(${(i * 47) % 360}, 55%, 60%, ${a})`; }
function ratingColor(r) { return ({ perfect: "#ffb340", great: "#37d0c4", good: "#6ea8ff", miss: "#e2564d" })[r] || "#888"; }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- minimal Standard MIDI File parser ----------
function parseMidi(buf) {
  const dv = new DataView(buf); let p = 0;
  const u8 = () => dv.getUint8(p++);
  const u16 = () => { const v = dv.getUint16(p); p += 2; return v; };
  const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
  const str = n => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(u8()); return s; };
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (str(4) !== "MThd") throw new Error("not a MIDI file");
  u32();
  u16(); // format
  const ntrk = u16();
  const div = u16();
  const ppq = (div & 0x8000) ? 480 : div;
  let tempo = 500000;
  const notes = [];

  for (let tr = 0; tr < ntrk; tr++) {
    if (str(4) !== "MTrk") throw new Error("bad track header");
    const len = u32(); const end = p + len; let tick = 0; let running = 0;
    while (p < end) {
      tick += vlq();
      let status = dv.getUint8(p);
      if (status & 0x80) { p++; running = status; } else status = running;
      const hi = status & 0xf0;
      if (status === 0xff) { const mt = u8(); const l = vlq();
        if (mt === 0x51) tempo = (dv.getUint8(p) << 16) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p + 2);
        p += l;
      } else if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; }
      else if (hi === 0x90) { const n = u8(); const v = u8(); if (v > 0) notes.push({ tick, midi: n }); }
      else if (hi === 0x80 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) { u8(); u8(); }
      else if (hi === 0xc0 || hi === 0xd0) { u8(); }
      else p++;
    }
    p = end;
  }
  const events = notes.map(n => ({ beat: n.tick / ppq, midi: n.midi })).sort((a, b) => a.beat - b.beat);
  return { events, ppq, bpm: Math.round(60000000 / tempo) };
}

function midiToLesson(parsed, name) {
  const { events } = parsed;
  if (!events.length) throw new Error("no notes found");
  // normalize so the clip starts at beat 0
  const first = Math.floor(events[0].beat);
  const norm = events.map(e => ({ ...e, beat: +(e.beat - first).toFixed(3) }));
  const maxBeat = Math.max(...norm.map(e => e.beat));
  const beats = Math.max(4, Math.ceil((maxBeat + 0.5) / 4) * 4); // round up to whole bars

  // map midi -> pad; unknown pitches get assigned to spare pads round-robin
  const spare = [6, 7, 9, 10, 4, 5, 11, 3, 2].slice(); const dyn = {};
  const toPad = (m) => {
    if (m in GM_TO_PAD) return GM_TO_PAD[m];
    if (m in dyn) return dyn[m];
    const pad = spare.length ? spare.shift() : 12;
    dyn[m] = pad; return pad;
  };
  const notes = norm.map(e => [toPad(e.midi), e.beat]);
  const clean = name.replace(/\.(mid|midi)$/i, "").slice(0, 28);
  return {
    name: `♫ ${clean}`,
    hint: "Imported clip — play your own part in time.",
    bpm: Math.min(Math.max(parsed.bpm || 90, 50), 160),
    beats, notes,
  };
}

// ---------- small UI pieces ----------
function Readout({ label, value, unit, tint = "#eef1f5", small }) {
  return (
    <div style={S.readout}>
      <div style={S.readoutLabel}>{label}</div>
      <div style={{ ...S.readoutValue, color: tint, fontSize: small ? 15 : 24 }}>
        {value}{unit && <span style={S.readoutUnit}> {unit}</span>}
      </div>
    </div>
  );
}
function Toggle({ on, set, label }) {
  return (
    <button onClick={() => set(v => !v)} style={{ ...S.toggle, ...(on ? S.toggleOn : {}) }}>
      <span style={{ ...S.dot, ...(on ? S.dotOn : {}) }} />
      {label}
    </button>
  );
}

// ---------- styles ----------
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const sans = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const S = {
  root: { fontFamily: sans, background: "#101216", color: "#eef1f5", padding: 16, borderRadius: 16, maxWidth: 760, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 },
  kicker: { fontSize: 11, letterSpacing: 3, color: "#37d0c4", fontWeight: 700 },
  lessonName: { fontSize: 22, fontWeight: 700, marginTop: 2 },
  hint: { fontSize: 12.5, color: "#8a929e", marginTop: 3, maxWidth: 360 },
  readouts: { display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" },
  readout: { minWidth: 62 },
  readoutLabel: { fontSize: 9.5, letterSpacing: 1.5, color: "#6b7280", fontFamily: mono },
  readoutValue: { fontFamily: mono, fontWeight: 700, lineHeight: 1.1 },
  readoutUnit: { fontSize: 11, color: "#6b7280", fontWeight: 500 },
  laneWrap: { position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid #23272f" },
  canvas: { width: "100%", display: "block", background: "#111318", touchAction: "none" },
  toast: { position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", background: "#1c2026ee", border: "1px solid #37d0c455", color: "#dfe4ea", padding: "6px 12px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" },
  loopBadge: { position: "absolute", top: 10, right: 10, background: "#1c2026cc", border: "1px solid #ffb34055", color: "#ffb340", padding: "3px 9px", borderRadius: 8, fontSize: 11, fontFamily: mono },
  controls: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "12px 0" },
  btn: { border: "1px solid #2b313a", background: "#1a1e24", color: "#eef1f5", padding: "9px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  btnPrimary: { background: "linear-gradient(180deg,#37d0c4,#20b3a8)", color: "#04201d", border: "none" },
  btnStop: { background: "#2a1c1c", borderColor: "#e2564d55", color: "#f0a8a2" },
  btnGhost: { background: "transparent" },
  slider: { display: "flex", flexDirection: "column", fontSize: 10, color: "#8a929e", fontFamily: mono, gap: 3 },
  select: { background: "#1a1e24", color: "#eef1f5", border: "1px solid #2b313a", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, fontFamily: sans },
  toggle: { display: "flex", alignItems: "center", gap: 7, background: "#1a1e24", border: "1px solid #2b313a", color: "#8a929e", padding: "9px 12px", borderRadius: 10, fontSize: 13, cursor: "pointer", fontWeight: 600 },
  toggleOn: { color: "#eef1f5", borderColor: "#37d0c455" },
  dot: { width: 8, height: 8, borderRadius: 8, background: "#404750" },
  dotOn: { background: "#37d0c4", boxShadow: "0 0 8px #37d0c4" },
  gridWrap: { marginTop: 4 },
  grid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  pad: { position: "relative", aspectRatio: "1 / 0.72", borderRadius: 12, border: "1px solid #2b313a", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 10px", cursor: "pointer", userSelect: "none", transition: "transform .05s, box-shadow .05s" },
  padKey: { fontFamily: mono, fontSize: 13, fontWeight: 700 },
  padName: { fontSize: 11.5, fontWeight: 600, textAlign: "left", lineHeight: 1.15 },
  legend: { fontSize: 12, color: "#6b7280", marginTop: 10, lineHeight: 1.5 },
};
const CSS = `
  .pad:active { transform: translateY(1px) scale(0.985); }
  .pop { position:absolute; top:-2px; right:8px; font-size:11px; font-weight:800; letter-spacing:0.5px;
         font-family:${mono}; animation: rise .5s ease-out forwards; pointer-events:none; }
  @keyframes rise { from { opacity:0; transform:translateY(6px);} 20%{opacity:1;} to{opacity:0; transform:translateY(-14px);} }
  input[type=range]{ accent-color:#37d0c4; width:120px; }
  @media (prefers-reduced-motion: reduce){ .pop{ animation:none; } }
`;
