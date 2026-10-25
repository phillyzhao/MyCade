// Player character. Three tiers, never blocking play:
//  1. default toy body tinted in the player's color (always available)
//  2. image card: the generated character image on a billboard (Gemini stage done)
//  3. rigged GLB normalized to height 1.0 with feet at y=0 (Tripo stage done)
// Games drive poses through a mutable `anim` object: {pose, t, speed, look}.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ToyBody } from './models/ToyBody.jsx';

const SKIN = '#f5c9a5';
const HAIR = ['#3b2414', '#1d1a1a', '#7a4a22', '#e3b04b', '#5b3a29', '#2b2b38', '#a8552a', '#3a2a1a'];

const glossy = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.25, ...extra });

export function makeAnim(pose = 'idle') {
  return { pose, t: 0, speed: 0, look: 0, time: Math.random() * 10 };
}

const ease = (x) => x * x * (3 - 2 * x);

/** Compute joint angles for a pose. Returns radians for each joint. */
function poseAngles(anim, time) {
  const t = anim.t ?? 0;
  const a = { bodyY: 0, bodyLean: 0, bodyTwist: 0, headTilt: 0, lArmZ: 0.3, rArmZ: -0.3, lArmX: 0, rArmX: 0, lLegX: 0, rLegX: 0, hop: 0, squash: 1 };
  const breathe = Math.sin(time * 2.2) * 0.02;
  switch (anim.pose) {
    case 'run': {
      const ph = time * (8 + (anim.speed || 0) * 6);
      a.lLegX = Math.sin(ph) * 0.8;
      a.rLegX = -Math.sin(ph) * 0.8;
      a.lArmX = -Math.sin(ph) * 0.9;
      a.rArmX = Math.sin(ph) * 0.9;
      a.hop = Math.abs(Math.sin(ph)) * 0.04;
      a.bodyLean = 0.15;
      break;
    }
    case 'bowl': {
      // t: 0 address -> 0.45 backswing -> 0.75 release -> 1 follow-through
      const back = t < 0.45 ? ease(t / 0.45) : 1 - ease(Math.min(1, (t - 0.45) / 0.3));
      const fwd = t < 0.45 ? 0 : ease(Math.min(1, (t - 0.45) / 0.45));
      a.rArmZ = -0.25;
      a.rArmX = back * 1.6 - fwd * 2.2;
      a.lArmZ = 0.9 + fwd * 0.4;
      a.bodyLean = fwd * 0.45 + back * 0.1;
      a.lLegX = -fwd * 0.6;
      a.rLegX = fwd * 0.5;
      a.bodyY = -fwd * 0.08;
      break;
    }
    case 'aim': {
      a.rArmZ = -0.3;
      a.rArmX = -0.5;
      a.lArmZ = 0.6;
      a.bodyLean = 0.12;
      break;
    }
    case 'swingR':
    case 'swingL': {
      // racket swing; t 0..1
      const s = anim.pose === 'swingR' ? 1 : -1;
      const ph = ease(Math.min(1, t));
      a.bodyTwist = s * (-0.9 + ph * 1.8);
      a.rArmZ = -1.4 + ph * 0.2;
      a.rArmX = -0.6;
      a.lArmZ = 0.8;
      a.bodyLean = 0.1;
      break;
    }
    case 'serve': {
      const ph = Math.min(1, t);
      a.rArmZ = -2.6 + (ph > 0.5 ? ease((ph - 0.5) * 2) * 2.2 : 0);
      a.lArmZ = 2.4 - ph * 1.6;
      a.bodyLean = ph > 0.5 ? 0.3 : -0.1;
      break;
    }
    case 'ready': {
      a.rArmZ = -0.9;
      a.rArmX = -0.4;
      a.lArmZ = 0.9;
      a.lArmX = -0.4;
      a.bodyLean = 0.2;
      a.lLegX = 0.2;
      a.rLegX = 0.2;
      a.hop = Math.abs(Math.sin(time * 6)) * 0.015;
      break;
    }
    case 'cheer': {
      const ph = time * 9;
      a.lArmZ = 2.7 + Math.sin(ph) * 0.25;
      a.rArmZ = -2.7 - Math.sin(ph) * 0.25;
      a.hop = Math.abs(Math.sin(ph * 0.5)) * 0.18;
      a.squash = 1 + Math.sin(ph) * 0.03;
      break;
    }
    case 'sad': {
      a.lArmZ = 0.25;
      a.rArmZ = -0.25;
      a.headTilt = 0.45;
      a.bodyLean = 0.25;
      break;
    }
    case 'wheel': {
      a.lArmZ = 0.5;
      a.rArmZ = -0.5;
      a.lArmX = -1.2;
      a.rArmX = -1.2;
      a.lLegX = -1.3;
      a.rLegX = -1.3;
      a.bodyY = -0.1;
      break;
    }
    case 'balance': {
      a.lArmZ = 1.5 + Math.sin(time * 3) * 0.2;
      a.rArmZ = -1.5 + Math.sin(time * 3 + 1) * 0.2;
      a.bodyLean = (anim.lean || 0) * -0.5;
      a.bodyTwist = 0;
      break;
    }
    case 'fall': {
      const ph = time * 14;
      a.lArmZ = 2.4 + Math.sin(ph) * 0.6;
      a.rArmZ = -2.4 - Math.cos(ph) * 0.6;
      a.lLegX = Math.sin(ph) * 0.7;
      a.rLegX = -Math.sin(ph) * 0.7;
      break;
    }
    default: {
      a.lArmZ = 0.3 + breathe * 2;
      a.rArmZ = -0.3 - breathe * 2;
      a.hop = breathe * 0.3;
    }
  }
  return a;
}

