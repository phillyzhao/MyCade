// Procedural toy go-kart. Forward = +Z, ~1.6 long, ~1.05 wide. Everything is generated in code:
// geometries are module-level singletons shared by every kart, materials are memoized per color.
// steer: -1..1 (positive = right turn, same sign convention as Racing: heading -= steer)
// speed: units/s, drives wheel spin. boosting: shows twin exhaust flames.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Where the driver's feet go (local kart space). Legs sink into the tub so the avatar reads as seated. */
export const KART_SEAT = [0, 0.13, -0.13];

const DARK = '#1e1518';
const YELLOW = '#ffd23a';
const FRONT_R = 0.2;
const REAR_R = 0.22;
const WHEEL_X = 0.43;
const FRONT_Z = 0.5;
const REAR_Z = -0.5;
const MAX_STEER = 0.45;

// ---------------------------------------------------------------- canvas textures (cached)
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const texCache = new Map();
function cached(key, make) {
  if (!texCache.has(key)) texCache.set(key, make());
  return texCache.get(key);
}

// tire tread: chevrons around the circumference (lathe u = around, v = across profile)
const treadTex = () =>
  cached('tread', () => {
    const t = canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#5a5a5a';
      const n = 28;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w;
        g.beginPath();
        g.moveTo(x, h * 0.28);
        g.lineTo(x + 7, h * 0.28);
        g.lineTo(x + 15, h * 0.5);
        g.lineTo(x + 7, h * 0.72);
        g.lineTo(x, h * 0.72);
        g.lineTo(x + 8, h * 0.5);
        g.closePath();
        g.fill();
      }
      // sidewall ring lines
      g.fillStyle = '#8a8a8a';
      g.fillRect(0, h * 0.1, w, 2);
      g.fillRect(0, h * 0.88, w, 2);
    }, false);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });

// rim face: 5 chunky spokes
const spokeTex = () =>
  cached('spokes', () =>
    canvasTex(128, 128, (g, w) => {
      const c = w / 2;
      g.fillStyle = '#2a2226';
      g.fillRect(0, 0, w, w);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) {
        g.save();
        g.translate(c, c);
        g.rotate((i / 5) * Math.PI * 2);
        g.beginPath();
        g.moveTo(-10, 0);
        g.lineTo(-15, -60);
        g.lineTo(15, -60);
        g.lineTo(10, 0);
        g.fill();
        g.restore();
      }
      g.beginPath();
      g.arc(c, c, 26, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 9;
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.arc(c, c, 58, 0, Math.PI * 2);
      g.stroke();
    }),
  );

