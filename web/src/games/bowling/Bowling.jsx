// Strike Lanes: tilt to aim, hold A + swing + release to bowl. Rapier physics pins, classic scoring.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MODE } from '@shared/protocol.js';
import { Avatar, makeAnim } from '../../three/Avatar.jsx';
import { SkyDome, Lights, Clouds, Bubbles } from '../../three/Scenery.jsx';
import { getInput, onPlayerEvent } from '../../host/input.js';
import { sendScreen, sendHaptic } from '../../host/net.js';
import { popup, confetti } from '../../ui/fx.jsx';
import { sound } from '../../sound.js';
import { AvatarHead } from '../../host/screens/PlayerBadge.jsx';
import { scoreFrames, frameDone, needsFreshRack } from './scoring.js';

const FRAMES = Number(new URLSearchParams(location.search).get('frames')) || 3;
const LANE_W = 1.06;
const HEAD_Z = -14;
const PIN_SP = 0.3048;
const BALL_R = 0.109;
const PIN_H = 0.38;
const PIN_R = 0.06;
const START_Z = 0.7;

// standard 10-pin rack, head pin first
const RACK = (() => {
  const out = [];
  const rowZ = PIN_SP * Math.sin(Math.PI / 3);
  for (let row = 0; row < 4; row++)
    for (let k = 0; k <= row; k++) out.push([(k - row / 2) * PIN_SP, HEAD_Z - row * rowZ]);
  return out;
})();
const NEIGHBORS = RACK.map((a, i) => RACK.map((b, j) => (i !== j && Math.hypot(a[0] - b[0], a[1] - b[1]) < PIN_SP * 1.05 ? j : -1)).filter((j) => j >= 0));

function isSplit(standing) {
  // head pin down and standing pins form 2+ disconnected groups
  if (standing.includes(0) || standing.length < 2) return false;
  const set = new Set(standing);
  const seen = new Set();
  let groups = 0;
  for (const s of standing) {
    if (seen.has(s)) continue;
    groups++;
    const st = [s];
    while (st.length) {
      const c = st.pop();
      if (seen.has(c)) continue;
      seen.add(c);
      for (const n of NEIGHBORS[c]) if (set.has(n)) st.push(n);
    }
  }
  return groups > 1;
}

// ---------------- geometry / materials ----------------
function laneTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 2048;
  const ctx = cv.getContext('2d');
  const boards = 39;
  for (let b = 0; b < boards; b++) {
    const l = 58 + ((b * 37) % 11);
    ctx.fillStyle = `hsl(32, 60%, ${l}%)`;
    ctx.fillRect((b / boards) * 256, 0, 256 / boards + 1, 2048);
    ctx.fillStyle = 'rgba(90,50,10,0.18)';
    ctx.fillRect((b / boards) * 256, 0, 1, 2048);
  }
  // arrows / dots
  ctx.fillStyle = '#1c6fd1';
  for (let k = 0; k < 7; k++) {
    const x = ((5 + k * 5) / boards) * 256;
    const y = 1640 - Math.abs(3 - k) * 40;
    ctx.beginPath();
    ctx.moveTo(x, y - 30);
    ctx.lineTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, 1900, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ff5a5f';
  ctx.fillRect(0, 2040, 256, 8);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pinGeometry() {
  // lathe profile, height PIN_H, max radius PIN_R
  const prof = [
    [0.0, 0], [0.026, 0], [0.04, 0.03], [0.058, 0.09], [0.06, 0.13], [0.052, 0.18], [0.034, 0.235], [0.026, 0.27],
    [0.03, 0.31], [0.033, 0.34], [0.028, 0.365], [0.015, 0.378], [0.0, PIN_H],
  ].map(([r, y]) => new THREE.Vector2(r, y - PIN_H / 2));
  const g = new THREE.LatheGeometry(prof, 24);
  // red neck stripes via vertex colors
  const pos = g.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + PIN_H / 2;
    const red = (y > 0.245 && y < 0.258) || (y > 0.266 && y < 0.279);
    colors.push(red ? 0.95 : 1, red ? 0.15 : 1, red ? 0.2 : 1);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------- physics world ----------------
function buildWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const fixed = (hx, hy, hz, x, y, z, fr = 0.5, rest = 0.2) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(fr).setRestitution(rest), b);
    return b;
  };
  const laneLen = Math.abs(HEAD_Z) + 4;
  // oily lane surface (low friction), pin deck slightly grippier
  fixed(LANE_W / 2, 0.1, laneLen / 2, 0, -0.1, -laneLen / 2 + 3, 0.04, 0.05);
  fixed(LANE_W / 2 + 0.01, 0.1, 0.8, 0, -0.1001, HEAD_Z - 0.35, 0.3, 0.05);
  // gutters (lower channels) + outer walls
  for (const s of [-1, 1]) {
    fixed(0.12, 0.1, laneLen / 2, s * (LANE_W / 2 + 0.12), -0.16, -laneLen / 2 + 3, 0.2, 0.05);
    fixed(0.03, 0.3, laneLen / 2, s * (LANE_W / 2 + 0.27), 0.1, -laneLen / 2 + 3, 0.3, 0.3);
    // kickback walls at the pin deck
    fixed(0.03, 0.4, 1.4, s * (LANE_W / 2 + 0.27), 0.3, HEAD_Z - 0.6, 0.3, 0.6);
  }
  // pit floor + back cushion
  fixed(1.2, 0.1, 1.5, 0, -0.55, HEAD_Z - 2.6, 0.8, 0.05);
  fixed(1.2, 0.8, 0.1, 0, 0.2, HEAD_Z - 3.2, 0.8, 0.05);
  return world;
}

