// ToyBody: procedural "Buddy" toy character. Drop-in replacement for Avatar.jsx's DefaultBody.
// Keeps the exact rig contract the pose system mutates:
//   lLeg [-0.07,0.24,0] / rLeg [0.07,0.24,0]   hip pivots (rotation.x swings)
//   body [0,0.3,0]                             hop / lean / twist / squash
//     lArm [0.14,0.22,0] / rArm [-0.14,0.22,0] shoulder pivots, arm hangs -Y
//     head [0,0.27,0]                          neck pivot
// Feet at y=0, top of head ~1.0, facing +Z. Everything shares cached geometries/materials.
import { useMemo } from 'react';
import * as THREE from 'three';

const PI = Math.PI;

// ---------------------------------------------------------------- looks
const SKINS = ['#ffe1c9', '#f7cba6', '#eab48b', '#d49a6c', '#a9704b', '#7b4f35'];
const PRESETS = [
  { skin: SKINS[1], hair: '#5a3620', hairStyle: 'short', eyes: 'round', shirt: 'tee', pants: '#3c5a8f', shoes: '#ff5a5f', glasses: false, iris: '#4a2c18' },
  { skin: SKINS[3], hair: '#1b1719', hairStyle: 'bob', eyes: 'happy', shirt: 'stripe', pants: '#2f3140', shoes: '#ffcf3a', glasses: false, iris: '#2b1a10' },
  { skin: SKINS[0], hair: '#e9bb5c', hairStyle: 'spiky', eyes: 'round', shirt: 'hoodie', pants: '#c9a878', shoes: '#36d39a', glasses: false, iris: '#2f6fb0' },
  { skin: SKINS[2], hair: '#b0562c', hairStyle: 'pigtails', eyes: 'round', shirt: 'tee', pants: '#4b3f72', shoes: '#ff7aa8', glasses: true, iris: '#3f6b35' },
  { skin: SKINS[5], hair: '#1b1719', hairStyle: 'cap', eyes: 'happy', shirt: 'hoodie', pants: '#3c5a8f', shoes: '#ff8c42', glasses: false, iris: '#2b1a10' },
  { skin: SKINS[1], hair: '#c4682f', hairStyle: 'beanie', eyes: 'sleepy', shirt: 'stripe', pants: '#36454f', shoes: '#4d9de0', glasses: true, iris: '#5a7a3a' },
  { skin: SKINS[4], hair: '#2a1c15', hairStyle: 'short', eyes: 'happy', shirt: 'hoodie', pants: '#2d5d4a', shoes: '#9b5de5', glasses: true, iris: '#2b1a10' },
  { skin: SKINS[2], hair: '#3d3f78', hairStyle: 'spiky', eyes: 'sleepy', shirt: 'tee', pants: '#7a2f3b', shoes: '#f4f1ea', glasses: false, iris: '#3a2a50' },
];

/** Deterministic varied look for a player/CPU slot (0..7, wraps). */
export function lookForSlot(slot = 0) {
  const p = PRESETS[(((slot | 0) % PRESETS.length) + PRESETS.length) % PRESETS.length];
  return { ...p, hat: p.shoes };
}

// ---------------------------------------------------------------- helpers
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const tint = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();

// point on a sphere of radius r at azimuth az (from +Z toward +X) and elevation el,
// with a frame whose +Z is the outward normal (roll spins it in the surface plane)
const surf = (r, az, el, roll = 0) => ({
  position: [r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az)],
  rotation: [-el, az, roll, 'YXZ'],
});

