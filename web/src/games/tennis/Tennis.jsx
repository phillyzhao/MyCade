// Rally Court: 2v2 doubles (or 1v1). Players auto-run to the ball; you time and power the swing.
// Swing hard and downward on a high ball to smash. No-ad scoring, first to N games.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MODE } from '@shared/protocol.js';
import { Avatar, makeAnim } from '../../three/Avatar.jsx';
import { SkyDome, Lights } from '../../three/Scenery.jsx';
import { StudioEnv, Post } from '../../three/Stage.jsx';
import { TennisStadium } from '../../three/models/Venues.jsx';
import { onPlayerEvent } from '../../host/input.js';
import { sendScreen, sendHaptic } from '../../host/net.js';
import { popup } from '../../ui/fx.jsx';
import { sound } from '../../sound.js';
import { AvatarHead } from '../../host/screens/PlayerBadge.jsx';

const GAMES_TO_WIN = Number(new URLSearchParams(location.search).get('games')) || 2;
const HALF_L = 8; // baseline z
const HALF_W = 4; // doubles sideline x
const SERVICE = 4.4;
const GRAV = 9.8 * 0.75;
const NET_H = 0.75;
const BASE_Z = 7.2; // where players stand
const PTS = ['0', '15', '30', '40'];
const TEAM_COLORS = ['#ffd23a', '#b04bff'];