function DefaultBody({ color, slot = 0, anim, held, look }) {
  const r = useRef({});
  useFrame((_, dt) => {
    if (!anim) return;
    anim.time = (anim.time || 0) + dt;
    const a = poseAngles(anim, anim.time);
    const k = 1 - Math.pow(0.0001, dt); // frame-rate independent smoothing
    const R = r.current;
    const sm = (obj, prop, v) => {
      if (obj) obj[prop] += (v - obj[prop]) * k;
    };
    sm(R.body?.position, 'y', 0.3 + a.bodyY + a.hop);
    sm(R.body?.rotation, 'x', a.bodyLean);
    sm(R.body?.rotation, 'y', a.bodyTwist);
    sm(R.head?.rotation, 'x', a.headTilt);
    sm(R.head?.rotation, 'y', anim.look || 0);
    sm(R.lArm?.rotation, 'z', a.lArmZ);
    sm(R.rArm?.rotation, 'z', a.rArmZ);
    sm(R.lArm?.rotation, 'x', a.lArmX);
    sm(R.rArm?.rotation, 'x', a.rArmX);
    sm(R.lLeg?.rotation, 'x', a.lLegX);
    sm(R.rLeg?.rotation, 'x', a.rLegX);
    if (R.body) R.body.scale.y += (a.squash - R.body.scale.y) * k;
  });

  const set = (name) => (el) => (r.current[name] = el);
  return <ToyBody color={color} slot={slot} setRef={set} held={held} look={look} />;
}