// ---------------------------------------------------------------- shared geometry
const HEAD_R = 0.215;
let GEO = null;
function geo() {
  if (GEO) return GEO;
  const S = (w, h, ...a) => new THREE.SphereGeometry(1, w, h, ...a);

  // torso profile (radius, y) in body space; lathed and slightly flattened front-to-back
  const prof = new THREE.SplineCurve(
    [
      [0, -0.064], [0.07, -0.062], [0.112, -0.05], [0.131, -0.022], [0.137, 0.03], [0.135, 0.09],
      [0.127, 0.15], [0.113, 0.2], [0.09, 0.238], [0.062, 0.262], [0.032, 0.275], [0, 0.279],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  ).getPoints(20);
  const lathe = (pts, off = 0, segs = 20) => {
    const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p.x > 0 ? p.x + off : 0, p.y)), segs);
    g.scale(1, 1, 0.86);
    return g;
  };
  const range = (y0, y1) => prof.filter((p) => p.y >= y0 && p.y <= y1);
  const shirtPts = range(-0.012, 1);
  const hemR = shirtPts[0].x;
  const shirt = lathe([new THREE.Vector2(hemR - 0.012, -0.02), new THREE.Vector2(hemR + 0.006, -0.018), ...shirtPts]);
  const pants = lathe(range(-1, 0.02).map((p) => new THREE.Vector2(p.x * 0.985, p.y)), 0, 18);
  const rAt = (y) => {
    for (let i = 1; i < prof.length; i++) {
      const a = prof[i - 1];
      const b = prof[i];
      if (y <= b.y) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1);
    }
    return 0;
  };
  const band = (y0, y1) => {
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const y = y0 + ((y1 - y0) * i) / 4;
      pts.push(new THREE.Vector2(rAt(y), y));
    }
    return lathe(pts, 0.0035, 20);
  };
  const stripes = [band(0.022, 0.05), band(0.095, 0.123), band(0.165, 0.19)];
  const hem = band(-0.015, 0.006);

  // hoodie hood: arc torus wrapped behind the neck
  const hood = new THREE.TorusGeometry(0.082, 0.036, 7, 18, PI * 1.45);
  hood.rotateZ(PI / 2 - PI * 0.725);
  hood.rotateX(-PI / 2);

  // bob hair pieces
  const bobGap = 0.78;
  const bobSides = new THREE.SphereGeometry(0.236, 34, 10, PI / 2 + bobGap, 2 * PI - 2 * bobGap, PI * 0.33, PI * 0.37);
  const bobRim = new THREE.TorusGeometry(0.236 * Math.sin(PI * 0.7), 0.017, 5, 30, 2 * PI - 2 * bobGap);
  bobRim.rotateZ(PI / 2 + bobGap);
  bobRim.rotateX(PI / 2);
  bobRim.scale(-1, 1, 1); // match SphereGeometry's phi handedness
  bobRim.translate(0, 0.236 * Math.cos(PI * 0.7), 0);

  const cone = new THREE.ConeGeometry(1, 1, 7, 1);
  cone.translate(0, 0.5, 0);

  const arcTorus = (arc) => {
    const g = new THREE.TorusGeometry(1, 0.24, 5, 12, arc);
    g.rotateZ((PI - arc) / 2);
    return g;
  };

  GEO = {
    skull: new THREE.SphereGeometry(HEAD_R, 48, 32),
    s6: S(6, 4),
    s8: S(8, 5),
    s10: S(9, 7),
    s12: S(11, 8),
    s16: S(12, 8),
    hemi: S(12, 6, 0, 2 * PI, 0, PI / 2),
    hairCap: new THREE.SphereGeometry(0.226, 36, 12, 0, 2 * PI, 0, PI * 0.5),
    hairNape: new THREE.SphereGeometry(0.223, 18, 7, PI * 1.08, PI * 0.84, PI * 0.4, PI * 0.33),
    bobTop: new THREE.SphereGeometry(0.236, 36, 9, 0, 2 * PI, 0, PI * 0.38),
    bobSides,
    bobRim,
    capDome: new THREE.SphereGeometry(0.229, 32, 10, 0, 2 * PI, 0, PI * 0.5),
    brim: new THREE.CylinderGeometry(0.13, 0.13, 0.012, 24),
    beanieDome: new THREE.SphereGeometry(0.232, 32, 11, 0, 2 * PI, 0, PI * 0.53),
    cuff: new THREE.CylinderGeometry(0.239, 0.239, 0.056, 32),
    cone,
    arc: arcTorus(PI), // ∩ arc, radius 1
    brow: arcTorus(PI * 0.55),
    smile: (() => {
      const g = arcTorus(PI * 0.8);
      g.rotateZ(PI);
      return g;
    })(),
    halfDisc: new THREE.CircleGeometry(1, 16, PI, PI),
    disc: new THREE.CircleGeometry(1, 16),
    ring: new THREE.TorusGeometry(1, 0.13, 4, 16),
    box: new THREE.BoxGeometry(1, 1, 1),
    shirt,
    pants,
    stripes,
    hem,
    hood,
    neck: new THREE.CylinderGeometry(0.05, 0.055, 0.06, 14, 1, true),
    collar: new THREE.TorusGeometry(0.052, 0.013, 5, 18),
    sleeveLong: new THREE.CapsuleGeometry(0.041, 0.09, 3, 11),
    sleeveShort: new THREE.CapsuleGeometry(0.045, 0.035, 3, 11),
    forearm: new THREE.CapsuleGeometry(0.031, 0.075, 3, 9),
    cuffRing: new THREE.TorusGeometry(0.039, 0.009, 4, 12),
    teeHem: new THREE.TorusGeometry(0.044, 0.007, 4, 12),
    pocket: new THREE.CapsuleGeometry(0.032, 0.075, 2, 8),
    string: new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 5),
    leg: new THREE.CapsuleGeometry(0.05, 0.075, 3, 11),
    legCuff: new THREE.TorusGeometry(0.047, 0.011, 4, 14),
  };
  return GEO;
}

