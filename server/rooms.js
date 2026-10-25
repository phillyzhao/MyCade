// Room registry: one host socket + up to MAX_PLAYERS phone sockets per 4-letter code.
import { MSG, MAX_PLAYERS, makeRoomCode } from '../shared/protocol.js';

const rooms = new Map();

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
};

export function getRoom(code) {
  return rooms.get(code);
}

export function listRooms() {
  return [...rooms.values()].map((r) => ({ code: r.code, players: r.players.size, host: !!r.host }));
}

function createRoom(preferred) {
  let code = preferred && /^[A-Z]{4}$/.test(preferred) && !rooms.has(preferred) ? preferred : null;
  while (!code || rooms.has(code)) code = makeRoomCode();
  const room = { code, host: null, players: new Map(), nextId: 1, createdAt: Date.now() };
  rooms.set(code, room);
  return room;
}

function freeSlot(room) {
  const used = new Set([...room.players.values()].map((p) => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function publicPlayer(p) {
  return { playerId: p.id, slot: p.slot, name: p.name, color: p.color, avatar: p.avatar || null, connected: p.connected };
}

export function attach(ws) {
  ws.role = null;
  ws.room = null;
  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    handle(ws, msg);
  });
  ws.on('close', () => onClose(ws));
}

function handle(ws, msg) {
  switch (msg.type) {
    case MSG.PING:
      return send(ws, { type: MSG.PONG, t: msg.t });
    case MSG.HOST: {
      let room = msg.room && rooms.get(msg.room);
      if (!room) room = createRoom(msg.room);
      if (room.host && room.host !== ws) send(room.host, { type: MSG.ERROR, code: 'replaced' });
      room.host = ws;
      ws.role = 'host';
      ws.room = room;
      send(ws, { type: MSG.HOSTED, room: room.code, players: [...room.players.values()].map(publicPlayer) });
      return;
    }
    case MSG.JOIN: {
      const code = String(msg.room || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: MSG.ERROR, code: 'no_room', message: `Room ${code} not found` });
      let p = msg.clientId && [...room.players.values()].find((x) => x.clientId === msg.clientId);
      if (p) {
        if (p.ws && p.ws !== ws) p.ws.close();
      } else {
        const slot = freeSlot(room);
        if (slot < 0) return send(ws, { type: MSG.ERROR, code: 'full', message: 'Room is full' });
        p = { id: `p${room.nextId++}`, slot, clientId: msg.clientId };
        room.players.set(p.id, p);
      }
      p.ws = ws;
      p.name = String(msg.name || 'Player').slice(0, 12);
      p.color = msg.color || '#19b8ff';
      p.connected = true;
      ws.role = 'player';
      ws.room = room;
      ws.player = p;
      send(ws, { type: MSG.JOINED, playerId: p.id, slot: p.slot, room: room.code, avatar: p.avatar || null });
      send(room.host, { type: MSG.PLAYER_JOINED, ...publicPlayer(p) });
      return;
    }
    default:
      break;
  }

  const room = ws.room;
  if (!room) return;

  if (ws.role === 'player') {
    // phone -> host relay; tag with player id
    if (msg.type === MSG.INPUT || msg.type === MSG.EVENT || msg.type === MSG.PLAYER_UPDATE) {
      msg.pid = ws.player.id;
      if (msg.type === MSG.PLAYER_UPDATE) {
        if (msg.name) ws.player.name = String(msg.name).slice(0, 12);
        if (msg.color) ws.player.color = msg.color;
        msg.playerId = ws.player.id;
      }
      send(room.host, msg);
    }
    return;
  }

  if (ws.role === 'host') {
    // host -> phones relay
    if (msg.type === MSG.SCREEN || msg.type === MSG.HAPTIC) {
      const data = JSON.stringify(msg);
      for (const p of room.players.values()) {
        if (msg.to && msg.to !== 'all' && msg.to !== p.id) continue;
        send(p.ws, data);
      }
    } else if (msg.type === 'kick' && msg.playerId) {
      const p = room.players.get(msg.playerId);
      if (p) {
        room.players.delete(p.id);
        p.ws?.close();
      }
    }
  }
}

function onClose(ws) {
  const room = ws.room;
  if (!room) return;
  if (ws.role === 'host' && room.host === ws) {
    room.host = null;
  } else if (ws.role === 'player' && ws.player && ws.player.ws === ws) {
    ws.player.connected = false;
    ws.player.ws = null;
    send(room.host, { type: MSG.PLAYER_LEFT, playerId: ws.player.id });
  }
}

/** Push an avatar update for a player (called by the avatar service). */
export function setPlayerAvatar(code, playerId, avatar) {
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(playerId);
  if (p) p.avatar = avatar;
  send(room.host, { type: MSG.AVATAR_STATUS, playerId, ...avatar });
  if (p) send(p.ws, { type: MSG.AVATAR_STATUS, playerId, ...avatar });
}

// Garbage-collect empty rooms after 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const empty = !r.host && ![...r.players.values()].some((p) => p.connected);
    if (empty && now - r.createdAt > 2 * 3600e3) rooms.delete(code);
  }
}, 60e3).unref();
