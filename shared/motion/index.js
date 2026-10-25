// Motion toolkit: turns raw DeviceMotion samples into game-friendly signals.
// Runs on the phone so discrete events (swing, release, shake) fire with sensor-rate precision.
import { MOTION } from '../config.js';

export const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const deadzone = (v, dz) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));
const mag3 = (v) => Math.hypot(v.x, v.y, v.z);
const map01 = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);

/**
 * MotionEngine
 *  feed(sample) with {t, accG:{x,y,z}, acc:{x,y,z}|null, rot:{alpha,beta,gamma}}
 *  read .state for continuous values, subscribe with onEvent(fn) for discrete gestures.
 */
export class MotionEngine {
  constructor(cfg = MOTION) {
    this.cfg = cfg;
    // iOS Safari reports accelerationIncludingGravity inverted vs the spec/Android; calibration refines it
    this.sign = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent || '') ? -1 : 1;
    this.g = { x: 0, y: 0, z: cfg.gravity };
    this.g0 = { x: 0, y: 0, z: cfg.gravity };
    this.steerMode = 'landscapeLeft';
    this.steerZero = 0;
    this.calibrating = null;
    this.state = {
      tilt: { x: 0, y: 0 },
      steer: 0,
      lin: 0,
      gyro: 0,
      acc: { x: 0, y: 0, z: 0 },
      rot: { alpha: 0, beta: 0, gamma: 0 },
      g: this.g,
      calibrated: false,
    };
    this.listeners = new Set();
    this.history = []; // {t, lin, gyro, twist, up}
    this.swing = null;
    this.lastSwingT = -1e9;
    this.lastShakeT = -1e9;
    this.lastFlickT = -1e9;
    this.shakeSpikes = [];
    this.aHeld = false;
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  /** Start a calibration: hold the phone flat and still. Resolves when done. */
  calibrate(ms = 900) {
    return new Promise((resolve) => {
      this.calibrating = { until: performance.now() + ms, sum: { x: 0, y: 0, z: 0 }, n: 0, resolve };
    });
  }

  /** Zero the steering wheel at the current hold. */
  zeroSteer() {
    this.updateSteerMode();
    this.steerZero = 0;
    const a = this.rawSteerAngle();
    // only re-centre small offsets; a big angle means the phone is mid-turn, not resting
    if (Math.abs(a) < 0.5) this.steerZero = a;
  }

  rawSteerAngle() {
    const g = this.g;
    if (this.steerMode === 'landscapeLeft') return Math.atan2(g.y, g.x);
    if (this.steerMode === 'landscapeRight') return Math.atan2(-g.y, -g.x);
    return Math.atan2(-g.x, g.y);
  }

  /** Pick the wheel orientation from where gravity points in the screen plane (with hysteresis). */
  updateSteerMode() {
    const g = this.g;
    const ax = Math.abs(g.x);
    const ay = Math.abs(g.y);
    const cur = this.steerMode;
    if (cur === 'portrait' ? ax > ay * 1.25 : ax > ay * 0.8) {
      const m = g.x > 0 ? 'landscapeLeft' : 'landscapeRight';
      if (m !== cur) {
        this.steerMode = m;
        this.steerZero = 0;
      }
    } else if (ay > ax * 1.25 && cur !== 'portrait') {
      this.steerMode = 'portrait';
      this.steerZero = 0;
    }
  }

  setButton(name, down) {
    if (name !== 'a') return;
    if (down && !this.aHeld) {
      this.aHeld = true;
      this.gripT = performance.now();
    } else if (!down && this.aHeld) {
      this.aHeld = false;
      this.emitRelease();
    }
  }

  emitRelease() {
    const c = this.cfg.release;
    const now = performance.now();
    let peak = 0;
    let twist = 0;
    for (const h of this.history) {
      if (now - h.t > c.windowMs) continue;
      if (h.lin > peak) peak = h.lin;
      if (now - h.t < 260 && Math.abs(h.twist) > Math.abs(twist)) twist = h.twist;
    }
    this.emit({
      kind: 'release',
      power: map01(peak, c.minPeak, c.fullPeak),
      spin: clamp(twist / c.fullTwist),
      held: now - (this.gripT || now),
      peak,
      t: now,
    });
  }