// ---- image card avatar: knock out the white background, show on a billboard
const cardCache = new Map();
function useCardTexture(url) {
  const [tex, setTex] = useState(() => cardCache.get(url) || null);
  useEffect(() => {
    if (!url || cardCache.has(url)) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = 384;
      const H = Math.round((img.height / img.width) * W);
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H);
      const px = d.data;
      // flood fill near-white from the borders -> transparent
      const seen = new Uint8Array(W * H);
      const stack = [];
      for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
      for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
      while (stack.length) {
        const i = stack.pop();
        if (seen[i]) continue;
        seen[i] = 1;
        const o = i * 4;
        if (px[o] < 228 || px[o + 1] < 228 || px[o + 2] < 228) continue;
        px[o + 3] = 0;
        const x = i % W;
        if (x > 0) stack.push(i - 1);
        if (x < W - 1) stack.push(i + 1);
        if (i >= W) stack.push(i - W);
        if (i < W * (H - 1)) stack.push(i + W);
      }
      // crop to content bounds so feet sit at y=0
      let minX = W, minY = H, maxX = 0, maxY = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (px[(y * W + x) * 4 + 3] > 20) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
      ctx.putImageData(d, 0, 0);
      const cw = Math.max(1, maxX - minX + 1);
      const ch = Math.max(1, maxY - minY + 1);
      const out = document.createElement('canvas');
      out.width = cw;
      out.height = ch;
      out.getContext('2d').drawImage(cv, minX, minY, cw, ch, 0, 0, cw, ch);
      const t = new THREE.CanvasTexture(out);
      t.colorSpace = THREE.SRGBColorSpace;
      t.userData.aspect = cw / ch;
      cardCache.set(url, t);
      setTex(t);
    };
    img.src = url;
  }, [url]);
  return tex;
}

