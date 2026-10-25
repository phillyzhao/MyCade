import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { PLAYER_COLORS } from '@shared/protocol.js';
import { useHost, activePlayers } from '../store.js';
import { onPlayerEvent, KEYBOARD_PID } from '../input.js';
import { BRAND, AVATAR_NAME } from '../../brand.js';
import { sound } from '../../sound.js';
import PlayerBadge from './PlayerBadge.jsx';

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
      <section className="lobby-hero">
        <div className="hero-kicker">phone-powered party games</div>
        <h1 className="display-title hero-title">{BRAND}</h1>
        <p className="hero-sub">Your phone is the controller. You are the character.</p>
        <div className="steps">
          <div className="step glass">
            <b>1</b>Scan the code
          </div>
          <div className="step glass">
            <b>2</b>Tap to enable motion
          </div>
          <div className="step glass">
            <b>3</b>Snap a photo, get your {AVATAR_NAME}
          </div>
        </div>
      </section>

      <section className="join-card glass bounce-in">
        <div className="qr-wrap">{qr ? <img src={qr} alt="Join QR code" /> : <div className="qr-ph" />}</div>
        <div className="join-code">
          <span>ROOM</span>
          <b>{room || '····'}</b>
        </div>
        <button className="join-url" onClick={() => useHost.getState().cycleUrl()} title="Click to cycle network address">
          {joinUrl.replace(/^https?:\/\//, '') || 'connecting…'}
        </button>
      </section>

      <section className="lobby-players">
        <div className="slots">
          {Array.from({ length: Math.max(4, act.length) }, (_, i) => act[i]).map((p, i) =>
            p ? <PlayerBadge key={p.id} player={p} big /> : <div key={`e${i}`} className="slot-empty glass">waiting…</div>,
          )}
        </div>
        <div className="lobby-actions">
          <button className="gloss-btn silver small" onClick={addCpu}>
            + CPU player
          </button>
          <button className="gloss-btn silver small" onClick={addKeyboard}>
            + Keyboard player
          </button>
          <button className="gloss-btn green" disabled={!act.length} onClick={() => (sound.sfx('select'), useHost.getState().setScreen('menu'))}>
            Let's play! ▶
          </button>
        </div>
      </section>
    </div>
  );
}