// ---------------------------------------------------------------- shared materials
const MATS = new Map();
function mat(key, make) {
  let m = MATS.get(key);
  if (!m) MATS.set(key, (m = make()));
  return m;
}
const fabric = (c) =>
  mat('fab' + c, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.62, clearcoat: 0.14, clearcoatRoughness: 0.55, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color('#ffffff') }));
const glossy = (c, rough = 0.28) => mat('gl' + c + rough, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.12 }));
const basic = (c, opacity = 1) =>
  mat('b' + c + opacity, () => new THREE.MeshBasicMaterial({ color: c, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));

function makeMats(L, color) {
  return {
    skin: mat('skin' + L.skin, () => new THREE.MeshPhysicalMaterial({ color: L.skin, roughness: 0.55, sheen: 0.3, sheenRoughness: 0.55, sheenColor: new THREE.Color(tint(L.skin, 0.4)), clearcoat: 0.06, clearcoatRoughness: 0.6, emissive: new THREE.Color(L.skin), emissiveIntensity: 0.12 })),
    skinDeep: mat('skinD' + L.skin, () => new THREE.MeshPhysicalMaterial({ color: shade(L.skin, 0.8), roughness: 0.6 })),
    hair: mat('hair' + L.hair, () => new THREE.MeshPhysicalMaterial({ color: L.hair, roughness: 0.5, clearcoat: 0.18, clearcoatRoughness: 0.5, sheen: 0.7, sheenRoughness: 0.4, sheenColor: new THREE.Color(tint(L.hair, 0.35)), side: THREE.DoubleSide })),
    brow: basic(shade(L.hair, 0.7)),
    shirt: fabric(color),
    shirtDeep: fabric(shade(color, 0.78)),
    trim: fabric('#f6f2ea'),
    pants: fabric(L.pants),
    pantsDeep: fabric(shade(L.pants, 0.8)),
    hat: fabric(L.hat || L.shoes),
    hatLight: fabric(tint(L.hat || L.shoes, 0.25)),
    pom: mat('pom', () => new THREE.MeshPhysicalMaterial({ color: '#fbf8f2', roughness: 1, sheen: 1, sheenRoughness: 0.9, sheenColor: new THREE.Color('#ffffff') })),
    shoe: glossy(L.shoes),
    sole: glossy('#fbfaf6', 0.4),
    lace: basic('#ffffff'),
    sclera: glossy('#ffffff', 0.15),
    iris: glossy(L.iris || '#3a2416', 0.2),
    pupil: basic('#0b0706'),
    glint: basic('#ffffff'),
    mouth: basic('#5e1b25'),
    tongue: basic('#ff7f90'),
    cheek: basic('#ff7f93', 0.42),
    frame: glossy('#2a2630', 0.3),
    lens: basic('#e8f4ff', 0.14),
  };
}

// ---------------------------------------------------------------- face
function Eye({ side, L, M, G }) {
  const f = surf(HEAD_R - 0.002, side * 0.36, -0.04);
  if (L.eyes === 'happy') {
    return (
      <group {...f}>
        <mesh geometry={G.arc} material={M.pupil} position={[0, -0.012, 0.004]} scale={[0.022, 0.026, 0.02]} />
      </group>
    );
  }
  const sleepy = L.eyes === 'sleepy';
  return (
    <group {...f}>
      <mesh geometry={G.s12} material={M.sclera} scale={[0.031, 0.04, 0.012]} />
      <mesh geometry={G.s10} material={M.iris} position={[-side * 0.002, sleepy ? -0.008 : -0.004, 0.006]} scale={[0.022, 0.028, 0.0095]} />
      <mesh geometry={G.s8} material={M.pupil} position={[-side * 0.002, sleepy ? -0.008 : -0.004, 0.0095]} scale={[0.012, 0.016, 0.007]} />
      <mesh geometry={G.s6} material={M.glint} position={[0.007, sleepy ? 0.001 : 0.008, 0.0155]} scale={0.0062} />
      <mesh geometry={G.s6} material={M.glint} position={[-0.007, -0.014, 0.014]} scale={0.0032} />
      {sleepy && (
        <>
          <mesh geometry={G.hemi} material={M.skin} rotation={[0.32, 0, 0]} scale={[0.035, 0.044, 0.0155]} />
          <mesh geometry={G.box} material={M.pupil} position={[0, -0.005, 0.0155]} scale={[0.064, 0.0045, 0.003]} />
        </>
      )}
    </group>
  );
}

function Face({ L, M, G }) {
  const R = HEAD_R;
  const ear = (side) => (
    <group {...surf(R - 0.006, side * (PI / 2 - 0.04), -0.06, 0)} key={'ear' + side}>
      <mesh geometry={G.s12} material={M.skin} scale={[0.034, 0.046, 0.022]} castShadow />
      <mesh geometry={G.s8} material={M.skinDeep} position={[0, -0.002, 0.014]} scale={[0.017, 0.026, 0.009]} />
    </group>
  );
  const brow = (side) => (
    <group {...surf(R, side * 0.37, 0.2, -side * 0.12)} key={'brow' + side}>
      <mesh geometry={G.brow} material={M.brow} position={[0, -0.016, 0.002]} scale={[0.027, 0.02, 0.012]} />
    </group>
  );
  const cheek = (side) => (
    <group {...surf(R + 0.0015, side * 0.62, -0.25)} key={'ch' + side}>
      <mesh geometry={G.disc} material={M.cheek} scale={[0.031, 0.021, 1]} />
    </group>
  );
  const sleepy = L.eyes === 'sleepy';
  return (
    <>
      <Eye side={1} L={L} M={M} G={G} />
      <Eye side={-1} L={L} M={M} G={G} />
      {brow(1)}
      {brow(-1)}
      {cheek(1)}
      {cheek(-1)}
      {ear(1)}
      {ear(-1)}
      {/* nose */}
      <group {...surf(R - 0.004, 0, -0.17)}>
        <mesh geometry={G.s10} material={M.skin} scale={[0.022, 0.017, 0.017]} />
      </group>
      {/* mouth */}
      <group {...surf(R + 0.004, 0, -0.36)}>
        {sleepy ? (
          <mesh geometry={G.smile} material={M.mouth} position={[0, 0.02, 0]} scale={[0.024, 0.022, 0.012]} />
        ) : (
          <>
            <mesh geometry={G.halfDisc} material={M.mouth} position={[0, 0.006, 0]} scale={[0.032, 0.026, 1]} />
            <mesh geometry={G.disc} material={M.tongue} position={[0, -0.009, 0.0006]} scale={[0.016, 0.0085, 1]} />
          </>
        )}
      </group>
      {L.glasses && <Glasses M={M} G={G} />}
    </>
  );
}

function Glasses({ M, G }) {
  const lens = (side) => {
    const f = surf(HEAD_R + 0.026, side * 0.36, -0.04);
    return (
      <group {...f} key={'g' + side}>
        <mesh geometry={G.ring} material={M.frame} scale={[0.044, 0.04, 0.044]} />
        <mesh geometry={G.disc} material={M.lens} scale={[0.042, 0.038, 1]} />
      </group>
    );
  };
  // temple arms from the outer rim back to the ears
  const arm = (side) => {
    const a = [side * 0.118, -0.006, 0.19];
    const b = [side * 0.214, 0.0, 0.0];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    return (
      <mesh
        key={'t' + side}
        geometry={G.box}
        material={M.frame}
        position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]}
        rotation={[0, Math.atan2(dx, dz), 0]}
        scale={[0.007, 0.007, len]}
      />
    );
  };
  return (
    <>
      {lens(1)}
      {lens(-1)}
      <group {...surf(HEAD_R + 0.022, 0, -0.025)}>
        <mesh geometry={G.box} material={M.frame} position={[0, 0.004, 0]} scale={[0.07, 0.007, 0.007]} />
      </group>
      {arm(1)}
      {arm(-1)}
    </>
  );
}

