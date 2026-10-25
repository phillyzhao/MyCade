// Cloud Karts: everyone races at once in split screen (chase cam per player). Phone sideways = steering wheel,
// right half gas, left half brake, shake to fire a full boost meter. 3 laps.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MODE } from '@shared/protocol.js';
import { Avatar, makeAnim } from '../../three/Avatar.jsx';
import { SkyDome, Lights, Hills } from '../../three/Scenery.jsx';
import { StudioEnv, Post } from '../../three/Stage.jsx';
import { getInput, onPlayerEvent } from '../../host/input.js';
import { sendScreen, sendHaptic } from '../../host/net.js';
import { popup } from '../../ui/fx.jsx';
import { sound } from '../../sound.js';
import { AvatarHead } from '../../host/screens/PlayerBadge.jsx';
import { Kart } from '../../three/models/Kart.jsx';
import { Trees, Bushes, Rocks, Tires, Balloons, Banners, Grandstand } from '../../three/models/Props.jsx';

const LAPS = 3;
const HALF_W = 1.9;
const MAX_SPEED = 10.5;
const GRASS_SPEED = 4.2;
const N_SAMPLES = 600;

// closed loop with a hairpin, an S-bend and a long straight
const CONTROL = [
  [-14, 0], [-14, -7], [-10, -11], [-3, -11], [0, -7], [3, -3], [8, -3], [13, -6], [16, -2], [15, 5], [9, 9], [0, 9], [-8, 9], [-13, 6],
].map(([x, z]) => new THREE.Vector3(x * 1.35, 0, z * 1.35));
const CURVE = new THREE.CatmullRomCurve3(CONTROL, true, 'centripetal');
const SAMPLES = CURVE.getSpacedPoints(N_SAMPLES).slice(0, N_SAMPLES);
const TANGENTS = SAMPLES.map((_, i) => SAMPLES[(i + 1) % N_SAMPLES].clone().sub(SAMPLES[(i - 1 + N_SAMPLES) % N_SAMPLES]).normalize());
const NORMALS = TANGENTS.map((t) => new THREE.Vector3(t.z, 0, -t.x)); // points to the left of travel
const BOOST_PADS = [0.18, 0.47, 0.8].map((u) => Math.floor(u * N_SAMPLES));

