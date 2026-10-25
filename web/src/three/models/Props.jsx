// Instanced, procedural trackside props. Each takes `items: [{ position:[x,y,z], rotation?:radians(Y), scale? }]`
// (Grandstand takes a single position/rotation/length). Geometry + materials are module singletons.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Kart } from './Kart.jsx';

const RED = '#ff2d2d';
const YELLOW = '#ffd23a';
const LIME = '#9dff3a';
const PURPLE = '#b04bff';
const DARK = '#1e1518';
const BRIGHTS = [RED, YELLOW, LIME, PURPLE, '#19b8ff', '#ff7a1a', '#ff4fb4', '#ffffff'];

// deterministic PRNG so props look the same every mount
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const glossy = (color, extra = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12, ...extra });

const _o = new THREE.Object3D();
const _c = new THREE.Color();

/** Generic instanced mesh from a flat list of {p, r:[x,y,z], s:[x,y,z]|number, c?}. */
function Instances({ geometry, material, list, castShadow = true, receiveShadow = false, meshRef }) {
  const local = useRef();
  const ref = meshRef || local;
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    list.forEach((it, i) => {
      _o.position.set(...it.p);
      if (it.r) _o.rotation.set(...it.r);
      else _o.rotation.set(0, 0, 0);
      const s = it.s ?? 1;
      if (typeof s === 'number') _o.scale.setScalar(s);
      else _o.scale.set(...s);
      _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix);
      if (it.c) m.setColorAt(i, _c.set(it.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list, ref]);
  if (!list.length) return null;
  return (
    <instancedMesh
      key={list.length}
      ref={ref}
      args={[geometry, material, list.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    />
  );
}

// place a local offset in an item's frame (position + yaw + uniform scale)
function place(item, local, out = []) {
  const s = item.scale ?? 1;
  const r = item.rotation ?? 0;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const [lx, ly, lz] = local;
  out[0] = item.position[0] + (lx * c + lz * sn) * s;
  out[1] = item.position[1] + ly * s;
  out[2] = item.position[2] + (-lx * sn + lz * c) * s;
  return out;
}

// ------------------------------------------------------------------ shared geometry / material
let G = null;
function geo() {
  if (G) return G;
  const blob = new THREE.IcosahedronGeometry(1, 2);
  const blobLo = new THREE.IcosahedronGeometry(1, 1);
  const trunk = new THREE.CylinderGeometry(0.09, 0.15, 1, 8, 1);
  trunk.translate(0, 0.5, 0);
  const rock = new THREE.IcosahedronGeometry(1, 1);
  {
    const pos = rock.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 3.1 + v.y * 1.7) * 0.5 + Math.sin(v.z * 2.3 - v.x * 1.3) * 0.5;
      v.multiplyScalar(1 + n * 0.16);
      v.y *= 0.72;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    rock.computeVertexNormals();
  }
  const flower = new THREE.IcosahedronGeometry(1, 0);
  const tire = new THREE.TorusGeometry(0.26, 0.12, 8, 18);
  tire.rotateX(Math.PI / 2);
  const capsule = new THREE.CapsuleGeometry(0.12, 0.2, 3, 8);
  const head = new THREE.SphereGeometry(0.1, 10, 8);
  const pole = new THREE.CylinderGeometry(0.035, 0.045, 1, 8);
  pole.translate(0, 0.5, 0);
  const finial = new THREE.SphereGeometry(0.07, 10, 8);
  const cloth = new THREE.PlaneGeometry(1.5, 0.85, 16, 6);
  cloth.translate(0.75, 0, 0);
  // balloon: lathe teardrop
  const bp = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const a = t * Math.PI;
    const r = Math.sin(a) * (0.85 + 0.15 * Math.cos(a)) * 0.24;
    bp.push(new THREE.Vector2(Math.max(r, 0.001), -Math.cos(a) * 0.3 + 0.3 - (t < 0.15 ? 0 : 0)));
  }
  const balloon = new THREE.LatheGeometry(bp, 18);
  const knot = new THREE.ConeGeometry(0.035, 0.05, 6);
  const string = new THREE.CylinderGeometry(0.004, 0.004, 1, 3);
  string.translate(0, -0.5, 0);
  G = { blob, blobLo, trunk, rock, flower, tire, capsule, head, pole, finial, cloth, balloon, knot, string };
  return G;
}

let M = null;
function mats() {
  if (M) return M;
  M = {
    foliage: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62 }),
    bark: new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.8 }),
    rock: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }),
    flower: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.12 }),
    tire: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    skin: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 }),
    pole: glossy('#f2eef6', { metalness: 0.2 }),
    yellow: glossy(YELLOW),
    string: new THREE.MeshBasicMaterial({ color: '#f5efe8' }),
  };
  return M;
}

