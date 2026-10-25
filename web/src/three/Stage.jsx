// Shared render polish: studio reflections (no network HDRs) + bloom/vignette post-processing.
import { Environment, Lightformer } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';

/** Procedural environment map: warm sunset softboxes so glossy materials get real reflections. */
export function StudioEnv({ intensity = 1 }) {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={0.85 * intensity}>
      <color attach="background" args={['#3a1440']} />
      <Lightformer form="rect" intensity={3} color="#ffd6a0" position={[0, 6, -8]} scale={[14, 4, 1]} />
      <Lightformer form="rect" intensity={2.2} color="#ff7a9a" position={[-9, 3, 0]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
      <Lightformer form="rect" intensity={1.6} color="#9dd6ff" position={[9, 4, 2]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} />
      <Lightformer form="circle" intensity={4} color="#fff3e0" position={[3, 9, 4]} scale={3} />
      <Lightformer form="ring" intensity={1.5} color="#ffd23a" position={[0, -2, 6]} scale={6} />
    </Environment>
  );
}

/** Bloom on neon + emissives, soft vignette, cheap AA. */
export function Post({ bloom = 0.8 }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <Bloom mipmapBlur intensity={bloom} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.7} />
      <Vignette eskil={false} offset={0.25} darkness={0.55} />
    </EffectComposer>
  );
}