function CardBody({ url, anim, fallback }) {
  const tex = useCardTexture(url);
  const g = useRef();
  useFrame((state, dt) => {
    if (!g.current || !anim) return;
    anim.time = (anim.time || 0) + dt;
    const a = poseAngles(anim, anim.time);
    g.current.position.y = a.hop + a.bodyY * 0.5;
    g.current.rotation.z = -a.bodyTwist * 0.25 + (anim.pose === 'sad' ? 0.15 : 0);
    g.current.rotation.x = a.bodyLean * 0.4;
    // face the camera around Y only
    const cam = state.camera;
    const wp = new THREE.Vector3();
    g.current.parent.getWorldPosition(wp);
    const parentRot = new THREE.Euler().setFromQuaternion(g.current.parent.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    g.current.rotation.y = Math.atan2(cam.position.x - wp.x, cam.position.z - wp.z) - parentRot;
  });
  if (!tex) return fallback;
  const h = 1.0;
  const w = h * (tex.userData.aspect || 0.8);
  return (
    <group ref={g}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} transparent alphaTest={0.3} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---- rigged GLB avatar
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function GlbBody({ url, meta, anim, held }) {
  const gltf = useGLTF(url);
  const { scene, bones, rest } = useMemo(() => {
    const scene = cloneSkinned(gltf.scene);
    scene.updateMatrixWorld(true);
    const inner = new THREE.Group();
    inner.add(scene);
    if (meta?.height > 0) {
      // server measured the skinned rest pose: scale to height 1.0, feet at y=0
      const s = 1 / meta.height;
      scene.scale.setScalar(s);
      scene.position.y = -(meta.minY || 0) * s;
    } else {
      const box = new THREE.Box3().setFromObject(scene, true);
      const size = box.getSize(new THREE.Vector3());
      const s = 1 / (size.y || 1);
      scene.scale.setScalar(s);
      const c = box.getCenter(new THREE.Vector3());
      scene.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    }
    // Tripo rigs face +X; yaw turns them to face +Z like every other avatar
    inner.rotation.y = meta?.yaw || 0;
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    const bones = {};
    const rest = {};
    const map = meta?.bones || {};
    for (const [canon, name] of Object.entries(map)) {
      const b = scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) || scene.getObjectByName(name);
      if (b) {
        bones[canon] = b;
        rest[canon] = b.quaternion.clone();
      }
    }
    if (typeof window !== 'undefined') (window.__glbs ||= []).push({ bones, scene: inner, meta });
    return { scene: inner, bones, rest };
    // memo on content, not object identity (player objects are recreated on every update)
  }, [gltf, meta?.yaw, meta?.height, meta?.minY, JSON.stringify(meta?.bones || {})]);

  const root = useRef();
  const prop = useRef();
  useFrame((_, dt) => {
    if (!anim) return;
    anim.time = (anim.time || 0) + dt;
    const a = poseAngles(anim, anim.time);
    if (root.current) {
      root.current.position.y = a.hop + a.bodyY * 0.5;
      root.current.rotation.x = a.bodyLean * 0.6;
      root.current.rotation.y = a.bodyTwist * 0.8;
    }
    // drive arms from T-pose rest with world-space rotations (rig-agnostic)
    root.current?.getWorldQuaternion(_rq);
    const drive = (canon, axis, angle, axis2, angle2) => {
      const b = bones[canon];
      if (!b || !b.parent) return;
      b.parent.getWorldQuaternion(_pq);
      _q.setFromAxisAngle(_ax.copy(axis).applyQuaternion(_rq), angle);
      if (axis2) _q.premultiply(_q2.setFromAxisAngle(_ax.copy(axis2).applyQuaternion(_rq), angle2));
      // local = parentWorld^-1 * worldRot * parentWorld * rest
      const local = _pq.clone().invert().multiply(_q).multiply(_pq).multiply(rest[canon]);
      b.quaternion.slerp(local, Math.min(1, dt * 14));
    };
    // T-pose arms are horizontal (angle PI/2 from down); our pose angles measure from down
    drive('leftUpperArm', AX.z, a.lArmZ - Math.PI / 2, AX.x, a.lArmX);
    drive('rightUpperArm', AX.z, Math.PI / 2 + a.rArmZ, AX.x, a.rArmX);
    drive('leftUpperLeg', AX.x, a.lLegX);
    drive('rightUpperLeg', AX.x, a.rLegX);
    drive('head', AX.x, a.headTilt);

    // held prop (racket): follow the right hand, pointing along the forearm
    const hand = bones.rightHand || bones.rightLowerArm;
    const elbow = bones.rightLowerArm || bones.rightUpperArm;
    if (prop.current && hand && elbow && root.current?.parent) {
      const par = root.current.parent;
      hand.getWorldPosition(_hp);
      elbow.getWorldPosition(_ep);
      _dir.subVectors(_hp, _ep).normalize();
      par.worldToLocal(_hp);
      prop.current.position.copy(_hp);
      // direction into the parent's space
      par.getWorldQuaternion(_pq2).invert();
      _dir.applyQuaternion(_pq2);
      prop.current.quaternion.setFromUnitVectors(_down, _dir);
      prop.current.visible = true;
    }
  });

  return (
    <>
      <group ref={root}>
        <primitive object={scene} />
      </group>
      {held && (
        <group ref={prop} visible={false}>
          {held}
        </group>
      )}
    </>
  );
}
const _hp = new THREE.Vector3();
const _ep = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _pq2 = new THREE.Quaternion();

export function Avatar({ player, anim, held, scale = 1, ...rest }) {
  const color = player?.color || '#19b8ff';
  const av = player?.avatar;
  const fallback = <DefaultBody color={color} slot={player?.slot || 0} anim={anim} held={held} look={player?.look} />;
  let body = fallback;
  if (av?.glb && av?.rigged !== false) {
    body = (
      <Suspense fallback={fallback}>
        <GlbBody url={av.glb} meta={av} anim={anim} held={held} />
      </Suspense>
    );
  } else if (av?.glb) {
    body = (
      <Suspense fallback={fallback}>
        <GlbBody url={av.glb} meta={{ ...av, bones: {} }} anim={anim} />
        {held && <group position={[-0.28, 0.5, 0.08]}>{held}</group>}
      </Suspense>
    );
  } else if (av?.image) {
    body = (
      <>
        <CardBody url={av.image} anim={anim} fallback={fallback} />
        {held && <group position={[-0.32, 0.5, 0.08]}>{held}</group>}
      </>
    );
  }
  return (
    <group scale={scale} {...rest}>
      {body}
      <PlayerRing color={color} />
    </group>
  );
}

function PlayerRing({ color }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
      <ringGeometry args={[0.2, 0.26, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.7} />
    </mesh>
  );
}