// ------------------------------------------------------------------ Trees
const GREENS = ['#3fae4a', '#5cc94f', '#2f9443', '#7bd65a', '#48b860'];

export function Trees({ items = [] }) {
  const g = geo();
  const m = mats();
  const { trunks, blobs } = useMemo(() => {
    const trunks = [];
    const blobs = [];
    items.forEach((it, i) => {
      const r = rng(i + 11);
      const s = it.scale ?? 1;
      const lean = (r() - 0.5) * 0.12;
      trunks.push({ p: place(it, [0, 0, 0]), r: [lean, it.rotation ?? 0, lean * 0.5], s: [s, 1.05 * s, s] });
      const base = new THREE.Color(GREENS[Math.floor(r() * GREENS.length)]);
      const parts = [
        [0, 1.45, 0, 0.72],
        [0.42, 1.2, 0.15, 0.48],
        [-0.38, 1.25, -0.12, 0.5],
        [0.05, 1.78, -0.05, 0.46],
      ];
      parts.forEach(([x, y, z, rad], k) => {
        const jit = 0.85 + r() * 0.3;
        const c = base.clone().offsetHSL((r() - 0.5) * 0.03, 0, (k === 3 ? 0.06 : 0) + (r() - 0.5) * 0.06);
        blobs.push({
          p: place(it, [x, y, z]),
          r: [r() * 3, r() * 3, r() * 3],
          s: [rad * jit * s, rad * jit * 0.86 * s, rad * jit * s],
          c: '#' + c.getHexString(),
        });
      });
    });
    return { trunks, blobs };
  }, [items]);
  return (
    <group>
      <Instances geometry={g.trunk} material={m.bark} list={trunks} />
      <Instances geometry={g.blob} material={m.foliage} list={blobs} />
    </group>
  );
}

// ------------------------------------------------------------------ Bushes
const FLOWERS = ['#ff4fb4', YELLOW, '#ffffff', PURPLE, RED, '#ff9a3a'];

export function Bushes({ items = [] }) {
  const g = geo();
  const m = mats();
  const { blobs, flowers } = useMemo(() => {
    const blobs = [];
    const flowers = [];
    items.forEach((it, i) => {
      const r = rng(i + 101);
      const s = it.scale ?? 1;
      const base = new THREE.Color(GREENS[Math.floor(r() * GREENS.length)]).offsetHSL(0, 0, -0.03);
      const parts = [
        [0, 0.32, 0, 0.42],
        [0.34, 0.24, 0.05, 0.3],
        [-0.32, 0.25, -0.04, 0.32],
      ];
      parts.forEach(([x, y, z, rad]) => {
        blobs.push({
          p: place(it, [x, y, z]),
          r: [r() * 3, r() * 3, r() * 3],
          s: [rad * s, rad * 0.85 * s, rad * s],
          c: '#' + base.clone().offsetHSL(0, 0, (r() - 0.5) * 0.08).getHexString(),
        });
      });
      const fc = FLOWERS[Math.floor(r() * FLOWERS.length)];
      for (let k = 0; k < 9; k++) {
        const part = parts[k % 3];
        // random point on upper hemisphere of a blob
        const th = r() * Math.PI * 2;
        const ph = r() * 1.1;
        const rad = part[3] * 0.98;
        const lx = part[0] + Math.cos(th) * Math.sin(ph) * rad;
        const ly = part[1] + Math.cos(ph) * rad * 0.85;
        const lz = part[2] + Math.sin(th) * Math.sin(ph) * rad;
        flowers.push({ p: place(it, [lx, ly, lz]), r: [r() * 3, r() * 3, 0], s: 0.045 * s, c: r() < 0.75 ? fc : '#ffffff' });
      }
    });
    return { blobs, flowers };
  }, [items]);
  return (
    <group>
      <Instances geometry={g.blob} material={m.foliage} list={blobs} />
      <Instances geometry={g.flower} material={m.flower} list={flowers} castShadow={false} />
    </group>
  );
}