// ---------------------------------------------------------------- hair & hats
const SPIKES = [
  // az, el, length, radius, lean (toward the back of the head)
  [-0.45, 0.52, 0.075, 0.05, 1.05],
  [0.0, 0.58, 0.085, 0.055, 1.15],
  [0.45, 0.52, 0.075, 0.05, 1.05],
  [-1.05, 0.6, 0.075, 0.05, 0.75],
  [1.05, 0.6, 0.075, 0.05, 0.75],
  [-0.45, 1.0, 0.09, 0.06, 0.8],
  [0.45, 1.0, 0.09, 0.06, 0.8],
  [-1.85, 0.72, 0.085, 0.058, 0.55],
  [1.85, 0.72, 0.085, 0.058, 0.55],
  [PI, 0.8, 0.09, 0.06, 0.5],
  [-2.55, 0.42, 0.075, 0.052, 0.35],
  [2.55, 0.42, 0.075, 0.052, 0.35],
  [0, 1.35, 0.095, 0.062, 0.7],
];

const BANGS = [
  // az, el, sx, sy, roll
  [-0.62, 0.5, 0.065, 0.045, 0.7],
  [-0.28, 0.54, 0.07, 0.045, 0.5],
  [0.08, 0.55, 0.075, 0.045, 0.35],
  [0.44, 0.52, 0.07, 0.044, 0.25],
];

