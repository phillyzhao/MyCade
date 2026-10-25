// Sky Wobble: every player tilts their own floating island at once. Keep your Buddy on it.
// Wind gusts push everyone, islands shrink over time. Last one standing wins.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { MODE } from '@shared/protocol.js';
import { Avatar, makeAnim } from '../../three/Avatar.jsx';
import { SkyDome, Lights, Clouds } from '../../three/Scenery.jsx';
import { StudioEnv, Post } from '../../three/Stage.jsx';
import { getInput } from '../../host/input.js';
import { sendScreen, sendHaptic } from '../../host/net.js';
import { popup } from '../../ui/fx.jsx';
import { sound } from '../../sound.js';
import { AvatarHead } from '../../host/screens/PlayerBadge.jsx';

const DURATION = 60;
const MAX_TILT = THREE.MathUtils.degToRad(20);
const G = 9.81 * 0.38;
const SPACING = 2.7;

function islandX(i, n) {
  return (i - (n - 1) / 2) * SPACING;
}

class BalanceGame {
  constructor(players, hooks) {
    this.hooks = hooks;
    this.t = 0;
    this.running = false;
    this.over = false;
    this.wind = { x: 0, z: 0, tx: 0, tz: 0, next: 6, gust: 0 };
    this.state = players.map((p, i) => ({
      p,
      x: (Math.random() - 0.5) * 0.1,
      z: (Math.random() - 0.5) * 0.1,
      vx: 0,
      vz: 0,
      rotX: 0,
      rotZ: 0,
      alive: true,
      falling: 0,
      y: 0,
      time: 0,
      anim: makeAnim('balance'),
      cpuNoise: Math.random() * 10,
    }));
  }

  radius() {
    return Math.max(0.42, 1.1 - Math.max(0, this.t - 8) * 0.013);
  }

  start() {
    this.running = true;
    for (const s of this.state) sendScreen(s.p.id, { mode: MODE.BALANCE, title: 'Stay on!', prompt: 'Tilt to keep your Buddy on the island', sub: 'Hold your phone flat' });
  }

  update(dt) {
    if (!this.running || this.over) return;
    this.t += dt;
    const R = this.radius();
    // wind gusts
    const w = this.wind;
    if (this.t > w.next) {
      const a = Math.random() * Math.PI * 2;
      const strength = 0.9 + Math.min(1.6, this.t / 30);
      w.tx = Math.cos(a) * strength;
      w.tz = Math.sin(a) * strength;
      w.gust = 2.2;
      w.next = this.t + 5 + Math.random() * 3.5;
      popup({ text: 'WIND!', kind: 'info', duration: 1100, top: '22%' });
      sound.sfx('wind');
    }
    w.gust -= dt;
    const gk = w.gust > 0 ? 1 : 0;
    w.x += (w.tx * gk - w.x) * Math.min(1, dt * 2.5);
    w.z += (w.tz * gk - w.z) * Math.min(1, dt * 2.5);

    let alive = 0;
    for (const s of this.state) {
      if (s.alive) {
        let tx;
        let ty;
        if (s.p.cpu) {
          // CPU: lean against its own drift, imperfectly
          s.cpuNoise += dt;
          tx = THREE.MathUtils.clamp(-s.x * 1.6 - s.vx * 0.9 + Math.sin(s.cpuNoise * 1.7) * 0.25, -1, 1);
          ty = THREE.MathUtils.clamp(s.z * 1.6 + s.vz * 0.9 + Math.cos(s.cpuNoise * 1.3) * 0.25, -1, 1);
        } else {
          const inp = getInput(s.p.id);
          tx = inp.tilt.x;
          ty = inp.tilt.y;
        }
        const tRotZ = -tx * MAX_TILT;
        const tRotX = -ty * MAX_TILT;
        s.rotZ += (tRotZ - s.rotZ) * Math.min(1, dt * 10);
        s.rotX += (tRotX - s.rotX) * Math.min(1, dt * 10);
        const ax = -G * Math.sin(s.rotZ) + w.x;
        const az = G * Math.sin(s.rotX) + w.z;
        s.vx = (s.vx + ax * dt) * (1 - 0.9 * dt);
        s.vz = (s.vz + az * dt) * (1 - 0.9 * dt);
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        s.time = this.t;
        s.anim.pose = 'balance';
        s.anim.lean = THREE.MathUtils.clamp(s.vx * 1.2, -1, 1);
        const r = Math.hypot(s.x, s.z);
        if (r > R * 0.97) {
          s.alive = false;
          s.falling = 0.001;
          s.anim.pose = 'fall';
          sound.sfx('fall');
          sendHaptic(s.p.id, [200]);
          popup({ text: `${s.p.name} fell!`, kind: 'bad', duration: 1300 });
          sendScreen(s.p.id, { mode: MODE.WAIT, title: 'You fell!', prompt: `You lasted ${s.time.toFixed(1)}s`, sub: 'Cheer on the others!' });
        } else if (r > R * 0.8) {
          if (!s.warned) sendHaptic(s.p.id, [30]);
          s.warned = true;
        } else s.warned = false;
        alive++;
      } else if (s.falling) {
        s.falling += dt;
        s.y -= (2 + s.falling * 9) * dt;
        s.x += s.vx * dt;
        s.z += s.vz * dt;
      }
    }

    const n = this.state.length;
    const end = this.t >= DURATION || alive === 0 || (n > 1 && alive <= 1);
    if (end && !this.over) {
      this.over = true;
      // survivors get the full time + a bonus so they rank above everyone who fell
      for (const s of this.state) if (s.alive) s.time = this.t + 1000;
      const last = this.state.filter((s) => s.alive);
      if (last.length === 1) popup({ text: 'LAST ONE STANDING!', sub: last[0].p.name, kind: 'gold', duration: 1800 });
      else if (last.length > 1) popup({ text: 'TIME!', kind: 'gold', duration: 1500 });
      for (const s of last) s.anim.pose = 'cheer';
      sound.sfx('cheer');
      setTimeout(() => this.finish(), 1800);
    }
    this.hooks.onTick?.();
  }