// ------------------------------------------------------------------ Rocks
const STONES = ['#9a8ea6', '#8a7f95', '#b0a3b8', '#7d728a'];

export function Rocks({ items = [] }) {
  const g = geo();
  const m = mats();
  const list = useMemo(
    () =>
      items.map((it, i) => {
        const r = rng(i + 301);
        const s = (it.scale ?? 1) * 0.45;
        return {
          p: [it.position[0], it.position[1] + s * 0.25, it.position[2]],
          r: [(r() - 0.5) * 0.4, (it.rotation ?? 0) + r() * 6, (r() - 0.5) * 0.4],
          s: [s * (0.8 + r() * 0.5), s * (0.7 + r() * 0.4), s * (0.8 + r() * 0.5)],
          c: STONES[Math.floor(r() * STONES.length)],
        };
      }),
    [items],
  );
  return <Instances geometry={g.rock} material={m.rock} list={list} receiveShadow />;
}

// ------------------------------------------------------------------ Tires (stacked barriers)
export function Tires({ items = [], height = 3 }) {
  const g = geo();
  const m = mats();
  const list = useMemo(() => {
    const out = [];
    items.forEach((it, i) => {
      const s = it.scale ?? 1;
      const h = it.height ?? height;
      for (let k = 0; k < h; k++) {
        out.push({
          p: place(it, [0, 0.12 + k * 0.235, 0]),
          r: [0, (it.rotation ?? 0) + k * 0.4, 0],
          s,
          c: (i + k) % 2 === 0 ? RED : '#f7f3f0',
        });
      }
    });
    return out;
  }, [items, height]);
  return <Instances geometry={g.tire} material={m.tire} list={list} receiveShadow />;
}

// ------------------------------------------------------------------ Balloons (bobbing)
export function Balloons({ items = [] }) {
  const g = geo();
  const m = mats();
  const balloonRef = useRef();
  const knotRef = useRef();
  const stringRef = useRef();
  const data = useMemo(
    () =>
      items.map((it, i) => {
        const r = rng(i + 501);
        return {
          base: it.position,
          s: it.scale ?? 1,
          ph: r() * 10,
          sp: 0.8 + r() * 0.6,
          len: 1.1 + r() * 0.5,
          c: BRIGHTS[Math.floor(r() * 7)],
        };
      }),
    [items],
  );
  const initial = useMemo(
    () => ({
      b: data.map((d) => ({ p: [d.base[0], d.base[1] + d.len * d.s, d.base[2]], s: d.s, c: d.c })),
      k: data.map((d) => ({ p: [d.base[0], d.base[1] + d.len * d.s, d.base[2]], s: d.s, c: d.c })),
      st: data.map((d) => ({ p: [d.base[0], d.base[1] + d.len * d.s, d.base[2]], s: [d.s, d.len * d.s, d.s] })),
    }),
    [data],
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const bm = balloonRef.current;
    const km = knotRef.current;
    const sm = stringRef.current;
    if (!bm || !km || !sm) return;
    data.forEach((d, i) => {
      const sway = Math.sin(t * d.sp + d.ph) * 0.12;
      const sway2 = Math.cos(t * d.sp * 0.8 + d.ph) * 0.1;
      const bob = Math.sin(t * d.sp * 1.3 + d.ph) * 0.06;
      const L = d.len * d.s;
      const x = d.base[0] + sway * L * 0.5;
      const z = d.base[2] + sway2 * L * 0.5;
      const y = d.base[1] + L + bob;
      // string from anchor to balloon knot
      _o.position.set(x, y, z);
      _o.rotation.set(sway2 * 0.5, 0, -sway * 0.5);
      _o.scale.set(d.s, L, d.s);
      _o.updateMatrix();
      sm.setMatrixAt(i, _o.matrix);
      _o.scale.setScalar(d.s);
      _o.rotation.set(sway2 * 0.6, t * 0.2 + d.ph, -sway * 0.6);
      _o.updateMatrix();
      bm.setMatrixAt(i, _o.matrix);
      km.setMatrixAt(i, _o.matrix);
    });
    bm.instanceMatrix.needsUpdate = true;
    km.instanceMatrix.needsUpdate = true;
    sm.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <Instances meshRef={balloonRef} geometry={g.balloon} material={m.gloss} list={initial.b} />
      <Instances meshRef={knotRef} geometry={g.knot} material={m.gloss} list={initial.k} castShadow={false} />
      <Instances meshRef={stringRef} geometry={g.string} material={m.string} list={initial.st} castShadow={false} />
    </group>
  );
}