class TennisGame {
  constructor(players, hooks) {
    this.hooks = hooks;
    // teams: alternate players so doubles split evenly
    this.team = [[], []];
    players.forEach((p, i) => this.team[i % 2].push(p));
    this.ents = players.map((p, i) => {
      const t = i % 2;
      const slot = Math.floor(i / 2);
      const n = this.team[t].length;
      const homeX = n === 1 ? 0 : slot === 0 ? -2 : 2;
      const side = t === 0 ? 1 : -1;
      return { p, t, homeX, x: homeX, z: side * BASE_Z, anim: makeAnim('ready'), swingT: 0, lastSwing: -9 };
    });
    this.ball = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0, live: false, lastHitTeam: -1, trail: [] };
    this.score = { pts: [0, 0], games: [0, 0] };
    this.serveTeam = 0;
    this.serveIdx = [0, 0];
    this.state = 'idle';
    this.t = 0;
    this.stateT = 0;
    this.rally = 0;
    this.longestRally = 0;
    this.stats = Object.fromEntries(players.map((p) => [p.id, { hits: 0, smashes: 0, aces: 0 }]));
  }

  start() {
    this.newPoint();
  }

  server() {
    const team = this.ents.filter((e) => e.t === this.serveTeam);
    return team[this.serveIdx[this.serveTeam] % team.length];
  }

  newPoint() {
    const b = this.ball;
    b.live = false;
    b.bounces = 0;
    b.trail = [];
    this.rally = 0;
    const total = this.score.pts[0] + this.score.pts[1];
    const deuceSide = total % 2 === 0 ? 1 : -1;
    for (const e of this.ents) {
      e.x = e.homeX;
      e.z = (e.t === 0 ? 1 : -1) * BASE_Z;
      e.anim.pose = 'ready';
    }
    const s = this.server();
    s.x = deuceSide * 1.2 * (s.t === 0 ? 1 : -1);
    s.z = (s.t === 0 ? 1 : -1) * (HALF_L + 0.3);
    s.anim.pose = 'idle';
    b.x = s.x + 0.3;
    b.y = 1.0;
    b.z = s.z;
    this.state = 'serve';
    this.stateT = 0;
    this.receiver = null;
    this.hitWindow = null;
    for (const e of this.ents) {
      if (e === s) sendScreen(e.p.id, { mode: MODE.TENNIS, title: 'Your serve!', prompt: 'Flick up to toss, then SWING', color: TEAM_COLORS[e.t], hot: true });
      else sendScreen(e.p.id, { mode: MODE.TENNIS, title: e.t === s.t ? 'Your team serves' : 'Get ready…', prompt: 'Swing when the ball reaches you', color: TEAM_COLORS[e.t], hot: false });
    }
    this.hooks.onHud();
  }

  onEvent(pid, ev) {
    const e = this.ents.find((x) => x.p.id === pid);
    if (!e || e.p.cpu) return;
    if (ev.kind === 'flick' && this.state === 'serve' && e === this.server() && !this.tossed) {
      this.toss();
    }
    if (ev.kind === 'swing' || (ev.kind === 'press' && ev.button === 'a' && ev.down && e.p.keyboard)) {
      const power = ev.kind === 'swing' ? ev.power : 0.7;
      this.trySwing(e, power, !!ev.smash, ev.dir || 1);
    }
  }

  toss() {
    const s = this.server();
    this.tossed = true;
    const b = this.ball;
    b.x = s.x + 0.3;
    b.y = 1.2;
    b.z = s.z;
    b.vx = 0;
    b.vz = 0;
    b.vy = 4.2;
    s.anim.pose = 'serve';
    s.anim.t = 0.3;
    sound.sfx('whoosh', { volume: 0.4 });
  }

  trySwing(e, power, smash, dir) {
    if (this.t - e.lastSwing < 0.35) return;
    e.lastSwing = this.t;
    e.anim.pose = e.x > this.ball.x ? 'swingL' : 'swingR';
    e.anim.t = 0;
    e.swingT = 0.001;
    sound.sfx('whoosh', { volume: 0.5 });
    if (this.state === 'serve' && e === this.server()) {
      if (!this.tossed) this.toss();
      this.serve(e, power);
      return;
    }
    if (this.state !== 'rally' || !this.hitWindow || this.hitWindow.e !== e) return;
    const b = this.ball;
    const ideal = e.z - Math.sign(e.z) * 0.4;
    const q = Math.max(0, 1 - Math.abs(b.z - ideal) / 1.6);
    this.hit(e, power, smash && b.y > 1.1, dir, q);
  }

  serve(e, power) {
    const b = this.ball;
    const toSide = e.t === 0 ? -1 : 1;
    const total = this.score.pts[0] + this.score.pts[1];
    const deuceSide = total % 2 === 0 ? 1 : -1;
    const tx = -deuceSide * (1 + Math.random() * 1.5) * (e.t === 0 ? 1 : -1);
    const tz = toSide * (SERVICE - 0.6 - Math.random() * 1.6);
    b.x = e.x + 0.3;
    b.y = Math.max(b.y, 2.3);
    b.z = e.z;
    this.launch(tx, tz, 0.95 - power * 0.3);
    b.lastHitTeam = e.t;
    b.live = true;
    b.bounces = 0;
    this.isServe = true;
    this.state = 'rally';
    this.tossed = false;
    e.anim.pose = 'serve';
    e.anim.t = 0.6;
    sound.sfx('racketHit');
    this.rally = 1;
    this.stats[e.p.id].hits++;
    this.assignReceiver();
  }

  hit(e, power, smash, dir, q) {
    const b = this.ball;
    const toSide = e.t === 0 ? -1 : 1;
    let tx = THREE.MathUtils.clamp(-e.x * 0.4 + dir * (0.8 + Math.random() * 2.2), -HALF_W + 0.4, HALF_W - 0.4);
    let tz = toSide * (2.5 + power * 4.5);
    let T = smash ? 0.5 : 1.3 - power * 0.5;
    // poor timing can send it long or wide
    const outChance = (1 - q) * 0.45 + (power > 0.95 ? 0.1 : 0);
    let out = false;
    if (Math.random() < outChance) {
      out = true;
      if (Math.random() < 0.5) tz = toSide * (HALF_L + 0.8 + Math.random());
      else tx = Math.sign(tx || 1) * (HALF_W + 0.6 + Math.random());
    }
    if (smash) tz = toSide * (4 + Math.random() * 3);
    this.launch(tx, tz, T);
    b.lastHitTeam = e.t;
    b.bounces = 0;
    this.isServe = false;
    this.hitWindow = null;
    this.rally++;
    this.stats[e.p.id].hits++;
    sound.sfx('racketHit', { volume: 0.6 + power * 0.4 });
    sendHaptic(e.p.id, [40]);
    if (smash) {
      this.stats[e.p.id].smashes++;
      popup({ text: 'SMASH!', kind: 'gold', duration: 1000, shake: true, top: '24%' });
    } else if (power > 0.72 && q > 0.55 && !out) popup({ text: 'NICE SHOT!', kind: 'good', duration: 900, top: '24%' });
    for (const x of this.ents) if (!x.p.cpu) sendScreen(x.p.id, { mode: MODE.TENNIS, title: '', prompt: 'Rally!', color: TEAM_COLORS[x.t], hot: false });
    this.assignReceiver();
  }

  launch(tx, tz, T) {
    const b = this.ball;
    for (let k = 0; k < 6; k++) {
      b.vx = (tx - b.x) / T;
      b.vz = (tz - b.z) / T;
      b.vy = (0 - b.y + 0.5 * GRAV * T * T) / T;
      // clear the net
      const tn = (0 - b.z) / b.vz;
      if (tn <= 0 || tn >= T) break;
      const yn = b.y + b.vy * tn - 0.5 * GRAV * tn * tn;
      if (yn > NET_H + 0.25) break;
      T += 0.15;
    }
  }

  assignReceiver() {
    const b = this.ball;
    const team = 1 - b.lastHitTeam;
    // predict intercept: where the ball crosses the receivers' standing line after one bounce
    const sim = { ...b };
    let bounces = 0;
    let ix = sim.x;
    let iz = (team === 0 ? 1 : -1) * BASE_Z;
    const lineZ = (team === 0 ? 1 : -1) * BASE_Z;
    for (let i = 0; i < 400; i++) {
      const dt = 1 / 120;
      sim.vy -= GRAV * dt;
      sim.x += sim.vx * dt;
      sim.y += sim.vy * dt;
      sim.z += sim.vz * dt;
      if (sim.y < 0) {
        sim.y = 0;
        sim.vy = -sim.vy * 0.72;
        sim.vx *= 0.85;
        sim.vz *= 0.85;
        bounces++;
      }
      ix = sim.x;
      iz = sim.z;
      // ideal contact: after the bounce, falling back to waist height, or reaching the baseline
      if (bounces >= 1 && ((sim.vy < 0 && sim.y < 0.9) || (team === 0 ? sim.z > lineZ : sim.z < lineZ))) break;
    }
    const cands = this.ents.filter((e) => e.t === team);
    cands.sort((a, c) => Math.abs(a.homeX - ix) - Math.abs(c.homeX - ix));
    this.receiver = cands[0];
    this.receiver.targetX = THREE.MathUtils.clamp(ix + (team === 0 ? 0.35 : -0.35), -HALF_W - 1, HALF_W + 1);
    const sgn = team === 0 ? 1 : -1;
    this.receiver.targetZ = sgn * THREE.MathUtils.clamp(Math.abs(iz) + 0.3, 2.5, HALF_L + 1.5);
    if (this.receiver.p.cpu) {
      this.receiver.cpuPlan = { skill: 0.82 + Math.random() * 0.12, offset: (Math.random() - 0.5) * 0.9 };
    }
  }

  point(team, why) {
    if (this.state !== 'rally') return;
    this.state = 'point';
    this.stateT = 0;
    this.ball.live = false;
    this.longestRally = Math.max(this.longestRally, this.rally);
    const s = this.score;
    s.pts[team]++;
    let gameWon = false;
    if (s.pts[team] >= 4) {
      s.games[team]++;
      s.pts = [0, 0];
      gameWon = true;
      this.serveTeam = 1 - this.serveTeam;
      this.serveIdx[this.serveTeam]++;
    }
    const winners = this.ents.filter((e) => e.t === team);
    for (const e of this.ents) e.anim.pose = e.t === team ? 'cheer' : 'sad';
    if (why === 'ace') {
      popup({ text: 'ACE!', kind: 'gold', duration: 1400, confetti: { count: 80 } });
      const srv = this.ents.find((e) => e.t === team && this.stats[e.p.id]);
      if (srv) this.stats[this.server().p.id].aces++;
    } else if (why === 'out') popup({ text: 'OUT!', kind: 'bad', duration: 1200 });
    else if (why === 'net') popup({ text: 'NET!', kind: 'bad', duration: 1200 });
    sound.sfx(why === 'out' || why === 'net' ? 'aww' : 'cheer');
    const names = winners.map((e) => e.p.name).join(' + ');
    if (gameWon) {
      sound.sting('spare');
      popup({ text: 'GAME!', sub: names, kind: 'gold', duration: 1700, top: '62%' });
    }
    for (const e of this.ents) sendHaptic(e.p.id, e.t === team ? [60, 40, 60] : [150]);
    this.hooks.onHud();
    if (s.games[team] >= GAMES_TO_WIN) this.matchOver = team;
  }

  update(dt) {
    this.t += dt;
    this.stateT += dt;
    const b = this.ball;
    for (const e of this.ents) {
      if (e.swingT > 0) {
        e.swingT += dt;
        e.anim.t = Math.min(1, e.swingT * 3.5);
        if (e.swingT > 0.5) {
          e.swingT = 0;
          if (e.anim.pose.startsWith('swing') || e.anim.pose === 'serve') e.anim.pose = 'ready';
        }
      }
    }

    if (this.state === 'serve') {
      const s = this.server();
      if (this.tossed) {
        b.vy -= GRAV * dt;
        b.y += b.vy * dt;
        if (b.y < 1.0) {
          this.tossed = false;
          b.y = 1.0;
        }
      }
      if (s.p.cpu && this.stateT > 1.4) {
        if (!this.tossed) this.toss();
        else if (b.vy < 0.5) this.trySwing(s, 0.6 + Math.random() * 0.35, false, 1);
      }
      // keyboard server: auto-serve after a moment so tests don't stall
      if (s.p.keyboard && this.stateT > 6) this.trySwing(s, 0.7, false, 1);
    }

    if (this.state === 'rally' && b.live) {
      b.vy -= GRAV * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const pz = b.z;
      b.z += b.vz * dt;
      // net
      if (Math.sign(pz) !== Math.sign(b.z) && b.y < NET_H && Math.abs(b.x) < HALF_W + 0.5) {
        b.vz *= -0.2;
        b.vx *= 0.3;
        b.z = Math.sign(pz) * 0.05;
        this.point(1 - b.lastHitTeam, 'net');
      }
      if (b.y < 0.06) {
        b.y = 0.06;
        b.vy = -b.vy * 0.72;
        b.vx *= 0.85;
        b.vz *= 0.85;
        b.bounces++;
        sound.sfx('bounce', { volume: 0.4 });
        if (b.bounces === 1) {
          const onOpp = b.lastHitTeam === 0 ? b.z < 0 : b.z > 0;
          const inBounds = Math.abs(b.x) <= HALF_W + 0.05 && Math.abs(b.z) <= HALF_L + 0.05 && onOpp;
          if (!inBounds) this.point(1 - b.lastHitTeam, 'out');
        } else if (b.bounces >= 2) {
          this.point(b.lastHitTeam, this.isServe && this.rally === 1 ? 'ace' : 'winner');
        }
      }
      b.trail.push([b.x, b.y, b.z]);
      if (b.trail.length > 14) b.trail.shift();

      // receivers run to the ball, partners drift home
      for (const e of this.ents) {
        const tx = e === this.receiver ? e.targetX : e.homeX;
        const tz = e === this.receiver ? e.targetZ : (e.t === 0 ? 1 : -1) * BASE_Z;
        const sp = 6.5 * dt;
        const dx = tx - e.x;
        e.x += Math.abs(dx) < sp ? dx : Math.sign(dx) * sp;
        const dz = tz - e.z;
        e.z += Math.abs(dz) < sp ? dz : Math.sign(dz) * sp;
        if (!e.anim.pose.startsWith('swing') && e.anim.pose !== 'serve') e.anim.pose = Math.abs(dx) > 0.2 ? 'run' : 'ready';
      }

      // hit window for the receiver
      const r = this.receiver;
      if (r && this.state === 'rally') {
        const near = Math.abs(b.z - r.z) < 1.7 && b.bounces >= 1 && b.y < 2.4 && Math.abs(b.x - r.x) < 1.6;
        const coming = r.t === 0 ? b.vz > 0 : b.vz < 0;
        if (near && coming) {
          if (!this.hitWindow) {
            this.hitWindow = { e: r, t0: this.t };
            if (!r.p.cpu) {
              sendScreen(r.p.id, { mode: MODE.TENNIS, title: 'SWING!', prompt: 'Swing now!', color: TEAM_COLORS[r.t], hot: true, flash: 'SWING!' });
            }
          }
          if (r.p.cpu) {
            const ideal = r.z - Math.sign(r.z) * 0.4 + r.cpuPlan.offset * 0.5;
            if (Math.abs(b.z - ideal) < 0.25) {
              if (Math.random() < r.cpuPlan.skill) this.trySwing(r, 0.5 + Math.random() * 0.45, b.y > 1.4 && Math.random() < 0.3, Math.random() < 0.5 ? -1 : 1);
              else r.cpuPlan.offset = 99; // whiff
            }
          }
        }
        // ball got past the receiver
        const past = r.t === 0 ? b.z > r.z + 1.6 : b.z < r.z - 1.6;
        if (past && b.bounces >= 1) this.point(b.lastHitTeam, this.isServe && this.rally === 1 ? 'ace' : 'winner');
      }
    }

    if (this.state === 'point') {
      // let the ball roll a little
      b.vy -= GRAV * dt;
      b.x += b.vx * dt * 0.5;
      b.y = Math.max(0.06, b.y + b.vy * dt);
      b.z += b.vz * dt * 0.5;
      if (this.stateT > 1.8) {
        if (this.matchOver != null) {
          this.state = 'done';
          this.finish(this.matchOver);
        } else this.newPoint();
      }
    }
  }

  finish(team) {
    const standings = this.ents.map((e) => ({
      pid: e.p.id,
      score: this.score.games[e.t],
      label: `${this.score.games[e.t]}-${this.score.games[1 - e.t]}`,
    }));
    const highlights = [`Longest rally: ${this.longestRally} hits`];
    const smasher = this.ents.reduce((b, e) => (this.stats[e.p.id].smashes > (b ? this.stats[b.p.id].smashes : 0) ? e : b), null);
    if (smasher) highlights.push(`Smash king: ${smasher.p.name}`);
    const winners = this.ents.filter((e) => e.t === team).map((e) => e.p.name);
    this.hooks.onDone({
      standings,
      highlights,
      records: { longestRally: { label: 'Longest rally', value: this.longestRally, display: `${this.longestRally} hits`, name: winners.join(' + ') } },
    });
  }
}