// round race-number roundel
const numberTex = (num, ring) =>
  cached(`num-${num}-${ring}`, () =>
    canvasTex(128, 128, (g, w) => {
      const c = w / 2;
      g.fillStyle = ring;
      g.beginPath();
      g.arc(c, c, 62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(c, c, 50, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = DARK;
      g.font = '900 64px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(num), c, c + 4);
    }),
  );

const glowTex = () =>
  cached('glow', () =>
    canvasTex(64, 64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,220,1)');
      gr.addColorStop(0.25, 'rgba(255,200,60,0.85)');
      gr.addColorStop(0.6, 'rgba(255,80,30,0.3)');
      gr.addColorStop(1, 'rgba(255,40,40,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, w);
    }),
  );

// ---------------------------------------------------------------- shared geometries (built once)
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const rb = (w, h, d, r, s = 2) => new RoundedBoxGeometry(w, h, d, s, r);

  // body: side profile (z, y) extruded across X with a soft bevel
  const s = new THREE.Shape();
  s.moveTo(-0.6, 0.13);
  s.lineTo(-0.6, 0.26);
  s.quadraticCurveTo(-0.6, 0.31, -0.54, 0.31);
  s.lineTo(-0.02, 0.3);
  s.quadraticCurveTo(0.12, 0.3, 0.2, 0.37);
  s.quadraticCurveTo(0.3, 0.37, 0.46, 0.28);
  s.quadraticCurveTo(0.66, 0.2, 0.7, 0.17);
  s.quadraticCurveTo(0.72, 0.13, 0.66, 0.13);
  s.lineTo(-0.6, 0.13);
  const depth = 0.38;
  const body = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.04,
    bevelSegments: 3,
    curveSegments: 6,
  });
  body.translate(0, 0, -depth / 2);
  body.rotateY(-Math.PI / 2);
  body.computeVertexNormals();
  // racing stripe: thin slice of the same profile, bevelled a hair wider so it sits proud of the shell
  const sd = 0.05;
  const stripeBody = new THREE.ExtrudeGeometry(s, {
    depth: sd,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.046,
    bevelSegments: 1,
    curveSegments: 6,
  });
  stripeBody.translate(0, 0, -sd / 2);
  stripeBody.rotateY(-Math.PI / 2);

  // tire: rounded cross-section lathed around Y, then turned so the axle is X
  const tp = [
    [0.125, -0.075], [0.165, -0.085], [0.187, -0.079], [0.198, -0.062], [0.2, -0.03],
    [0.2, 0.03], [0.198, 0.062], [0.187, 0.079], [0.165, 0.085], [0.125, 0.075],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.LatheGeometry(tp, 26);
  tire.rotateZ(-Math.PI / 2);

  const rp = [[0.127, -0.07], [0.13, 0.05], [0.12, 0.072], [0.106, 0.064], [0.097, 0.045]].map(
    ([x, y]) => new THREE.Vector2(x, y),
  );
  const rim = new THREE.LatheGeometry(rp, 18);
  rim.rotateZ(-Math.PI / 2);
  const rimFace = new THREE.CircleGeometry(0.098, 22);
  rimFace.rotateY(Math.PI / 2);
  rimFace.translate(0.045, 0, 0);
  const rimBack = new THREE.CircleGeometry(0.128, 16);
  rimBack.rotateY(-Math.PI / 2);
  rimBack.translate(-0.06, 0, 0);
  const hub = new THREE.SphereGeometry(0.04, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  hub.rotateZ(-Math.PI / 2);
  hub.translate(0.05, 0, 0);

  const tube = (pts, r, seg = 16) =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 7, false);
  const frontBumper = tube(
    [[-0.34, 0.16, 0.6], [-0.3, 0.16, 0.74], [0, 0.17, 0.8], [0.3, 0.16, 0.74], [0.34, 0.16, 0.6]],
    0.045,
  );
  const rearBumper = tube(
    [[-0.48, 0.2, -0.64], [-0.42, 0.2, -0.76], [0, 0.2, -0.79], [0.42, 0.2, -0.76], [0.48, 0.2, -0.64]],
    0.045,
  );
  const capsuleEnd = new THREE.SphereGeometry(0.046, 8, 5);

  const pipe = new THREE.CylinderGeometry(0.038, 0.032, 0.24, 12, 1, true);
  pipe.rotateX(Math.PI / 2);
  const pipeLip = new THREE.TorusGeometry(0.04, 0.012, 4, 12);
  const pipeHole = new THREE.CircleGeometry(0.034, 12);
  pipeHole.rotateY(Math.PI);

  // teardrop flames (lathe), tip toward -Z
  const drop = (r, len) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(new THREE.Vector2(Math.max(0.001, r * Math.sin(Math.PI * Math.pow(t, 0.55)) * (1 - t * 0.25)), -t * len));
    }
    const g = new THREE.LatheGeometry(pts, 8);
    g.rotateX(Math.PI / 2);
    return g;
  };
  const flameIn = drop(0.04, 0.24);
  const flameOut = drop(0.075, 0.42);

  const column = new THREE.CylinderGeometry(0.018, 0.022, 0.26, 8);
  const wheelRing = new THREE.TorusGeometry(0.1, 0.02, 6, 18);
  const wheelBar = rb(0.18, 0.03, 0.025, 0.012, 1);
  const wheelHub = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12);
  wheelHub.rotateX(Math.PI / 2);

  const axle = new THREE.CylinderGeometry(0.02, 0.02, WHEEL_X * 2, 6);
  axle.rotateZ(Math.PI / 2);
  const strut = new THREE.CylinderGeometry(0.016, 0.016, 0.2, 6);
  const headlight = new THREE.SphereGeometry(0.045, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  headlight.rotateX(Math.PI / 2);
  const bezel = new THREE.TorusGeometry(0.047, 0.01, 4, 12);
  const decal = new THREE.CircleGeometry(0.075, 20);
  const filter = new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12);
  filter.rotateZ(Math.PI / 2);

  GEO = {
    body,
    stripeBody,
    tire,
    rim,
    rimFace,
    rimBack,
    hub,
    frontBumper,
    rearBumper,
    capsuleEnd,
    pipe,
    pipeLip,
    pipeHole,
    flameIn,
    flameOut,
    column,
    wheelRing,
    wheelBar,
    wheelHub,
    axle,
    strut,
    headlight,
    bezel,
    decal,
    filter,
    floor: rb(0.62, 0.05, 1.3, 0.024, 1),
    pod: rb(0.17, 0.15, 0.5, 0.06),
    podIntake: rb(0.1, 0.06, 0.03, 0.015, 1),
    stripe: new THREE.BoxGeometry(0.075, 0.012, 0.62),
    seatBase: rb(0.36, 0.07, 0.3, 0.03, 1),
    seatBack: rb(0.38, 0.36, 0.08, 0.035),
    engine: rb(0.32, 0.15, 0.2, 0.04, 1),
    wing: rb(0.84, 0.035, 0.18, 0.016, 1),
    endplate: rb(0.03, 0.16, 0.24, 0.014, 1),
    dash: rb(0.3, 0.04, 0.08, 0.018, 1),
  };
  return GEO;
}

