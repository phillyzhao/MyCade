import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import { ToyBody } from './three/models/ToyBody.jsx';

const COLORS = ['#19b8ff', '#ff4d6d', '#7bd389', '#ffb000', '#a06cd5', '#ff7a1a', '#2ec4b6'];
const params = new URLSearchParams(location.search);
const cam = (params.get('cam') || '0,0.9,4.2').split(',').map(Number);
const tgt = (params.get('t') || '0,0.55,0').split(',').map(Number);
const only = params.get('only');

function Posed({ i }) {
  const r = useRef({});
  const set = (n) => (el) => (r.current[n] = el);
  useEffect(() => {
    const R = r.current;
    R.lArm.rotation.z = 2.6; R.rArm.rotation.z = -2.6; R.head.rotation.y = 0.3;
  }, []);
  return <ToyBody color={COLORS[6]} slot={6} setRef={set} held={<mesh><boxGeometry args={[0.05,0.05,0.05]} /><meshBasicMaterial color="red"/></mesh>} />;
}

function Stats() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const t = setTimeout(() => {
      const out = [];
      scene.children.forEach((c) => { if (c.userData.slot === undefined) return; let tris = 0, meshes = 0;
        c.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
        out.push(`slot${c.userData.slot}: ${Math.round(tris)} tris, ${meshes} meshes`); });
      window.__stats = out.join('\n') + `\ncalls ${gl.info.render.calls} tris ${gl.info.render.triangles}`;
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}

function App() {
  const items = only !== null ? [Number(only)] : [0, 1, 2, 3, 4, 5, 6];
  return (
    <Canvas shadows camera={{ position: cam, fov: 35 }}>
      <color attach="background" args={['#f4a582']} />
      <hemisphereLight args={['#ffe9d6', '#8a5a6a', 1.1]} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[6, 48]} /><meshStandardMaterial color="#e8c9a8" /></mesh>
      {items.map((s, k) => (
        <group key={s} userData={{ slot: s }} position={[(k - (items.length - 1) / 2) * 0.62, 0, 0]}>
          {s === 6 ? <Posed i={s} /> : <ToyBody color={COLORS[s]} slot={s} />}
        </group>
      ))}
      <OrbitControls target={tgt} />
      <Stats />
    </Canvas>
  );
}
createRoot(document.getElementById('root')).render(<App />);
