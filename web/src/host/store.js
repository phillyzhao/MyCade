// Host-side app state. Fast-changing input lives in input.js (not React state).
import { create } from 'zustand';

export const GAMES = [
  { id: 'bowling', title: 'Strike Lanes', tag: 'Bowling', color: '#ff9a1f', players: '1-4 · turns', motion: 'Tilt to aim · hold A, swing, release' },
  { id: 'balance', title: 'Sky Wobble', tag: 'Balance', color: '#a35cff', players: '1-8 · all at once', motion: 'Tilt your phone to tilt your island' },
  { id: 'racing', title: 'Cloud Karts', tag: 'Racing', color: '#ff5a5f', players: '1-4 · all at once', motion: 'Hold sideways, steer like a wheel, shake to boost' },
  { id: 'tennis', title: 'Rally Court', tag: 'Tennis', color: '#62d321', players: '2-4 · doubles', motion: 'Swing like a racket when the ball arrives' },
];

export const useHost = create((set, get) => ({
  room: null,
  urls: [],
  urlIndex: 0,
  netStatus: 'connecting',
  players: [], // {id, slot, name, color, connected, avatar, cpu}
  screen: 'lobby', // lobby | menu | game | results | podium
  game: null,
  lastResult: null,
  matches: [], // results of this session
  debug: false,

  setRoom: (room) => set({ room }),
  setUrls: (urls) => set({ urls }),
  cycleUrl: () => set((s) => ({ urlIndex: (s.urlIndex + 1) % Math.max(1, s.urls.length) })),
  setNetStatus: (netStatus) => set({ netStatus }),
  upsertPlayer: (p) =>
    set((s) => {
      const i = s.players.findIndex((x) => x.id === p.id);
      const players = [...s.players];
      if (i >= 0) players[i] = { ...players[i], ...p };
      else players.push({ connected: true, avatar: null, ...p });
      players.sort((a, b) => a.slot - b.slot);
      return { players };
    }),
  removePlayer: (id) => set((s) => ({ players: s.players.filter((p) => p.id !== id) })),
  setScreen: (screen, extra = {}) => set({ screen, ...extra }),
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  addMatch: (m) => set((s) => ({ matches: [...s.matches, m], lastResult: m })),
  resetSession: () => set({ matches: [], lastResult: null }),
}));

export const activePlayers = (players) => players.filter((p) => p.connected || p.cpu).slice(0, 8);