function Racket() {
  return (
    <group rotation={[0, 0, 0]}>
      <mesh position={[0, -0.08, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.16, 8]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh position={[0, -0.24, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.08, 0.012, 8, 20]} />
        <meshStandardMaterial color="#ff2d2d" />
      </mesh>
    </group>
  );
}

function Court() {
  const lines = useMemo(() => {
    const segs = [
      [-HALF_W, -HALF_L, HALF_W, -HALF_L], [-HALF_W, HALF_L, HALF_W, HALF_L],
      [-HALF_W, -HALF_L, -HALF_W, HALF_L], [HALF_W, -HALF_L, HALF_W, HALF_L],
      [-HALF_W + 0.9, -HALF_L, -HALF_W + 0.9, HALF_L], [HALF_W - 0.9, -HALF_L, HALF_W - 0.9, HALF_L],
      [-HALF_W + 0.9, -SERVICE, HALF_W - 0.9, -SERVICE], [-HALF_W + 0.9, SERVICE, HALF_W - 0.9, SERVICE],
      [0, -SERVICE, 0, SERVICE],
    ];
    return segs;
  }, []);
  return (
    <group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[HALF_W * 2 + 2, HALF_L * 2 + 3]} />
        <meshPhysicalMaterial color="#2f5bd8" roughness={0.6} clearcoat={0.3} />
      </mesh>
      {lines.map(([x1, z1, x2, z2], i) => {
        const len = Math.hypot(x2 - x1, z2 - z1);
        return (
          <mesh key={i} position={[(x1 + x2) / 2, 0.01, (z1 + z2) / 2]} rotation={[-Math.PI / 2, 0, Math.atan2(x2 - x1, z2 - z1)]}>
            <planeGeometry args={[0.07, len]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        );
      })}
      {/* net */}
      <mesh position={[0, NET_H / 2, 0]}>
        <boxGeometry args={[HALF_W * 2 + 1, NET_H, 0.03]} />
        <meshStandardMaterial color="#111" transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, NET_H, 0]}>
        <boxGeometry args={[HALF_W * 2 + 1, 0.06, 0.05]} />
        <meshBasicMaterial color="#fff" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (HALF_W + 0.55), NET_H / 2, 0]}>
          <cylinderGeometry args={[0.05, 0.05, NET_H + 0.1, 8]} />
          <meshStandardMaterial color="#ffd23a" />
        </mesh>
      ))}
    </group>
  );
}

