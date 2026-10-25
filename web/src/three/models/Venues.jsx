// Procedural venues: everything AROUND the gameplay pieces. No model files, no network textures.
//   <BowlingAlley />   indoor "Mycade Lanes" around the game's own lane (x=0, foul line z=0)
//   <TennisStadium />  grass, sponsor boards, grandstands + instanced crowd around the game's court
//   <PartyPark />      floating sky islands, balloons, spinning tokens, neon rainbow (Balance)
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

/* ------------------------------------------------------------------ shared helpers */

const RED = '#ff2d2d';
const YELLOW = '#ffd23a';
const LIME = '#9dff3a';
const PURPLE = '#b04bff';
const DARK = '#1e1518';
const CYAN = '#3ad8ff';
const PINK = '#ff4fa8';
const ORANGE = '#ff8a2a';
const BRIGHTS = [RED, YELLOW, LIME, PURPLE, CYAN, PINK, ORANGE];
const FONT = '"Lilita One", "Rubik", system-ui, sans-serif';

function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Neon colour pushed above 1.0 so the shared Bloom pass picks it up (use with toneMapped={false}). */
const neon = (c, k = 1.6) => new THREE.Color(c).multiplyScalar(k);

/** Canvas texture that redraws once the brand font is available. */
function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  if (document.fonts?.load) {
    document.fonts
      .load(`64px ${FONT.split(',')[0]}`)
      .then(() => {
        ctx.clearRect(0, 0, w, h);
        draw(ctx, w, h);
        t.needsUpdate = true;
      })
      .catch(() => {});
  }
  return t;
}

function useDispose(list) {
  useEffect(() => () => list.forEach((x) => x && x.dispose && x.dispose()), [list]);
}

function starPath(ctx, cx, cy, spikes, outer, inner, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / spikes;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Chunky toy text: dark outline + fill + soft highlight. */
function toyText(ctx, text, x, y, size, fill, { stroke = '#1e1518', lw = 0.16, align = 'center', glow } = {}) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = size * 0.35;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = size * lw;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/* ------------------------------------------------------------------ BOWLING */

const PIN_SP = 0.3048;

function pinGeometry() {
  // profile (radius, y) with doubled points at the stripe edges for crisp vertex-colour bands
  const P = [
    [0, 0], [0.026, 0], [0.04, 0.025], [0.054, 0.07], [0.06, 0.12], [0.058, 0.15], [0.05, 0.19], [0.04, 0.22],
    [0.033, 0.243], [0.033, 0.243], [0.03, 0.258], [0.03, 0.258], [0.027, 0.27], [0.027, 0.27], [0.025, 0.284], [0.025, 0.284],
    [0.026, 0.31], [0.031, 0.335], [0.03, 0.357], [0.022, 0.374], [0.01, 0.381], [0, 0.382],
  ];
  const red = new Set([9, 10, 13, 14]);
  const pts = P.map(([r, y]) => new THREE.Vector2(r, y));
  const seg = 14;
  const g = new THREE.LatheGeometry(pts, seg);
  const col = new Float32Array(g.attributes.position.count * 3);
  const w = new THREE.Color('#fbf7f2');
  const r = new THREE.Color('#e3141c');
  for (let i = 0; i <= seg; i++)
    for (let j = 0; j < pts.length; j++) {
      const c = red.has(j) ? r : w;
      const k = (i * pts.length + j) * 3;
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function woodLaneTex(laneLen) {
  return canvasTex(128, 2048, (ctx, w, h) => {
    const boards = 13;
    for (let i = 0; i < boards; i++) {
      const t = Math.sin(i * 12.9) * 0.5 + 0.5;
      ctx.fillStyle = `hsl(${30 + t * 6}, ${55 + t * 12}%, ${66 + t * 8}%)`;
      ctx.fillRect((i * w) / boards, 0, w / boards + 1, h);
      ctx.fillStyle = 'rgba(120,70,30,0.25)';
      ctx.fillRect((i * w) / boards, 0, 1, h);
    }
    // grain streaks
    const r = rng(7);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(150,90,40,${0.04 + r() * 0.06})`;
      ctx.fillRect(r() * w, r() * h, 1, 20 + r() * 120);
    }
    // arrows ~4.6 m from the foul line (canvas top = pin end)
    const ay = h * (1 - 4.6 / laneLen);
    ctx.fillStyle = '#c0262c';
    for (let i = 0; i < 7; i++) {
      const x = ((i + 3) * w) / boards + w / boards / 2;
      const y = ay + Math.abs(i - 3) * 22;
      ctx.beginPath();
      ctx.moveTo(x, y - 26);
      ctx.lineTo(x + 5, y + 6);
      ctx.lineTo(x - 5, y + 6);
      ctx.fill();
    }
    // approach dots near the foul line
    const dy = h * (1 - 2.1 / laneLen);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(((i * 2 + 2) * w) / boards + w / boards / 2, dy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // darker oil sheen toward the pins
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,240,220,0.0)');
    g.addColorStop(1, 'rgba(80,40,10,0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function approachTex() {
  return canvasTex(128, 256, (ctx, w, h) => {
    for (let i = 0; i < 13; i++) {
      const t = Math.sin(i * 7.3) * 0.5 + 0.5;
      ctx.fillStyle = `hsl(34, ${45 + t * 10}%, ${76 + t * 6}%)`;
      ctx.fillRect((i * w) / 13, 0, w / 13 + 1, h);
    }
    ctx.fillStyle = '#d4141b';
    ctx.fillRect(0, 0, w, 8); // foul line (canvas top = lane side)
    ctx.fillStyle = '#7a3a1a';
    for (const v of [0.35, 0.7])
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(((i * 2 + 2) * w) / 13 + w / 26, h * v, 3, 0, Math.PI * 2);
        ctx.fill();
      }
  });
}

function carpetTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2a1145';
    ctx.fillRect(0, 0, w, h);
    const r = rng(42);
    // squiggles
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = BRIGHTS[i % BRIGHTS.length];
      const x = r() * w;
      const y = r() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 20, y - 25, x + 35, y + 25, x + 55, y);
      ctx.stroke();
    }
    // confetti triangles + stars
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = BRIGHTS[(i * 3) % BRIGHTS.length];
      const x = r() * w;
      const y = r() * h;
      if (i % 3 === 0) {
        starPath(ctx, x, y, 5, 14, 6, r() * 6);
        ctx.fill();
      } else if (i % 3 === 1) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r() * 6);
        ctx.fillRect(-9, -4, 18, 8);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, { repeat: [4, 2] });
}

function wallTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a0b33');
    g.addColorStop(1, '#3a1450');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.18;
    for (let i = -4; i < 12; i++) {
      ctx.fillStyle = i % 2 ? PURPLE : PINK;
      ctx.beginPath();
      ctx.moveTo(i * 64, h);
      ctx.lineTo(i * 64 + 64, h);
      ctx.lineTo(i * 64 + 320, 0);
      ctx.lineTo(i * 64 + 256, 0);
      ctx.fill();
    }
    ctx.globalAlpha = 0.5;
    const r = rng(9);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(r() * w, r() * h * 0.6, 1 + r() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, { repeat: [4, 1] });
}

function posterTex(word, bg, fg) {
  return canvasTex(512, 640, (ctx, w, h) => {
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // sunburst rays
    ctx.translate(w / 2, h * 0.46);
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(600, -100);
      ctx.lineTo(600, 100);
      ctx.fill();
    }
    ctx.restore();
    starPath(ctx, w / 2, h * 0.46, 14, 220, 165, 0);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = DARK;
    ctx.stroke();
    toyText(ctx, word, w / 2, h * 0.46, word.length > 5 ? 96 : 128, '#ffffff', { lw: 0.18 });
    toyText(ctx, 'MYCADE', w / 2, h * 0.88, 70, fg, { lw: 0.2 });
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
}

function signTex() {
  return canvasTex(2048, 512, (ctx, w, h) => {
    const draw = (txt, x, y, size, col, glow) => {
      ctx.font = `${size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.save();
      ctx.shadowColor = glow;
      for (const b of [80, 40, 18]) {
        ctx.shadowBlur = b;
        ctx.lineWidth = 16;
        ctx.strokeStyle = glow;
        ctx.strokeText(txt, x, y);
      }
      ctx.restore();
      ctx.lineWidth = 6;
      ctx.strokeStyle = col;
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = '#fff6e8';
      ctx.fillText(txt, x, y);
    };
    draw('MYCADE', w / 2, h * 0.38, 250, '#ffe7a0', RED);
    draw('★  L A N E S  ★', w / 2, h * 0.8, 120, '#fff7c2', YELLOW);
  });
}

function maskTex(num, a, b) {
  return canvasTex(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // swooshes
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(w * 0.2, h * 1.1, w * 0.6, h * 0.55, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // pin silhouettes
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const x = w * 0.62 + i * 46;
      ctx.beginPath();
      ctx.ellipse(x, h * 0.62, 16, 34, 0, 0, Math.PI * 2);
      ctx.ellipse(x, h * 0.33, 9, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = RED;
      ctx.fillRect(x - 9, h * 0.42, 18, 5);
      ctx.fillStyle = '#ffffff';
    }
    starPath(ctx, w * 0.22, h * 0.5, 8, 92, 70, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = DARK;
    ctx.stroke();
    toyText(ctx, String(num), w * 0.22, h * 0.53, 110, b, { lw: 0.14 });
  });
}

function monitorTex(lane) {
  return canvasTex(512, 288, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b0f5a');
    g.addColorStop(1, '#0f1b4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    toyText(ctx, `LANE ${lane}`, 20, 30, 34, YELLOW, { align: 'left', lw: 0.1 });
    toyText(ctx, 'MYCADE', w - 20, 30, 34, PINK, { align: 'right', lw: 0.1 });
    const rows = [
      ['P1', ['X', '7/', '9-', 'X'], RED],
      ['P2', ['8/', 'X', '72', '9/'], LIME],
      ['P3', ['X', 'X', '8-', '6/'], CYAN],
    ];
    rows.forEach(([n, f, c], r) => {
      const y = 70 + r * 70;
      ctx.fillStyle = c;
      roundRect(ctx, 16, y, 70, 56, 10);
      ctx.fill();
      toyText(ctx, n, 51, y + 29, 30, '#ffffff', { lw: 0.12 });
      f.forEach((s, i) => {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(ctx, 96 + i * 100, y, 92, 56, 8);
        ctx.fill();
        toyText(ctx, s, 142 + i * 100, y + 29, 32, s.includes('X') ? YELLOW : '#ffffff', { stroke: null });
      });
    });
  });
}

/** One decorative neighbouring lane (lane surface starts at the foul line z=0). */
function DecoLane({ x, headZ, laneTex, appTex }) {
  const len = Math.abs(headZ) + 0.9;
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0, -len / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.06, len]} />
        <meshPhysicalMaterial map={laneTex} roughness={0.22} clearcoat={1} clearcoatRoughness={0.04} />
      </mesh>
      <mesh position={[0, 0, 1.7]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.8, 3.4]} />
        <meshPhysicalMaterial map={appTex} roughness={0.35} clearcoat={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.65, -0.005, -len / 2]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <cylinderGeometry args={[0.12, 0.12, len, 12, 1, true, -Math.PI / 2, Math.PI]} />
          <meshPhysicalMaterial color="#c9d6e2" metalness={0.65} roughness={0.25} clearcoat={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* pin deck + pit */}
      <mesh position={[0, -0.32, headZ - 1.9]}>
        <boxGeometry args={[1.5, 0.1, 2]} />
        <meshStandardMaterial color="#0c0710" roughness={1} />
      </mesh>
    </group>
  );
}

