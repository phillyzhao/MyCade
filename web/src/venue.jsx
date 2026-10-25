import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { SkyDome, Lights, Clouds } from './three/Scenery.jsx';
import { StudioEnv, Post } from './three/Stage.jsx';
import { BowlingAlley, TennisStadium, PartyPark } from './three/models/Venues.jsx';

const CAMS = {
  bowling: [[[0.55, 1.75, 3.2], [0, 0, -9]], [[0, 1.0, -11.4], [0, 0.1, -14.4]], [[0, 6, 10], [0, 0, -6]]],
  tennis: [[[0, 3.2, 13], [0, 0.6, -2]], [[0, 9.5, 17], [0, 0, -1.5]], [[18, 12, 18], [0, 0, 0]]],
  balance: [[[0, 3.4, 6.7], [0, 0, 0]], [[0, 5, 9], [0, 0, 0]], [[25, 10, 20], [0, 0, -20]]],
};

function CamRig({ venue, cam }) {
  const { camera } = useThree();
  const ctl = useRef();
  useEffect(() => {
    const [p, t] = CAMS[venue][cam];
    camera.position.set(...p);
    ctl.current.target.set(...t);
    ctl.current.update();
  }, [venue, cam]);
  return <OrbitControls ref={ctl} makeDefault />;
}

function BowlStandIn() {
  return (
    <group>
      <mesh position={[0, -0.002, -5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.06, 18]} />
        <meshPhysicalMaterial color="#f0c890" roughness={0.25} clearcoat={1} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * 0.65, -0.07, -7]}><boxGeometry args={[0.24, 0.02, 20]} /><meshPhysicalMaterial color="#c9d6e2" metalness={0.6} roughness={0.25} /></mesh>
          <mesh position={[s * 0.82, 0.05, -7]}><boxGeometry args={[0.06, 0.3, 20]} /><meshPhysicalMaterial color="#2a1d21" /></mesh>
          <mesh position={[s * 0.82, 0.21, -7]}><boxGeometry args={[0.07, 0.025, 20]} /><meshBasicMaterial color={s < 0 ? '#ff2d2d' : '#ffd23a'} toneMapped={false} /></mesh>
        </group>
      ))}
      <mesh position={[0, -0.45, -7]}><boxGeometry args={[1.8, 0.7, 20.5]} /><meshPhysicalMaterial color="#1e1518" /></mesh>
      <mesh position={[0, -0.001, 2.2]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.8, 2.4]} /><meshPhysicalMaterial color="#f6e2c2" /></mesh>
      <mesh position={[0, 0.85, -15.4]}><boxGeometry args={[1.8, 0.5, 2.8]} /><meshPhysicalMaterial color="#d4141b" clearcoat={1} roughness={0.15} /></mesh>
      {[[0, -14], [-0.15, -14.26], [0.15, -14.26], [-0.3, -14.53], [0, -14.53], [0.3, -14.53]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.19, z]} castShadow><cylinderGeometry args={[0.04, 0.05, 0.38, 12]} /><meshStandardMaterial color="#fff" /></mesh>
      ))}
    </group>
  );
}
function TennisStandIn() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[10, 19]} /><meshPhysicalMaterial color="#2f5bd8" roughness={0.6} clearcoat={0.3} /></mesh>
      <mesh position={[0, 0.375, 0]}><boxGeometry args={[9, 0.75, 0.03]} /><meshStandardMaterial color="#111" transparent opacity={0.55} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * 4, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.07, 16]} /><meshBasicMaterial color="#fff" /></mesh>)}
      {[-1, 1].map((s) => <mesh key={s} position={[0, 0.01, s * 8]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[8, 0.07]} /><meshBasicMaterial color="#fff" /></mesh>)}
      {[[-1.5, 7.2], [1.5, 7.2], [-1.5, -7.2], [1.5, -7.2]].map(([x, z], i) => <mesh key={i} position={[x, 0.6, z]} castShadow><capsuleGeometry args={[0.3, 0.6]} /><meshStandardMaterial color={i < 2 ? '#ffd23a' : '#b04bff'} /></mesh>)}
    </group>
  );
}
function BalanceStandIn() {
  return [-2.2, 0, 2.2].map((x) => (
    <mesh key={x} position={[x, -0.5, 0]}><cylinderGeometry args={[0.9, 0.5, 1, 24]} /><meshStandardMaterial color="#6fdc45" /></mesh>
  ));
}

function App() {
  const [venue, setVenue] = useState(new URLSearchParams(location.search).get('v') || 'bowling');
  const [cam, setCam] = useState(0);
  useEffect(() => { window.setVenue = setVenue; window.setCam = setCam; }, []);
  return (
    <>
      <div id="ui">
        {Object.keys(CAMS).map((v) => <button key={v} onClick={() => { setVenue(v); setCam(0); }}>{v}</button>)}
        {[0, 1, 2].map((c) => <button key={c} onClick={() => setCam(c)}>cam {c}</button>)}
      </div>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 2, 5], fov: venue === 'bowling' ? 50 : 45, near: 0.05, far: 300 }}>
        <SkyDome />
        <Lights shadowSize={venue === 'tennis' ? 14 : 10} target={venue === 'bowling' ? [0, 0, -6] : [0, 0, 0]} />
        <StudioEnv />
        {venue === 'bowling' && <><BowlStandIn /><BowlingAlley /></>}
        {venue === 'tennis' && <><TennisStandIn /><TennisStadium /></>}
        {venue === 'balance' && <><Clouds count={14} y={-6} spread={60} z={-20} /><BalanceStandIn /><PartyPark /></>}
        <CamRig venue={venue} cam={cam} />
        <Post />
      </Canvas>
    </>
  );
}
createRoot(document.getElementById('root')).render(<App />);