function nearestIndex(x, z, hint) {
  // local search around the previous index keeps progress continuous
  let best = hint;
  let bd = Infinity;
  for (let k = -40; k <= 40; k++) {
    const i = (hint + k + N_SAMPLES) % N_SAMPLES;
    const p = SAMPLES[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function trackGeometry(halfW, y = 0, colorFn) {
  const pos = [];
  const col = [];
  const idx = [];
  for (let i = 0; i <= N_SAMPLES; i++) {
    const k = i % N_SAMPLES;
    const p = SAMPLES[k];
    const n = NORMALS[k];
    pos.push(p.x + n.x * halfW[0], y, p.z + n.z * halfW[0], p.x + n.x * halfW[1], y, p.z + n.z * halfW[1]);
    const c = colorFn ? colorFn(i) : [1, 1, 1];
    col.push(...c, ...c);
    if (i < N_SAMPLES) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const WALL_OFF = HALF_W + 2.3;
const ARCHES = [0.1, 0.35, 0.62, 0.9].map((u) => Math.floor(u * N_SAMPLES));

function nearestGlobal(x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < N_SAMPLES; i += 3) {
    const d = (SAMPLES[i].x - x) ** 2 + (SAMPLES[i].z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// trackside dressing, placed off the asphalt and away from other stretches of track
const SCENERY = (() => {
  const out = { trees: [], bushes: [], rocks: [], tires: [], balloons: [], banners: [] };
  const clear = (x, z, margin) => {
    const ni = nearestGlobal(x, z);
    return Math.hypot(SAMPLES[ni].x - x, SAMPLES[ni].z - z) > HALF_W + margin;
  };
  for (let i = 0; i < 90; i++) {
    const k = (i * 37) % N_SAMPLES;
    const side = i % 2 ? 1 : -1;
    const off = WALL_OFF + 1.6 + (i % 5) * 1.7;
    const x = SAMPLES[k].x + NORMALS[k].x * side * off;
    const z = SAMPLES[k].z + NORMALS[k].z * side * off;
    if (!clear(x, z, 3)) continue;
    const item = { position: [x, 0, z], rotation: i * 1.7, scale: 0.8 + ((i * 13) % 7) * 0.08 };
    if (i % 3 === 0) out.bushes.push(item);
    else if (i % 7 === 0) out.rocks.push(item);
    else out.trees.push(item);
  }
  // tire stacks on the outside of the tightest corners, balloons + banners along straights
  for (const u of [0.12, 0.28, 0.55, 0.72, 0.93]) {
    const k = Math.floor(u * N_SAMPLES);
    for (const side of [-1, 1]) {
      const x = SAMPLES[k].x + NORMALS[k].x * side * (WALL_OFF + 0.6);
      const z = SAMPLES[k].z + NORMALS[k].z * side * (WALL_OFF + 0.6);
      if (clear(x, z, 1.5)) out.tires.push({ position: [x, 0, z] });
    }
  }
  for (let i = 0; i < 16; i++) {
    const k = (i * 41 + 9) % N_SAMPLES;
    const side = i % 2 ? 1 : -1;
    const x = SAMPLES[k].x + NORMALS[k].x * side * (WALL_OFF + 1.1);
    const z = SAMPLES[k].z + NORMALS[k].z * side * (WALL_OFF + 1.1);
    if (!clear(x, z, 1.5)) continue;
    if (i % 2) out.balloons.push({ position: [x, 0.7, z] });
    else out.banners.push({ position: [x, 0, z], rotation: Math.atan2(TANGENTS[k].x, TANGENTS[k].z), variant: i % 5 });
  }
  const s = SAMPLES[8];
  const n = NORMALS[8];
  out.stand = { position: [s.x + n.x * (WALL_OFF + 4), 0, s.z + n.z * (WALL_OFF + 4)], rotation: Math.atan2(-n.x, -n.z) };
  return out;
})();

function wallGeometry(off, y0, y1) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= N_SAMPLES; i++) {
    const k = i % N_SAMPLES;
    const p = SAMPLES[k];
    const n = NORMALS[k];
    pos.push(p.x + n.x * off, y0, p.z + n.z * off, p.x + n.x * off, y1, p.z + n.z * off);
    if (i < N_SAMPLES) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

class RaceGame {
  constructor(players, hooks) {
    this.hooks = hooks;
    this.t = 0;
    this.running = false;
    this.over = false;
    this.timeScale = 1;
    this.finishOrder = [];
    const start = SAMPLES[2];
    const tan = TANGENTS[2];
    const nrm = NORMALS[2];
    this.karts = players.map((p, i) => {
      const row = Math.floor(i / 2);
      const side = i % 2 ? -0.9 : 0.9;
      const x = start.x - tan.x * (1.6 + row * 1.8) + nrm.x * side;
      const z = start.z - tan.z * (1.6 + row * 1.8) + nrm.z * side;
      return {
        p, x, z, h: Math.atan2(tan.x, tan.z), speed: 0, idx: nearestIndex(x, z, 0), lap: 0, progress: 0,
        boost: 0.3, boosting: 0, finished: null, lapStart: 0, bestLap: null, anim: makeAnim('wheel'),
        cpu: p.cpu ? { lane: (Math.random() - 0.5) * 1.6, skill: 0.86 + Math.random() * 0.1, wob: Math.random() * 10 } : null,
        lastBoostSent: -1, place: i + 1, armed: false,
      };
    });
    // karts on the grid sit just behind the line: their first crossing starts lap 1
    for (const k of this.karts) {
      k.progress = k.idx / N_SAMPLES;
      if (k.progress > 0.5) k.lap = -1;
    }
  }

  start() {
    this.running = true;
    for (const k of this.karts) k.lapStart = 0;
    for (const k of this.karts) sendScreen(k.p.id, { mode: MODE.RACE, title: 'GO!', prompt: 'Steer like a wheel', sub: 'Right = gas · Left = brake · Shake = boost', boost: k.boost });
    this.engine = sound.loop('engine');
  }

  onEvent(pid, ev) {
    if (ev.kind !== 'shake' || !this.running) return;
    const k = this.karts.find((x) => x.p.id === pid);
    if (k) this.fireBoost(k);
  }

  fireBoost(k) {
    if (k.boost < 1 || k.finished) return;
    k.boost = 0;
    k.boosting = 1.6;
    sound.sfx('boost');
    sendHaptic(k.p.id, [60, 30, 120]);
    popup({ text: 'BOOST!', sub: k.p.name, kind: 'info', duration: 800, top: '15%' });
  }

  update(dtRaw) {
    if (!this.running || this.over) return;
    if (this.slowmo > 0) {
      this.slowmo -= dtRaw;
      this.timeScale = this.slowmo > 0 ? 0.3 : 1;
    }
    const dt = dtRaw * this.timeScale;
    this.t += dt;
    let avgSpeed = 0;
    for (const k of this.karts) {
      let steer = 0;
      let gas = false;
      let brake = false;
      if (k.finished) {
        gas = true;
        steer = this.autoSteer(k, 0);
        k.speed *= 1 - 0.8 * dt;
      } else if (k.cpu) {
        steer = this.autoSteer(k, k.cpu.lane + Math.sin(this.t * 0.7 + k.cpu.wob) * 0.6);
        gas = true;
        if (k.boost >= 1 && Math.random() < dt * 0.5) this.fireBoost(k);
      } else {
        const inp = getInput(k.p.id);
        steer = inp.steer;
        gas = inp.gas || inp.buttons?.a;
        brake = inp.brake;
      }
      k.steerIn = steer;
      // off-track check
      k.idx = nearestIndex(k.x, k.z, k.idx);
      const c = SAMPLES[k.idx];
      const lateral = (k.x - c.x) * NORMALS[k.idx].x + (k.z - c.z) * NORMALS[k.idx].z;
      const offTrack = Math.abs(lateral) > HALF_W;
      let max = (offTrack ? GRASS_SPEED : MAX_SPEED) * (k.cpu ? k.cpu.skill : 1);
      if (k.boosting > 0) {
        k.boosting -= dt;
        max *= 1.55;
        k.speed = Math.max(k.speed, max * 0.95);
      }
      if (gas && !k.finished) k.speed += 9 * dt;
      else k.speed -= 3 * dt;
      if (brake) k.speed -= 16 * dt;
      if (k.speed > max) k.speed += (max - k.speed) * Math.min(1, dt * 3);
      k.speed = Math.max(-2, k.speed);
      const turn = steer * 2.5 * Math.min(1, Math.abs(k.speed) / 4) * Math.sign(k.speed || 1);
      k.h -= turn * dt;
      k.x += Math.sin(k.h) * k.speed * dt;
      k.z += Math.cos(k.h) * k.speed * dt;
      // soft outer wall
      if (Math.abs(lateral) > WALL_OFF - 0.6) {
        const push = (Math.abs(lateral) - (WALL_OFF - 0.6)) * Math.sign(lateral);
        k.x -= NORMALS[k.idx].x * push;
        k.z -= NORMALS[k.idx].z * push;
        k.speed *= 0.9;
      }
      // boost pads + meter
      for (const b of BOOST_PADS) {
        if (Math.abs(k.idx - b) < 4 && Math.abs(lateral) < HALF_W * 0.6 && k.padCool !== b) {
          k.padCool = b;
          k.boosting = Math.max(k.boosting, 0.7);
          k.boost = Math.min(1, k.boost + 0.35);
          sound.sfx('boost', { volume: 0.6 });
        }
      }
      if (k.padCool != null && Math.abs(k.idx - k.padCool) > 20) k.padCool = null;
      k.boost = Math.min(1, k.boost + dt * 0.06);

      // progress + laps
      const prev = k.progress;
      const u = k.idx / N_SAMPLES;
      if (prev > 0.85 && u < 0.15) {
        k.lap++;
        if (!k.finished) this.onLap(k);
      } else if (prev < 0.15 && u > 0.85) k.lap--;
      k.progress = u;

      k.anim.pose = 'wheel';
      avgSpeed += Math.abs(k.speed);
    }

    // kart-to-kart bumps
    for (let i = 0; i < this.karts.length; i++)
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i];
        const b = this.karts[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0 && d < 1.3) {
          a.bumped = true;
          b.bumped = true;
          const o = (1.3 - d) / 2;
          a.x -= (dx / d) * o;
          a.z -= (dz / d) * o;
          b.x += (dx / d) * o;
          b.z += (dz / d) * o;
          if (!this.bumpCool || this.t - this.bumpCool > 0.4) {
            sound.sfx('bounce', { volume: 0.5 });
            this.bumpCool = this.t;
          }
        }
      }

    // standings
    const order = [...this.karts].sort((a, b) => {
      if (a.finished != null && b.finished != null) return a.finished - b.finished;
      if (a.finished != null) return -1;
      if (b.finished != null) return 1;
      return b.lap + b.progress - (a.lap + a.progress);
    });
    order.forEach((k, i) => {
      if (k.place !== i + 1 && this.t > 2 && !k.finished && !k.p.cpu) {
        sendScreen(k.p.id, { mode: MODE.RACE, title: ordinal(i + 1), prompt: `Lap ${Math.max(1, Math.min(LAPS, k.lap + 1))}/${LAPS}`, sub: 'Shake = boost', boost: k.boost });
      }
      k.place = i + 1;
    });
    for (const k of this.karts) {
      if (k.p.cpu || k.finished) continue;
      const b = Math.round(k.boost * 10) / 10;
      if (b !== k.lastBoostSent) {
        k.lastBoostSent = b;
        sendScreen(k.p.id, { mode: MODE.RACE, title: ordinal(k.place), prompt: `Lap ${Math.max(1, Math.min(LAPS, k.lap + 1))}/${LAPS}`, sub: b >= 1 ? 'SHAKE TO BOOST!' : 'Right = gas · Left = brake', boost: b });
      }
    }
    this.engine?.set({ rate: 0.4 + (avgSpeed / this.karts.length / MAX_SPEED) * 1.2, volume: 0.5 });

    const allDone = this.karts.every((k) => k.finished != null);
    const timeout = this.firstFinish != null && this.t - this.firstFinish > 20;
    if ((allDone || timeout) && !this.over) {
      this.over = true;
      this.engine?.stop();
      setTimeout(() => this.finish(), 1500);
    }
    this.hooks.onTick?.();
  }

  autoSteer(k, laneOffset) {
    const ahead = (k.idx + 22) % N_SAMPLES;
    const tp = SAMPLES[ahead];
    const n = NORMALS[ahead];
    const tx = tp.x + n.x * laneOffset;
    const tz = tp.z + n.z * laneOffset;
    const want = Math.atan2(tx - k.x, tz - k.z);
    let d = want - k.h;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return THREE.MathUtils.clamp(-d * 2.2, -1, 1);
  }

  onLap(k) {
    if (k.lap <= 0) {
      k.lapStart = this.t;
      return;
    }
    const lapTime = this.t - k.lapStart;
    if (k.lap >= 1 && (k.bestLap == null || lapTime < k.bestLap)) k.bestLap = lapTime;
    k.lapStart = this.t;
    if (k.lap >= LAPS) {
      k.finished = this.t;
      this.finishOrder.push(k);
      const place = this.finishOrder.length;
      if (place === 1) this.firstFinish = this.t;
      // photo finish: second kart within half a second
      if (place === 2 && this.t - this.firstFinish < 0.6) {
        this.slowmo = 1.4;
        popup({ text: 'PHOTO FINISH!', kind: 'gold', duration: 1800, shake: true });
      } else popup({ text: `${ordinal(place)}!`, sub: k.p.name, kind: place === 1 ? 'gold' : 'good', duration: 1500, confetti: place === 1 });
      sound.sfx(place === 1 ? 'cheer' : 'clap');
      k.anim.pose = 'cheer';
      sendScreen(k.p.id, { mode: MODE.WAIT, title: `${ordinal(place)}!`, prompt: `Finished in ${fmtTime(k.finished)}`, sub: '' });
      sendHaptic(k.p.id, [80, 40, 160]);
    } else {
      sound.sfx('lap');
      if (k.lap === LAPS - 1 && !k.p.cpu) popup({ text: 'FINAL LAP!', sub: k.p.name, kind: 'info', duration: 1100, top: '20%' });
    }
  }

  finish() {
    const standings = this.karts.map((k) => ({
      pid: k.p.id,
      score: k.finished != null ? k.finished : 9999 - (k.lap + k.progress),
      label: k.finished != null ? fmtTime(k.finished) : `DNF · lap ${Math.max(1, Math.min(LAPS, k.lap + 1))}`,
    }));
    const best = this.karts.filter((k) => k.bestLap != null).sort((a, b) => a.bestLap - b.bestLap)[0];
    const highlights = [];
    if (best) highlights.push(`Best lap: ${best.p.name}, ${fmtTime(best.bestLap)}`);
    if (this.finishOrder.length > 1) highlights.push(`Winning margin: ${(this.finishOrder[1].finished - this.finishOrder[0].finished).toFixed(2)}s`);
    this.hooks.onDone({
      standings,
      higherIsBetter: false,
      highlights,
      records: best ? { bestLap: { label: 'Best lap', value: +best.bestLap.toFixed(2), display: fmtTime(best.bestLap), name: best.p.name, lowerIsBetter: true } } : {},
    });
  }

  dispose() {
    this.engine?.stop();
  }
}

function ordinal(n) {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

function RaceKart({ k }) {
  const g = useRef();
  const src = useMemo(() => {
    const o = { steer: 0, speed: 0, boosting: false };
    return () => {
      o.steer = k.steerIn || 0;
      o.speed = k.speed;
      o.boosting = k.boosting > 0;
      return o;
    };
  }, [k]);
  useFrame(() => {
    if (!g.current) return;
    g.current.position.set(k.x, 0, k.z);
    g.current.rotation.y = k.h;
    // lean into turns
    g.current.rotation.z = THREE.MathUtils.lerp(g.current.rotation.z, -(k.steerIn || 0) * Math.min(1, Math.abs(k.speed) / 8) * 0.08, 0.2);
  });
  return (
    <group ref={g}>
      <Kart color={k.p.color} source={src}>
        <Avatar player={k.p} anim={k.anim} scale={0.85} />
      </Kart>
      <mesh position={[0, 1.6, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.09, 0.18, 4]} />
        <meshBasicMaterial color={k.p.color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.95, 20]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Track() {
  const road = useMemo(() => trackGeometry([-HALF_W, HALF_W], 0.01), []);
  const curbL = useMemo(() => trackGeometry([HALF_W, HALF_W + 0.35], 0.02, (i) => (Math.floor(i / 6) % 2 ? [1, 0.18, 0.18] : [1, 1, 1])), []);
  const curbR = useMemo(() => trackGeometry([-HALF_W - 0.35, -HALF_W], 0.02, (i) => (Math.floor(i / 6) % 2 ? [1, 0.18, 0.18] : [1, 1, 1])), []);
  const neonL = useMemo(() => trackGeometry([HALF_W + 0.35, HALF_W + 0.45], 0.03), []);
  const neonR = useMemo(() => trackGeometry([-HALF_W - 0.45, -HALF_W - 0.35], 0.03), []);
  const wallL = useMemo(() => wallGeometry(WALL_OFF, 0, 0.7), []);
  const wallR = useMemo(() => wallGeometry(-WALL_OFF, 0, 0.7), []);
  const wallTopL = useMemo(() => trackGeometry([WALL_OFF - 0.06, WALL_OFF + 0.06], 0.71), []);
  const wallTopR = useMemo(() => trackGeometry([-WALL_OFF - 0.06, -WALL_OFF + 0.06], 0.71), []);
  const start = SAMPLES[0];
  const startAngle = Math.atan2(TANGENTS[0].x, TANGENTS[0].z);
  const checker = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 16;
    const ctx = cv.getContext('2d');
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    return t;
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[140, 110]} />
        <meshStandardMaterial color="#4c9a2a" roughness={1} />
      </mesh>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial color="#34303a" roughness={0.8} />
      </mesh>
      <mesh geometry={curbL}>
        <meshStandardMaterial vertexColors roughness={0.6} />
      </mesh>
      <mesh geometry={curbR}>
        <meshStandardMaterial vertexColors roughness={0.6} />
      </mesh>
      <mesh geometry={neonL}>
        <meshBasicMaterial color="#ffd23a" toneMapped={false} />
      </mesh>
      <mesh geometry={neonR}>
        <meshBasicMaterial color="#ff2d2d" toneMapped={false} />
      </mesh>
      <mesh position={[start.x, 0.03, start.z]} rotation={[-Math.PI / 2, 0, startAngle]}>
        <planeGeometry args={[HALF_W * 2, 0.6]} />
        <meshBasicMaterial map={checker} />
      </mesh>
      {/* start arch */}
      <group position={[start.x, 0, start.z]} rotation={[0, startAngle, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (HALF_W + 0.7), 1.4, 0]} castShadow>
            <boxGeometry args={[0.3, 2.8, 0.3]} />
            <meshStandardMaterial color="#1e1518" />
          </mesh>
        ))}
        <mesh position={[0, 2.9, 0]}>
          <boxGeometry args={[HALF_W * 2 + 1.7, 0.5, 0.3]} />
          <meshBasicMaterial color="#ff2d2d" toneMapped={false} />
        </mesh>
      </group>
      {BOOST_PADS.map((b) => {
        const p = SAMPLES[b];
        const a = Math.atan2(TANGENTS[b].x, TANGENTS[b].z);
        return (
          <mesh key={b} position={[p.x, 0.04, p.z]} rotation={[-Math.PI / 2, 0, a]}>
            <planeGeometry args={[HALF_W * 1.1, 1.4]} />
            <meshBasicMaterial color="#9dff3a" toneMapped={false} transparent opacity={0.85} />
          </mesh>
        );
      })}
      <mesh geometry={wallL}>
        <meshStandardMaterial color="#2a1d21" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={wallR}>
        <meshStandardMaterial color="#2a1d21" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={wallTopL}>
        <meshBasicMaterial color="#ffd23a" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={wallTopR}>
        <meshBasicMaterial color="#ff2d2d" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <Hills radius={75} y={-0.5} />
      {ARCHES.map((a) => {
        const p = SAMPLES[a];
        const ang = Math.atan2(TANGENTS[a].x, TANGENTS[a].z);
        return (
          <group key={a} position={[p.x, 0, p.z]} rotation={[0, ang, 0]}>
            <mesh>
              <torusGeometry args={[HALF_W + 1.4, 0.16, 8, 32, Math.PI]} />
              <meshBasicMaterial color={a % 2 ? '#b04bff' : '#9dff3a'} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
      <Trees items={SCENERY.trees} />
      <Bushes items={SCENERY.bushes} />
      <Rocks items={SCENERY.rocks} />
      <Tires items={SCENERY.tires} />
      <Balloons items={SCENERY.balloons} />
      <Banners items={SCENERY.banners} />
      <Grandstand position={SCENERY.stand.position} rotation={SCENERY.stand.rotation} length={14} />
    </group>
  );
}

// split-screen layout: rects in CSS pixels, origin top-left
function layout(n, W, H) {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
  const out = [];
  const rows = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) out.push({ x: (i % 2) * (W / 2), y: Math.floor(i / 2) * (H / rows), w: W / 2, h: H / rows });
  return out;
}

function Scene({ game }) {
  const g = game.current;
  const cams = useMemo(() => g.karts.map(() => new THREE.PerspectiveCamera(64, 1, 0.1, 400)), [g]);
  const camState = useRef(
    g.karts.map((k) => ({
      pos: new THREE.Vector3(k.x - Math.sin(k.h) * 4, 2, k.z - Math.cos(k.h) * 4),
      look: new THREE.Vector3(k.x, 0.5, k.z),
    })),
  );
  const tmp = useMemo(() => ({ want: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const introStart = useRef(performance.now());
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    g.update(dt);
    const { gl, scene, size } = state;
    const rects = layout(g.karts.length, size.width, size.height);
    gl.setScissorTest(true);
    g.karts.forEach((k, i) => {
      const cam = cams[i];
      const cs = camState.current[i];
      // turn rate drives the Joyride-style swing + roll
      const turn = cs.lastH == null ? 0 : (k.h - cs.lastH) / Math.max(dt, 1e-3);
      cs.lastH = k.h;
      cs.turn = (cs.turn || 0) + (THREE.MathUtils.clamp(turn, -3, 3) - (cs.turn || 0)) * Math.min(1, dt * 4);
      const fx = Math.sin(k.h);
      const fz = Math.cos(k.h);
      const rx = -fz; // right vector
      const rz = fx;
      const spd = Math.abs(k.speed);
      if (!g.running) {
        // pre-race swoop: orbit from the front of the kart around to the chase position
        const tIntro = Math.min(1, (performance.now() - (g.introStart ?? introStart.current)) / 3200);
        const e = 1 - Math.pow(1 - tIntro, 3);
        const ang = k.h + Math.PI * (1 - e) + (i % 2 ? -0.4 : 0.4) * (1 - e);
        const dist = 2.6 + e * 1.5;
        tmp.want.set(k.x - Math.sin(ang) * dist, 1.0 + e * 1.2, k.z - Math.cos(ang) * dist);
        tmp.look.set(k.x, 0.55, k.z);
        cs.pos.copy(tmp.want);
        cs.look.copy(tmp.look);
      } else {
        const back = 3.7 + Math.min(1.6, spd * 0.12) + (k.boosting > 0 ? 0.8 : 0);
        const swing = -cs.turn * 0.55; // camera slides to the outside of the turn
        tmp.want.set(k.x - fx * back + rx * swing, 2.0 + spd * 0.02, k.z - fz * back + rz * swing);
        tmp.look.set(k.x + fx * 5 - rx * cs.turn * 0.9, 0.35, k.z + fz * 5 - rz * cs.turn * 0.9);
        cs.pos.lerp(tmp.want, Math.min(1, dt * 6));
        cs.look.lerp(tmp.look, Math.min(1, dt * 8));
      }
      cam.position.copy(cs.pos);
      if (k.boosting > 0 || cs.shake > 0) {
        const a = k.boosting > 0 ? 0.035 : cs.shake * 0.12;
        cam.position.x += (Math.random() - 0.5) * a;
        cam.position.y += (Math.random() - 0.5) * a;
      }
      cs.shake = Math.max(0, (cs.shake || 0) - dt * 2);
      if (k.bumped) {
        cs.shake = 1;
        k.bumped = false;
      }
      cam.fov += ((62 + (k.boosting > 0 ? 14 : 0) + Math.min(8, spd * 0.55)) - cam.fov) * Math.min(1, dt * 5);
      // roll into the turn
      cam.up.set(rx * cs.turn * 0.06, 1, rz * cs.turn * 0.06).normalize();
      const r = rects[i];
      cam.aspect = r.w / r.h;
      cam.updateProjectionMatrix();
      cam.lookAt(cs.look);
      const y = size.height - r.y - r.h;
      gl.setViewport(r.x, y, r.w, r.h);
      gl.setScissor(r.x, y, r.w, r.h);
      gl.render(scene, cam);
    });
    gl.setScissorTest(false);
  }, 1);
  return (
    <>
      <SkyDome />
      <StudioEnv />
      <Lights shadowSize={26} />
      <fog attach="fog" args={['#e0607a', 35, 120]} />
      <Track />
      {g.karts.map((k) => (
        <RaceKart key={k.p.id} k={k} />
      ))}
    </>
  );
}

function RacerHud({ k, rect, total, t }) {
  const tan = TANGENTS[k.idx];
  const wrongWay = k.speed > 2 && Math.sin(k.h) * tan.x + Math.cos(k.h) * tan.z < -0.3;
  const lapShown = Math.max(1, Math.min(LAPS, k.lap + 1));
  return (
    <div className="racer-hud" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, '--pc': k.p.color }}>
      <div className="rh-top">
        <div className="rh-lap">
          <span className="rh-lap-label">LAP</span>
          <span className="rh-lap-num">
            {lapShown}
            <small>/{LAPS}</small>
          </span>
        </div>
        <div className="rh-time">{fmtTime(k.finished ?? t)}</div>
        <div className="rh-name">
          <AvatarHead player={k.p} size={34} />
          {k.p.name}
        </div>
      </div>
      {wrongWay && <div className="rh-center">WRONG WAY!</div>}
      {k.finished != null && <div className="rh-center done">FINISHED!</div>}
      <div className="rh-bottom">
        <div className="rh-boost">
          <div className={`rh-boostbar ${k.boost >= 1 ? 'full' : ''}`}>
            <i style={{ width: `${k.boost * 100}%` }} />
          </div>
          <span>{k.boost >= 1 ? 'SHAKE TO BOOST!' : 'BOOST'}</span>
        </div>
        <div className="rh-speed">
          {Math.round(Math.abs(k.speed) * 9.5)}
          <small>km/h</small>
        </div>
        <div className="rh-place">
          {k.place}
          <sup>{ordinal(k.place).slice(-2)}</sup>
          <small>/{total}</small>
        </div>
      </div>
    </div>
  );
}

export default function Racing({ players, playing, phase, onDone }) {
  const game = useRef(null);
  const wrap = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [, setTick] = useState(0);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight - 62 });
  if (!game.current) game.current = new RaceGame(players, { onDone: (r) => onDoneRef.current(r) });
  useEffect(() => {
    if (playing && !game.current.running) game.current.start();
  }, [playing]);
  useEffect(() => {
    // replay the camera swoop during the 3-2-1
    if (phase === 'countdown') game.current.introStart = performance.now();
  }, [phase]);
  useEffect(() => {
    for (const k of game.current.karts) {
      const np = players.find((p) => p.id === k.p.id);
      if (np) k.p = np;
    }
  }, [players]);
  useEffect(() => onPlayerEvent((pid, ev) => game.current?.onEvent(pid, ev)), []);
  useEffect(() => {
    const iv = setInterval(() => setTick((x) => x + 1), 100);
    sendScreen('all', { mode: MODE.RACE, title: 'Get ready', prompt: 'Hold your phone sideways like a wheel', sub: 'Right = gas · Left = brake', boost: 0 });
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    if (wrap.current) ro.observe(wrap.current);
    return () => {
      clearInterval(iv);
      ro.disconnect();
      game.current?.dispose();
    };
  }, []);
  const g = game.current;
  const rects = layout(g.karts.length, size.w, size.h);
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <Canvas dpr={[1, 1.5]} gl={{ antialias: true }}>
        <Scene game={game} />
      </Canvas>
      <div className="hud">
        {g.karts.map((k, i) => (
          <RacerHud key={k.p.id} k={k} rect={rects[i]} total={g.karts.length} t={g.t} />
        ))}
        {g.karts.length > 1 && <div className="split-v" />}
        {g.karts.length > 2 && <div className="split-h" />}
      </div>
    </div>
  );
}
