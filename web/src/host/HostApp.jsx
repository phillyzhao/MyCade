import { useEffect } from 'react';
import { MODE } from '@shared/protocol.js';
import { useHost, activePlayers } from './store.js';
import { startHostNet, sendScreen } from './net.js';
import { installKeyboard, onPlayerEvent } from './input.js';
import { AeroBackground, PopupLayer, ConfettiLayer } from '../ui/fx.jsx';
import { sound } from '../sound.js';
import { BRAND } from '../brand.js';
import Lobby from './screens/Lobby.jsx';
import Menu from './screens/Menu.jsx';
import GameShell from './screens/GameShell.jsx';
import Podium from './screens/Podium.jsx';
import DebugOverlay from './screens/DebugOverlay.jsx';
import './host.css';
import '../games/games.css';

export default function HostApp() {
  const screen = useHost((s) => s.screen);
  const debug = useHost((s) => s.debug);
  const room = useHost((s) => s.room);
  const players = useHost((s) => s.players);
  const netStatus = useHost((s) => s.netStatus);

  useEffect(() => {
    startHostNet();
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => useHost.getState().setUrls(c.urls || []))
      .catch(() => {});
    const offKb = installKeyboard();
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const onKey = (e) => {
      if (e.target && /input/i.test(e.target.tagName)) return;
      if (e.key === 'd' || e.key === 'D') useHost.getState().toggleDebug();
      if (e.key === 'm' || e.key === 'M') sound.toggleMute();
    };
    window.addEventListener('keydown', onKey);
    // cached Buddies: look up a joining player's pre-generated avatar by name
    const off = onPlayerEvent((pid, ev) => {
      if (ev.kind !== 'joined') return;
      sound.sfx('join');
      const p = useHost.getState().players.find((x) => x.id === pid);
      if (!p || p.avatar?.image || p.avatar?.glb) return;
      fetch(`/api/avatar/cache?name=${encodeURIComponent(p.name)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((e) => {
          if (e && (e.image || e.glb)) useHost.getState().upsertPlayer({ id: pid, avatar: { status: 'ready', ...e } });
        })
        .catch(() => {});
    });
    return () => {
      offKb();
      off();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // keep phones in the right mode for non-game screens
  useEffect(() => {
    if (screen === 'lobby') sendScreen('all', { mode: MODE.LOBBY, prompt: 'You are in! Watch the big screen.' });
    if (screen === 'menu') sendScreen('all', { mode: MODE.MENU, prompt: 'Tilt or tap arrows to pick a game. Press A to play!' });
    if (screen === 'lobby' || screen === 'menu') sound.music('menu');
  }, [screen]);

  return (
    <div id="stage" className="host">
      <AeroBackground />
      <header className="topbar">
        <div className="brand">
          <span className="brand-orb" />
          {BRAND}
        </div>
        <div className="topbar-mid">
          {activePlayers(players).map((p) => (
            <span key={p.id} className={`chip pchip ${p.connected || p.cpu ? '' : 'off'}`}>
              <span className="player-dot" style={{ '--pc': p.color }} />
              {p.name}
            </span>
          ))}
        </div>
        <div className="topbar-right">
          {room && (
            <span className="chip room-chip">
              ROOM <b>{room}</b>
            </span>
          )}
          <span className={`net-dot ${netStatus}`} title={netStatus} />
        </div>
      </header>
      <main className="screen">
        {screen === 'lobby' && <Lobby />}
        {screen === 'menu' && <Menu />}
        {screen === 'game' && <GameShell />}
        {screen === 'podium' && <Podium />}
      </main>
      {debug && <DebugOverlay />}
      <PopupLayer />
      <ConfettiLayer />
    </div>
  );
}
