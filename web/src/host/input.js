// Live per-player input. Written by the network layer at ~60 Hz, read by games inside useFrame.
const blank = () => ({
  t: 0,
  tilt: { x: 0, y: 0 },
  steer: 0,
  lin: 0,
  gyro: 0,
  acc: { x: 0, y: 0, z: 0 },
  rot: { alpha: 0, beta: 0, gamma: 0 },
  buttons: { a: false, b: false },
  gas: false,
  brake: false,
  recv: 0,
  latency: 0,
  history: [],
});

export const inputs = new Map();
const listeners = new Set();

export function getInput(pid) {
  let s = inputs.get(pid);
  if (!s) {
    s = blank();
    inputs.set(pid, s);
  }
  return s;
}

export function applyInput(pid, msg) {
  const s = getInput(pid);
  Object.assign(s, msg);
  s.recv = performance.now();
  s.history.push({ t: s.recv, tx: s.tilt.x, ty: s.tilt.y, st: s.steer, lin: s.lin, gyro: s.gyro });
  if (s.history.length > 180) s.history.shift();
}

/** Subscribe to discrete events. fn(pid, ev). Returns unsubscribe. */
export function onPlayerEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitPlayerEvent(pid, ev) {
  for (const fn of [...listeners]) fn(pid, ev);
}

// ---- Keyboard player (dev + demo fallback): arrows tilt/steer, space = A, enter = swing, S = shake
export const KEYBOARD_PID = 'kb';
const keys = new Set();
let kbHeldAt = 0;

export function installKeyboard() {
  const s = getInput(KEYBOARD_PID);
  const down = (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (keys.has(e.code)) return;
    keys.add(e.code);
    if (e.code === 'Space') {
      s.buttons = { ...s.buttons, a: true };
      kbHeldAt = performance.now();
      emitPlayerEvent(KEYBOARD_PID, { kind: 'press', button: 'a', down: true });
    }
    if (e.code === 'Enter') {
      emitPlayerEvent(KEYBOARD_PID, { kind: 'swing', power: 0.6 + Math.random() * 0.35, dir: keys.has('ArrowLeft') ? -1 : 1, smash: keys.has('ArrowUp'), twist: 0 });
      emitPlayerEvent(KEYBOARD_PID, { kind: 'press', button: 'a', down: true });
    }
    if (e.code === 'KeyS') emitPlayerEvent(KEYBOARD_PID, { kind: 'shake' });
    if (e.code === 'KeyF') emitPlayerEvent(KEYBOARD_PID, { kind: 'flick', strength: 12 });
    if (e.code === 'ArrowLeft') emitPlayerEvent(KEYBOARD_PID, { kind: 'nav', dir: -1 });
    if (e.code === 'ArrowRight') emitPlayerEvent(KEYBOARD_PID, { kind: 'nav', dir: 1 });
  };
  const up = (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') {
      s.buttons = { ...s.buttons, a: false };
      const held = performance.now() - kbHeldAt;
      const spin = keys.has('ArrowLeft') ? -0.6 : keys.has('ArrowRight') ? 0.6 : 0;
      emitPlayerEvent(KEYBOARD_PID, { kind: 'press', button: 'a', down: false });
      emitPlayerEvent(KEYBOARD_PID, { kind: 'release', power: Math.min(1, 0.35 + held / 1400), spin, held });
    }
  };
  let raf;
  const tick = () => {
    const tx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    const ty = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    s.tilt.x += (tx * 0.8 - s.tilt.x) * 0.15;
    s.tilt.y += (ty * 0.8 - s.tilt.y) * 0.15;
    s.steer = s.tilt.x;
    s.gas = keys.has('ArrowUp') || keys.has('KeyW');
    s.brake = keys.has('ArrowDown');
    s.recv = performance.now();
    raf = requestAnimationFrame(tick);
  };
  tick();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}