  feed(s) {
    const c = this.cfg;
    const now = s.t ?? performance.now();
    const sg = this.sign;
    const accG = { x: s.accG.x * sg, y: s.accG.y * sg, z: s.accG.z * sg };

    // gravity estimate (low-pass)
    const a = c.gravityAlpha;
    this.g.x = lerp(this.g.x, accG.x, a);
    this.g.y = lerp(this.g.y, accG.y, a);
    this.g.z = lerp(this.g.z, accG.z, a);

    // linear acceleration: prefer the OS-provided value, otherwise subtract our gravity estimate
    const acc = s.acc && s.acc.x != null
      ? { x: s.acc.x * sg, y: s.acc.y * sg, z: s.acc.z * sg }
      : { x: accG.x - this.g.x, y: accG.y - this.g.y, z: accG.z - this.g.z };
    const lin = mag3(acc);
    const rot = s.rot || { alpha: 0, beta: 0, gamma: 0 };
    const gyro = Math.hypot(rot.alpha || 0, rot.beta || 0, rot.gamma || 0);

    if (this.calibrating) {
      const cal = this.calibrating;
      cal.sum.x += s.accG.x; cal.sum.y += s.accG.y; cal.sum.z += s.accG.z; cal.n++;
      if (now >= cal.until && cal.n > 3) {
        const avg = { x: cal.sum.x / cal.n, y: cal.sum.y / cal.n, z: cal.sum.z / cal.n };
        // only trust the sign if the phone really was flat (face up); otherwise keep the platform default
        if (Math.abs(avg.z) > Math.abs(avg.x) && Math.abs(avg.z) > Math.abs(avg.y) && Math.abs(avg.z) > 6) this.sign = avg.z >= 0 ? 1 : -1;
        this.g0 = { x: avg.x * this.sign, y: avg.y * this.sign, z: avg.z * this.sign };
        this.g = { ...this.g0 };
        this.state.g = this.g;
        this.state.calibrated = true;
        this.calibrating = null;
        cal.resolve(this.g0);
      }
    }

    // tilt: right-edge-down => +x, top-edge-away => +y, relative to calibrated rest pose
    const G = c.gravity;
    const tx = clamp(deadzone(clamp(-(this.g.x - this.g0.x) / G / c.tilt.maxTilt), c.tilt.deadzone));
    const ty = clamp(deadzone(clamp(-(this.g.y - this.g0.y) / G / c.tilt.maxTilt), c.tilt.deadzone));
    const st = this.state;
    st.tilt.x = lerp(st.tilt.x, tx, 1 - c.tilt.smoothing);
    st.tilt.y = lerp(st.tilt.y, ty, 1 - c.tilt.smoothing);

    // steering: phone held like a wheel, turning it in its own screen plane
    this.updateSteerMode();
    let ang = this.rawSteerAngle() - this.steerZero;
    if (ang > Math.PI) ang -= 2 * Math.PI;
    if (ang < -Math.PI) ang += 2 * Math.PI;
    const steer = clamp(deadzone(clamp((ang * 180) / Math.PI / c.steer.maxAngleDeg), c.steer.deadzone));
    st.steer = lerp(st.steer, steer, 1 - c.steer.smoothing);

    st.lin = lin;
    st.gyro = gyro;
    st.acc = acc;
    st.rot = rot;

    // world-up unit vector in device frame, used for smash / flick direction
    const gm = mag3(this.g) || 1;
    const up = (acc.x * this.g.x + acc.y * this.g.y + acc.z * this.g.z) / gm;

    this.history.push({ t: now, lin, gyro, twist: rot.gamma || 0, up });
    while (this.history.length && now - this.history[0].t > 800) this.history.shift();

    this.detectSwing(now, acc, lin, gyro, rot, up);
    this.detectShake(now, lin);
    this.detectFlick(now, up);
  }

  detectSwing(now, acc, lin, gyro, rot, up) {
    const c = this.cfg.swing;
    if (!this.swing) {
      if (now - this.lastSwingT < c.debounceMs) return;
      if (lin > c.minPeak && gyro > c.minGyro) {
        this.swing = { start: now, peak: lin, acc: { ...acc }, gyro, twist: rot.gamma || 0, up, rot: { ...rot } };
      }
      return;
    }
    const sw = this.swing;
    if (lin > sw.peak) {
      sw.peak = lin;
      sw.acc = { ...acc };
      sw.up = up;
      sw.rot = { ...rot };
    }
    if (Math.abs(rot.gamma || 0) > Math.abs(sw.twist)) sw.twist = rot.gamma || 0;
    if (gyro > sw.gyro) sw.gyro = gyro;
    if (lin < sw.peak * c.settleRatio || now - sw.start > 220) {
      this.swing = null;
      this.lastSwingT = now;
      const down = clamp(-sw.up / (sw.peak || 1), -1, 1);
      // horizontal direction: sign of the dominant yaw rate at the peak
      const yaw = Math.abs(sw.rot.alpha || 0) > Math.abs(sw.rot.beta || 0) ? sw.rot.alpha : sw.rot.beta;
      this.emit({
        kind: 'swing',
        power: map01(sw.peak, c.minPeak, c.fullPeak),
        dir: (yaw || 0) >= 0 ? 1 : -1,
        twist: clamp(sw.twist / 600),
        smash: down > c.smashDown,
        peak: sw.peak,
        t: now,
      });
    }
  }

  detectShake(now, lin) {
    const c = this.cfg.shake;
    const last = this.shakeSpikes[this.shakeSpikes.length - 1];
    if (lin > c.spike && (!last || now - last > 90)) this.shakeSpikes.push(now);
    while (this.shakeSpikes.length && now - this.shakeSpikes[0] > c.windowMs) this.shakeSpikes.shift();
    if (this.shakeSpikes.length >= c.count && now - this.lastShakeT > c.debounceMs) {
      this.lastShakeT = now;
      this.shakeSpikes = [];
      this.emit({ kind: 'shake', t: now });
    }
  }

  detectFlick(now, up) {
    const c = this.cfg.flick;
    if (up > c.minUp && now - this.lastFlickT > c.debounceMs && !this.swing) {
      this.lastFlickT = now;
      this.emit({ kind: 'flick', strength: up, t: now });
    }
  }
}