// ------------------------------------------------------------------ Banners (waving cloth, atlas texture)
const BANNER_VARIANTS = [
  { bg: RED, fg: YELLOW, text: 'MYCADE' },
  { bg: YELLOW, fg: DARK, pattern: 'check' },
  { bg: PURPLE, fg: LIME, text: 'MYCADE' },
  { bg: LIME, fg: DARK, pattern: 'stripes' },
  { bg: DARK, fg: YELLOW, text: 'MYCADE' },
];

let bannerTex = null;
function getBannerTex() {
  if (bannerTex) return bannerTex;
  const W = 512;
  const H = 288;
  const n = BANNER_VARIANTS.length;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * n;
  const g = c.getContext('2d');
  BANNER_VARIANTS.forEach((v, i) => {
    // row 0 of the atlas = top of canvas = highest v; store variant i at canvas row (n-1-i)
    const y0 = (n - 1 - i) * H;
    g.fillStyle = v.bg;
    g.fillRect(0, y0, W, H);
    g.fillStyle = v.fg;
    if (v.pattern === 'check') {
      const sq = 36;
      for (let yy = 0; yy < H / sq; yy++)
        for (let xx = 0; xx < W / sq; xx++) if ((xx + yy) % 2 === 0) g.fillRect(xx * sq, y0 + yy * sq, sq, sq);
    } else if (v.pattern === 'stripes') {
      g.save();
      g.beginPath();
      g.rect(0, y0, W, H);
      g.clip();
      for (let k = -H; k < W; k += 64) {
        g.beginPath();
        g.moveTo(k, y0 + H);
        g.lineTo(k + 32, y0 + H);
        g.lineTo(k + 32 + H, y0);
        g.lineTo(k + H, y0);
        g.fill();
      }
      g.restore();
    }
    if (v.text) {
      g.fillStyle = v.fg;
      g.fillRect(0, y0 + 14, W, 10);
      g.fillRect(0, y0 + H - 24, W, 10);
      g.font = 'italic 900 112px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 14;
      g.strokeStyle = DARK === v.bg ? RED : DARK;
      g.strokeText(v.text, W / 2, y0 + H / 2 + 6);
      g.fillText(v.text, W / 2, y0 + H / 2 + 6);
    }
  });
  bannerTex = new THREE.CanvasTexture(c);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  bannerTex.anisotropy = 8;
  return bannerTex;
}

const bannerTime = { value: 0 };
let bannerMat = null;
function getBannerMat() {
  if (bannerMat) return bannerMat;
  const n = BANNER_VARIANTS.length.toFixed(1);
  bannerMat = new THREE.MeshStandardMaterial({ map: getBannerTex(), roughness: 0.75, side: THREE.DoubleSide });
  bannerMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = bannerTime;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         attribute float aVariant;
         float wavePhase(){ return instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.53; }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float wph = wavePhase();
         float wx = position.x;
         float wk = 5.0;
         float wa = 0.11 * (wx / 1.5);
         float warg = wx * wk - uTime * 6.0 + wph;
         float dzdx = 0.11 / 1.5 * sin(warg) + wa * wk * cos(warg);
         vec3 objectNormal = normalize(vec3(-dzdx, 0.0, 1.0));
         #ifdef USE_TANGENT
           vec3 objectTangent = vec3(1.0, 0.0, 0.0);
         #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
         transformed.z += wa * sin(warg);
         transformed.y -= 0.05 * (wx / 1.5) * (wx / 1.5) * (0.6 + 0.4 * sin(uTime * 2.0 + wph));`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         #ifdef USE_MAP
           vMapUv.y = (vMapUv.y + aVariant) / ${n};
         #endif`,
      );
  };
  bannerMat.customProgramCacheKey = () => 'mycade-banner-v1';
  return bannerMat;
}

