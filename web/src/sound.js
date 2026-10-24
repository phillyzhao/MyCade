// Sound facade. Music: Lyria-generated tracks (web/public/music) played through <audio> with
// crossfades; falls back to the synthesized Tone.js score. SFX + stings: synthesized engine.
let engine = null;
const pending = [];
import('./audio/index.js')
  .then((m) => {
    engine = m.audio || m.default;
    for (const [fn, args] of pending.splice(0)) engine?.[fn]?.(...args);
  })
  .catch((e) => console.warn('[sound] audio engine unavailable', e));

const call = (fn, ...args) => {
  try {
    if (engine) return engine[fn]?.(...args);
    if (fn === 'unlock' || fn === 'playMusic') pending.push([fn, args]);
  } catch (e) {
    console.warn('[sound]', fn, e);
  }
};

// ---------- file-based music ----------
const MUSIC_VOL = 0.55;
let tracks = null;
fetch('/music/tracks.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((t) => {
    tracks = t || {};
    if (wanted) playFile(wanted);
  })
  .catch(() => (tracks = {}));

let muted = false;
try {
  muted = localStorage.getItem('mycade.muted') === '1';
} catch {}
let wanted = null;
let current = null; // {name, el}
let duck = 1;
let unlocked = false;

function fade(el, to, ms, done) {
  const from = el.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  step();
}

function targetVol() {
  return muted ? 0 : MUSIC_VOL * duck;
}

function playFile(name) {
  if (!tracks) return true; // still loading; will retry
  const src = tracks[name];
  if (!src) return false;
  if (current?.name === name) return true;
  const el = new Audio(src);
  el.loop = true;
  el.volume = 0;
  el.preload = 'auto';
  const old = current;
  current = { name, el };
  const start = () =>
    el
      .play()
      .then(() => fade(el, targetVol(), 700))
      .catch(() => {}); // blocked until the first user gesture; unlock() retries
  start();
  if (old) fade(old.el, 0, 600, () => old.el.pause());
  return true;
}

export const sound = {
  unlock: () => {
    call('unlock');
    if (!unlocked && current) {
      unlocked = true;
      current.el.play().then(() => fade(current.el, targetVol(), 500)).catch(() => {});
    }
  },
  music: (track) => {
    wanted = track;
    if (playFile(track)) {
      call('stopMusic', 0.3);
      return;
    }
    call('playMusic', track);
  },
  stopMusic: (f) => {
    wanted = null;
    if (current) {
      const c = current;
      current = null;
      fade(c.el, 0, (f || 0.5) * 1000, () => c.el.pause());
    }
    call('stopMusic', f);
  },
  sfx: (name, opts) => {
    call('sfx', name, opts);
    if (name === 'pins' || name === 'cheer') duckMusic(1400);
  },
  sting: (name) => {
    call('sting', name);
    duckMusic(2200);
  },
  loop: (name) => {
    try {
      return engine?.loop?.(name) || { set() {}, stop() {} };
    } catch {
      return { set() {}, stop() {} };
    }
  },
  toggleMute: () => {
    muted = !muted;
    try {
      localStorage.setItem('mycade.muted', muted ? '1' : '0');
    } catch {}
    if (current) current.el.volume = targetVol();
    const engMuted = engine?.muted;
    if (engMuted !== muted) call('toggleMute');
    return muted;
  },
  get muted() {
    return muted;
  },
};

let duckTimer = null;
function duckMusic(ms) {
  duck = 0.35;
  if (current) fade(current.el, targetVol(), 150);
  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duck = 1;
    if (current) fade(current.el, targetVol(), 600);
  }, ms);
}