function Neon({ position, size, color, k = 1.6, rotation }) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={neon(color, k)} toneMapped={false} />
    </mesh>
  );
}

function BallReturn({ position, color, accent }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.46, 0.5, 1.1]} radius={0.16} smoothness={4} position={[0, 0.25, 0]} castShadow>
        <meshPhysicalMaterial color={color} clearcoat={1} clearcoatRoughness={0.08} roughness={0.25} />
      </RoundedBox>
      {/* hood dome */}
      <mesh position={[0, 0.5, -0.35]} castShadow>
        <sphereGeometry args={[0.24, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color={accent} clearcoat={1} roughness={0.15} />
      </mesh>
      <Neon position={[0, 0.505, 0.15]} size={[0.47, 0.025, 0.6]} color={accent} k={1.3} />
      {/* rails */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.13, 0.56, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.8, 8]} />
          <meshPhysicalMaterial color="#e8eef5" metalness={0.9} roughness={0.15} />
        </mesh>
      ))}
    </group>
  );
}

function Bench({ position, color, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[2.4, 0.42, 0.7]} radius={0.12} smoothness={3} position={[0, 0.21, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial color={color} clearcoat={0.9} clearcoatRoughness={0.2} roughness={0.45} />
      </RoundedBox>
      <RoundedBox args={[2.4, 0.7, 0.24]} radius={0.1} smoothness={3} position={[0, 0.65, 0.3]} castShadow>
        <meshPhysicalMaterial color={color} clearcoat={0.9} clearcoatRoughness={0.2} roughness={0.45} />
      </RoundedBox>
      <mesh position={[0, 0.44, -0.05]}>
        <boxGeometry args={[2.2, 0.04, 0.5]} />
        <meshPhysicalMaterial color="#ffffff" clearcoat={1} roughness={0.3} />
      </mesh>
    </group>
  );
}

export function BowlingAlley({ laneWidth = 1.06, headZ = -14 }) {
  const W = 6; // half width of the hall
  const backZ = headZ - 3.4;
  const frontZ = 8.6;
  const ceilY = 3.4;
  const len = Math.abs(headZ) + 0.9;
  const hall = frontZ - backZ;
  const laneXs = [-4.4, -2.2, 2.2, 4.4];

  const tex = useMemo(() => {
    const t = {
      lane: woodLaneTex(len),
      app: approachTex(),
      carpet: carpetTex(),
      wall: wallTex(),
      sign: signTex(),
      monitor: [monitorTex(2), monitorTex(4)],
      posters: [posterTex('STRIKE!', RED, YELLOW), posterTex('SPARE!', PURPLE, LIME), posterTex('300', '#1aa3ff', PINK), posterTex('BOWL!', ORANGE, PURPLE)],
      masks: [maskTex(1, PURPLE, PINK), maskTex(2, '#1aa3ff', LIME), maskTex(3, RED, YELLOW), maskTex(4, ORANGE, RED), maskTex(5, '#12b886', CYAN)],
    };
    t.carpetSide = t.carpet.clone();
    t.carpetSide.repeat.set(1, 8);
    t.carpetSide.needsUpdate = true;
    return t;
  }, [len]);
  useDispose(useMemo(() => [tex.lane, tex.app, tex.carpet, tex.wall, tex.sign, ...tex.monitor, ...tex.posters, ...tex.masks], [tex]));

  // static pins for the 4 neighbour lanes (one instanced draw)
  const pinGeo = useMemo(pinGeometry, []);
  const pinRef = useRef();
  const pinMat = useMemo(() => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }), []);
  useDispose(useMemo(() => [pinGeo, pinMat], [pinGeo, pinMat]));

  // balls: on returns + wall rack
  const balls = useMemo(() => {
    const out = [];
    const cols = [RED, YELLOW, LIME, PURPLE, CYAN, PINK, ORANGE, '#1aa3ff'];
    let k = 0;
    for (const bx of [-3.3, -1.3, 1.3, 3.3])
      for (let i = 0; i < 3; i++) out.push({ p: [bx, 0.64, 2.3 + i * 0.25], c: cols[k++ % cols.length] });
    // wall rack (two shelves) along the right wall near the seating
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < 8; i++) out.push({ p: [W - 0.32, 0.42 + s * 0.42, 4.2 + i * 0.27], c: cols[(i + s * 3) % cols.length] });
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < 8; i++) out.push({ p: [-W + 0.32, 0.42 + s * 0.42, 4.2 + i * 0.27], c: cols[(i * 5 + s) % cols.length] });
    return out;
  }, []);
  const ballRef = useRef();

  useEffect(() => {
    const m = new THREE.Matrix4();
    if (pinRef.current) {
      let i = 0;
      const rowZ = PIN_SP * Math.sin(Math.PI / 3);
      for (const lx of laneXs)
        for (let row = 0; row < 4; row++)
          for (let k = 0; k <= row; k++) {
            m.makeTranslation(lx + (k - row / 2) * PIN_SP, 0, headZ - row * rowZ);
            pinRef.current.setMatrixAt(i++, m);
          }
      pinRef.current.instanceMatrix.needsUpdate = true;
    }
    if (ballRef.current) {
      const c = new THREE.Color();
      balls.forEach((b, i) => {
        m.makeTranslation(...b.p);
        ballRef.current.setMatrixAt(i, m);
        ballRef.current.setColorAt(i, c.set(b.c));
      });
      ballRef.current.instanceMatrix.needsUpdate = true;
      if (ballRef.current.instanceColor) ballRef.current.instanceColor.needsUpdate = true;
    }
  }, [headZ, balls]);

  // ceiling light panels
  const panelRef = useRef();
  const panels = useMemo(() => {
    const out = [];
    for (const lx of [-4.4, -2.2, 0, 2.2, 4.4]) for (let z = 2; z > backZ + 1; z -= 2.6) out.push([lx, ceilY - 0.02, z]);
    return out;
  }, [backZ]);
  useEffect(() => {
    if (!panelRef.current) return;
    const m = new THREE.Matrix4();
    const r = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    panels.forEach((p, i) => {
      m.makeTranslation(...p).multiply(r);
      panelRef.current.setMatrixAt(i, m);
    });
    panelRef.current.instanceMatrix.needsUpdate = true;
  }, [panels]);

  const sideWallMat = <meshStandardMaterial map={tex.wall} roughness={0.85} />;
  const dividerMat = <meshPhysicalMaterial color="#2a1d21" clearcoat={1} clearcoatRoughness={0.1} roughness={0.3} />;
  const maskCols = [PURPLE, '#1aa3ff', RED, ORANGE, '#12b886'];

  return (
    <group>
      {/* sub-floor (keeps the centre strip open for the game's pit) */}
      {[-1, 1].map((s) => (
        <mesh key={`sf${s}`} position={[s * (W + 0.9) / 2, -0.26, (backZ + 3.4) / 2]}>
          <boxGeometry args={[W - 0.9, 0.2, 3.4 - backZ]} />
          <meshStandardMaterial color="#120a14" roughness={1} />
        </mesh>
      ))}

      {/* neighbour lanes */}
      {laneXs.map((x) => (
        <DecoLane key={x} x={x} headZ={headZ} laneTex={tex.lane} appTex={tex.app} />
      ))}
      <instancedMesh ref={pinRef} args={[pinGeo, pinMat, laneXs.length * 10]} castShadow />

      {/* lane dividers / capping */}
      {[
        [1.125, 0.6],
        [3.3, 0.66],
        [5.585, 0.83],
      ].flatMap(([cx, w]) =>
        [-1, 1].map((s) => (
          <group key={`dv${s}${cx}`}>
            <mesh position={[s * cx, -0.04, (headZ - 0.9 + 3.4) / 2]} receiveShadow>
              <boxGeometry args={[w, 0.12, len + 3.4]} />
              {dividerMat}
            </mesh>
            {cx < 5 && <Neon position={[s * cx, 0.025, (headZ - 0.9 + 3.4) / 2]} size={[0.035, 0.012, len + 3.4]} color={cx < 2 ? (s < 0 ? RED : YELLOW) : PURPLE} k={1.3} />}
          </group>
        )),
      )}

      {/* kickback panels + pin-deck boxes between lanes */}
      {[1.12, 3.3, 5.5].flatMap((cx) =>
        [-1, 1].map((s) => (
          <group key={`kb${s}${cx}`} position={[s * cx, 0, headZ - 1.3]}>
            <RoundedBox args={[cx < 5 ? 0.56 : 1, 0.62, 4.2]} radius={0.06} smoothness={2} position={[0, 0.31, 0]}>
              <meshPhysicalMaterial color="#251832" clearcoat={1} roughness={0.25} />
            </RoundedBox>
            {[-1, 1].map((e) => (
              <Neon key={e} position={[e * ((cx < 5 ? 0.56 : 1) / 2 - 0.05), 0.625, 0]} size={[0.035, 0.02, 4.1]} color={BRIGHTS[(Math.round(cx) + (s > 0 ? 2 : 0)) % BRIGHTS.length]} k={1.4} />
            ))}
          </group>
        )),
      )}

      {/* pinsetter masks: neighbours full height, centre sits on top of the game's canopy */}
      {[-4.4, -2.2, 0, 2.2, 4.4].map((x, i) => {
        const centre = x === 0;
        const y0 = centre ? 1.12 : 0.62;
        const h = 1.8 - y0;
        return (
          <group key={`mk${x}`} position={[x, y0 + h / 2, headZ - 1.4]}>
            <RoundedBox args={[2.12, h, 2.8]} radius={0.12} smoothness={3}>
              <meshPhysicalMaterial color={maskCols[i]} clearcoat={1} clearcoatRoughness={0.08} roughness={0.3} />
            </RoundedBox>
            <mesh position={[0, 0, 1.401]}>
              <planeGeometry args={[1.9, h - 0.12]} />
              <meshStandardMaterial map={tex.masks[i]} roughness={0.4} emissive="#ffffff" emissiveMap={tex.masks[i]} emissiveIntensity={0.35} />
            </mesh>
            <Neon position={[0, h / 2 + 0.01, 1.3]} size={[2.0, 0.03, 0.05]} color={YELLOW} k={1.5} />
          </group>
        );
      })}
      <Neon position={[0, 1.82, headZ + 0.01]} size={[W * 2, 0.035, 0.04]} color={PINK} k={1.4} />

      {/* back wall + neon sign */}
      <mesh position={[0, ceilY / 2 - 0.3, backZ]}>
        <planeGeometry args={[W * 2, ceilY + 0.6]} />
        <meshStandardMaterial color="#14082a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.62, backZ + 0.05]}>
        <planeGeometry args={[6, 1.5]} />
        <meshBasicMaterial map={tex.sign} color={[1.35, 1.35, 1.35]} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {[[-4.6, PURPLE], [4.6, LIME]].map(([x, c]) => (
        <group key={`st${x}`} position={[x, 2.62, backZ + 0.06]}>
          {[0, 1, 2].map((i) => (
            <Neon key={i} position={[0, (i - 1) * 0.28, 0]} size={[0.9 - i * 0.18, 0.06, 0.03]} color={c} k={1.7} />
          ))}
        </group>
      ))}

      {/* ceiling */}
      <mesh position={[0, ceilY, (backZ + frontZ) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W * 2, hall]} />
        <meshStandardMaterial color="#1a0f24" roughness={1} />
      </mesh>
      <instancedMesh ref={panelRef} args={[undefined, undefined, panels.length]}>
        <planeGeometry args={[1.3, 0.7]} />
        <meshBasicMaterial color={neon('#fff1d6', 1.25)} toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
      {[-3.3, -1.1, 1.1, 3.3].map((x, i) => (
        <Neon key={`cs${x}`} position={[x, ceilY - 0.03, (backZ + frontZ) / 2]} size={[0.05, 0.02, hall]} color={[RED, YELLOW, LIME, PURPLE][i]} k={1.3} />
      ))}
      {/* ceiling beams across for depth rhythm */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={`bm${i}`} position={[0, ceilY - 0.12, 4 - i * 3.2]}>
          <boxGeometry args={[W * 2, 0.22, 0.16]} />
          <meshStandardMaterial color="#26143a" roughness={0.8} />
        </mesh>
      ))}

      {/* side walls */}
      {[-1, 1].map((s) => (
        <group key={`sw${s}`}>
          <mesh position={[s * W, ceilY / 2 - 0.3, (backZ + frontZ) / 2]} rotation={[0, -s * Math.PI / 2, 0]}>
            <planeGeometry args={[hall, ceilY + 0.6]} />
            {sideWallMat}
          </mesh>
          {/* wainscot */}
          <mesh position={[s * (W - 0.06), 0.35, (backZ + frontZ) / 2]}>
            <boxGeometry args={[0.12, 0.7, hall]} />
            <meshPhysicalMaterial color="#2b1438" clearcoat={1} roughness={0.3} />
          </mesh>
          <Neon position={[s * (W - 0.12), 0.72, (backZ + frontZ) / 2]} size={[0.03, 0.05, hall]} color={s < 0 ? RED : YELLOW} />
          <Neon position={[s * (W - 0.03), 3.05, (backZ + frontZ) / 2]} size={[0.03, 0.06, hall]} color={PURPLE} k={1.8} />
          <Neon position={[s * (W - 0.03), 2.92, (backZ + frontZ) / 2]} size={[0.03, 0.03, hall]} color={PINK} k={1.5} />
          {/* starburst posters */}
          {[-3.5, -8, -12.5].map((z, i) => (
            <group key={z} position={[s * (W - 0.04), 1.85, z]} rotation={[0, -s * Math.PI / 2, 0]}>
              <mesh>
                <planeGeometry args={[1.5, 1.875]} />
                <meshStandardMaterial map={tex.posters[(i + (s > 0 ? 2 : 0)) % 4]} roughness={0.5} emissive="#ffffff" emissiveMap={tex.posters[(i + (s > 0 ? 2 : 0)) % 4]} emissiveIntensity={0.45} transparent />
              </mesh>
            </group>
          ))}
          {/* zig-zag neon between posters */}
          {[-5.75, -10.25].map((z) => (
            <group key={`zz${z}`} position={[s * (W - 0.05), 1.85, z]}>
              {[0, 1, 2, 3].map((k) => (
                <Neon key={k} position={[0, 0.45 - k * 0.3, 0]} rotation={[k % 2 ? 0.7 : -0.7, 0, 0]} size={[0.03, 0.05, 0.45]} color={k % 2 ? LIME : CYAN} k={1.5} />
              ))}
            </group>
          ))}
        </group>
      ))}

      {/* overhead score monitors facing the bowler */}
      {[-1, 1].map((s, i) => (
        <group key={`om${s}`} position={[s * 1.1, 2.86, -2.6]} rotation={[0.1, 0, 0]}>
          <RoundedBox args={[1.5, 0.92, 0.12]} radius={0.05} smoothness={2}>
            <meshPhysicalMaterial color="#111" clearcoat={1} roughness={0.2} />
          </RoundedBox>
          <mesh position={[0, 0, 0.065]}>
            <planeGeometry args={[1.4, 0.79]} />
            <meshBasicMaterial map={tex.monitor[i]} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.5, -0.02]}>
            <cylinderGeometry args={[0.025, 0.025, 0.3, 8]} />
            <meshStandardMaterial color="#555" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* ball returns between lanes + balls */}
      <BallReturn position={[-1.3, 0, 2.55]} color={PURPLE} accent={YELLOW} />
      <BallReturn position={[1.3, 0, 2.55]} color={RED} accent={LIME} />
      <BallReturn position={[-3.3, 0, 2.55]} color="#1aa3ff" accent={PINK} />
      <BallReturn position={[3.3, 0, 2.55]} color={ORANGE} accent={CYAN} />
      <instancedMesh ref={ballRef} args={[undefined, undefined, balls.length]} castShadow>
        <sphereGeometry args={[0.12, 20, 14]} />
        <meshPhysicalMaterial roughness={0.12} clearcoat={1} clearcoatRoughness={0.04} metalness={0.05} />
      </instancedMesh>
      {/* wall ball racks */}
      {[-1, 1].map((s) => (
        <group key={`br${s}`}>
          {[0.27, 0.69].map((y) => (
            <mesh key={y} position={[s * (W - 0.32), y, 5.15]}>
              <boxGeometry args={[0.34, 0.05, 2.3]} />
              <meshPhysicalMaterial color="#e8eef5" metalness={0.8} roughness={0.2} />
            </mesh>
          ))}
        </group>
      ))}

      {/* carpet (behind approach) + edge strip */}
      <mesh position={[0, 0, (3.4 + frontZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W * 2, frontZ - 3.4]} />
        <meshStandardMaterial map={tex.carpet} roughness={0.95} />
      </mesh>
      <Neon position={[0, 0.006, 3.43]} size={[W * 2, 0.012, 0.05]} color={YELLOW} k={1.4} />
      <mesh position={[0, 0.01, 3.47]}>
        <boxGeometry args={[W * 2, 0.02, 0.06]} />
        <meshPhysicalMaterial color="#2a1d21" clearcoat={1} />
      </mesh>

      {/* seating + scoring console */}
      <Bench position={[-2.6, 0, 6.4]} color={RED} />
      <Bench position={[2.6, 0, 6.4]} color={PURPLE} />
      <Bench position={[-4.6, 0, 5.3]} color={YELLOW} rotation={[0, -Math.PI / 2, 0]} />
      <Bench position={[4.6, 0, 5.3]} color="#12b886" rotation={[0, Math.PI / 2, 0]} />
      {[-1, 1].map((s, i) => (
        <group key={`cn${s}`} position={[s * 1.1, 0, 5.2]}>
          <RoundedBox args={[0.9, 0.9, 0.6]} radius={0.12} smoothness={3} position={[0, 0.45, 0]} castShadow>
            <meshPhysicalMaterial color="#2a1d21" clearcoat={1} roughness={0.25} />
          </RoundedBox>
          <Neon position={[0, 0.2, -0.305]} size={[0.8, 0.04, 0.01]} color={s < 0 ? LIME : PINK} />
          <group position={[0, 1.25, 0]} rotation={[0, Math.PI, 0]}>
            <RoundedBox args={[1.0, 0.62, 0.08]} radius={0.04} smoothness={2}>
              <meshPhysicalMaterial color="#111" clearcoat={1} roughness={0.2} />
            </RoundedBox>
            <mesh position={[0, 0, 0.045]}>
              <planeGeometry args={[0.92, 0.52]} />
              <meshBasicMaterial map={tex.monitor[i]} toneMapped={false} />
            </mesh>
          </group>
          <mesh position={[0, 0.95, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 0.2, 10]} />
            <meshStandardMaterial color="#444" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* front wall (behind the players) */}
      <mesh position={[0, ceilY / 2 - 0.3, frontZ]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[W * 2, ceilY + 0.6]} />
        {sideWallMat}
      </mesh>

      {/* warm practical lights (no shadows) */}
      <pointLight position={[0, 2.6, headZ + 1.5]} intensity={6} distance={9} decay={1.6} color="#ffe2b8" />
      <pointLight position={[0, 2.8, -5]} intensity={5} distance={12} decay={1.6} color="#ffb6d9" />
      <pointLight position={[0, 2.8, 4.5]} intensity={4} distance={9} decay={1.6} color="#ffd8a8" />
    </group>
  );
}

/* ------------------------------------------------------------------ TENNIS */

function grassTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3fae3a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4fc544';
    ctx.fillRect(0, 0, w / 2, h);
    const r = rng(3);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,200,0.07)' : 'rgba(0,60,0,0.08)';
      ctx.fillRect(r() * w, r() * h, 1.5, 4);
    }
  }, { repeat: [24, 24] });
}