  finish() {
    const fell = this.state.filter((s) => s.time < 1000);
    const best = fell.reduce((b, s) => (s.time > (b?.time || 0) ? s : b), null);
    const standings = this.state.map((s) => ({
      pid: s.p.id,
      score: Math.round(s.time * 10) / 10,
      label: s.time >= 1000 ? 'SURVIVED' : `${s.time.toFixed(1)}s`,
    }));
    const highlights = [];
    const surv = this.state.filter((s) => s.time >= 1000);
    if (surv.length) highlights.push(`Still standing: ${surv.map((s) => s.p.name).join(', ')}`);
    const first = fell.reduce((b, s) => (!b || s.time < b.time ? s : b), null);
    if (first) highlights.push(`First to fall: ${first.p.name} (${first.time.toFixed(1)}s)`);
    const records = {};
    const longest = this.state.reduce((b, s) => {
      const v = Math.min(s.time, this.t);
      return v > (b?.v || 0) ? { v, name: s.p.name } : b;
    }, null);
    if (longest) records.longestBalance = { label: 'Longest balance', value: +longest.v.toFixed(1), display: `${longest.v.toFixed(1)}s`, name: longest.name };
    this.hooks.onDone({ standings, highlights, records });
  }
}

function Island({ s, x, radius, game }) {
  const g = useRef();
  const body = useRef();
  const top = useRef();
  useFrame(() => {
    if (!g.current) return;
    g.current.rotation.x = s.rotX;
    g.current.rotation.z = s.rotZ;
    const R = game.current.radius();
    top.current.scale.set(R, 1, R);
    if (body.current) {
      body.current.position.set(s.x, s.y, s.z);
      body.current.rotation.z = s.falling ? s.falling * 6 : 0;
    }
  });
  return (
    <group position={[x, 0, 0]}>
      <group ref={g}>
        <group ref={top}>
          <mesh position={[0, -0.06, 0]} receiveShadow castShadow>
            <cylinderGeometry args={[1, 1, 0.12, 48]} />
            <meshPhysicalMaterial color="#7bdc3a" roughness={0.5} clearcoat={0.6} />
          </mesh>
          <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.9, 1.0, 48]} />
            <meshBasicMaterial color={s.p.color} toneMapped={false} />
          </mesh>
          <mesh position={[0, -0.5, 0]} castShadow>
            <coneGeometry args={[1, 0.8, 24]} />
            <meshStandardMaterial color="#8a4a1a" roughness={0.9} flatShading />
          </mesh>
        </group>
        <group ref={body}>
          <Avatar player={s.p} anim={s.anim} scale={0.75} />
        </group>
      </group>
      <Html position={[0, 1.55, 0]} center distanceFactor={9} zIndexRange={[5, 0]}>
        <div className="isle-tag" style={{ '--pc': s.p.color, opacity: s.alive ? 1 : 0.4 }}>
          {s.p.name}
        </div>
      </Html>
    </group>
  );
}

function Scene({ game }) {
  const { camera } = useThree();
  const g = game.current;
  const n = g.state.length;
  useFrame((_, dt) => {
    g.update(Math.min(dt, 1 / 20));
    const span = Math.max(1, n) * SPACING;
    camera.position.lerp(new THREE.Vector3(0, 2.4 + span * 0.28, 3.2 + span * 0.62), 0.05);
    camera.lookAt(0, 0, 0);
  });
  return (
    <>
      <SkyDome />
      <StudioEnv />
      <Post />
      <Lights shadowSize={12} />
      <Clouds count={10} y={-14} spread={50} z={-20} />
      <Clouds count={8} y={8} spread={60} z={-35} />
      {g.state.map((s, i) => (
        <Island key={s.p.id} s={s} x={islandX(i, n)} game={game} />
      ))}
    </>
  );
}

export default function Balance({ players, playing, onDone }) {
  const game = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [, setTick] = useState(0);
  if (!game.current) {
    game.current = new BalanceGame(players, { onDone: (r) => onDoneRef.current(r) });
  }
  useEffect(() => {
    if (playing && !game.current.running) game.current.start();
  }, [playing]);
  useEffect(() => {
    for (const s of game.current.state) {
      const np = players.find((p) => p.id === s.p.id);
      if (np) s.p = np;
    }
  }, [players]);
  useEffect(() => {
    const iv = setInterval(() => setTick((x) => x + 1), 200);
    return () => clearInterval(iv);
  }, []);
  const g = game.current;
  const left = Math.max(0, DURATION - g.t);
  return (
    <>
      <Canvas shadows="soft" dpr={[1, 2]} camera={{ position: [0, 5, 9], fov: 45 }}>
        <Scene game={game} />
      </Canvas>
      <div className="hud">
        <div className="timer-chip panel">{left.toFixed(0)}</div>
        <div className="alive-list">
          {g.state.map((s) => (
            <div key={s.p.id} className={`alive-item panel ${s.alive ? '' : 'out'}`} style={{ '--pc': s.p.color }}>
              <AvatarHead player={s.p} size={34} />
              {s.p.name}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
