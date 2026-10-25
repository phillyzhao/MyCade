// Wire protocol shared by host, controller and server. All messages are JSON {type, ...}.

export const MSG = {
  // phone -> server
  JOIN: 'join', // {room, name, color, clientId}
  // server -> phone
  JOINED: 'joined', // {playerId, slot, room}
  // phone -> host (relayed)
  INPUT: 'input', // continuous state, ~60 Hz: {t, tilt:{x,y}, steer, accel, rot, g, buttons:{a,b}, gas, brake}
  EVENT: 'event', // discrete motion event: {kind:'swing'|'release'|'shake'|'flick'|'press'|'nav', ...}
  // host -> server
  HOST: 'host', // {room?} create/reclaim a room
  HOSTED: 'hosted', // {room, url}
  // host -> phone(s) (relayed)
  SCREEN: 'screen', // {mode, prompt, color, turn, ...}
  HAPTIC: 'haptic', // {pattern:number[]}
  // server -> host
  PLAYER_JOINED: 'player_joined', // {playerId, slot, name, color}
  PLAYER_LEFT: 'player_left', // {playerId}
  PLAYER_UPDATE: 'player_update', // {playerId, name?, color?, avatar?}
  AVATAR_STATUS: 'avatar_status', // {playerId, status, url?, image?}
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
};

// Phone screen modes the host can put a controller into.
export const MODE = {
  LOBBY: 'lobby',
  MENU: 'menu',
  WAIT: 'wait',
  BOWL: 'bowl',
  TENNIS: 'tennis',
  RACE: 'race',
  BALANCE: 'balance',
  RESULTS: 'results',
};

export const PLAYER_COLORS = [
  { id: 'aqua', hex: '#19b8ff', name: 'Aqua' },
  { id: 'lime', hex: '#62d321', name: 'Lime' },
  { id: 'coral', hex: '#ff5a5f', name: 'Coral' },
  { id: 'sun', hex: '#ffbf1f', name: 'Sun' },
  { id: 'grape', hex: '#a35cff', name: 'Grape' },
  { id: 'pink', hex: '#ff6fcf', name: 'Pink' },
  { id: 'mint', hex: '#2fe0b5', name: 'Mint' },
  { id: 'orange', hex: '#ff8a1f', name: 'Orange' },
];

export const MAX_PLAYERS = 8;

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}