const BEANIE_BANGS = [
  [-0.32, 0.33, 0.055, 0.03, 0.4],
  [0.02, 0.34, 0.06, 0.03, 0.2],
  [0.36, 0.33, 0.055, 0.03, 0.0],
];

const BOB_BANGS = [
  [-0.66, 0.5, 0.07, 0.05, 0.25],
  [-0.33, 0.52, 0.075, 0.052, 0.1],
  [0.0, 0.53, 0.078, 0.052, 0.0],
  [0.33, 0.52, 0.075, 0.052, -0.1],
  [0.66, 0.5, 0.07, 0.05, -0.25],
];

function Tufts({ list, r, M, G }) {
  return list.map(([az, el, sx, sy, roll], i) => (
    <group key={i} {...surf(r, az, el, roll)}>
      <mesh geometry={G.s10} material={M.hair} scale={[sx, sy, 0.03]} castShadow />
    </group>
  ));
}

function BaseHair({ M, G, bangs = true }) {
  return (
    <>
      <group rotation={[-0.45, 0, 0]}>
        <mesh geometry={G.hairCap} material={M.hair} castShadow />
      </group>
      <mesh geometry={G.hairNape} material={M.hair} castShadow />
      {/* sideburns */}
      <group {...surf(0.213, 1.24, 0.07)}>
        <mesh geometry={G.s10} material={M.hair} scale={[0.019, 0.038, 0.011]} />
      </group>
      <group {...surf(0.213, -1.24, 0.07)}>
        <mesh geometry={G.s10} material={M.hair} scale={[0.019, 0.038, 0.011]} />
      </group>
      {bangs && <Tufts list={BANGS} r={0.214} M={M} G={G} />}
    </>
  );
}

