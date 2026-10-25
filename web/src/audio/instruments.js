// Synth voices for music + stings. Everything here is created lazily (called from unlock()).
import * as Tone from 'tone';

const poly = (Voice, opts, max = 6, db = -12) => {
  const p = new Tone.PolySynth(Voice, opts);
  p.maxPolyphony = max;
  p.volume.value = db;
  return p;
};

// Soft electric piano (FM, tine-like)
const EP = {
  harmonicity: 1,
  modulationIndex: 3.2,
  oscillator: { type: 'sine' },
  modulation: { type: 'sine' },
  envelope: { attack: 0.004, decay: 1.2, sustain: 0.15, release: 0.7 },
  modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0.1, release: 0.6 },
};
// Marimba-ish wooden mallet
const MALLET = {
  harmonicity: 4,
  modulationIndex: 2.4,
  oscillator: { type: 'sine' },
  modulation: { type: 'sine' },
  envelope: { attack: 0.001, decay: 0.55, sustain: 0, release: 0.35 },
  modulationEnvelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.08 },
};
// Vibraphone-ish (with tremolo applied outside)
const VIBES = {
  harmonicity: 4,
  modulationIndex: 0.9,
  oscillator: { type: 'sine' },
  modulation: { type: 'sine' },
  envelope: { attack: 0.002, decay: 1.8, sustain: 0.05, release: 1.4 },
  modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.3 },
};
// Glassy bell / glockenspiel
const BELL = {
  harmonicity: 5.5,
  modulationIndex: 3.5,
  oscillator: { type: 'sine' },
  modulation: { type: 'sine' },
  envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.2 },
  modulationEnvelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.4 },
};
// Pizzicato strings
const PIZZ = {
  oscillator: { type: 'sawtooth' },
  filter: { Q: 1.2, type: 'lowpass', rolloff: -24 },
  envelope: { attack: 0.003, decay: 0.28, sustain: 0, release: 0.15 },
  filterEnvelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.1, baseFrequency: 280, octaves: 3.2 },
};

/** Music instruments, all routed into `dest` (music bus input). */
export function createMusicInstruments(dest) {
  const out = (node) => { node.connect(dest); return node; };

  const vibesTrem = new Tone.Tremolo(4.5, 0.35).start();
  vibesTrem.connect(dest);
  const padFilter = new Tone.Filter(1600, 'lowpass');
  padFilter.connect(dest);

  const inst = {
    keys: out(poly(Tone.FMSynth, EP, 16, -15)),
    mallet: out(poly(Tone.FMSynth, MALLET, 10, -10)),
    vibes: poly(Tone.FMSynth, VIBES, 8, -11),
    bells: out(poly(Tone.FMSynth, BELL, 8, -19)),
    pizz: out(poly(Tone.MonoSynth, PIZZ, 6, -15)),
    pad: poly(Tone.Synth, {
      oscillator: { type: 'fattriangle', count: 2, spread: 18 },
      envelope: { attack: 0.6, decay: 0.8, sustain: 0.7, release: 1.8 },
    }, 12, -24),
    bass: out(new Tone.MonoSynth({
      oscillator: { type: 'triangle' },
      filter: { Q: 1, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.35, sustain: 0.35, release: 0.2 },
      filterEnvelope: { attack: 0.002, decay: 0.2, sustain: 0.3, release: 0.2, baseFrequency: 180, octaves: 2.6 },
    })),
    lead: out(new Tone.MonoSynth({
      portamento: 0.015,
      oscillator: { type: 'pulse', width: 0.3 },
      filter: { Q: 1, type: 'lowpass', rolloff: -12 },
      envelope: { attack: 0.006, decay: 0.2, sustain: 0.5, release: 0.15 },
      filterEnvelope: { attack: 0.004, decay: 0.25, sustain: 0.4, release: 0.2, baseFrequency: 700, octaves: 2.5 },
    })),
    kick: out(new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 5,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 },
    })),
    snare: out(new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
    })),
    hat: null,
  };
  inst.vibes.connect(vibesTrem);
  inst.pad.connect(padFilter);

  const hatHP = new Tone.Filter(7500, 'highpass');
  hatHP.connect(dest);
  inst.hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 },
  });
  inst.hat.connect(hatHP);

  inst.bass.volume.value = -9;
  inst.lead.volume.value = -20;
  inst.kick.volume.value = -12;
  inst.snare.volume.value = -24;
  inst.hat.volume.value = -22;

  // per-track presets tweak a few voices
  inst.preset = (name) => {
    if (name === 'racing') {
      inst.bass.set({ oscillator: { type: 'sawtooth' }, filterEnvelope: { baseFrequency: 140, octaves: 3.4, decay: 0.12, sustain: 0.15 }, envelope: { decay: 0.15, sustain: 0.3 } });
      inst.bass.volume.value = -15;
      inst.snare.set({ noise: { type: 'white' }, envelope: { decay: 0.14 } });
      inst.snare.volume.value = -22;
    } else if (name === 'bowling') {
      inst.bass.set({ oscillator: { type: 'triangle' }, filterEnvelope: { baseFrequency: 160, octaves: 2.2, decay: 0.25, sustain: 0.2 }, envelope: { decay: 0.4, sustain: 0.25 } });
      inst.bass.volume.value = -8;
      inst.snare.set({ noise: { type: 'pink' }, envelope: { attack: 0.02, decay: 0.22 } });
      inst.snare.volume.value = -30;
    } else {
      inst.bass.set({ oscillator: { type: 'triangle' }, filterEnvelope: { baseFrequency: 180, octaves: 2.6, decay: 0.2, sustain: 0.3 }, envelope: { decay: 0.35, sustain: 0.35 } });
      inst.bass.volume.value = -9;
      inst.snare.set({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.12 } });
      inst.snare.volume.value = name === 'balance' ? -30 : -24;
    }
  };

  inst.silence = () => {
    for (const k of ['keys', 'mallet', 'vibes', 'bells', 'pizz', 'pad']) {
      try { inst[k].releaseAll(); } catch { /* ignore */ }
    }
    for (const k of ['bass', 'lead']) {
      try { inst[k].triggerRelease(); } catch { /* ignore */ }
    }
  };

  return inst;
}

/** Separate voices for stings so they sit on the (un-ducked) sfx bus. */
export function createStingInstruments(dest) {
  const out = (node) => { node.connect(dest); return node; };
  return {
    keys: out(poly(Tone.FMSynth, EP, 24, -8)),
    mallet: out(poly(Tone.FMSynth, MALLET, 16, -5)),
    bells: out(poly(Tone.FMSynth, BELL, 16, -11)),
    pizz: out(poly(Tone.MonoSynth, PIZZ, 4, -11)),
  };
}