function sponsorTex(text, bg, fg, accent) {
  return canvasTex(1024, 200, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, bg);
    g.addColorStop(1, new THREE.Color(bg).multiplyScalar(0.7).getStyle());
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, 14);
    ctx.fillRect(0, h - 14, w, 14);
    for (const x of [90, w - 90]) {
      starPath(ctx, x, h / 2, 5, 48, 21);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = DARK;
      ctx.stroke();
    }
    toyText(ctx, text, w / 2, h / 2 + 4, text.length > 9 ? 104 : 124, fg, { lw: 0.15 });
  });
}

function scoreboardTex() {
  return canvasTex(1024, 420, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a0f55');
    g.addColorStop(1, '#0e1640');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // LED dot grid
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 6; y < h; y += 12) for (let x = 6; x < w; x += 12) ctx.fillRect(x, y, 3, 3);
    toyText(ctx, 'MYCADE OPEN', w / 2, 62, 78, YELLOW, { lw: 0.12, glow: ORANGE });
    const rows = [
      ['TEAM SUN', YELLOW, ['6', '4', '30']],
      ['TEAM GRAPE', PURPLE, ['4', '6', '40']],
    ];
    rows.forEach(([n, c, s], i) => {
      const y = 160 + i * 110;
      ctx.fillStyle = c;
      roundRect(ctx, 40, y - 38, 26, 76, 8);
      ctx.fill();
      toyText(ctx, n, 90, y, 64, '#ffffff', { align: 'left', lw: 0.1 });
      s.forEach((v, k) => {
        ctx.fillStyle = k === 2 ? 'rgba(255,45,45,0.9)' : 'rgba(255,255,255,0.12)';
        roundRect(ctx, 610 + k * 130, y - 44, 112, 88, 14);
        ctx.fill();
        toyText(ctx, v, 666 + k * 130, y + 3, 68, '#ffffff', { stroke: null });
      });
    });
    toyText(ctx, '● LIVE  •  RALLY COURT', w / 2, h - 34, 40, LIME, { stroke: null, glow: LIME });
  });
}