function Hair({ L, M, G }) {
  switch (L.hairStyle) {
    case 'spiky':
      return (
        <>
          <BaseHair M={M} G={G} bangs={false} />
          {SPIKES.map(([az, el, len, rad, lean], i) => (
            <group key={i} {...surf(0.2, az, el)}>
              <mesh geometry={G.cone} material={M.hair} rotation={[PI / 2 - lean, 0, 0]} scale={[rad, len + 0.03, rad * 0.8]} castShadow />
            </group>
          ))}
        </>
      );
    case 'bob':
      return (
        <>
          <mesh geometry={G.bobTop} material={M.hair} castShadow />
          <Tufts list={BOB_BANGS} r={0.222} M={M} G={G} />
          <group scale={[1.05, 1, 1.03]}>
            <mesh geometry={G.bobSides} material={M.hair} castShadow />
            <mesh geometry={G.bobRim} material={M.hair} />
          </group>
          {/* little crown swirl */}
          <group {...surf(0.23, -0.3, 1.25, 0.6)}>
            <mesh geometry={G.s10} material={M.hair} scale={[0.05, 0.03, 0.02]} />
          </group>
        </>
      );
    case 'pigtails':
      return (
        <>
          <BaseHair M={M} G={G} />
          {[1, -1].map((s) => (
            <group key={s} position={[s * 0.205, 0.02, -0.07]} rotation={[0.25, 0, s * 0.5]}>
              <mesh geometry={G.s12} material={M.hair} position={[s * 0.03, -0.075, 0]} scale={[0.055, 0.085, 0.055]} castShadow />
              <mesh geometry={G.ring} material={M.hat} rotation={[0, 0, PI / 2]} position={[s * 0.012, -0.012, 0]} scale={[0.028, 0.028, 0.06]} />
            </group>
          ))}
        </>
      );
    case 'cap':
      return (
        <>
          <BaseHair M={M} G={G} bangs={false} />
          <group rotation={[-0.4, 0, 0]}>
            <mesh geometry={G.capDome} material={M.hat} castShadow />
            <mesh geometry={G.s8} material={M.hat} position={[0, 0.229, 0]} scale={[0.018, 0.012, 0.018]} />
          </group>
          <mesh geometry={G.brim} material={M.hat} position={[0, 0.08, 0.17]} rotation={[0.24, 0, 0]} scale={[1.05, 1, 0.95]} castShadow />
          <group {...surf(0.2295, 0, 0.66)}>
            <mesh geometry={G.disc} material={M.trim} scale={0.038} />
            <mesh geometry={G.disc} material={M.hatLight} position={[0, 0, 0.0008]} scale={0.022} />
          </group>
        </>
      );
    case 'beanie':
      return (
        <>
          <Tufts list={BEANIE_BANGS} r={0.209} M={M} G={G} />
          <mesh geometry={G.hairNape} material={M.hair} castShadow />
          <group rotation={[-0.42, 0, 0]}>
            <mesh geometry={G.beanieDome} material={M.hat} scale={[1, 1.07, 1]} castShadow />
            <mesh geometry={G.cuff} material={M.hatLight} position={[0, -0.006, 0]} castShadow />
            <mesh geometry={G.s12} material={M.pom} position={[0, 0.232 * 1.07 + 0.035, 0]} scale={0.058} castShadow />
          </group>
        </>
      );
    default:
      return <BaseHair M={M} G={G} />;
  }
}

// ---------------------------------------------------------------- body parts
function Arm({ side, L, M, G, setRef, held }) {
  const long = L.shirt !== 'tee';
  const name = side > 0 ? 'lArm' : 'rArm';
  return (
    <group ref={setRef(name)} position={[side * 0.14, 0.22, 0]} rotation={[0, 0, side * 0.3]}>
      <mesh geometry={G.s12} material={M.shirt} scale={0.046} castShadow />
      {long ? (
        <>
          <mesh geometry={G.sleeveLong} material={M.shirt} position={[0, -0.072, 0]} castShadow />
          <mesh geometry={G.cuffRing} material={L.shirt === 'stripe' ? M.trim : M.shirtDeep} position={[0, -0.14, 0]} rotation={[PI / 2, 0, 0]} />
        </>
      ) : (
        <>
          <mesh geometry={G.sleeveShort} material={M.shirt} position={[0, -0.04, 0]} castShadow />
          <mesh geometry={G.teeHem} material={M.trim} position={[0, -0.085, 0]} rotation={[PI / 2, 0, 0]} />
          <mesh geometry={G.forearm} material={M.skin} position={[0, -0.12, 0]} castShadow />
        </>
      )}
      {/* mitten hand + thumb bump */}
      <mesh geometry={G.s12} material={M.skin} position={[0, -0.19, 0]} scale={[0.04, 0.05, 0.047]} castShadow />
      <mesh geometry={G.s8} material={M.skin} position={[-side * 0.016, -0.172, 0.03]} scale={[0.017, 0.022, 0.017]} />
      {held && <group position={[0, -0.22, 0]}>{held}</group>}
    </group>
  );
}

function Leg({ side, M, G, setRef }) {
  const name = side > 0 ? 'rLeg' : 'lLeg';
  return (
    <group ref={setRef(name)} position={[side * 0.07, 0.24, 0]}>
      <mesh geometry={G.leg} material={M.pants} position={[0, -0.075, 0]} castShadow />
      <mesh geometry={G.legCuff} material={M.pantsDeep} position={[0, -0.148, 0]} rotation={[PI / 2, 0, 0]} />
      {/* chunky sneaker */}
      <mesh geometry={G.s16} material={M.sole} position={[0, -0.221, 0.022]} scale={[0.062, 0.021, 0.094]} castShadow />
      <mesh geometry={G.s16} material={M.shoe} position={[0, -0.198, 0.016]} scale={[0.055, 0.044, 0.08]} castShadow />
      <mesh geometry={G.s10} material={M.sole} position={[0, -0.208, 0.07]} scale={[0.04, 0.024, 0.03]} />
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={G.s6} material={M.lace} position={[0, -0.158 - i * 0.008, 0.02 + i * 0.016]} scale={[0.009, 0.005, 0.006]} />
      ))}
    </group>
  );
}

