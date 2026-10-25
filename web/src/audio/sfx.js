// Synthesized sound effects, stings and continuous loops.
// SFX/loops use raw WebAudio nodes on Tone's context (cheap, fire-and-forget); stings use Tone synths.
import * as Tone from 'tone';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function makeNoiseBuffers(ctx) {
  const n = Math.floor(ctx.sampleRate * 2);
  const mk = () => ctx.createBuffer(1, n, ctx.sampleRate);
  const white = mk(), pink = mk(), brown = mk();
  const w = white.getChannelData(0), p = pink.getChannelData(0), br = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    br[i] = last * 3.5;
  }
  return { white, pink, brown };
}

export function createSfx({ dest, verb, duck, stingInst }) {
  const ctx = Tone.getContext().rawContext;
  const out = ctx.createGain();
  Tone.connect(out, dest);
  const wet = ctx.createGain();
  Tone.connect(wet, verb);
  const bufs = makeNoiseBuffers(ctx);

  const E = (o) => ({ attack: 0.005, hold: 0, decay: 0.2, vol: 0.3, verb: 0, ...o });

  function route(node, verbAmt) {
    node.connect(out);
    if (verbAmt) {
      const s = ctx.createGain();
      s.gain.value = verbAmt;
      node.connect(s);
      s.connect(wet);
    }
  }
  function env(g, t, e) {
    const p = g.gain;
    const vol = Math.max(0.0002, e.vol);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(vol, t + e.attack);
    if (e.hold) p.setValueAtTime(vol, t + e.attack + e.hold);
    p.exponentialRampToValueAtTime(0.0001, t + e.attack + e.hold + e.decay);
    return t + e.attack + e.hold + e.decay + 0.03;
  }

  function tone(t, o) {
    const e = E(o);
    const osc = ctx.createOscillator();
    osc.type = e.type || 'sine';
    osc.frequency.setValueAtTime(e.f, t);
    if (e.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, e.f2), t + (e.glide ?? (e.attack + e.hold + e.decay)));
    const g = ctx.createGain();
    let last = osc;
    if (e.lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = e.lp;
      osc.connect(fl);
      last = fl;
    }
    last.connect(g);
    route(g, e.verb);
    const end = env(g, t, e);
    osc.start(t);
    osc.stop(end);
    if (e.vib) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = e.vib;
      lg.gain.value = e.vibDepth ?? e.f * 0.02;
      l.connect(lg);
      lg.connect(osc.frequency);
      l.start(t);
      l.stop(end);
    }
    osc.onended = () => { try { g.disconnect(); } catch { /* */ } };
  }

  function noise(t, o) {
    const e = E(o);
    const src = ctx.createBufferSource();
    src.buffer = bufs[e.color || 'white'];
    src.loop = true;
    src.playbackRate.value = e.rate ?? 1;
    const fl = ctx.createBiquadFilter();
    fl.type = e.ftype || 'bandpass';
    fl.frequency.setValueAtTime(e.f ?? 1000, t);
    fl.Q.value = e.q ?? 1;
    if (e.f2) fl.frequency.exponentialRampToValueAtTime(e.f2, t + (e.glide ?? (e.attack + e.hold + e.decay)));
    const g = ctx.createGain();
    src.connect(fl);
    fl.connect(g);
    route(g, e.verb);
    const end = env(g, t, e);
    src.start(t, Math.random() * 1.5);
    src.stop(end);
    src.onended = () => { try { g.disconnect(); } catch { /* */ } };
  }

  const kick = (t, v = 0.5) => tone(t, { f: 160, f2: 45, glide: 0.25, decay: 0.3, vol: v });
  const cymbal = (t, v = 0.12, decay = 1.4, attack = 0.003) => noise(t, { ftype: 'highpass', f: 6500, q: 0.5, attack, decay, vol: v, verb: 0.4 });
  const sparkle = (t, n, p = 1, v = 1) => {
    for (let i = 0; i < n; i++) tone(t + rnd(0, 0.3), { f: rnd(2500, 5000) * p, decay: 0.09, vol: 0.035 * v, verb: 0.6 });
  };
  const pinClack = (t, p, v) => {
    const f = rnd(900, 1350) * p;
    noise(t, { f: 2800 * p, q: 4, decay: 0.05, vol: 0.35 * v });
    tone(t, { type: 'triangle', f, f2: f * 0.7, decay: 0.07, vol: 0.2 * v });
    tone(t, { f: f * 2.3, decay: 0.03, vol: 0.07 * v });
  };

  const SFX = {
    tick: (t, p, v) => {
      tone(t, { type: 'triangle', f: 1500 * p, decay: 0.035, vol: 0.12 * v });
      tone(t, { f: 3000 * p, decay: 0.02, vol: 0.04 * v });
    },
    select: (t, p, v) => {
      tone(t, { type: 'triangle', f: 1046.5 * p, decay: 0.09, vol: 0.16 * v });
      tone(t + 0.06, { type: 'triangle', f: 1568 * p, decay: 0.2, vol: 0.16 * v, verb: 0.3 });
      tone(t + 0.06, { f: 3136 * p, decay: 0.12, vol: 0.04 * v });
    },
    back: (t, p, v) => {
      tone(t, { type: 'triangle', f: 880 * p, decay: 0.08, vol: 0.15 * v });
      tone(t + 0.06, { type: 'triangle', f: 587.3 * p, decay: 0.15, vol: 0.15 * v });
    },
    join: (t, p, v) => {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        tone(t + i * 0.07, { f: f * p, decay: 0.55, vol: 0.13 * v, verb: 0.5 });
        tone(t + i * 0.07, { f: f * 3.01 * p, decay: 0.15, vol: 0.025 * v });
      });
    },
    countdown: (t, p, v) => {
      tone(t, { f: 784 * p, hold: 0.09, decay: 0.12, vol: 0.22 * v });
      tone(t, { type: 'triangle', f: 784 * p, hold: 0.09, decay: 0.1, vol: 0.06 * v });
    },
    go: (t, p, v) => {
      tone(t, { f: 1568 * p, hold: 0.25, decay: 0.35, vol: 0.22 * v, verb: 0.3 });
      tone(t, { type: 'triangle', f: 2349 * p, hold: 0.2, decay: 0.3, vol: 0.06 * v });
    },
    pin: (t, p, v) => pinClack(t, p * rnd(0.92, 1.08), v),
    pins: (t, p, v) => {
      const amt = clamp(v, 0.1, 1.5);
      const n = Math.round(4 + 10 * Math.min(amt, 1));
      for (let i = 0; i < n; i++) pinClack(t + Math.pow(Math.random(), 1.6) * 0.42, p * rnd(0.85, 1.25), rnd(0.4, 1) * 0.8 * amt);
      tone(t, { f: 140 * p, f2: 55, decay: 0.25, vol: 0.5 * Math.min(amt, 1) });
      noise(t, { ftype: 'lowpass', f: 4000, f2: 700, decay: 0.6, vol: 0.25 * amt, verb: 0.2 });
      if (amt > 0.3) duck(1.2);
    },
    racketHit: (t, p, v) => {
      noise(t, { f: 1400 * p, q: 0.8, decay: 0.05, vol: 0.5 * v });
      tone(t, { type: 'triangle', f: 520 * p, f2: 200 * p, decay: 0.07, vol: 0.35 * v });
      tone(t, { f: 1800 * p, decay: 0.05, vol: 0.08 * v });
    },
    bounce: (t, p, v) => {
      tone(t, { f: 260 * p, f2: 150 * p, decay: 0.09, vol: 0.4 * v });
      noise(t, { ftype: 'lowpass', f: 900, decay: 0.025, vol: 0.2 * v });
    },
    cheer: (t, p, v) => {
      noise(t, { color: 'pink', f: 1400 * p, q: 0.5, attack: 0.25, hold: 0.45, decay: 1.0, vol: 0.7 * v, verb: 0.3 });
      noise(t, { color: 'white', f: 3200 * p, q: 0.9, attack: 0.2, hold: 0.3, decay: 0.8, vol: 0.08 * v });
      for (let i = 0; i < 30; i++) {
        const f = rnd(380, 1100) * p;
        tone(t + rnd(0, 1.2), { type: 'triangle', f, f2: f * rnd(0.9, 1.25), attack: 0.02, decay: rnd(0.08, 0.22), vol: rnd(0.015, 0.04) * v, lp: 2200 });
      }
      for (let i = 0; i < 2; i++) tone(t + rnd(0.1, 0.6), { f: 1700 * p, f2: 2700 * p, glide: 0.3, attack: 0.03, hold: 0.15, decay: 0.2, vol: 0.04 * v });
      duck(1.6);
    },
    aww: (t, p, v) => {
      noise(t, { color: 'pink', f: 900 * p, f2: 380 * p, q: 0.8, attack: 0.15, hold: 0.3, decay: 1.0, vol: 0.35 * v });
      for (let i = 0; i < 7; i++) {
        const f = rnd(330, 560) * p;
        tone(t + rnd(0, 0.15), { type: 'sawtooth', f, f2: f * 0.62, glide: 1.3, attack: 0.18, hold: 0.4, decay: 0.8, vol: 0.022 * v, lp: 1100, vib: rnd(4, 6), vibDepth: 6 });
      }
      duck(1.4);
    },
    boost: (t, p, v) => {
      noise(t, { f: 400 * p, f2: 5000 * p, q: 2.5, attack: 0.05, decay: 0.7, glide: 0.6, vol: 0.35 * v, verb: 0.2 });
      tone(t, { type: 'sawtooth', f: 180 * p, f2: 1000 * p, attack: 0.03, decay: 0.55, vol: 0.07 * v, lp: 2500 });
    },
    fall: (t, p, v) => {
      tone(t, { type: 'triangle', f: 1400 * p, f2: 120 * p, glide: 0.9, attack: 0.01, hold: 0.5, decay: 0.4, vol: 0.15 * v, vib: 9, vibDepth: 30 });
      noise(t, { f: 1200, f2: 300, q: 1, decay: 0.9, vol: 0.08 * v });
    },
    splash: (t, p, v) => {
      noise(t, { ftype: 'lowpass', f: 5000 * p, f2: 500, attack: 0.005, decay: 0.7, vol: 0.5 * v, verb: 0.2 });
      noise(t, { ftype: 'highpass', f: 3000, decay: 0.25, vol: 0.15 * v });
      for (let i = 0; i < 7; i++) {
        const f = rnd(900, 2200) * p;
        tone(t + 0.05 + rnd(0, 0.45), { f, f2: f * 1.6, decay: 0.06, vol: 0.07 * v });
      }
    },
    ding: (t, p, v) => {
      tone(t, { f: 1318.5 * p, decay: 1.0, vol: 0.2 * v, verb: 0.5 });
      tone(t, { f: 1318.5 * 2.76 * p, decay: 0.3, vol: 0.035 * v });
      tone(t, { type: 'triangle', f: 2637 * p, decay: 0.15, vol: 0.03 * v });
    },
    pop: (t, p, v) => {
      noise(t, { f: 1500 * p, q: 0.7, decay: 0.03, vol: 0.5 * v });
      tone(t, { f: 500 * p, f2: 120 * p, decay: 0.06, vol: 0.35 * v });
      sparkle(t + 0.03, 5, p, v);
    },
    whoosh: (t, p, v) => {
      noise(t, { color: 'pink', f: 500 * p, f2: 2600 * p, q: 1.6, attack: 0.09, decay: 0.2, glide: 0.29, vol: 0.4 * v });
    },
    poof: (t, p, v) => {
      noise(t, { color: 'pink', ftype: 'lowpass', f: 3500 * p, f2: 250, attack: 0.015, decay: 0.4, vol: 0.55 * v, verb: 0.2 });
      tone(t, { f: 220 * p, f2: 80 * p, decay: 0.2, vol: 0.2 * v });
      sparkle(t + 0.05, 3, p, v);
    },
    lap: (t, p, v) => {
      tone(t, { type: 'triangle', f: 1175 * p, decay: 0.12, vol: 0.15 * v });
      tone(t + 0.1, { type: 'triangle', f: 1568 * p, decay: 0.12, vol: 0.15 * v });
      tone(t + 0.2, { type: 'triangle', f: 2093 * p, hold: 0.1, decay: 0.4, vol: 0.15 * v, verb: 0.4 });
      tone(t + 0.2, { f: 1046.5 * p, hold: 0.1, decay: 0.4, vol: 0.1 * v });
    },
    wind: (t, p, v) => {
      noise(t, { color: 'pink', f: 450 * p, f2: 900 * p, q: 0.9, attack: 0.6, hold: 0.5, decay: 1.2, glide: 2.3, vol: 0.28 * v });
    },
    throw: (t, p, v) => {
      noise(t, { color: 'pink', f: 300 * p, f2: 1100 * p, q: 1.2, attack: 0.05, decay: 0.25, vol: 0.3 * v });
      tone(t, { f: 110 * p, f2: 55, decay: 0.18, vol: 0.35 * v });
    },
    clap: (t, p, v) => {
      for (let i = 0; i < 22; i++) {
        const off = Math.pow(Math.random(), 1.3) * 1.2;
        noise(t + off, { f: rnd(1100, 2000) * p, q: 1.5, decay: 0.025, vol: 0.25 * v * (1 - off / 1.4) });
      }
    },
    error: (t, p, v) => {
      tone(t, { type: 'square', f: 233 * p, hold: 0.08, decay: 0.05, vol: 0.1 * v, lp: 1400 });
      tone(t + 0.14, { type: 'square', f: 185 * p, hold: 0.12, decay: 0.1, vol: 0.1 * v, lp: 1400 });
    },
  };

  function play(name, opts = {}) {
    const fn = SFX[name];
    if (!fn) return;
    const v = opts.volume ?? 1;
    const p = opts.pitch ?? 1;
    try { fn(ctx.currentTime + 0.01, p, v); } catch (e) { /* never break gameplay over audio */ }
  }

  // ---------------------------------------------------------------- stings (Tone synths on the sfx bus)
  const S = stingInst;
  const at = (inst, notes, dur, time, vel = 0.8) => inst.triggerAttackRelease(notes, dur, time, vel);
  const STINGS = {
    victory: (T) => {
      ['C5', 'E5', 'G5', 'C6', 'E6'].forEach((n, i) => at(S.mallet, n, 0.25, T + i * 0.07, 0.85));
      at(S.keys, ['C4', 'E4', 'G4', 'B4', 'D5'], 1.8, T + 0.38, 0.7);
      ['E6', 'G6', 'B6'].forEach((n, i) => at(S.bells, n, 1.2, T + 0.38 + i * 0.06, 0.7));
      kick(T + 0.38, 0.45); cymbal(T + 0.38, 0.1);
      at(S.mallet, 'G5', 0.2, T + 0.95, 0.6); at(S.mallet, 'C6', 0.6, T + 1.07, 0.7);
      return 2.4;
    },
    lose: (T) => {
      ['B4', 'Bb4', 'A4'].forEach((n, i) => at(S.mallet, n, 0.3, T + i * 0.32, 0.7));
      at(S.keys, ['F3', 'Ab3', 'C4', 'D4'], 1.3, T + 0.96, 0.55);
      at(S.mallet, 'Ab4', 1.0, T + 0.96, 0.6);
      return 2.2;
    },
    gutter: (T) => {
      tone(T, { type: 'triangle', f: 700, f2: 160, glide: 0.75, attack: 0.01, hold: 0.5, decay: 0.3, vol: 0.14, vib: 7, vibDepth: 25 });
      tone(T + 0.85, { f: 180, f2: 90, decay: 0.2, vol: 0.4 });
      ['G4', 'E4', 'C4'].forEach((n, i) => at(S.pizz, n, 0.15, T + 0.85 + i * 0.11, 0.8));
      return 1.4;
    },
    strike: (T) => {
      ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6'].forEach((n, i) => at(S.mallet, n, 0.2, T + i * 0.045, 0.8));
      kick(T, 0.4); kick(T + 0.4, 0.55);
      at(S.keys, ['D4', 'F#4', 'A4', 'C#5', 'E5'], 1.4, T + 0.4, 0.75);
      ['A5', 'D6', 'F#6'].forEach((n, i) => at(S.bells, n, 1.2, T + 0.4 + i * 0.05, 0.8));
      cymbal(T + 0.4, 0.16, 1.6);
      sparkle(T + 0.5, 6);
      return 2.0;
    },
    spare: (T) => {
      ['G5', 'B5', 'D6'].forEach((n, i) => at(S.mallet, n, 0.2, T + i * 0.08, 0.8));
      at(S.bells, 'G6', 1.0, T + 0.26, 0.8);
      at(S.keys, ['G4', 'B4', 'D5', 'F#5'], 1.0, T + 0.26, 0.65);
      cymbal(T + 0.26, 0.07, 1.0);
      return 1.5;
    },
    champion: (T) => {
      const F = ['F3', 'A3', 'C4', 'E4'], G = ['G3', 'B3', 'D4', 'E4'];
      at(S.keys, F, 0.3, T, 0.8); at(S.keys, F, 0.15, T + 0.3, 0.7);
      at(S.keys, G, 0.3, T + 0.5, 0.8); at(S.keys, G, 0.15, T + 0.8, 0.7);
      at(S.bells, 'C6', 0.3, T, 0.8); at(S.bells, 'C6', 0.15, T + 0.3, 0.7);
      at(S.bells, 'D6', 0.3, T + 0.5, 0.8); at(S.bells, 'E6', 0.5, T + 0.8, 0.85);
      kick(T, 0.45); kick(T + 0.5, 0.45); kick(T + 0.8, 0.4);
      cymbal(T + 0.7, 0.1, 0.4, 0.8);
      ['C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'].forEach((n, i) => at(S.mallet, n, 0.25, T + 1.1 + i * 0.06, 0.8));
      at(S.keys, ['C4', 'E4', 'G4', 'B4', 'D5'], 2.2, T + 1.6, 0.85);
      at(S.pizz, ['C3'], 0.4, T + 1.6, 0.9);
      ['E6', 'G6', 'B6', 'D7'].forEach((n, i) => at(S.bells, n, 1.6, T + 1.6 + i * 0.07, 0.75));
      kick(T + 1.6, 0.6); cymbal(T + 1.6, 0.18, 2.2);
      sparkle(T + 1.8, 8); sparkle(T + 2.4, 6);
      return 4.0;
    },
  };

  function sting(name) {
    const fn = STINGS[name];
    if (!fn) return 0;
    try { return fn(Tone.now()); } catch (e) { return 0; }
  }

  // ---------------------------------------------------------------- loops
  function makeLoop(name, state) {
    const now = () => ctx.currentTime;
    const smooth = (param, val, tc = 0.06) => { try { param.setTargetAtTime(val, now(), tc); } catch { /* */ } };
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(out);
    const sources = [];
    const startSrc = (node) => { node.start(); sources.push(node); return node; };
    const noiseSrc = (color) => {
      const s = ctx.createBufferSource();
      s.buffer = bufs[color]; s.loop = true;
      return s;
    };
    let update;

    if (name === 'roll') {
      const n = noiseSrc('brown');
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      const rum = ctx.createOscillator(); rum.type = 'sine';
      const am = ctx.createGain(); am.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.type = 'triangle';
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.45;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      n.connect(lp); lp.connect(master);
      rum.connect(am); am.connect(master);
      [n, rum, lfo].forEach(startSrc);
      update = (r, vol) => {
        smooth(lp.frequency, 160 + r * 520);
        smooth(rum.frequency, 42 + r * 38);
        smooth(lfo.frequency, 5 + r * 12);
        smooth(master.gain, vol * Math.min(1, 0.1 + r * 0.6) * 0.8);
      };
    } else if (name === 'engine') {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const sub = ctx.createOscillator(); sub.type = 'sine';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
      const mix = ctx.createGain(); mix.gain.value = 0.7;
      const o2g = ctx.createGain(); o2g.gain.value = 0.25;
      const lfo = ctx.createOscillator(); lfo.type = 'sine';
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.3;
      lfo.connect(lfoG); lfoG.connect(mix.gain);
      o1.connect(lp); o2.connect(o2g); o2g.connect(lp); sub.connect(mix);
      lp.connect(mix); mix.connect(master);
      [o1, o2, sub, lfo].forEach(startSrc);
      update = (r, vol) => {
        const f = 55 + r * 110;
        smooth(o1.frequency, f); smooth(o2.frequency, f * 1.503); smooth(sub.frequency, f / 2);
        smooth(lp.frequency, 350 + r * 1600);
        smooth(lfo.frequency, 16 + r * 28);
        smooth(master.gain, vol * 0.12 * (0.6 + 0.4 * Math.min(r, 1.5)));
      };
    } else if (name === 'crowd') {
      const n1 = noiseSrc('pink'), n2 = noiseSrc('white');
      const bp1 = ctx.createBiquadFilter(); bp1.type = 'bandpass'; bp1.Q.value = 0.6;
      const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.Q.value = 1; bp2.frequency.value = 2600;
      const g2 = ctx.createGain(); g2.gain.value = 0.15;
      const swell = ctx.createGain(); swell.gain.value = 0.8;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.2;
      lfo.connect(lfoG); lfoG.connect(swell.gain);
      n1.connect(bp1); bp1.connect(swell);
      n2.connect(bp2); bp2.connect(g2); g2.connect(swell);
      swell.connect(master);
      n1.start(0, Math.random()); sources.push(n1);
      n2.start(0, Math.random()); sources.push(n2);
      startSrc(lfo);
      update = (r, vol) => {
        smooth(bp1.frequency, 700 + r * 600);
        smooth(g2.gain, 0.08 + r * 0.15);
        smooth(master.gain, vol * (0.2 + r * 0.45) * 0.5, 0.25);
      };
    } else {
      master.disconnect();
      return null;
    }

    const st = { rate: 1, volume: 0.6, ...state };
    update(clamp(st.rate, 0, 2), clamp(st.volume, 0, 1));
    let alive = true;
    return {
      set(o = {}) {
        if (!alive) return;
        if (o.rate != null) st.rate = o.rate;
        if (o.volume != null) st.volume = o.volume;
        update(clamp(st.rate, 0, 2), clamp(st.volume, 0, 1));
      },
      stop() {
        if (!alive) return;
        alive = false;
        const t = now();
        try {
          master.gain.cancelScheduledValues(t);
          master.gain.setValueAtTime(master.gain.value, t);
          master.gain.linearRampToValueAtTime(0, t + 0.3);
        } catch { /* */ }
        sources.forEach((s) => { try { s.stop(t + 0.35); } catch { /* */ } });
        setTimeout(() => { try { master.disconnect(); } catch { /* */ } }, 500);
      },
    };
  }

  return { play, sting, loop: makeLoop };
}