export function Banners({ items = [] }) {
  const g = geo();
  const m = mats();
  const clothRef = useRef();
  const { poles, finials, cloths, variants } = useMemo(() => {
    const poles = [];
    const finials = [];
    const cloths = [];
    const variants = new Float32Array(Math.max(1, items.length));
    items.forEach((it, i) => {
      const s = it.scale ?? 1;
      const H = 3.2;
      const yaw = it.rotation ?? 0;
      poles.push({ p: place(it, [0, 0, 0]), s: [s, H * s, s] });
      finials.push({ p: place(it, [0, H + 0.04, 0]), s, c: YELLOW });
      cloths.push({ p: place(it, [0.03, H - 0.5, 0]), r: [0, yaw, 0], s });
      variants[i] = it.variant ?? i % BANNER_VARIANTS.length;
    });
    return { poles, finials, cloths, variants };
  }, [items]);
  const clothGeo = useMemo(() => {
    const geom = g.cloth.clone();
    geom.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variants, 1));
    return geom;
  }, [g, variants]);
  useFrame((state) => {
    bannerTime.value = state.clock.elapsedTime;
  });
  return (
    <group>
      <Instances geometry={g.pole} material={m.pole} list={poles} />
      <Instances geometry={g.finial} material={m.yellow} list={finials} castShadow={false} />
      <Instances meshRef={clothRef} geometry={clothGeo} material={getBannerMat()} list={cloths} />
    </group>
  );
}

// ------------------------------------------------------------------ Grandstand with cheering crowd
const SKINS = ['#f5c9a5', '#e0ac85', '#c68c5f', '#8d5a3b', '#ffd9bd', '#a8714a'];
let canopyTex = null;
function getCanopyTex() {
  if (canopyTex) return canopyTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#fff4ea' : RED;
    g.fillRect(i * 32, 0, 32, 32);
  }
  canopyTex = new THREE.CanvasTexture(c);
  canopyTex.colorSpace = THREE.SRGBColorSpace;
  canopyTex.wrapS = THREE.RepeatWrapping;
  return canopyTex;
}

