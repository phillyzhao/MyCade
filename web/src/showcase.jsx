import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { SkyDome, Lights } from './three/Scenery.jsx';
import { PropsShowcase, } from './three/models/Props.jsx';
import { Kart } from './three/models/Kart.jsx';

function Expose() {
  const s = useThree();
  window.__r3f = s;
  return null;
}
const solo = new URLSearchParams(location.search).get('solo');
createRoot(document.getElementById('root')).render(
  <Canvas shadows camera={{ position: [0, 4, 9], fov: 45 }} gl={{ preserveDrawingBuffer: true }}>
    <SkyDome />
    <Lights shadowSize={18} />
    <Expose />
    {solo ? <Kart color={solo === 'y' ? '#ffd23a' : '#ff2d2d'} steer={0.6} speed={3} boosting /> : <PropsShowcase />}
    <OrbitControls makeDefault target={[0, 0.5, 0]} />
  </Canvas>,
);