function makePin(world, x, z) {
  const b = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, PIN_H / 2 + 0.001, z).setLinearDamping(0.1).setAngularDamping(0.25).setCanSleep(true),
  );
  // two colliders: belly + neck, total ~1.5 kg, low centre of mass
  // flat-bottomed belly cylinder (stable when standing) + light neck capsule => low centre of mass
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.095, 0.055).setTranslation(0, -0.095, 0).setDensity(900).setFriction(0.5).setRestitution(0.45), b);
  world.createCollider(RAPIER.ColliderDesc.capsule(0.06, 0.032).setTranslation(0, 0.08, 0).setDensity(250).setFriction(0.5).setRestitution(0.45), b);
  return b;
}

// ---------------- scene ----------------
function Scene({ game }) {
  const { camera } = useThree();
  const laneTex = useMemo(laneTexture, []);
  const pinGeo = useMemo(pinGeometry, []);
  const pinMat = useMemo(() => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }), []);
  const pinRefs = useRef([]);
  const ballRef = useRef();
  const camTarget = useRef(new THREE.Vector3(0, 0.4, -6));
  const g = game.current;

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    g.update(dt);
    // sync pins
    g.pins.forEach((p, i) => {
      const m = pinRefs.current[i];
      if (!m) return;
      if (!p.body) {
        m.visible = false;
        return;
      }
      m.visible = true;
      const t = p.body.translation();
      const r = p.body.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
    });
    // ball
    const bm = ballRef.current;
    if (bm) {
      if (g.ball) {
        const t = g.ball.translation();
        const r = g.ball.rotation();
        bm.position.set(t.x, t.y, t.z);
        bm.quaternion.set(r.x, r.y, r.z, r.w);
        bm.visible = true;
      } else if (g.phase === 'aim' || g.phase === 'grip') {
        bm.visible = true;
        bm.position.set(g.aimX + 0.17, 0.32 + (g.phase === 'grip' ? Math.sin(state.clock.elapsedTime * 3) * 0.01 : 0), START_Z + 0.05);
      } else bm.visible = false;
      bm.material.color.set(g.currentColor());
    }
    // camera choreography
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (g.phase === 'roll' && g.ball) {
      const t = g.ball.translation();
      if (t.z > HEAD_Z + 3.2) {
        want.set(t.x * 0.6, 0.75, t.z + 2.4);
        look.set(t.x * 0.4, 0.15, t.z - 4);
      } else {
        want.set(0.0, 1.0, HEAD_Z + 2.6);
        look.set(0, 0.1, HEAD_Z - 0.4);
      }
    } else if (g.phase === 'settle' || g.phase === 'result') {
      want.set(0.25, 1.1, HEAD_Z + 2.3);
      look.set(0, 0.12, HEAD_Z - 0.4);
    } else {
      want.set(g.aimX * 0.8, 1.35, START_Z + 2.6);
      look.set(g.aimX * 0.3, 0.25, -7);
    }
    const k = 1 - Math.pow(0.02, dt);
    camera.position.lerp(want, k);
    camTarget.current.lerp(look, k);
    camera.lookAt(camTarget.current);
  });

  const cur = g.currentPlayer();
  return (
    <>
      <SkyDome />
      <Lights shadowSize={10} target={[0, 0, -6]} />
      <Clouds count={14} y={-6} spread={60} z={-20} />
      <Clouds count={8} y={10} spread={60} z={-40} />
      <Bubbles count={16} area={[14, 6, 30]} center={[0, 0.5, -8]} />
      {/* floating lane platform */}
      <group>
        <mesh position={[0, -0.002, -(Math.abs(HEAD_Z) + 4) / 2 + 3]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[LANE_W, Math.abs(HEAD_Z) + 4]} />
          <meshPhysicalMaterial map={laneTex} roughness={0.25} clearcoat={1} clearcoatRoughness={0.05} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * (LANE_W / 2 + 0.12), -0.07, -7]} receiveShadow>
              <boxGeometry args={[0.24, 0.02, 20]} />
              <meshPhysicalMaterial color="#c9d6e2" metalness={0.6} roughness={0.25} clearcoat={1} />
            </mesh>
            <mesh position={[s * (LANE_W / 2 + 0.29), 0.05, -7]} castShadow receiveShadow>
              <boxGeometry args={[0.06, 0.3, 20]} />
              <meshPhysicalMaterial color="#ffffff" clearcoat={1} roughness={0.2} />
            </mesh>
          </group>
        ))}
        {/* underside of platform */}
        <mesh position={[0, -0.45, -7]}>
          <boxGeometry args={[1.8, 0.7, 20.5]} />
          <meshPhysicalMaterial color="#e9f6ff" roughness={0.3} clearcoat={0.8} />
        </mesh>
        {/* approach */}
        <mesh position={[0, -0.001, 2.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[1.8, 2.4]} />
          <meshPhysicalMaterial color="#f6e2c2" roughness={0.35} clearcoat={0.6} />
        </mesh>
        {/* pinsetter canopy */}
        <mesh position={[0, 0.85, HEAD_Z - 1.4]}>
          <boxGeometry args={[1.8, 0.5, 2.8]} />
          <meshPhysicalMaterial color="#2a9df4" clearcoat={1} roughness={0.15} />
        </mesh>
        <mesh position={[0, 0.25, HEAD_Z - 3.25]}>
          <boxGeometry args={[1.8, 1.4, 0.1]} />
          <meshStandardMaterial color="#0d3559" />
        </mesh>
      </group>
      {g.pins.map((_, i) => (
        <mesh key={i} ref={(el) => (pinRefs.current[i] = el)} geometry={pinGeo} material={pinMat} castShadow />
      ))}
      <mesh ref={ballRef} castShadow>
        <sphereGeometry args={[BALL_R, 32, 24]} />
        <meshPhysicalMaterial color="#19b8ff" roughness={0.1} clearcoat={1} clearcoatRoughness={0.05} metalness={0.1} />
      </mesh>
      {cur && <Avatar player={cur} anim={g.anim} position={[g.aimX, 0, START_Z]} rotation={[0, Math.PI, 0]} />}
    </>
  );
}