const SKIN = ['#ffd7b5', '#f1b98c', '#d99a6c', '#a86b45', '#7a4a2e', '#ffe0c4'];

/** Instanced crowd. seats: [{x,y,z}] where y is the sitting surface. */
function Crowd({ seats, cheer = 0 }) {
  const bodyRef = useRef();
  const headRef = useRef();
  const data = useMemo(() => {
    const r = rng(77);
    return seats.map((s) => ({ ...s, ph: r() * Math.PI * 2, sp: 1.4 + r() * 2.2, amp: 0.02 + r() * 0.035, sc: 0.9 + r() * 0.22, jump: r() }));
  }, [seats]);
  const cursor = useRef(0);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sv = useMemo(() => new THREE.Vector3(), []);
  const write = (i, t) => {
    const d = data[i];
    const c = cheer > 0 && d.jump < 0.3 + cheer * 0.6 ? cheer : 0;
    const bob = Math.sin(t * d.sp + d.ph) * d.amp + c * Math.max(0, Math.sin(t * 7 + d.ph)) * 0.3;
    sv.set(d.sc, d.sc, d.sc);
    v.set(d.x, d.y + 0.29 * d.sc + bob, d.z);
    m.compose(v, q, sv);
    bodyRef.current.setMatrixAt(i, m);
    v.y += 0.36 * d.sc + Math.sin(t * d.sp * 0.5 + d.ph) * 0.015;
    m.compose(v, q, sv);
    headRef.current.setMatrixAt(i, m);
  };
  useEffect(() => {
    if (!bodyRef.current) return;
    const r = rng(5);
    const c = new THREE.Color();
    data.forEach((d, i) => {
      write(i, 0);
      bodyRef.current.setColorAt(i, c.set(BRIGHTS[Math.floor(r() * BRIGHTS.length)]).offsetHSL(0, 0, (r() - 0.5) * 0.12));
      headRef.current.setColorAt(i, c.set(SKIN[Math.floor(r() * SKIN.length)]));
    });
    for (const ref of [bodyRef, headRef]) {
      ref.current.instanceMatrix.needsUpdate = true;
      ref.current.instanceColor.needsUpdate = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useFrame((st) => {
    if (!bodyRef.current) return;
    const t = st.clock.elapsedTime;
    const n = data.length;
    const batch = Math.ceil(n / 3); // update a third of the crowd per frame
    for (let k = 0; k < batch; k++) {
      write(cursor.current, t);
      cursor.current = (cursor.current + 1) % n;
    }
    bodyRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, data.length]} frustumCulled={false}>
        <capsuleGeometry args={[0.16, 0.26, 3, 8]} />
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, data.length]} frustumCulled={false}>
        <sphereGeometry args={[0.135, 10, 8]} />
        <meshStandardMaterial roughness={0.55} />
      </instancedMesh>
    </group>
  );
}

