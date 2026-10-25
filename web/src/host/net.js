// Host network layer: owns the room, routes phone input/events, pushes screens to phones.
import { MSG } from '@shared/protocol.js';
import { createSocket } from '../net/socket.js';
import { useHost } from './store.js';
import { applyInput, emitPlayerEvent } from './input.js';

let sock = null;
const motionLog = [];

export function startHostNet() {
  if (sock) return sock;
  const st = useHost.getState();
  const saved = sessionStorage.getItem('mp.room');
  sock = createSocket({
    onStatus: (s) => useHost.getState().setNetStatus(s),
    onOpen: () => sock.send({ type: MSG.HOST, room: useHost.getState().room || saved || undefined }),
    onMessage: (msg) => {
      const h = useHost.getState();
      switch (msg.type) {
        case MSG.HOSTED:
          h.setRoom(msg.room);
          sessionStorage.setItem('mp.room', msg.room);
          for (const p of msg.players || []) h.upsertPlayer({ id: p.playerId, ...p });
          resendScreens();
          break;
        case MSG.PLAYER_JOINED:
          h.upsertPlayer({ id: msg.playerId, slot: msg.slot, name: msg.name, color: msg.color, connected: true, avatar: msg.avatar });
          emitPlayerEvent(msg.playerId, { kind: 'joined' });
          resendScreens(msg.playerId);
          break;
        case MSG.PLAYER_LEFT:
          h.upsertPlayer({ id: msg.playerId, connected: false });
          break;
        case MSG.PLAYER_UPDATE:
          h.upsertPlayer({ id: msg.pid, ...(msg.name ? { name: msg.name } : {}), ...(msg.color ? { color: msg.color } : {}) });
          break;
        case MSG.AVATAR_STATUS: {
          const prev = h.players.find((p) => p.id === msg.playerId)?.avatar;
          const { type, playerId, ...avatar } = msg;
          h.upsertPlayer({ id: msg.playerId, avatar: { ...prev, ...avatar } });
          emitPlayerEvent(msg.playerId, { kind: 'avatar', avatar });
          break;
        }
        case MSG.INPUT:
          applyInput(msg.pid, msg);
          break;
        case MSG.EVENT:
          emitPlayerEvent(msg.pid, msg);
          if (msg.kind === 'swing' || msg.kind === 'release') {
            motionLog.push({ room: h.room, game: h.game, player: h.players.find((p) => p.id === msg.pid)?.name, kind: msg.kind, power: msg.power, spin: msg.spin ?? msg.twist, peak: msg.peak });
          }
          break;
        default:
          break;
      }
    },
  });
  // flush motion summaries for the stats DB every few seconds
  setInterval(() => {
    if (!motionLog.length) return;
    const batch = motionLog.splice(0, motionLog.length);
    fetch('/api/motion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) }).catch(() => {});
  }, 5000);
  return sock;
}

// last screen sent to each phone, so reconnecting phones get the right UI
const screens = new Map();
let screenAll = null;

/** Push a controller screen. to = playerId | 'all'. */
export function sendScreen(to, screen) {
  if (to === 'all') {
    screenAll = screen;
    screens.clear();
  } else screens.set(to, screen);
  sock?.send({ type: MSG.SCREEN, to, ...screen }, { queueIfClosed: false });
}

function resendScreens(pid) {
  if (!sock) return;
  const players = useHost.getState().players;
  for (const p of players) {
    if (pid && p.id !== pid) continue;
    const s = screens.get(p.id) || screenAll;
    if (s) sock.send({ type: MSG.SCREEN, to: p.id, ...s }, { queueIfClosed: false });
  }
}

export function sendHaptic(to, pattern) {
  sock?.send({ type: MSG.HAPTIC, to, pattern }, { queueIfClosed: false });
}

export function kickPlayer(playerId) {
  sock?.send({ type: 'kick', playerId });
}