// ---------------- game controller ----------------
class BowlingGame {
  constructor(players, hooks) {
    this.players = players;
    this.hooks = hooks;
    this.world = buildWorld();
    this.pins = RACK.map(() => ({ body: null }));
    this.ball = null;
    this.phase = 'intro';
    this.turn = 0; // player index
    this.frame = 0;
    this.rolls = Object.fromEntries(players.map((p) => [p.id, []]));
    this.frameRolls = [];
    this.aimX = 0;
    this.anim = makeAnim('idle');
    this.acc = 0;
    this.t = 0;
    this.bestSpeed = { value: 0, name: '' };
    this.strikes = {};
    this.rackPins();
  }

  currentPlayer() {
    return this.players[this.turn];
  }

  currentColor() {
    return this.currentPlayer()?.color || '#19b8ff';
  }

  rackPins() {
    for (const p of this.pins) if (p.body) this.world.removeRigidBody(p.body);
    this.pins = RACK.map(([x, z]) => ({ body: makePin(this.world, x, z), x, z }));
    this.hooks.onPins?.();
  }

  clearFallen() {
    for (const p of this.pins) {
      if (p.body && this.pinDown(p)) {
        this.world.removeRigidBody(p.body);
        p.body = null;
      }
    }
  }

  pinDown(p) {
    if (!p.body) return true;
    const t = p.body.translation();
    const r = p.body.rotation();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    return up.y < 0.8 || t.y < PIN_H / 2 - 0.05 || Math.hypot(t.x - p.x, t.z - p.z) > 0.12;
  }