function Torso({ L, M, G }) {
  return (
    <>
      <mesh geometry={G.shirt} material={M.shirt} castShadow />
      <mesh geometry={G.pants} material={M.pants} castShadow />
      <mesh geometry={G.neck} material={M.skin} position={[0, 0.29, 0]} />
      {L.shirt === 'tee' && (
        <>
          <mesh geometry={G.collar} material={M.trim} position={[0, 0.266, 0.004]} rotation={[PI / 2 + 0.12, 0, 0]} />
          <mesh geometry={G.hem} material={M.shirtDeep} />
          {/* chest star badge */}
          <group position={[0.045, 0.14, 0.106]} rotation={[-0.08, 0.35, 0]}>
            <mesh geometry={G.disc} material={M.trim} scale={0.024} />
            <mesh geometry={G.disc} material={M.shirtDeep} position={[0, 0, 0.0008]} scale={0.012} />
          </group>
        </>
      )}
      {L.shirt === 'stripe' && (
        <>
          {G.stripes.map((g, i) => (
            <mesh key={i} geometry={g} material={M.trim} />
          ))}
          <mesh geometry={G.collar} material={M.shirtDeep} position={[0, 0.266, 0.004]} rotation={[PI / 2 + 0.12, 0, 0]} />
        </>
      )}
      {L.shirt === 'hoodie' && (
        <>
          <mesh geometry={G.hood} material={M.shirt} position={[0, 0.262, -0.012]} rotation={[0.18, 0, 0]} scale={[1.08, 1, 1.05]} castShadow />
          <mesh geometry={G.s12} material={M.shirt} position={[0, 0.2, -0.085]} scale={[0.085, 0.065, 0.04]} rotation={[0.3, 0, 0]} />
          <mesh geometry={G.pocket} material={M.shirtDeep} position={[0, 0.045, 0.111]} rotation={[0.05, 0, PI / 2]} scale={[1, 1, 0.45]} />
          <mesh geometry={G.hem} material={M.shirtDeep} />
          {[1, -1].map((s) => (
            <group key={s}>
              <mesh geometry={G.string} material={M.trim} position={[s * 0.024, 0.205, 0.093]} rotation={[0.42, 0, s * 0.06]} />
              <mesh geometry={G.s6} material={M.trim} position={[s * 0.026, 0.168, 0.11]} scale={0.0075} />
            </group>
          ))}
        </>
      )}
    </>
  );
}

const noopRef = () => undefined;

/**
 * Procedural toy character ("Buddy").
 * @param color   main clothing color (player color)
 * @param slot    used to derive a deterministic look when `look` is missing
 * @param setRef  (name) => (el) => void  ref callback factory for the animated groups
 * @param held    optional prop element rendered in the right hand
 * @param look    optional look override (merged over lookForSlot(slot))
 */
export function ToyBody({ color = '#19b8ff', slot = 0, setRef = noopRef, held, look }) {
  const L = useMemo(() => ({ ...lookForSlot(slot), ...(look || {}) }), [slot, look]);
  const G = geo();
  const M = useMemo(() => makeMats(L, color), [L, color]);
  return (
    <group>
      <Leg side={-1} M={M} G={G} setRef={setRef} />
      <Leg side={1} M={M} G={G} setRef={setRef} />
      <group ref={setRef('body')} position={[0, 0.3, 0]}>
        <Torso L={L} M={M} G={G} />
        <Arm side={1} L={L} M={M} G={G} setRef={setRef} />
        <Arm side={-1} L={L} M={M} G={G} setRef={setRef} held={held} />
        <group ref={setRef('head')} position={[0, 0.27, 0]}>
          <group position={[0, 0.2, 0]} scale={[1.04, 0.98, 0.98]}>
            <mesh geometry={G.skull} material={M.skin} castShadow />
            <Face L={L} M={M} G={G} />
            <Hair L={L} M={M} G={G} />
          </group>
        </group>
      </group>
    </group>
  );
}

export default ToyBody;
