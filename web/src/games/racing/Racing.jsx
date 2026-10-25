// Cloud Karts: everyone races at once on one shared screen. Phone sideways = steering wheel,
// right half gas, left half brake, shake to fire a full boost meter. 3 laps.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { MODE } from '@shared/protocol.js';
import { Avatar, makeAnim } from '../../three/Avatar.jsx';
import { SkyDome, Lights } from '../../three/Scenery.jsx';
import { getInput, onPlayerEvent } from '../../host/input.js';
import { sendScreen, sendHaptic } from '../../host/net.js';
import { popup } from '../../ui/fx.jsx';
import { sound } from '../../sound.js';
import { AvatarHead } from '../../host/screens/PlayerBadge.jsx';

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
      if (Math.abs(lateral) > HALF_W + 2.2) {
        const push = (Math.abs(lateral) - HALF_W - 2.2) * Math.sign(lateral);
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

function Kart({ k }) {
  const g = useRef();
  const flame = useRef();
  useFrame(() => {
    if (!g.current) return;
    g.current.position.set(k.x, 0, k.z);
    g.current.rotation.y = k.h;
    if (flame.current) flame.current.visible = k.boosting > 0;
  });
  return (
    <group ref={g}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.95, 0.32, 1.5]} />
        <meshPhysicalMaterial color={k.p.color} clearcoat={1} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.3, 0.82]} castShadow>
        <boxGeometry args={[1.05, 0.18, 0.2]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {[[-0.52, 0.5], [0.52, 0.5], [-0.52, -0.5], [0.52, -0.5]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.18, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.18, 0.18, 0.16, 16]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      <mesh ref={flame} position={[0, 0.3, -0.95]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.18, 0.7, 12]} />
        <meshBasicMaterial color="#ffd23a" toneMapped={false} />
      </mesh>
      <group position={[0, 0.3, -0.15]}>
        <Avatar player={k.p} anim={k.anim} scale={0.85} />
      </group>
      <Html position={[0, 1.55, 0]} center distanceFactor={22} zIndexRange={[5, 0]}>
        <div className="isle-tag" style={{ '--pc': k.p.color }}>
          {k.place}. {k.p.name}
        </div>
      </Html>
    </group>
  );
}

function Track() {
  const road = useMemo(() => trackGeometry([-HALF_W, HALF_W], 0.01), []);
  const curbL = useMemo(() => trackGeometry([HALF_W, HALF_W + 0.35], 0.02, (i) => (Math.floor(i / 6) % 2 ? [1, 0.18, 0.18] : [1, 1, 1])), []);
  const curbR = useMemo(() => trackGeometry([-HALF_W - 0.35, -HALF_W], 0.02, (i) => (Math.floor(i / 6) % 2 ? [1, 0.18, 0.18] : [1, 1, 1])), []);
  const neonL = useMemo(() => trackGeometry([HALF_W + 0.35, HALF_W + 0.45], 0.03), []);
  const neonR = useMemo(() => trackGeometry([-HALF_W - 0.45, -HALF_W - 0.35], 0.03), []);
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
        <meshStandardMaterial color="#2d6b1f" roughness={1} />
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
      {/* trackside trees */}
      {Array.from({ length: 26 }, (_, i) => {
        const s = SAMPLES[(i * 23) % N_SAMPLES];
        const n = NORMALS[(i * 23) % N_SAMPLES];
        const side = i % 2 ? 1 : -1;
        const x = s.x + n.x * side * (HALF_W + 3 + (i % 3));
        const z = s.z + n.z * side * (HALF_W + 3 + (i % 3));
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 0.5, 0]} castShadow>
              <cylinderGeometry args={[0.12, 0.15, 1, 8]} />
              <meshStandardMaterial color="#6b3a1a" />
            </mesh>
            <mesh position={[0, 1.3, 0]} castShadow>
              <sphereGeometry args={[0.7, 12, 10]} />
              <meshStandardMaterial color={i % 3 ? '#3fae2a' : '#62d321'} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Scene({ game }) {
  const { camera } = useThree();
  const g = game.current;
  const look = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    g.update(Math.min(dt, 1 / 20));
    // shared camera: keep the pack framed, never lose sight of the track
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const k of g.karts) {
      minX = Math.min(minX, k.x); maxX = Math.max(maxX, k.x);
      minZ = Math.min(minZ, k.z); maxZ = Math.max(maxZ, k.z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, (maxZ - minZ) * 1.6, 10);
    const dist = Math.min(46, 8 + span * 0.95);
    const want = new THREE.Vector3(cx, dist * 0.82, cz + dist * 0.62);
    camera.position.lerp(want, Math.min(1, dt * 1.8));
    look.current.lerp(new THREE.Vector3(cx, 0, cz - 0.5), Math.min(1, dt * 2.5));
    camera.lookAt(look.current);
  });
  return (
    <>
      <SkyDome />
      <Lights shadowSize={26} />
      <Track />
      {g.karts.map((k) => (
        <Kart key={k.p.id} k={k} />
      ))}
    </>
  );
}

export default function Racing({ players, playing, onDone }) {
  const game = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [, setTick] = useState(0);
  if (!game.current) game.current = new RaceGame(players, { onDone: (r) => onDoneRef.current(r) });
  useEffect(() => {
    if (playing && !game.current.running) game.current.start();
  }, [playing]);
  useEffect(() => {
    for (const k of game.current.karts) {
      const np = players.find((p) => p.id === k.p.id);
      if (np) k.p = np;
    }
  }, [players]);
  useEffect(() => onPlayerEvent((pid, ev) => game.current?.onEvent(pid, ev)), []);
  useEffect(() => {
    const iv = setInterval(() => setTick((x) => x + 1), 200);
    sendScreen('all', { mode: MODE.RACE, title: 'Get ready', prompt: 'Hold your phone sideways like a wheel', sub: 'Right = gas · Left = brake', boost: 0 });
    return () => {
      clearInterval(iv);
      game.current?.dispose();
    };
  }, []);
  const g = game.current;
  const corners = [
    { left: 16, top: 14 },
    { right: 16, top: 14 },
    { left: 16, bottom: 16 },
    { right: 16, bottom: 16 },
  ];
  return (
    <>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 30, 22], fov: 42 }}>
        <Scene game={game} />
      </Canvas>
      <div className="hud">
        {g.karts.map((k, i) => (
          <div key={k.p.id} className="race-chip panel" style={{ ...corners[i % 4], ...(i >= 4 ? { top: 90 + (i - 4) * 70 } : {}), borderColor: k.p.color }}>
            <span className="pos">{ordinal(k.place)}</span>
            <AvatarHead player={k.p} size={36} />
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>{k.p.name}</div>
              <div className="lap">{k.finished != null ? fmtTime(k.finished) : `LAP ${Math.max(1, Math.min(LAPS, k.lap + 1))}/${LAPS}`}</div>
              <div className={`boostbar ${k.boost >= 1 ? 'full' : ''}`}>
                <i style={{ width: `${k.boost * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
        <div className="timer-chip panel" style={{ fontSize: 30 }}>
          {fmtTime(g.t)}
        </div>
      </div>
    </>
  );
}