  start() {
    this.beginTurn();
  }

  beginTurn() {
    const p = this.currentPlayer();
    this.phase = 'aim';
    this.anim.pose = 'aim';
    this.aimX = 0;
    this.t = 0;
    this.cpuPlan = p.cpu ? { x: (Math.random() - 0.5) * 0.4, at: 1.2 + Math.random() * 0.8, power: 0.55 + Math.random() * 0.45, spin: (Math.random() - 0.5) * 0.6 } : null;
    const ball = this.frameRolls.length + 1;
    for (const q of this.players) {
      if (q.id === p.id) sendScreen(q.id, { mode: MODE.BOWL, active: true, title: 'Your turn!', prompt: 'Tilt to aim', sub: 'Hold A, swing back + forward, let go!' });
      else sendScreen(q.id, { mode: MODE.BOWL, active: false, waitingFor: p.name, prompt: `${p.name} is up`, sub: `Frame ${this.frame + 1} · ball ${ball}` });
    }
    sendHaptic(p.id, [40, 60, 40]);
    this.hooks.onHud();
  }

  onEvent(pid, ev) {
    const p = this.currentPlayer();
    if (!p || pid !== p.id) return;
    if (this.phase === 'aim' && ev.kind === 'press' && ev.button === 'a' && ev.down) {
      this.phase = 'grip';
      this.anim.pose = 'bowl';
      this.anim.t = 0;
      this.hooks.onHud();
    }
    if ((this.phase === 'grip' || this.phase === 'aim') && ev.kind === 'release') {
      this.throwBall(ev.power, ev.spin || 0);
    }
  }