/** Stepped grandstand. Built in local space: rows step away along +Z, length along X. */
function Grandstand({ position, rotation = 0, length, rows, rowD = 0.8, rowH = 0.45, base = 0.55, palette }) {
  const tiers = Array.from({ length: rows }, (_, k) => k);
  const depth = rows * rowD;
  const backH = base + rows * rowH + 1.2;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {tiers.map((k) => {
        const top = base + (k + 1) * rowH;
        return (
          <group key={k}>
            <mesh position={[0, top / 2, k * rowD + rowD / 2]}>
              <boxGeometry args={[length, top, rowD]} />
              <meshStandardMaterial color={k % 2 ? '#2a1838' : '#341e46'} roughness={0.8} />
            </mesh>
            {/* coloured seat strip */}
            <mesh position={[0, top + 0.06, k * rowD + rowD * 0.72]}>
              <boxGeometry args={[length - 0.1, 0.12, 0.26]} />
              <meshPhysicalMaterial color={palette[k % palette.length]} clearcoat={0.8} roughness={0.35} />
            </mesh>
            {/* riser face trim */}
            <mesh position={[0, top - 0.03, k * rowD + 0.005]}>
              <boxGeometry args={[length, 0.06, 0.02]} />
              <meshBasicMaterial color={neon(palette[(k + 1) % palette.length], 1.1)} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
      {/* front wall */}
      <mesh position={[0, base / 2, -0.06]}>
        <boxGeometry args={[length, base, 0.12]} />
        <meshPhysicalMaterial color={DARK} clearcoat={1} roughness={0.25} />
      </mesh>
      {/* back wall + top neon */}
      <mesh position={[0, backH / 2, depth + 0.1]}>
        <boxGeometry args={[length + 0.4, backH, 0.2]} />
        <meshStandardMaterial color="#22122e" roughness={0.8} />
      </mesh>
      <mesh position={[0, backH + 0.02, depth + 0.1]}>
        <boxGeometry args={[length + 0.4, 0.08, 0.24]} />
        <meshBasicMaterial color={neon(palette[0], 1.6)} toneMapped={false} />
      </mesh>
      {/* end caps */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (length / 2 + 0.1), backH / 2, depth / 2]}>
          <boxGeometry args={[0.2, backH, depth + 0.4]} />
          <meshPhysicalMaterial color="#3b1d55" clearcoat={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function standSeats(position, rotation, length, rows, { rowD = 0.8, rowH = 0.45, base = 0.55, spacing = 0.78, prob = 0.5, seed = 1 }) {
  const r = rng(seed);
  const out = [];
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  for (let k = 0; k < rows; k++) {
    const n = Math.floor(length / spacing);
    for (let i = 0; i < n; i++) {
      if (r() > prob) continue;
      const lx = -length / 2 + spacing / 2 + i * spacing + (r() - 0.5) * 0.12;
      const lz = k * rowD + rowD * 0.42;
      // rotate local (lx, lz) by `rotation` around Y
      out.push({ x: position[0] + lx * c + lz * s, y: position[1] + base + (k + 1) * rowH, z: position[2] - lx * s + lz * c });
    }
  }
  return out;
}

function Flag({ position, color, phase = 0 }) {
  const ref = useRef();
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1.3, 0.75, 10, 1);
    g.translate(0.65, 0, 0);
    return g;
  }, []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo]);
  useFrame((st) => {
    const p = geo.attributes.position;
    const t = st.clock.elapsedTime * 3 + phase;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3];
      p.array[i * 3 + 2] = Math.sin(x * 3.5 - t) * 0.12 * x;
    }
    p.needsUpdate = true;
  });
  return (
    <group position={position}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 2.2, 8]} />
        <meshPhysicalMaterial color="#f2f2f2" metalness={0.7} roughness={0.2} />
      </mesh>
      <mesh position={[0, 2.25, 0]}>
        <sphereGeometry args={[0.08, 12, 8]} />
        <meshPhysicalMaterial color={YELLOW} metalness={0.6} roughness={0.2} />
      </mesh>
      <mesh ref={ref} geometry={geo} position={[0.04, 1.8, 0]}>
        <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.6} />
      </mesh>
    </group>
  );
}