export function Grandstand({ position = [0, 0, 0], rotation = 0, length = 12, rows = 5 }) {
  const g = geo();
  const m = mats();
  const bodyRef = useRef();
  const headRef = useRef();
  const ROW_D = 0.75;
  const ROW_H = 0.42;

  const parts = useMemo(() => {
    const L = length;
    const depth = rows * ROW_D;
    const steps = Array.from({ length: rows }, (_, i) => {
      const h = ROW_H * (i + 1);
      const geom = new RoundedBoxGeometry(L, h, ROW_D + 0.02, 1, 0.04);
      return { geom, pos: [0, h / 2, -i * ROW_D - ROW_D / 2], color: i % 2 ? '#4a3a6a' : '#5b4880' };
    });
    const backH = ROW_H * rows + 1.75;
    const back = new RoundedBoxGeometry(L + 0.3, backH, 0.18, 1, 0.06);
    const side = new RoundedBoxGeometry(0.18, ROW_H * rows + 0.3, depth + 0.1, 1, 0.06);
    const roofGeom = new RoundedBoxGeometry(L + 0.8, 0.12, depth + 1.0, 1, 0.05);
    const valance = new THREE.PlaneGeometry(L + 0.8, 0.32, 1, 1);
    const tex = getCanopyTex().clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.round((L + 0.8) / 1.2), 1);
    const valanceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
    const postGeom = new THREE.CylinderGeometry(0.07, 0.07, 1, 8);
    const nPosts = Math.max(2, Math.round(L / 4) + 1);
    const posts = Array.from({ length: nPosts }, (_, i) => -L / 2 + (i / (nPosts - 1)) * L);
    const railGeom = new THREE.CylinderGeometry(0.03, 0.03, L, 8);
    railGeom.rotateZ(Math.PI / 2);
    return {
      steps,
      back,
      backH,
      side,
      roofGeom,
      valance,
      valanceMat,
      postGeom,
      posts,
      railGeom,
      depth,
      stepMats: [glossy('#5b4880', { clearcoat: 0.4 }), glossy('#4a3a6a', { clearcoat: 0.4 })],
      wallMat: glossy('#ffffff', { clearcoat: 0.5, roughness: 0.5 }),
      roofMat: glossy(RED),
    };
  }, [length, rows]);

  // crowd
  const crowd = useMemo(() => {
    const r = rng(Math.round(length * 7 + rows));
    const people = [];
    const perRow = Math.max(1, Math.round((length - 0.6) / 0.48));
    for (let row = 0; row < rows; row++) {
      for (let k = 0; k < perRow; k++) {
        if (r() < 0.06) continue; // a few empty seats
        const x = -length / 2 + 0.3 + (k + 0.5) * ((length - 0.6) / perRow) + (r() - 0.5) * 0.12;
        const y = ROW_H * (row + 1);
        const z = -row * ROW_D - ROW_D * 0.55 + (r() - 0.5) * 0.1;
        people.push({
          x,
          y,
          z,
          ph: r() * Math.PI * 2,
          sp: 4 + r() * 4,
          amp: r() < 0.35 ? 0.16 : 0.05,
          yaw: (r() - 0.5) * 0.6,
          sc: 0.85 + r() * 0.3,
          shirt: BRIGHTS[Math.floor(r() * BRIGHTS.length)],
          skin: SKINS[Math.floor(r() * SKINS.length)],
        });
      }
    }
    return people;
  }, [length, rows]);

  const initBodies = useMemo(
    () => crowd.map((p) => ({ p: [p.x, p.y + 0.22 * p.sc, p.z], r: [0, p.yaw, 0], s: p.sc, c: p.shirt })),
    [crowd],
  );
  const initHeads = useMemo(
    () => crowd.map((p) => ({ p: [p.x, p.y + 0.5 * p.sc, p.z], s: p.sc, c: p.skin })),
    [crowd],
  );

  const frame = useRef(0);
  useFrame((state) => {
    const bm = bodyRef.current;
    const hm = headRef.current;
    if (!bm || !hm) return;
    const t = state.clock.elapsedTime;
    const f = frame.current++ & 3;
    for (let i = f; i < crowd.length; i += 4) {
      const p = crowd[i];
      const hop = Math.abs(Math.sin(t * p.sp * 0.5 + p.ph)) * p.amp;
      _o.rotation.set(0, p.yaw, Math.sin(t * 2 + p.ph) * 0.08);
      _o.scale.setScalar(p.sc);
      _o.position.set(p.x, p.y + 0.22 * p.sc + hop, p.z);
      _o.updateMatrix();
      bm.setMatrixAt(i, _o.matrix);
      _o.position.set(p.x + Math.sin(t * 2 + p.ph) * -0.02, p.y + 0.5 * p.sc + hop, p.z);
      _o.updateMatrix();
      hm.setMatrixAt(i, _o.matrix);
    }
    bm.instanceMatrix.needsUpdate = true;
    hm.instanceMatrix.needsUpdate = true;
  });

  const P = parts;
  const roofY = ROW_H * rows + 2.0;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {P.steps.map((s, i) => (
        <mesh key={i} geometry={s.geom} material={P.stepMats[i % 2]} position={s.pos} castShadow receiveShadow />
      ))}
      <mesh geometry={P.back} material={P.wallMat} position={[0, P.backH / 2, -P.depth - 0.05]} castShadow receiveShadow />
      <mesh geometry={P.side} material={P.wallMat} position={[length / 2 + 0.09, (ROW_H * rows + 0.3) / 2, -P.depth / 2]} castShadow />
      <mesh geometry={P.side} material={P.wallMat} position={[-length / 2 - 0.09, (ROW_H * rows + 0.3) / 2, -P.depth / 2]} castShadow />
      {/* front rail */}
      <mesh geometry={P.railGeom} material={mats().yellow} position={[0, ROW_H + 0.45, 0.02]} />
      {P.posts.map((x) => (
        <mesh key={'r' + x} geometry={P.postGeom} material={mats().yellow} position={[x, ROW_H + 0.22, 0.02]} scale={[0.5, 0.45, 0.5]} />
      ))}
      {/* canopy roof on posts */}
      <group position={[0, roofY, -P.depth / 2 + 0.3]} rotation={[-0.12, 0, 0]}>
        <mesh geometry={P.roofGeom} material={P.roofMat} castShadow receiveShadow />
        <mesh geometry={P.valance} material={P.valanceMat} position={[0, -0.2, (P.depth + 1.0) / 2 + 0.005]} />
      </group>
      {P.posts.map((x) => (
        <mesh key={'p' + x} geometry={P.postGeom} material={m.pole} position={[x, (roofY + 0.2) / 2, 0.35]} scale={[1, roofY + 0.2, 1]} castShadow />
      ))}
      <Instances meshRef={bodyRef} geometry={g.capsule} material={m.gloss} list={initBodies} />
      <Instances meshRef={headRef} geometry={g.head} material={m.skin} list={initHeads} />
    </group>
  );
}