  throwBall(power, spin) {
    const p = this.currentPlayer();
    const pw = Math.max(0.22, Math.min(1, power));
    const speed = 4.2 + pw * 7.3; // m/s
    spin = Math.max(-1, Math.min(1, spin));
    this.spin = spin;
    const b = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(this.aimX + 0.12, BALL_R + 0.005, START_Z - 0.75).setCcdEnabled(true).setLinearDamping(0.02).setAngularDamping(0.05),
    );
    this.world.createCollider(RAPIER.ColliderDesc.ball(BALL_R).setDensity(6.5 / ((4 / 3) * Math.PI * BALL_R ** 3)).setFriction(0.2).setRestitution(0.1), b);
    b.setLinvel({ x: -spin * 0.15, y: 0, z: -speed }, true);
    b.setAngvel({ x: -speed / BALL_R, y: spin * 6, z: 0 }, true);
    this.ball = b;
    this.throwSpeed = speed;
    this.phase = 'roll';
    this.anim.pose = 'bowl';
    this.anim.t = 0.6;
    this.t = 0;
    this.hitSound = false;
    this.gutter = false;
    this.rollLoop = sound.loop('roll');
    sound.sfx('throw');
    const mph = speed * 2.237 * 1.5; // toy-scale lane, reported in friendly "lane mph"
    this.lastMph = mph;
    if (mph > this.bestSpeed.value) this.bestSpeed = { value: mph, name: p.name };
    popup({ text: `${mph.toFixed(0)} mph`, kind: 'info', duration: 900, top: '18%' });
    for (const q of this.players) sendScreen(q.id, { mode: MODE.BOWL, active: false, waitingFor: p.name, prompt: q.id === p.id ? 'Rolling…' : `${p.name} is rolling`, sub: '' });
  }

  update(dt) {
    this.t += dt;
    const p = this.currentPlayer();
    if (this.phase === 'aim' || this.phase === 'grip') {
      if (p?.cpu) {
        const plan = this.cpuPlan;
        this.aimX += (plan.x - this.aimX) * Math.min(1, dt * 2);
        if (this.t > plan.at && this.phase === 'aim') {
          this.phase = 'grip';
          this.anim.pose = 'bowl';
          this.anim.t = 0;
        }
        if (this.t > plan.at + 0.7) this.throwBall(plan.power, plan.spin);
      } else if (p) {
        const tilt = getInput(p.id).tilt.x;
        this.aimX = Math.max(-0.38, Math.min(0.38, this.aimX + tilt * dt * 0.9));
      }
      if (this.phase === 'grip') this.anim.t = Math.min(0.45, this.anim.t + dt * 0.8);
    }
    if (this.phase === 'roll' || this.phase === 'settle') {
      this.anim.t = Math.min(1, this.anim.t + dt * 1.2);
      // fixed-step physics
      this.acc += dt;
      while (this.acc > 1 / 120) {
        if (this.ball) {
          const t = this.ball.translation();
          // hook on the dry back end
          if (t.z < -5 && t.z > HEAD_Z - 0.3 && t.y > 0) {
            const m = this.ball.mass();
            this.ball.applyImpulse({ x: this.spin * 1.5 * m * (1 / 120), y: 0, z: 0 }, true);
          }
        }
        this.world.step();
        this.acc -= 1 / 120;
      }
      if (this.ball) {
        const t = this.ball.translation();
        const v = this.ball.linvel();
        const sp = Math.hypot(v.x, v.z);
        this.rollLoop?.set({ rate: Math.min(2, sp / 6), volume: t.y > -0.05 ? 0.8 : 0.2 });
        if (t.y < 0.06 && Math.abs(t.x) > LANE_W / 2 && t.z > HEAD_Z) this.gutter = true;
        if (!this.hitSound && t.z < HEAD_Z + 0.35) {
          this.hitSound = true;
          if (Math.abs(t.x) < LANE_W / 2 + 0.05 && t.y > -0.02) sound.sfx('pins', { volume: Math.min(1, sp / 8) });
        }
        if (t.z < HEAD_Z - 1.2 || t.y < -0.3 || (this.t > 1 && sp < 0.15) || this.t > 6) {
          this.world.removeRigidBody(this.ball);
          this.ball = null;
          this.rollLoop?.stop();
          this.phase = 'settle';
          this.t = 0;
        }
      } else if (this.phase === 'settle' && this.t > 1.6) {
        this.resolve();
      }
    }
    if (this.phase === 'result' && this.t > 2.0) this.advance();
  }

  resolve() {
    const p = this.currentPlayer();
    const standingBefore = this.pins.filter((x) => x.body).length;
    const standingIdx = this.pins.map((x, i) => (x.body && !this.pinDown(x) ? i : -1)).filter((i) => i >= 0);
    const knocked = standingBefore - standingIdx.length;
    this.frameRolls.push(knocked);
    this.rolls[p.id].push(knocked);
    const isLast = this.frame === FRAMES - 1;
    const first = this.frameRolls.length === 1 || (isLast && needsFreshRack(this.frameRolls.slice(0, -1), true));
    const cleared = standingIdx.length === 0;

    if (cleared && first) {
      popup({ text: 'STRIKE!', kind: 'gold', shake: true, confetti: { count: 180 }, duration: 2000 });
      sound.sting('strike');
      sound.sfx('cheer');
      this.anim.pose = 'cheer';
      this.strikes[p.id] = (this.strikes[p.id] || 0) + 1;
      sendHaptic(p.id, [80, 40, 80, 40, 160]);
    } else if (cleared) {
      popup({ text: 'SPARE!', kind: 'good', confetti: { count: 90 }, duration: 1800 });
      sound.sting('spare');
      sound.sfx('clap');
      this.anim.pose = 'cheer';
    } else if (knocked === 0 && this.lastGutter()) {
      popup({ text: 'GUTTER…', kind: 'bad', duration: 1700 });
      sound.sting('gutter');
      sound.sfx('aww');
      this.anim.pose = 'sad';
    } else if (knocked === 0) {
      popup({ text: 'Missed!', kind: 'bad', duration: 1500 });
      sound.sfx('aww');
      this.anim.pose = 'sad';
    } else if (first && isSplit(standingIdx)) {
      popup({ text: 'Split!', sub: `${knocked} pins`, kind: 'info', duration: 1700 });
      sound.sfx('aww');
      this.anim.pose = 'sad';
    } else {
      popup({ text: `${knocked}!`, kind: knocked >= 7 ? 'good' : 'info', duration: 1400 });
      sound.sfx(knocked >= 7 ? 'clap' : 'ding');
      this.anim.pose = knocked >= 5 ? 'cheer' : 'idle';
    }
    this.phase = 'result';
    this.t = 0;
    this.hooks.onHud();
  }

  lastGutter() {
    return this.gutter;
  }

  advance() {
    const isLast = this.frame === FRAMES - 1;
    if (frameDone(this.frameRolls, isLast)) {
      this.frameRolls = [];
      this.turn++;
      if (this.turn >= this.players.length) {
        this.turn = 0;
        this.frame++;
        if (this.frame >= FRAMES) return this.finish();
      }
      this.rackPins();
    } else if (needsFreshRack(this.frameRolls, isLast)) {
      this.rackPins();
    } else {
      this.clearFallen();
      // straighten survivors for a clean second ball
      for (const pin of this.pins) {
        if (!pin.body) continue;
        const t = pin.body.translation();
        pin.body.setTranslation({ x: t.x, y: PIN_H / 2 + 0.001, z: t.z }, true);
        pin.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        pin.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        pin.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        pin.x = t.x;
        pin.z = t.z;
      }
    }
    this.beginTurn();
  }

  finish() {
    this.phase = 'done';
    const standings = this.players.map((p) => {
      const s = scoreFrames(this.rolls[p.id], FRAMES).total;
      return { pid: p.id, score: s, label: `${s}` };
    });
    const highlights = [];
    if (this.bestSpeed.name) highlights.push(`Fastest bowl: ${this.bestSpeed.name}, ${this.bestSpeed.value.toFixed(0)} mph`);
    for (const p of this.players) if (this.strikes[p.id]) highlights.push(`${p.name}: ${this.strikes[p.id]} strike${this.strikes[p.id] > 1 ? 's' : ''}`);
    this.hooks.onDone({
      standings,
      highlights,
      records: this.bestSpeed.name ? { fastestBowl: { label: 'Fastest bowl', value: +this.bestSpeed.value.toFixed(1), display: `${this.bestSpeed.value.toFixed(0)} mph`, name: this.bestSpeed.name } } : {},
    });
  }

  dispose() {
    this.rollLoop?.stop();
    this.world.free();
  }
}