function LightTower({ position, rotation = 0, h = 10 }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.14, 0.26, h, 10]} />
        <meshPhysicalMaterial color="#e9e4f2" metalness={0.6} roughness={0.3} />
      </mesh>
      <group position={[0, h + 0.6, 0]} rotation={[0.35, 0, 0]}>
        <RoundedBox args={[2.6, 1.5, 0.3]} radius={0.1} smoothness={2}>
          <meshPhysicalMaterial color="#2a1d21" clearcoat={1} roughness={0.3} />
        </RoundedBox>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[(i % 4) * 0.6 - 0.9, i < 4 ? 0.33 : -0.33, 0.16]}>
            <circleGeometry args={[0.22, 16]} />
            <meshBasicMaterial color={neon('#fff4dc', 2.2)} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function UmpireChair({ position, rotation = 0 }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => (
        <mesh key={i} position={[a * 0.32, 0.85, b * 0.32]} rotation={[b * 0.08, 0, -a * 0.08]} castShadow>
          <cylinderGeometry args={[0.04, 0.05, 1.75, 8]} />
          <meshPhysicalMaterial color="#ffffff" clearcoat={1} roughness={0.2} />
        </mesh>
      ))}
      {[0.5, 1.0].map((y) => (
        <mesh key={y} position={[0.28, y, 0]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.08, 0.05, 0.62]} />
          <meshPhysicalMaterial color={YELLOW} clearcoat={1} roughness={0.2} />
        </mesh>
      ))}
      <RoundedBox args={[0.8, 0.14, 0.8]} radius={0.05} smoothness={2} position={[0, 1.75, 0]} castShadow>
        <meshPhysicalMaterial color={PURPLE} clearcoat={1} roughness={0.2} />
      </RoundedBox>
      <RoundedBox args={[0.12, 0.7, 0.8]} radius={0.05} smoothness={2} position={[-0.36, 2.15, 0]} castShadow>
        <meshPhysicalMaterial color={PURPLE} clearcoat={1} roughness={0.2} />
      </RoundedBox>
      {/* umpire */}
      <mesh position={[-0.05, 2.15, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.3, 4, 10]} />
        <meshStandardMaterial color="#1f2a6b" roughness={0.6} />
      </mesh>
      <mesh position={[-0.05, 2.62, 0]} castShadow>
        <sphereGeometry args={[0.15, 16, 12]} />
        <meshStandardMaterial color="#f1b98c" roughness={0.5} />
      </mesh>
      <mesh position={[-0.05, 2.74, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.06, 16]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>
      {/* parasol */}
      <mesh position={[-0.42, 2.9, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 1.0, 6]} />
        <meshStandardMaterial color="#ddd" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[-0.2, 3.35, 0]}>
        <coneGeometry args={[0.75, 0.32, 12, 1, true]} />
        <meshPhysicalMaterial color={RED} clearcoat={1} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function TennisStadium({ halfW = 4, halfL = 8, cheer = 0 }) {
  const fx = halfW + 2.8; // fence x
  const fz = halfL + 3.6; // fence z
  const tex = useMemo(
    () => ({
      grass: grassTex(),
      score: scoreboardTex(),
      sponsors: [
        sponsorTex('MYCADE', RED, '#ffffff', YELLOW),
        sponsorTex('RALLY!', PURPLE, YELLOW, LIME),
        sponsorTex('PHONE POWER', '#1aa3ff', '#ffffff', PINK),
        sponsorTex('SMASH IT', YELLOW, RED, PURPLE),
        sponsorTex('BUDDY CUP', '#12b886', '#ffffff', YELLOW),
      ],
    }),
    [],
  );
  useDispose(useMemo(() => [tex.grass, tex.score, ...tex.sponsors], [tex]));

  const boards = useMemo(() => {
    const out = [];
    const seg = 3.9;
    let k = 0;
    for (const s of [-1, 1]) {
      const n = Math.round((fz * 2) / seg);
      for (let i = 0; i < n; i++) out.push({ p: [s * fx, 0, -fz + (fz * 2) / n / 2 + i * (fz * 2) / n], ry: -s * Math.PI / 2, w: (fz * 2) / n - 0.08, t: k++ % 5 });
    }
    for (const s of [-1, 1]) {
      const n = Math.round((fx * 2) / seg);
      for (let i = 0; i < n; i++) out.push({ p: [-fx + (fx * 2) / n / 2 + i * (fx * 2) / n, 0, s * fz], ry: s < 0 ? 0 : Math.PI, w: (fx * 2) / n - 0.08, t: (k++ + 2) % 5 });
    }
    return out;
  }, [fx, fz]);

  const sideLen = fz * 2 - 1;
  const farW = (fx + 0.7 + 7 * 0.8) * 2 + 0.2;
  const stands = useMemo(() => {
    const L = { length: sideLen, rows: 7 };
    const F = { length: farW, rows: 9 };
    return {
      left: { position: [-(fx + 0.7), 0, -0.5], rotation: -Math.PI / 2, ...L },
      right: { position: [fx + 0.7, 0, -0.5], rotation: Math.PI / 2, ...L },
      far: { position: [0, 0, -(fz + 0.8)], rotation: Math.PI, ...F },
    };
  }, [fx, fz, sideLen, farW]);
  const seats = useMemo(
    () => [
      ...standSeats(stands.far.position, stands.far.rotation, stands.far.length, stands.far.rows, { prob: 0.55, seed: 11 }),
      ...standSeats(stands.left.position, stands.left.rotation, stands.left.length, stands.left.rows, { prob: 0.34, seed: 12 }),
      ...standSeats(stands.right.position, stands.right.rotation, stands.right.length, stands.right.rows, { prob: 0.34, seed: 13 }),
    ],
    [stands],
  );
  const farDepth = 9 * 0.8;
  const farBackZ = -(fz + 0.8) - farDepth - 0.1;
  const farBackTop = 0.55 + 9 * 0.45 + 1.2;

  return (
    <group>
      {/* striped grass surround (slightly below the court plane) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial map={tex.grass} roughness={0.95} />
      </mesh>
      {/* court apron border */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.003, 0]} receiveShadow>
        <planeGeometry args={[halfW * 2 + 3.2, halfL * 2 + 4.6]} />
        <meshPhysicalMaterial color="#5a2fa8" roughness={0.6} clearcoat={0.3} />
      </mesh>

      {/* sponsor boards */}
      {boards.map((b, i) => (
        <group key={i} position={b.p} rotation={[0, b.ry, 0]}>
          <RoundedBox args={[b.w, 0.9, 0.22]} radius={0.08} smoothness={2} position={[0, 0.45, 0]}>
            <meshPhysicalMaterial color={DARK} clearcoat={1} roughness={0.3} />
          </RoundedBox>
          <mesh position={[0, 0.46, 0.112]}>
            <planeGeometry args={[b.w - 0.14, 0.72]} />
            <meshStandardMaterial map={tex.sponsors[b.t]} roughness={0.35} emissive="#ffffff" emissiveMap={tex.sponsors[b.t]} emissiveIntensity={0.3} />
          </mesh>
        </group>
      ))}

      {/* grandstands + crowd */}
      <Grandstand {...stands.far} palette={[RED, YELLOW, PURPLE]} />
      <Grandstand {...stands.left} palette={[PURPLE, PINK, CYAN]} />
      <Grandstand {...stands.right} palette={[LIME, YELLOW, ORANGE]} />
      <Crowd seats={seats} cheer={cheer} />

      {/* scoreboard on the far stand */}
      <group position={[0, farBackTop + 2.0, farBackZ - 0.1]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 2.6, -1.6, -0.1]}>
            <boxGeometry args={[0.25, 2.4, 0.25]} />
            <meshPhysicalMaterial color="#e9e4f2" metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
        <RoundedBox args={[7.4, 3.2, 0.5]} radius={0.22} smoothness={3}>
          <meshPhysicalMaterial color={DARK} clearcoat={1} roughness={0.2} />
        </RoundedBox>
        <mesh position={[0, 0, 0.26]}>
          <planeGeometry args={[6.9, 2.83]} />
          <meshBasicMaterial map={tex.score} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.66, 0]}>
          <boxGeometry args={[7.2, 0.08, 0.3]} />
          <meshBasicMaterial color={neon(YELLOW, 1.8)} toneMapped={false} />
        </mesh>
        <mesh position={[0, -1.66, 0]}>
          <boxGeometry args={[7.2, 0.08, 0.3]} />
          <meshBasicMaterial color={neon(RED, 1.8)} toneMapped={false} />
        </mesh>
      </group>

      {/* flags along the far stand */}
      {[-11, -7.5, 7.5, 11].map((x, i) => (
        <Flag key={x} position={[x, farBackTop, farBackZ]} color={[RED, YELLOW, LIME, PURPLE][i]} phase={i * 1.3} />
      ))}
      {[-1, 1].flatMap((s) =>
        [-6, 2].map((z, i) => <Flag key={`${s}${z}`} position={[s * (fx + 0.7 + 7 * 0.8 + 0.1), 0.55 + 7 * 0.45 + 1.2, z]} color={[PINK, CYAN][i]} phase={s + i} />),
      )}

      <UmpireChair position={[-(halfW + 1.35), 0, 0]} rotation={0} />
      {/* players' benches by the chair */}
      {[-1.6, 1.6].map((z, i) => (
        <RoundedBox key={z} args={[0.5, 0.45, 1.3]} radius={0.1} smoothness={2} position={[-(halfW + 1.7), 0.22, z]} castShadow>
          <meshPhysicalMaterial color={i ? YELLOW : PURPLE} clearcoat={1} roughness={0.25} />
        </RoundedBox>
      ))}

      {/* light towers */}
      <LightTower position={[-15, 0, farBackZ - 1]} rotation={0.6} h={9.5} />
      <LightTower position={[15, 0, farBackZ - 1]} rotation={-0.6} h={9.5} />
      <LightTower position={[-15, 0, fz + 1]} rotation={Math.PI - 0.6} h={9.5} />
      <LightTower position={[15, 0, fz + 1]} rotation={-Math.PI + 0.6} h={9.5} />
    </group>
  );
}