// ------------------------------------------------------------------ Showcase (visual check)
export function PropsShowcase() {
  const trees = useMemo(
    () =>
      [
        [-9, -6], [-7, -9], [-11, -2], [9, -7], [11, -3], [8, -10], [-4, -11], [4, -12], [13, 2], [-13, 3],
      ].map(([x, z], i) => ({ position: [x, 0, z], rotation: i, scale: 0.85 + (i % 3) * 0.2 })),
    [],
  );
  const bushes = useMemo(
    () => [[-6, -4], [-5, -5.2], [6, -4.5], [7.2, -5], [-8, 1], [8, 1.5]].map(([x, z], i) => ({ position: [x, 0, z], rotation: i * 1.3, scale: 0.9 + (i % 2) * 0.3 })),
    [],
  );
  const rocks = useMemo(
    () => [[-3, -6], [-2.3, -6.4], [3.5, -7], [10, 4], [-10, 5], [5, 5.5]].map(([x, z], i) => ({ position: [x, 0, z], rotation: i, scale: 0.7 + (i % 3) * 0.4 })),
    [],
  );
  const tires = useMemo(() => [-4, -3.4, -2.8, 2.8, 3.4, 4].map((x, i) => ({ position: [x, 0, 3.6], rotation: i * 0.7 })), []);
  const banners = useMemo(() => [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].map((x, i) => ({ position: [x, 0, -2.8], rotation: 0, variant: i % 5 })), []);
  const balloons = useMemo(
    () => Array.from({ length: 9 }, (_, i) => ({ position: [-6 + (i % 3) * 0.35, 1.8, 3.2 + Math.floor(i / 3) * 0.3], scale: 1 })),
    [],
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[40, 48]} />
        <meshStandardMaterial color="#6fbf4a" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0.6]} receiveShadow>
        <planeGeometry args={[30, 4.4]} />
        <meshStandardMaterial color="#4b3f52" roughness={0.85} />
      </mesh>
      <Grandstand position={[0, 0, -14]} length={14} />
      <Trees items={trees} />
      <Bushes items={bushes} />
      <Rocks items={rocks} />
      <Tires items={tires} />
      <Banners items={banners} />
      <Balloons items={balloons} />
      <group position={[-2.2, 0, 0.6]} rotation={[0, 0.5, 0]}>
        <Kart color={RED} steer={0.8} speed={4} />
      </group>
      <group position={[0, 0, 0.8]} rotation={[0, -0.2, 0]}>
        <Kart color={YELLOW} steer={0} speed={8} boosting />
      </group>
      <group position={[2.2, 0, 0.6]} rotation={[0, -0.6, 0]}>
        <Kart color={PURPLE} steer={-0.6} speed={2} />
      </group>
    </group>
  );
}