// ---------------- HUD ----------------
function Scoreboard({ game }) {
  const g = game.current;
  return (
    <div className="bowl-board glass">
      <table>
        <thead>
          <tr>
            <th />
            {Array.from({ length: FRAMES }, (_, i) => (
              <th key={i} className={g.frame === i ? 'cur' : ''}>
                {i + 1}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {g.players.map((p, pi) => {
            const sc = scoreFrames(g.rolls[p.id], FRAMES);
            return (
              <tr key={p.id} className={g.turn === pi ? 'active' : ''} style={{ '--pc': p.color }}>
                <td className="who">
                  <AvatarHead player={p} size={34} />
                  <span>{p.name}</span>
                </td>
                {sc.frames.map((f, i) => (
                  <td key={i} className="fr">
                    <div className="balls">
                      {f.balls.map((b, k) => (
                        <span key={k} className={b === 'X' ? 'x' : b === '/' ? 'sp' : ''}>
                          {b}
                        </span>
                      ))}
                    </div>
                    <div className="ft">{f.total ?? ''}</div>
                  </td>
                ))}
                <td className="tot">{sc.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Bowling({ players, playing, onDone }) {
  const [ready, setReady] = useState(false);
  const [, setHud] = useState(0);
  const game = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let alive = true;
    RAPIER.init().then(() => {
      if (!alive) return;
      game.current = new BowlingGame(players, {
        onHud: () => setHud((x) => x + 1),
        onDone: (r) => onDoneRef.current(r),
      });
      setReady(true);
    });
    return () => {
      alive = false;
      game.current?.dispose();
      game.current = null;
    };
  }, []);

  // keep live player data (Buddy swaps) in the game
  useEffect(() => {
    if (game.current) game.current.players = game.current.players.map((p) => players.find((x) => x.id === p.id) || p);
  }, [players]);

  useEffect(() => {
    if (playing && ready && game.current?.phase === 'intro') game.current.start();
  }, [playing, ready]);

  useEffect(() => onPlayerEvent((pid, ev) => game.current?.onEvent(pid, ev)), []);

  if (!ready) return <div className="boot">setting up the lanes…</div>;
  const g = game.current;
  const cur = g.currentPlayer();
  return (
    <>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 1.4, 3.4], fov: 50, near: 0.05, far: 300 }} gl={{ antialias: true }}>
        <Scene game={game} />
      </Canvas>
      <div className="hud">
        <Scoreboard game={game} />
        {cur && playing && (g.phase === 'aim' || g.phase === 'grip') && (
          <div className="hud-turn glass" style={{ '--pc': cur.color }}>
            <AvatarHead player={cur} size={52} />
            <div>
              <div className="who">{cur.name}</div>
              <div className="what">{g.phase === 'grip' ? 'Swing… and release!' : 'Tilt to aim · hold A'}</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