/* ------------------------------------------------------------------ PARTY PARK */

function coinTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#fff3a8');
    g.addColorStop(0.6, '#ffc62a');
    g.addColorStop(1, '#e08a00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#c56f00';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    toyText(ctx, 'M', w / 2, h / 2 + 8, 150, '#fff7d0', { stroke: '#c56f00', lw: 0.1 });
  });
}

const ISLANDS = [
  [-13, -6, -14, 3.2], [14, -8, -16, 3.6], [-22, -3, -26, 4.2], [22, -2, -27, 3.4], [-7.5, -12, -20, 2.4],
  [8, -4.5, -33, 2.8], [-32, -8, -36, 5], [32, -6, -38, 4.6], [0, -14, -26, 2.6], [-11, -9, -5, 2], [12, -11, -7, 2.2],
];

function Island({ position, r, seed }) {
  const g = useRef();
  const rnd = useMemo(() => rng(seed), [seed]);
  const deco = useMemo(() => {
    const trees = [];
    const n = Math.max(1, Math.round(r * 0.9));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.6;
      trees.push({ p: [Math.cos(a) * d, 0, Math.sin(a) * d], s: 0.6 + rnd() * 0.6, c: ['#5fd43c', '#ff7ab8', '#ffd23a', '#7be36a'][Math.floor(rnd() * 4)] });
    }
    return { trees, cab: rnd() > 0.55, cabA: rnd() * Math.PI * 2, ph: rnd() * 6 };
  }, [r, rnd]);
  useFrame((st) => {
    if (g.current) g.current.position.y = position[1] + Math.sin(st.clock.elapsedTime * 0.5 + deco.ph) * 0.35;
  });
  return (
    <group ref={g} position={position}>
      <mesh position={[0, -0.15, 0]}>
        <cylinderGeometry args={[r, r * 0.96, 0.4, 28]} />
        <meshPhysicalMaterial color="#58c93a" clearcoat={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.05, 0]} scale={[r, 0.25, r]}>
        <sphereGeometry args={[1, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color="#6fdc45" clearcoat={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[r * 0.97, r * 0.85, 0.5, 28]} />
        <meshStandardMaterial color="#c9824a" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.8 - r * 0.7, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[r * 0.85, r * 1.4, 9, 2]} />
        <meshStandardMaterial color="#9a5a3a" roughness={0.9} flatShading />
      </mesh>
      {deco.trees.map((t, i) => (
        <group key={i} position={[t.p[0], 0.15, t.p[2]]} scale={t.s}>
          <mesh position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.08, 0.12, 0.9, 8]} />
            <meshStandardMaterial color="#8a5a3a" />
          </mesh>
          <mesh position={[0, 1.15, 0]}>
            <sphereGeometry args={[0.55, 16, 12]} />
            <meshPhysicalMaterial color={t.c} clearcoat={0.8} roughness={0.35} />
          </mesh>
        </group>
      ))}
      {deco.cab && (
        <group position={[Math.cos(deco.cabA) * r * 0.45, 0.2, Math.abs(Math.sin(deco.cabA)) * r * 0.4]} rotation={[0, (deco.cabA % 1) - 0.5, 0]}>
          <RoundedBox args={[0.7, 1.4, 0.6]} radius={0.1} smoothness={2} position={[0, 0.7, 0]}>
            <meshPhysicalMaterial color={RED} clearcoat={1} roughness={0.2} />
          </RoundedBox>
          <mesh position={[0, 0.95, 0.31]}>
            <planeGeometry args={[0.5, 0.38]} />
            <meshBasicMaterial color={neon(CYAN, 1.5)} toneMapped={false} />
          </mesh>
          <mesh position={[0, 1.38, 0.31]}>
            <planeGeometry args={[0.6, 0.12]} />
            <meshBasicMaterial color={neon(YELLOW, 1.5)} toneMapped={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function Balloons({ count = 22 }) {
  const ref = useRef();
  const strRef = useRef();
  const data = useMemo(() => {
    const r = rng(21);
    const out = [];
    while (out.length < count) {
      const x = (r() - 0.5) * 80;
      const z = -10 - r() * 32;
      out.push({ x, y: -16 + r() * 22, z, sp: 0.25 + r() * 0.35, ph: r() * 6, s: 0.6 + r() * 0.5, c: BRIGHTS[out.length % BRIGHTS.length] });
    }
    return out;
  }, [count]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sv = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const c = new THREE.Color();
    data.forEach((d, i) => ref.current.setColorAt(i, c.set(d.c)));
    ref.current.instanceColor.needsUpdate = true;
  }, [data]);
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime;
    data.forEach((d, i) => {
      d.y += d.sp * dt;
      if (d.y > 6) d.y = -18;
      v.set(d.x + Math.sin(t * 0.4 + d.ph) * 0.6, d.y, d.z);
      sv.set(d.s, d.s * 1.18, d.s);
      m.compose(v, q, sv);
      ref.current.setMatrixAt(i, m);
      v.y -= d.s * 1.18 + 0.75 * d.s;
      sv.set(d.s, d.s, d.s);
      m.compose(v, q, sv);
      strRef.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    strRef.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, data.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 20, 16]} />
        <meshPhysicalMaterial roughness={0.15} clearcoat={1} clearcoatRoughness={0.05} />
      </instancedMesh>
      <instancedMesh ref={strRef} args={[undefined, undefined, data.length]} frustumCulled={false}>
        <cylinderGeometry args={[0.012, 0.012, 1.5, 4]} />
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>
    </group>
  );
}

function Coins({ count = 16 }) {
  const ref = useRef();
  const tex = useMemo(coinTex, []);
  useDispose(useMemo(() => [tex], [tex]));
  const data = useMemo(() => {
    const r = rng(33);
    const out = [];
    while (out.length < count) {
      const x = (r() - 0.5) * 60;
      const z = -6 - r() * 30;
      if (Math.abs(x) < 8 && z > -10) continue;
      out.push({ x, y: -11 + r() * 12, z, sp: 1 + r() * 1.5, ph: r() * 6, s: 0.5 + r() * 0.45 });
    }
    return out;
  }, [count]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sv = useMemo(() => new THREE.Vector3(), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    data.forEach((d, i) => {
      e.set(Math.PI / 2, 0, t * d.sp + d.ph);
      q.setFromEuler(e);
      v.set(d.x, d.y + Math.sin(t + d.ph) * 0.4, d.z);
      sv.setScalar(d.s);
      m.compose(v, q, sv);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  const mats = useMemo(() => {
    const side = new THREE.MeshPhysicalMaterial({ color: '#ffb81f', metalness: 0.85, roughness: 0.22, clearcoat: 1, emissive: '#7a4a00', emissiveIntensity: 0.4 });
    const face = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.6, roughness: 0.25, clearcoat: 1, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 });
    return [side, face, face];
  }, [tex]);
  const geo = useMemo(() => new THREE.CylinderGeometry(1, 1, 0.16, 32), []);
  useDispose(useMemo(() => [geo, ...mats.slice(0, 2)], [geo, mats]));
  return <instancedMesh ref={ref} args={[geo, mats, data.length]} frustumCulled={false} />;
}

function NeonRainbow({ position = [0, -15, -36], R = 13.5 }) {
  const cols = [RED, ORANGE, YELLOW, LIME, CYAN, PURPLE];
  return (
    <group position={position}>
      {cols.map((c, i) => (
        <group key={c}>
          <mesh>
            <torusGeometry args={[R - i * 0.75, 0.2, 10, 96, Math.PI]} />
            <meshBasicMaterial color={neon(c, 1.9)} toneMapped={false} />
          </mesh>
          <mesh>
            <torusGeometry args={[R - i * 0.75, 0.42, 8, 64, Math.PI]} />
            <meshBasicMaterial color={c} transparent opacity={0.18} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      ))}
      {/* puffy cloud feet */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (R - 1.9), -0.2, 0]}>
          {[[0, 0, 0, 1.9], [1.5, -0.4, 0.5, 1.4], [-1.6, -0.5, 0.3, 1.3], [0.4, 0.9, -0.3, 1.2]].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]}>
              <sphereGeometry args={[r, 20, 14]} />
              <meshPhysicalMaterial color="#ffe6f0" roughness={0.6} clearcoat={0.3} emissive="#ff8fb8" emissiveIntensity={0.25} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export function PartyPark() {
  return (
    <group>
      {ISLANDS.map(([x, y, z, r], i) => (
        <Island key={i} position={[x, y, z]} r={r} seed={i * 17 + 3} />
      ))}
      <Balloons />
      <Coins />
      <NeonRainbow />
    </group>
  );
}
