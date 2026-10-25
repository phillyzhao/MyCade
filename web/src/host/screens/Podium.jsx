// End-of-session champion podium with 3D avatars.
import { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { MODE } from '@shared/protocol.js';
import { useHost, activePlayers } from '../store.js';
import { sendScreen } from '../net.js';
import { leaderboard, headToHead, rivalryLine, bestRecords } from '../rivalry.js';
import { Avatar, makeAnim } from '../../three/Avatar.jsx';
import { SkyDome, Lights } from '../../three/Scenery.jsx';
import { confetti, popup } from '../../ui/fx.jsx';
import { sound } from '../../sound.js';
import { onPlayerEvent } from '../input.js';

const STEPS = [
  { x: 0, h: 0.6, color: '#ffd23f' },
  { x: -1.15, h: 0.4, color: '#dfe8f2' },
  { x: 1.15, h: 0.25, color: '#ffb072' },
];

export default function Podium() {
  const players = useHost((s) => s.players);
  const matches = useHost((s) => s.matches);
  const act = activePlayers(players);
  const board = leaderboard(matches, act);
  const top = board.slice(0, 3).map((r) => ({ ...r, player: players.find((p) => p.name === r.name) || { name: r.name, color: r.color } }));
  const anims = useMemo(() => top.map((_, i) => makeAnim(i === 0 ? 'cheer' : 'idle')), [top.length]);
  const recs = bestRecords(matches);
  const h2h = headToHead(matches).slice(0, 3);

  useEffect(() => {
    sound.music('results');
    sound.sting('champion');
    const fire = () => {
      confetti({ count: 200, x: 0.5, y: 0.3 });
    };
    fire();
    const iv = setInterval(fire, 2600);
    if (top[0]) popup({ text: 'CHAMPION!', sub: top[0].name, kind: 'gold', duration: 2600 });
    sendScreen('all', { mode: MODE.RESULTS, prompt: top[0] ? `${top[0].name} is the champion!` : 'Champion!', sub: 'Press A for a new session' });
    const off = onPlayerEvent((pid, ev) => {
      if (ev.kind === 'press' && ev.button === 'a' && ev.down) {
        useHost.getState().resetSession();
        useHost.getState().setScreen('menu');
      }
    });
    return () => {
      clearInterval(iv);
      off();
    };
  }, []);

  return (
    <div className="podium fade-in">
      <div className="podium-3d">
        <Canvas shadows camera={{ position: [0, 1.6, 4.2], fov: 40 }} dpr={[1, 2]}>
          <SkyDome />
          <Lights />
          <group position={[0, -0.6, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <circleGeometry args={[4, 48]} />
              <meshStandardMaterial color="#7ad94a" />
            </mesh>
            {top.map((t, i) => (
              <group key={t.name} position={[STEPS[i].x, 0, 0]}>
                <mesh position={[0, STEPS[i].h / 2, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[0.5, 0.55, STEPS[i].h, 32]} />
                  <meshPhysicalMaterial color={STEPS[i].color} clearcoat={1} roughness={0.2} metalness={0.2} />
                </mesh>
                <Avatar player={t.player} anim={anims[i]} position={[0, STEPS[i].h, 0]} rotation={[0, 0, 0]} />
              </group>
            ))}
          </group>
        </Canvas>
      </div>
      <aside className="podium-side glass">
        <h2 className="display-title" style={{ fontSize: 48 }}>
          Champion
        </h2>
        <ol className="board">
          {board.map((r, i) => (
            <li key={r.name}>
              <span className="rank">{i + 1}</span>
              <span className="player-dot" style={{ '--pc': r.color }} />
              <span className="bname">{r.name}</span>
              <span className="bpts">
                {r.points} pts · {r.wins}W
              </span>
            </li>
          ))}
        </ol>
        {h2h.length > 0 && <h4>Rivalries</h4>}
        {h2h.map((r) => (
          <div key={r.leader + r.trailer} className="rival">
            {rivalryLine(r)}
          </div>
        ))}
        {Object.keys(recs).length > 0 && <h4>Records</h4>}
        {Object.entries(recs).map(([k, r]) => (
          <div key={k} className="rival">
            {r.label}: <b>{r.display ?? r.value}</b> · {r.name}
          </div>
        ))}
        <button className="gloss-btn green" onClick={() => (useHost.getState().resetSession(), useHost.getState().setScreen('menu'))}>
          New session
        </button>
      </aside>
    </div>
  );
}