function Scene({ game }) {
  const { camera } = useThree();
  const g = game.current;
  const ballRef = useRef();
  const shadowRef = useRef();
  const trailRef = useRef([]);
  const entRefs = useRef([]);
  const look = useRef(new THREE.Vector3(0, 0.5, -2.5));
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    g.update(dt);
    const b = g.ball;
    ballRef.current?.position.set(b.x, b.y, b.z);
    shadowRef.current?.position.set(b.x, 0.015, b.z);
    trailRef.current.forEach((m, i) => {
      const p = b.trail[i];
      if (!m) return;
      if (!p || !b.live) {
        m.visible = false;
        return;
      }
      m.visible = true;
      m.position.set(p[0], p[1], p[2]);
      const k = i / b.trail.length;
      m.scale.setScalar(0.3 + k * 0.7);
      m.material.opacity = k * 0.5;
    });
    g.ents.forEach((e, i) => {
      const r = entRefs.current[i];
      if (!r) return;
      r.position.set(e.x, 0, e.z);
      r.rotation.y = e.t === 0 ? Math.PI : 0;
    });
    // Wii-style: low behind the near team, drifting gently with the ball
    camera.position.lerp(new THREE.Vector3(b.x * 0.25, 3.9, 15.2), Math.min(1, dt * 2));
    look.current.lerp(new THREE.Vector3(b.x * 0.35, 0.2, -1.8), Math.min(1, dt * 2.5));
    camera.lookAt(look.current);
  });
  return (
    <>
      <SkyDome />
      <StudioEnv />
      <Post />
      <Lights shadowSize={14} />
      <TennisStadium halfW={HALF_W} halfL={HALF_L} />
      <Court />
      {g.ents.map((e, i) => (
        <group key={e.p.id} ref={(el) => (entRefs.current[i] = el)}>
          <Avatar player={e.p} anim={e.anim} held={<Racket />} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
            <ringGeometry args={[0.32, 0.4, 32]} />
            <meshBasicMaterial color={TEAM_COLORS[e.t]} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={ballRef} castShadow>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshStandardMaterial color="#e7ff4f" emissive="#9dff3a" emissiveIntensity={0.4} />
      </mesh>
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.1, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} ref={(el) => (trailRef.current[i] = el)}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshBasicMaterial color="#e7ff4f" transparent opacity={0.3} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

export default function Tennis({ players, playing, onDone }) {
  const game = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [, setHud] = useState(0);
  if (!game.current) game.current = new TennisGame(players, { onHud: () => setHud((x) => x + 1), onDone: (r) => onDoneRef.current(r) });
  useEffect(() => {
    if (playing && game.current.state === 'idle') game.current.start();
  }, [playing]);
  useEffect(() => {
    for (const e of game.current.ents) {
      const np = players.find((p) => p.id === e.p.id);
      if (np) e.p = np;
    }
  }, [players]);
  useEffect(() => onPlayerEvent((pid, ev) => game.current?.onEvent(pid, ev)), []);
  const g = game.current;
  const s = g.score;
  const teamBox = (t) => (
    <div className="tennis-team">
      {g.ents
        .filter((e) => e.t === t)
        .map((e) => (
          <AvatarHead key={e.p.id} player={e.p} size={34} />
        ))}
      <span style={{ color: TEAM_COLORS[t] }}>{g.ents.filter((e) => e.t === t).map((e) => e.p.name).join(' + ')}</span>
      <span className="games">{s.games[t]}</span>
      <span className="pts">{PTS[Math.min(3, s.pts[t])]}</span>
    </div>
  );
  return (
    <>
      <Canvas shadows="soft" dpr={[1, 2]} camera={{ position: [0, 3.4, 13.6], fov: 52 }}>
        <Scene game={game} />
      </Canvas>
      <div className="hud">
        <div className="tennis-score panel">
          {teamBox(0)}
          <span className="tennis-vs">VS</span>
          {teamBox(1)}
        </div>
        <div className="hint" style={{ position: 'absolute', bottom: 16, left: 0, right: 0 }}>
          first to {GAMES_TO_WIN} games · no-ad scoring
        </div>
      </div>
    </>
  );
}
