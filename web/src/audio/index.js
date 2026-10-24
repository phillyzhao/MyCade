// miisterygames audio engine: music (Tone.Transport + Parts), stings, synthesized sfx and loops.
// Importing this module never creates audio nodes; everything is built inside unlock().
import * as Tone from 'tone';
import { createMusicInstruments, createStingInstruments } from './instruments.js';
import { buildTrack, TRACKS } from './tracks.js';
import { createSfx } from './sfx.js';

const LS_KEY = 'miisterygames.audio.muted';
const DUCK_DB = -10;

let ready = false;
let unlocking = null;
let N = null; // audio graph + instruments once unlocked

let masterVol = 0.8;
let muted = readMuted();

let currentName = null;
let current = null;
let pendingTrack = null;
let switchToken = 0;
let duckUntil = 0;
const pendingLoops = new Set();

function readMuted() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}
function writeMuted(m) {
  try { localStorage.setItem(LS_KEY, m ? '1' : '0'); } catch { /* ignore */ }
}

function build() {
  const ctx = Tone.getContext();
  try { ctx.lookAhead = 0.05; } catch { /* ignore */ }

  const masterGain = new Tone.Gain(0).toDestination();
  const limiter = new Tone.Limiter(-1).connect(masterGain);
  const comp = new Tone.Compressor({ threshold: -16, ratio: 3, attack: 0.01, release: 0.25 }).connect(limiter);
  const reverb = new Tone.Reverb({ decay: 2.6, preDelay: 0.02, wet: 1 }).connect(comp);

  // music: instruments -> musicIn -> fade (track switches) -> duck (stings) -> comp, + reverb send
  const musicIn = new Tone.Gain(1.5);
  const musicFade = new Tone.Gain(0);
  const musicDuck = new Tone.Volume(0);
  musicIn.connect(musicFade);
  musicFade.connect(musicDuck);
  musicDuck.connect(comp);
  const musicSend = new Tone.Gain(0.3);
  musicDuck.connect(musicSend);
  musicSend.connect(reverb);

  // sfx bus
  const sfxIn = new Tone.Gain(1);
  sfxIn.connect(comp);
  const sfxSend = new Tone.Gain(0.12);
  sfxIn.connect(sfxSend);
  sfxSend.connect(reverb);

  const musicInst = createMusicInstruments(musicIn);
  const stingInst = createStingInstruments(sfxIn);
  const fx = createSfx({ dest: sfxIn, verb: reverb, duck, stingInst });

  N = { masterGain, limiter, comp, reverb, musicIn, musicFade, musicDuck, sfxIn, musicInst, stingInst, fx };
}

function applyVolume(rampSec = 0.05) {
  if (!N) return;
  const target = muted ? 0 : Math.max(0, Math.min(1, masterVol));
  try { N.masterGain.gain.rampTo(target, rampSec); } catch { /* ignore */ }
}

function duck(sec) {
  if (!N) return;
  const v = N.musicDuck.volume;
  const now = Tone.now();
  const end = now + sec;
  if (end <= duckUntil) return;
  const already = duckUntil > now;
  duckUntil = end;
  try {
    v.cancelAndHoldAtTime(now);
    if (!already) v.linearRampToValueAtTime(DUCK_DB, now + 0.08);
    else v.setValueAtTime(DUCK_DB, now + 0.01);
    v.setValueAtTime(DUCK_DB, end);
    v.linearRampToValueAtTime(0, end + 0.6);
  } catch { /* ignore */ }
}

function stopCurrentNow() {
  const tr = Tone.getTransport();
  if (current) { current.stop(); current = null; }
  try { tr.stop(); } catch { /* ignore */ }
  N?.musicInst.silence();
}

function startTrack(name) {
  const track = buildTrack(name, N.musicInst);
  if (!track) return;
  const tr = Tone.getTransport();
  tr.bpm.value = track.bpm;
  tr.swingSubdivision = '8n';
  tr.swing = track.swing || 0;
  tr.position = 0;
  track.start();
  tr.start('+0.05');
  current = track;
  const g = N.musicFade.gain;
  try { g.cancelScheduledValues(Tone.now()); } catch { /* ignore */ }
  g.rampTo(1, 0.3);
}

function playMusic(name) {
  if (!TRACKS[name]) return;
  if (!ready) { pendingTrack = name; return; }
  if (name === currentName && current) return;
  currentName = name;
  const token = ++switchToken;
  if (!current) {
    stopCurrentNow();
    startTrack(name);
    return;
  }
  // ~0.6s crossfade: fade out 0.3s, swap parts/bpm, fade in 0.3s
  N.musicFade.gain.rampTo(0, 0.3);
  setTimeout(() => {
    if (token !== switchToken) return;
    stopCurrentNow();
    startTrack(name);
  }, 320);
}

function stopMusic(fadeSec = 0.5) {
  pendingTrack = null;
  if (!ready) return;
  currentName = null;
  const token = ++switchToken;
  const f = Math.max(0.01, fadeSec);
  N.musicFade.gain.rampTo(0, f);
  setTimeout(() => {
    if (token !== switchToken) return;
    stopCurrentNow();
  }, f * 1000 + 30);
}

function unlock() {
  if (ready) {
    return Tone.start().catch(() => {});
  }
  if (!unlocking) {
    unlocking = (async () => {
      await Tone.start(); // invoked synchronously within the caller's gesture
      build();
      ready = true;
      applyVolume(0.1);
      if (pendingTrack) {
        const t = pendingTrack;
        pendingTrack = null;
        playMusic(t);
      }
      for (const h of pendingLoops) h._attach();
      pendingLoops.clear();
    })().catch((e) => {
      unlocking = null;
      console.warn('[audio] unlock failed', e);
    });
  }
  return unlocking;
}

function sting(name) {
  if (!ready) return;
  const dur = N.fx.sting(name);
  if (dur) duck(dur + 0.2);
}

function sfx(name, opts) {
  if (!ready) return;
  N.fx.play(name, opts || {});
}

function loop(name) {
  let real = null;
  let stopped = false;
  const state = { rate: 1, volume: 0.6 };
  const h = {
    set(o = {}) {
      if (o.rate != null) state.rate = o.rate;
      if (o.volume != null) state.volume = o.volume;
      if (real) real.set(o);
    },
    stop() {
      stopped = true;
      pendingLoops.delete(h);
      if (real) real.stop();
      real = null;
    },
    _attach() {
      if (stopped || real) return;
      try { real = N.fx.loop(name, state); } catch { real = null; }
    },
  };
  if (ready) h._attach();
  else pendingLoops.add(h);
  return h;
}

export const audio = {
  unlock,
  playMusic,
  stopMusic,
  sting,
  sfx,
  loop,
  setMasterVolume(v) {
    masterVol = Math.max(0, Math.min(1, Number(v) || 0));
    applyVolume();
  },
  toggleMute() {
    muted = !muted;
    writeMuted(muted);
    applyVolume();
    return muted;
  },
  get muted() { return muted; },
};

export default audio;
