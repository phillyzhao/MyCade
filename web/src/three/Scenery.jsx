// Shared 3D scenery: Frutiger Aero sky dome, puffy clouds, soft sun lighting.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function SkyDome({ top = '#1a0b3d', mid = '#c2386f', bottom = '#ffa45c', radius = 120 }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bottom: { value: new THREE.Color(bottom) } },
        vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vp;
          void main(){ float h = vp.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, bottom, smoothstep(0.0, -0.25, h));
          float sun = pow(max(0.0, dot(vp, normalize(vec3(0.3, 0.12, -0.95)))), 24.0);
          float stars = step(0.9985, fract(sin(dot(floor(vp.xz*420.0 + vp.y*137.0), vec2(12.9898,78.233)))*43758.5453)) * smoothstep(0.15, 0.5, h);
          gl_FragColor = vec4(c + vec3(1.0,0.8,0.4)*sun*0.9 + vec3(stars), 1.0); }`,
      }),
    [top, mid, bottom],
  );
  return (
    <mesh material={mat} renderOrder={-1}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  );
}

export function Lights({ shadowSize = 12, target = [0, 0, 0] }) {
  return (
    <>
      <hemisphereLight args={['#ffd9e8', '#3a1450', 1.1]} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowSize}
        shadow-camera-right={shadowSize}
        shadow-camera-top={shadowSize}
        shadow-camera-bottom={-shadowSize}
        shadow-bias={-0.0004}
        target-position={target}
      />
      <ambientLight intensity={0.35} />
    </>
  );
}

function Cloud({ position, scale = 1, speed = 0.3 }) {
  const g = useRef();
  const puffs = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        p: [(i - 2.5) * 0.9 + Math.sin(i * 7) * 0.3, Math.abs(Math.sin(i * 3.1)) * 0.6, Math.cos(i * 5) * 0.4],
        r: 0.7 + Math.abs(Math.sin(i * 2.3)) * 0.6,
      })),
    [],
  );
  useFrame((_, dt) => {
    if (!g.current) return;
    g.current.position.x += speed * dt;
    if (g.current.position.x > 60) g.current.position.x = -60;
  });
  return (
    <group ref={g} position={position} scale={scale}>
      {puffs.map((pf, i) => (
        <mesh key={i} position={pf.p}>
          <sphereGeometry args={[pf.r, 16, 12]} />
          <meshStandardMaterial color="#ff9ab0" roughness={1} emissive="#ff4d6d" emissiveIntensity={0.25} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

export function Clouds({ count = 10, y = 14, spread = 50, z = -30 }) {
  const items = useMemo(
    () => Array.from({ length: count }, (_, i) => ({ pos: [((i * 37) % (spread * 2)) - spread, y + ((i * 13) % 8), z - ((i * 17) % 25)], s: 1.2 + ((i * 7) % 5) * 0.4 })),
    [count, y, spread, z],
  );
  return items.map((c, i) => <Cloud key={i} position={c.pos} scale={c.s} speed={0.2 + (i % 3) * 0.15} />);
}

/** Rolling grassy hills ring for outdoor scenes. */
export function Hills({ radius = 70, y = -0.5 }) {
  const items = useMemo(
    () => Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      return { p: [Math.cos(a) * radius, y, Math.sin(a) * radius], s: 10 + ((i * 7) % 6) * 3 };
    }),
    [radius, y],
  );
  return items.map((h, i) => (
    <mesh key={i} position={h.p} scale={[h.s * 1.6, h.s * 0.55, h.s * 1.6]}>
      <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshStandardMaterial color={i % 2 ? '#6fd43c' : '#58c22c'} roughness={0.9} />
    </mesh>
  ));
}

/** Glossy floating bubbles for ambience. */
export function Bubbles({ count = 18, area = [20, 8, 20], center = [0, 3, 0] }) {
  const g = useRef();
  const data = useMemo(
    () => Array.from({ length: count }, (_, i) => ({ p: new THREE.Vector3((Math.random() - 0.5) * area[0], Math.random() * area[1], (Math.random() - 0.5) * area[2]), s: 0.15 + Math.random() * 0.35, v: 0.2 + Math.random() * 0.4 })),
    [count],
  );
  useFrame((st, dt) => {
    if (!g.current) return;
    g.current.children.forEach((m, i) => {
      const d = data[i];
      d.p.y += d.v * dt;
      if (d.p.y > area[1]) d.p.y = 0;
      m.position.set(d.p.x + Math.sin(st.clock.elapsedTime + i) * 0.3, d.p.y, d.p.z);
    });
  });
  return (
    <group ref={g} position={center}>
      {data.map((d, i) => (
        <mesh key={i} scale={d.s}>
          <sphereGeometry args={[1, 20, 14]} />
          <meshPhysicalMaterial color="#ffffff" transmission={0.9} roughness={0.05} thickness={0.2} clearcoat={1} transparent opacity={0.45} iridescence={1} iridescenceIOR={1.3} />
        </mesh>
      ))}
    </group>
  );
}
