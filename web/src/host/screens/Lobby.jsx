import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { PLAYER_COLORS } from '@shared/protocol.js';
import { useHost, activePlayers } from '../store.js';
import { onPlayerEvent, KEYBOARD_PID } from '../input.js';
import { BRAND, AVATAR_NAME } from '../../brand.js';
import { sound } from '../../sound.js';
import { PlayerCard } from './PlayerBadge.jsx';

const CPU_NAMES = ['Bloop', 'Zibzab', 'Pip', 'Mochi', 'Gizmo', 'Tofu'];

export function addCpu() {
  const h = useHost.getState();
  const used = new Set(h.players.map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const n = h.players.filter((p) => p.cpu).length;
  const color = PLAYER_COLORS.find((c) => !h.players.some((p) => p.color === c.hex))?.hex || PLAYER_COLORS[slot % 8].hex;
  h.upsertPlayer({ id: `cpu${Date.now() % 100000}`, slot, name: `CPU ${CPU_NAMES[n % CPU_NAMES.length]}`, color, cpu: true, connected: true });
  sound.sfx('join');
}

export function addKeyboard() {
  const h = useHost.getState();
  if (h.players.some((p) => p.id === KEYBOARD_PID)) return;
  const used = new Set(h.players.map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  h.upsertPlayer({ id: KEYBOARD_PID, slot, name: 'Keys', color: '#2fe0b5', connected: true, keyboard: true });
  sound.sfx('join');
}

export default function Lobby() {
  const room = useHost((s) => s.room);
  const urls = useHost((s) => s.urls);
  const urlIndex = useHost((s) => s.urlIndex);
  const players = useHost((s) => s.players);
  const [qr, setQr] = useState(null);
  const base = urls[urlIndex] || location.origin;
  const joinUrl = room ? `${base}/play/${room}` : '';

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 420, color: { dark: '#07407a', light: '#ffffff' } }).then(setQr);
  }, [joinUrl]);

  // any player pressing A in the lobby moves to the game menu
  useEffect(
    () =>
      onPlayerEvent((pid, ev) => {
        if (ev.kind === 'press' && ev.button === 'a' && ev.down && activePlayers(useHost.getState().players).length) {
          sound.sfx('select');
          useHost.getState().setScreen('menu');
        }
      }),
    [],
  );

  const act = activePlayers(players);
  return (
    <div className="lobby fade-in">
      <section className="lobby-hero burst panel">
        <div className="hero-inner">
          <div className="pixel-title hero-kicker">YOUR PERSONAL ARCADE</div>
          <h1 className="display-title hero-title">{BRAND.toUpperCase()}!</h1>
          <div className="hero-steps">
            <span>
              <b>1</b> scan
            </span>
            <span>
              <b>2</b> enable motion
            </span>
            <span>
              <b>3</b> snap a pic, get your {AVATAR_NAME}
            </span>
          </div>
        </div>
        <div className="join-card bounce-in">
          <div className="qr-wrap">{qr ? <img src={qr} alt="Join QR code" /> : <div className="qr-ph" />}</div>
          <div className="join-code">
            <span>ROOM</span>
            <b>{room || '····'}</b>
          </div>
          <button className="join-url" onClick={() => useHost.getState().cycleUrl()} title="Click to cycle network address">
            {joinUrl.replace(/^https?:\/\//, '') || 'connecting…'}
          </button>
        </div>
      </section>

      <section className="lobby-players">
        {Array.from({ length: Math.max(4, act.length) }, (_, i) => act[i]).map((p, i) =>
          p ? <PlayerCard key={p.id} player={p} /> : <EmptyCard key={`e${i}`} n={i + 1} />,
        )}
      </section>

      <section className="lobby-actions">
        <button className="gloss-btn silver small" onClick={addCpu}>
          + CPU
        </button>
        <button className="gloss-btn silver small" onClick={addKeyboard}>
          + Keyboard
        </button>
        <div className="lobby-hint pixel">{act.length ? 'press A on any phone to start' : 'waiting for players…'}</div>
        <button className="gloss-btn green big-cta" disabled={!act.length} onClick={() => (sound.sfx('select'), useHost.getState().setScreen('menu'))}>
          LET'S PLAY ▶
        </button>
      </section>
    </div>
  );
}

function EmptyCard({ n }) {
  return (
    <div className="pcard empty">
      <div className="pcard-art">
        <span className="pixel">P{n}</span>
      </div>
      <div className="pcard-label">
        <i className="stick" />
        <span className="pixel">PRESS START</span>
        <i className="btns" />
      </div>
    </div>
  );
}