// ---------------------------------------------------------------- materials (shared + per color)
let SHARED = null;
function sharedMats() {
  if (SHARED) return SHARED;
  const glossy = (color, extra = {}) =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1, ...extra });
  const tread = treadTex();
  SHARED = {
    dark: glossy(DARK, { roughness: 0.45, clearcoat: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#2b2427', roughness: 0.9, map: tread, bumpMap: tread, bumpScale: 3 }),
    bumper: new THREE.MeshStandardMaterial({ color: '#2b2427', roughness: 0.7 }),
    rim: glossy('#f4f1f6', { roughness: 0.22, metalness: 0.25 }),
    rimFace: new THREE.MeshPhysicalMaterial({ map: spokeTex(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    chrome: glossy('#d9d6e2', { metalness: 0.55, roughness: 0.18 }),
    soot: new THREE.MeshBasicMaterial({ color: '#0c0809' }),
    yellow: glossy(YELLOW),
    seat: glossy('#2a1f24', { roughness: 0.55, clearcoat: 0.4 }),
    head: new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 1.6, toneMapped: false }),
    flameIn: new THREE.MeshBasicMaterial({ color: '#fff3a0', toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }),
    flameOut: new THREE.MeshBasicMaterial({
      color: '#ff4a12',
      toneMapped: false,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    glow: new THREE.SpriteMaterial({ map: glowTex(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  return SHARED;
}

const colorMatCache = new Map();
function colorMats(color, number) {
  const key = `${color}|${number}`;
  if (colorMatCache.has(key)) return colorMatCache.get(key);
  const c = new THREE.Color(color);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const stripeColor = lum > 0.55 ? DARK : '#ffffff';
  const hsl = {};
  c.getHSL(hsl);
  const deep = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.05), hsl.l * 0.62);
  const m = {
    body: new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
    deep: new THREE.MeshPhysicalMaterial({ color: deep, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    stripe: new THREE.MeshPhysicalMaterial({ color: stripeColor, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    number: new THREE.MeshPhysicalMaterial({
      map: numberTex(number, color),
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  };
  colorMatCache.set(key, m);
  return m;
}

function hashNumber(color) {
  let h = 0;
  for (let i = 0; i < color.length; i++) h = (h * 31 + color.charCodeAt(i)) >>> 0;
  return 1 + (h % 98);
}

// ---------------------------------------------------------------- parts
function Wheel({ position, side, rear, spinRef, steerRef, G, S, cm }) {
  // side: +1 = left (+X), -1 = right. Mirror via a PI yaw so the rim face always points outward.
  const r = rear ? REAR_R : FRONT_R;
  const sc = r / FRONT_R;
  const inner = (
    <group rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
      <group ref={spinRef} scale={[rear ? 1.18 : 1, sc, sc]}>
        <mesh geometry={G.tire} material={S.rubber} castShadow />
        <mesh geometry={G.rim} material={S.rim} />
        <mesh geometry={G.rimFace} material={S.rimFace} />
        <mesh geometry={G.rimBack} material={S.dark} />
        <mesh geometry={G.hub} material={cm.body} />
      </group>
    </group>
  );
  return (
    <group position={position}>
      {steerRef ? <group ref={steerRef}>{inner}</group> : inner}
    </group>
  );
}

// source: optional () => ({steer, speed, boosting}) read every frame (avoids React re-renders in games)
export function Kart({ color = '#ff2d2d', steer = 0, speed = 0, boosting = false, number, source, children }) {
  const G = geos();
  const S = sharedMats();
  const num = number ?? hashNumber(color);
  const cm = useMemo(() => colorMats(color, num), [color, num]);

  const spin = [useRef(), useRef(), useRef(), useRef()];
  const steerL = useRef();
  const steerR = useRef();
  const wheel = useRef();
  const flames = useRef();
  const flameA = useRef();
  const flameB = useRef();
  const glowA = useRef();
  const glowB = useRef();
  const st = useRef({ angle: 0, steer: 0 });
  const live = useRef({ steer, speed, boosting });
  live.current.steer = steer;
  live.current.speed = speed;
  live.current.boosting = boosting;

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.1);
    const L = source ? source() : live.current;
    const s = st.current;
    s.angle += (L.speed || 0) * d;
    const fa = s.angle / FRONT_R;
    const ra = s.angle / REAR_R;
    // after the PI mirror on right-hand wheels, local X is flipped, so negate their spin
    if (spin[0].current) spin[0].current.rotation.x = fa;
    if (spin[1].current) spin[1].current.rotation.x = -fa;
    if (spin[2].current) spin[2].current.rotation.x = ra;
    if (spin[3].current) spin[3].current.rotation.x = -ra;
    s.steer += (THREE.MathUtils.clamp(L.steer || 0, -1, 1) - s.steer) * Math.min(1, d * 14);
    const yaw = -s.steer * MAX_STEER;
    if (steerL.current) steerL.current.rotation.y = yaw;
    if (steerR.current) steerR.current.rotation.y = yaw;
    if (wheel.current) wheel.current.rotation.z = s.steer * 1.4;
    if (flames.current) {
      flames.current.visible = !!L.boosting;
      if (L.boosting) {
        const t = state.clock.elapsedTime;
        const f1 = 0.75 + Math.random() * 0.5;
        const f2 = 0.75 + Math.random() * 0.5;
        flameA.current.scale.set(1 + Math.sin(t * 40) * 0.1, 1 + Math.sin(t * 40) * 0.1, f1);
        flameB.current.scale.set(1 + Math.cos(t * 37) * 0.1, 1 + Math.cos(t * 37) * 0.1, f2);
        const g1 = 0.3 + f1 * 0.18;
        const g2 = 0.3 + f2 * 0.18;
        glowA.current.scale.set(g1, g1, 1);
        glowB.current.scale.set(g2, g2, 1);
      }
    }
  });

  return (
    <group>
      {/* chassis */}
      <mesh geometry={G.floor} material={S.dark} position={[0, 0.1, -0.02]} castShadow />
      <mesh geometry={G.axle} material={S.dark} position={[0, FRONT_R, FRONT_Z]} />
      <mesh geometry={G.axle} material={S.dark} position={[0, REAR_R, REAR_Z]} />

      {/* body shell + racing stripes */}
      <mesh geometry={G.body} material={cm.body} castShadow receiveShadow />
      <mesh geometry={G.stripeBody} material={cm.stripe} position={[-0.075, 0, 0]} />
      <mesh geometry={G.stripeBody} material={cm.stripe} position={[0.075, 0, 0]} />
      <mesh geometry={G.dash} material={S.dark} position={[0, 0.405, 0.2]} />
      {/* nose number */}
      <mesh geometry={G.decal} material={cm.number} position={[0, 0.296, 0.56]} rotation={[-Math.PI / 2 + 0.38, 0, 0]} scale={0.85} />

      {/* side pods with numbers + intakes */}
      {[1, -1].map((sd) => (
        <group key={sd} position={[sd * 0.385, 0.2, -0.02]}>
          <mesh geometry={G.pod} material={cm.body} castShadow />
          <mesh geometry={G.podIntake} material={S.dark} position={[0, 0.02, 0.252]} />
          <mesh geometry={G.decal} material={cm.number} position={[sd * 0.0865, 0, -0.03]} rotation={[0, sd * Math.PI / 2, 0]} scale={0.78} />
          <mesh geometry={G.stripe} material={S.yellow} position={[0, 0.0755, 0]} scale={[1.2, 1, 0.75]} />
        </group>
      ))}

      {/* bumpers */}
      <mesh geometry={G.frontBumper} material={S.bumper} castShadow />
      <mesh geometry={G.rearBumper} material={S.bumper} castShadow />
      {[[-0.34, 0.16, 0.6], [0.34, 0.16, 0.6], [-0.48, 0.2, -0.64], [0.48, 0.2, -0.64]].map((p, i) => (
        <mesh key={i} geometry={G.capsuleEnd} material={S.yellow} position={p} />
      ))}

      {/* headlights */}
      {[-0.13, 0.13].map((x) => (
        <group key={x} position={[x, 0.235, 0.66]} rotation={[0.35, 0, 0]}>
          <mesh geometry={G.headlight} material={S.head} />
          <mesh geometry={G.bezel} material={S.chrome} />
        </group>
      ))}

      {/* steering column + wheel */}
      <mesh geometry={G.column} material={S.dark} position={[0, 0.43, 0.12]} rotation={[0.9, 0, 0]} />
      <group position={[0, 0.5, 0.05]} rotation={[-0.75, 0, 0]}>
        <group ref={wheel}>
          <mesh geometry={G.wheelRing} material={S.dark} castShadow />
          <mesh geometry={G.wheelBar} material={S.dark} />
          <mesh geometry={G.wheelHub} material={S.yellow} />
        </group>
      </group>

      {/* seat */}
      <mesh geometry={G.seatBase} material={S.seat} position={[0, 0.33, -0.15]} />
      <mesh geometry={G.seatBack} material={S.seat} position={[0, 0.48, -0.33]} rotation={[-0.22, 0, 0]} castShadow />
      <mesh geometry={G.stripe} material={cm.body} position={[0, 0.48, -0.373]} rotation={[Math.PI / 2 - 0.22, 0, 0]} scale={[1.6, 1, 0.42]} />

      {/* engine + air filter */}
      <mesh geometry={G.engine} material={S.dark} position={[0, 0.38, -0.5]} castShadow />
      <mesh geometry={G.filter} material={S.yellow} position={[0.2, 0.4, -0.5]} />
      <mesh geometry={G.filter} material={cm.deep} position={[-0.2, 0.4, -0.5]} />

      {/* exhausts */}
      {[-0.11, 0.11].map((x) => (
        <group key={x} position={[x, 0.36, -0.66]} rotation={[0.18, 0, 0]}>
          <mesh geometry={G.pipe} material={S.chrome} />
          <mesh geometry={G.pipeLip} material={S.chrome} position={[0, 0, -0.12]} />
          <mesh geometry={G.pipeHole} material={S.soot} position={[0, 0, -0.11]} />
        </group>
      ))}

      {/* boost flames */}
      <group ref={flames} visible={false}>
        {[
          [-0.11, flameA, glowA],
          [0.11, flameB, glowB],
        ].map(([x, fr, gr]) => (
          <group key={x} position={[x, 0.36 + 0.022, -0.78]} rotation={[0.18, 0, 0]}>
            <group ref={fr}>
              <mesh geometry={G.flameOut} material={S.flameOut} renderOrder={5} />
              <mesh geometry={G.flameIn} material={S.flameIn} renderOrder={6} />
            </group>
            <sprite ref={gr} material={S.glow} position={[0, 0, -0.05]} renderOrder={7} />
          </group>
        ))}
      </group>

      {/* rear spoiler */}
      <group position={[0, 0.49, -0.69]}>
        <mesh geometry={G.wing} material={cm.body} rotation={[-0.14, 0, 0]} castShadow />
        <mesh geometry={G.endplate} material={S.dark} position={[0.43, -0.02, 0]} castShadow />
        <mesh geometry={G.endplate} material={S.dark} position={[-0.43, -0.02, 0]} castShadow />
        <mesh geometry={G.strut} material={S.dark} position={[0.2, -0.08, 0.05]} scale={[1, 0.7, 1]} />
        <mesh geometry={G.strut} material={S.dark} position={[-0.2, -0.08, 0.05]} scale={[1, 0.7, 1]} />
      </group>

      {/* wheels */}
      <Wheel position={[WHEEL_X, FRONT_R, FRONT_Z]} side={1} spinRef={spin[0]} steerRef={steerL} G={G} S={S} cm={cm} />
      <Wheel position={[-WHEEL_X, FRONT_R, FRONT_Z]} side={-1} spinRef={spin[1]} steerRef={steerR} G={G} S={S} cm={cm} />
      <Wheel position={[WHEEL_X + 0.01, REAR_R, REAR_Z]} side={1} rear spinRef={spin[2]} G={G} S={S} cm={cm} />
      <Wheel position={[-WHEEL_X - 0.01, REAR_R, REAR_Z]} side={-1} rear spinRef={spin[3]} G={G} S={S} cm={cm} />

      {children != null && <group position={KART_SEAT}>{children}</group>}
    </group>
  );
}
