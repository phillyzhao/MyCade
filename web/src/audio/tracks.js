// Original compositions, written as compact note strings and compiled into a single looping Tone.Part per track.
//
// Notation for mel(): space separated tokens, one per step (default step = 8th note = 2 sixteenths).
//   "C5" note, "C4+E4+G4" chord, "-" tie/extend previous, "." rest, "|" bar separator (ignored).
import * as Tone from 'tone';

const pos = (s) => `${Math.floor(s / 16)}:${Math.floor((s % 16) / 4)}:${s % 4}`;
const len = (n) => `0:0:${n}`;
const up = (note, oct = 1) => note.replace(/(-?\d+)$/, (d) => String(+d + oct));
const humanize = (v) => Math.max(0.05, Math.min(1, v + (Math.random() - 0.5) * 0.08));

function mel(out, i, startBar, str, { step = 2, vel = 0.7, hold = null, oct = 0 } = {}) {
  const toks = str.replace(/\|/g, ' ').trim().split(/\s+/);
  let s = startBar * 16;
  let cur = null;
  for (const t of toks) {
    if (t === '-') { if (cur && hold == null) cur.n += step; }
    else if (t === '.') { cur = null; }
    else {
      let note = t.includes('+') ? t.split('+') : t;
      if (oct) note = Array.isArray(note) ? note.map((n) => up(n, oct)) : up(note, oct);
      cur = { i, s, n: hold ?? step, note, vel };
      out.push(cur);
    }
    s += step;
  }
}

// chords: per bar either an array of notes or {a, b} (first / second half of bar)
function comp(out, i, startBar, chords, hits, { vel = 0.5, oct = 0 } = {}) {
  chords.forEach((c, b) => {
    for (const [s, n] of hits) {
      let notes = Array.isArray(c) ? c : (s < 8 ? c.a : c.b);
      if (oct) notes = notes.map((x) => up(x, oct));
      out.push({ i, s: (startBar + b) * 16 + s, n, note: notes, vel });
    }
  });
}

function pad(out, i, startBar, chords, { vel = 0.4 } = {}) {
  chords.forEach((c, b) => {
    if (Array.isArray(c)) out.push({ i, s: (startBar + b) * 16, n: 16, note: c, vel });
    else {
      out.push({ i, s: (startBar + b) * 16, n: 8, note: c.a, vel });
      out.push({ i, s: (startBar + b) * 16 + 8, n: 8, note: c.b, vel });
    }
  });
}

function arp(out, i, startBar, chords, order, { step = 2, vel = 0.4, oct = 0, hold = null } = {}) {
  chords.forEach((c, b) => {
    for (let k = 0, s = 0; s < 16; k++, s += step) {
      const notes = Array.isArray(c) ? c : (s < 8 ? c.a : c.b);
      let note = notes[order[k % order.length] % notes.length];
      if (oct) note = up(note, oct);
      out.push({ i, s: (startBar + b) * 16 + s, n: hold ?? step, note, vel });
    }
  });
}

// 16-char-per-bar pattern: x = accent, o = soft, . = rest. Pattern repeats to fill `bars`.
function drums(out, i, startBar, bars, pattern, { vel = 0.8, note = 'C1', n = 1 } = {}) {
  const p = pattern.replace(/[\s|]/g, '');
  for (let s = 0; s < bars * 16; s++) {
    const ch = p[s % p.length];
    if (ch === 'x' || ch === 'o') out.push({ i, s: startBar * 16 + s, n, note, vel: ch === 'x' ? vel : vel * 0.45 });
  }
}

// ---------------------------------------------------------------- MENU (F major, 96)
function menu() {
  const ev = [];
  const ch = [
    ['A3', 'C4', 'E4', 'G4'],        // Fmaj9
    ['G3', 'A3', 'C4', 'E4'],        // Am7
    ['A3', 'Bb3', 'D4', 'F4'],       // Bbmaj7
    ['G3', 'A3', 'D4', 'E4'],        // C6/9
    ['F3', 'A3', 'C4', 'E4'],        // Dm9
    ['Bb3', 'D4', 'F4', 'A4'],       // Gm9
    ['A3', 'C4', 'D4', 'F4'],        // Bbmaj9
    ['Bb3', 'D4', 'F4', 'G4'],       // C9sus
  ];
  const ch16 = [...ch, ...ch];
  pad(ev, 'pad', 0, ch16, { vel: 0.35 });
  comp(ev, 'keys', 0, ch16, [[0, 5], [6, 3], [10, 5]], { vel: 0.38 });
  const bass = 'F2 - - - C3 - - E2 | A2 - - - E3 - - A2 | Bb2 - - - F2 - - Bb2 | C3 - - - G2 - A2 B2 | D3 - - - A2 - - D3 | G2 - - - D3 - - F2 | Bb2 - - - F3 - - D3 | C3 - - - G2 - C3 E2';
  mel(ev, 'bass', 0, bass, { vel: 0.75 });
  mel(ev, 'bass', 8, bass, { vel: 0.75 });
  mel(ev, 'mallet', 0,
    'C5 . F5 G5 A5 . G5 . | E5 - - C5 E5 . G5 . | F5 - D5 . A4 . C5 D5 | E5 - - - D5 . . . | ' +
    'A5 . G5 F5 E5 . F5 . | D5 - - Bb4 D5 . F5 . | A5 - G5 . F5 . D5 . | G5 - - - - . . .', { vel: 0.75 });
  mel(ev, 'vibes', 8,
    'A5 - G5 F5 C5 . A4 C5 | E5 - - - G5 - E5 . | D5 - F5 . A5 - G5 F5 | E5 - G5 - A5 - - . | ' +
    'C6 - A5 . F5 . A5 . | Bb5 - A5 G5 F5 - D5 . | C5 D5 F5 - A5 - G5 F5 | G5 - - - . . . .', { vel: 0.7 });
  // soft counter-arpeggio under the vibes half
  arp(ev, 'mallet', 8, ch, [0, 2, 1, 3], { step: 4, vel: 0.28, oct: 1, hold: 2 });
  for (const b of [3, 7, 11, 15]) mel(ev, 'bells', b, '. . . . . . . . . . . . G5 A5 C6 E6', { step: 1, vel: 0.5, hold: 3 });
  drums(ev, 'kick', 0, 16, 'x.........x.....', { vel: 0.55 });
  drums(ev, 'snare', 0, 16, '....o.......o...', { vel: 0.5 });
  drums(ev, 'hat', 0, 16, 'o.x.o.x.o.x.o.x.', { vel: 0.35 });
  return { bpm: 96, swing: 0.12, bars: 16, events: ev };
}

// ---------------------------------------------------------------- BOWLING (Eb major lounge, 92, swung)
function bowling() {
  const ev = [];
  const ch = [
    ['G3', 'Bb3', 'D4', 'F4'],                          // Ebmaj9
    ['Eb3', 'G3', 'Bb3', 'D4'],                         // Cm9
    ['Ab3', 'C4', 'Eb4', 'G4'],                         // Fm9
    ['Ab3', 'D4', 'G4'],                                // Bb13
    { a: ['F3', 'Bb3', 'D4'], b: ['E3', 'Bb3', 'D4'] }, // Gm7  C9
    { a: ['Ab3', 'C4', 'Eb4'], b: ['Ab3', 'D4', 'F4'] }, // Fm7  Bb7
    ['G3', 'C4', 'F4'],                                 // Eb6/9
    { a: ['Ab3', 'C4', 'Eb4', 'G4'], b: ['Ab3', 'D4', 'F4'] }, // Fm9 Bb7
  ];
  const ch16 = [...ch, ...ch];
  comp(ev, 'keys', 0, ch16, [[0, 3], [6, 2], [10, 3]], { vel: 0.42 });
  pad(ev, 'pad', 0, ch16, { vel: 0.18 });
  const walk = 'Eb2 G2 Bb2 D3 | C3 Bb2 G2 Eb2 | F2 Ab2 C3 A2 | Bb2 D3 F2 Ab2 | G2 Bb2 C3 E2 | F2 Ab2 Bb2 D2 | Eb2 G2 C3 Bb2 | F2 C3 Bb2 E2';
  mel(ev, 'bass', 0, walk, { step: 4, hold: 3, vel: 0.8 });
  mel(ev, 'bass', 8, walk, { step: 4, hold: 3, vel: 0.8 });
  mel(ev, 'vibes', 0,
    '. Bb4 D5 F5 G5 - F5 D5 | Eb5 - - C5 . . D5 Eb5 | F5 . Ab5 G5 F5 - Eb5 C5 | D5 - - - . G4 A4 . | ' +
    'Bb4 D5 F5 E5 - D5 C5 Bb4 | Ab4 C5 Eb5 - D5 - C5 . | Bb4 - G4 . C5 . Eb5 . | D5 - - - . . . .', { vel: 0.75 });
  mel(ev, 'vibes', 8,
    'G5 - F5 D5 Bb4 - G4 . | Eb5 D5 C5 Bb4 G4 - - . | Ab4 C5 Eb5 G5 - F5 Eb5 C5 | D5 - F5 - Ab5 - G5 . | ' +
    'F5 D5 Bb4 G4 E5 - C5 . | Eb5 - C5 Ab4 F5 - D5 . | G5 - Eb5 - C5 - Bb4 G4 | Bb4 - - - . . . .', { vel: 0.72 });
  for (const b of [7, 15]) mel(ev, 'bells', b, '. . . . . Bb5 D6 F6', { vel: 0.4, hold: 3 });
  drums(ev, 'kick', 0, 16, 'o.......o.......', { vel: 0.5 });
  drums(ev, 'snare', 0, 16, '....x.......x...', { vel: 0.6, n: 3 });
  drums(ev, 'hat', 0, 16, 'x...x.o.x...x.o.', { vel: 0.4 });
  return { bpm: 92, swing: 0.55, bars: 16, events: ev };
}

// ---------------------------------------------------------------- TENNIS (D major, 124)
function tennis() {
  const ev = [];
  const ch = [
    ['F#4', 'A4', 'C#5'],          // Dmaj7
    ['D4', 'F#4', 'A4'],           // Bm7
    ['F#4', 'A4', 'B4'],           // Gmaj9
    ['C#4', 'E4', 'F#4', 'B4'],    // A6/9
    ['F#4', 'A4', 'C#5'],          // Dmaj7
    ['E4', 'A4', 'C#5'],           // F#m7
    ['F#4', 'B4', 'D5'],           // Gmaj7
    ['D4', 'G4', 'A4'],            // A7sus4
  ];
  const ch16 = [...ch, ...ch];
  pad(ev, 'pad', 0, ch16.map((c) => c.map((n) => up(n, -1))), { vel: 0.3 });
  comp(ev, 'keys', 0, ch16, [[2, 1], [6, 1], [10, 1], [14, 1]], { vel: 0.4 });
  const bass = 'D2 . D3 D2 . D2 D3 . | B1 . B2 B1 . B1 B2 . | G2 . G3 G2 . G2 G3 . | A2 . A3 A2 . A2 E3 . | D2 . D3 D2 . D2 D3 . | F#2 . F#3 F#2 . F#2 C#3 . | G2 . G3 G2 . G2 G3 . | A2 . A3 A2 . G2 A2 C#3';
  mel(ev, 'bass', 0, bass, { hold: 1, vel: 0.8 });
  mel(ev, 'bass', 8, bass, { hold: 1, vel: 0.8 });
  mel(ev, 'bells', 0,
    'F#5 . A5 . D6 - C#6 A5 | B5 - - A5 F#5 . D5 . | E5 F#5 A5 - B5 . A5 . | F#5 - E5 - . . . . | ' +
    'F#5 . A5 . E6 - D6 C#6 | A5 - - F#5 C#6 - A5 . | B5 A5 G5 F#5 E5 . D5 E5 | D5 - E5 - A5 - - .', { vel: 0.95 });
  arp(ev, 'mallet', 0, ch, [0, 1, 2, 1, 2, 0, 1, 2], { step: 2, vel: 0.3, hold: 1 });
  mel(ev, 'mallet', 8,
    'D5 F#5 A5 F#5 D6 - A5 . | B5 A5 F#5 D5 B4 - D5 . | G5 - B5 A5 F#5 - E5 . | C#5 E5 F#5 - E5 - . . | ' +
    'F#5 A5 D6 A5 F#5 A5 E6 . | C#6 - A5 F#5 E5 - C#5 . | D5 E5 F#5 G5 A5 B5 C#6 - | D6 - - - A5 - - .', { vel: 0.8 });
  arp(ev, 'bells', 8, ch, [2, 1, 0, 1], { step: 4, vel: 0.35, oct: 1, hold: 2 });
  drums(ev, 'kick', 0, 16, 'x.....x.x.......', { vel: 0.75 });
  drums(ev, 'snare', 0, 16, '....x.......x...', { vel: 0.7 });
  drums(ev, 'hat', 0, 16, 'o.x.o.x.o.x.o.xo', { vel: 0.45 });
  return { bpm: 124, swing: 0.08, bars: 16, events: ev };
}

// ---------------------------------------------------------------- RACING (E major, 150)
function racing() {
  const ev = [];
  const ch = [
    ['G#3', 'B3', 'D#4', 'F#4'],                          // Emaj9
    ['E3', 'G#3', 'B3', 'D#4'],                           // C#m9
    ['G#3', 'C#4', 'E4'],                                 // Amaj7
    ['F#3', 'G#3', 'B3', 'D#4'],                          // B6
    ['G#3', 'B3', 'C#4', 'E4'],                           // Amaj9
    ['F#3', 'B3', 'D#4'],                                 // B
    { a: ['F#3', 'B3', 'D#4'], b: ['E3', 'G#3', 'B3'] },  // G#m7  C#m7
    { a: ['E3', 'A3', 'C#4'], b: ['E3', 'F#3', 'A3', 'B3'] }, // F#m7  B7sus
  ];
  const roots = ['E2', 'C#2', 'A1', 'B1', 'A1', 'B1', { a: 'G#1', b: 'C#2' }, { a: 'F#1', b: 'B1' }];
  const ch16 = [...ch, ...ch];
  pad(ev, 'pad', 0, ch16, { vel: 0.32 });
  comp(ev, 'keys', 0, ch16, [[2, 1], [6, 1], [10, 1], [14, 1]], { vel: 0.33, oct: 1 });
  for (let rep = 0; rep < 2; rep++) {
    roots.forEach((r, b) => {
      for (let s = 0; s < 16; s += 2) {
        const root = typeof r === 'string' ? r : (s < 8 ? r.a : r.b);
        const note = (s === 6 || s === 14) ? up(root) : root;
        ev.push({ i: 'bass', s: (rep * 8 + b) * 16 + s, n: 1, note, vel: s % 4 === 0 ? 0.9 : 0.7 });
      }
    });
  }
  mel(ev, 'lead', 0,
    'E5 . B4 E5 G#5 - F#5 E5 | D#5 - E5 - G#5 - B5 - | C#6 - B5 A5 G#5 - E5 . | F#5 - G#5 - D#5 - B4 . | ' +
    'A5 . G#5 A5 C#6 - B5 A5 | B5 - F#5 - D#6 - B5 . | G#5 F#5 E5 D#5 E5 F#5 G#5 B5 | A5 - G#5 - F#5 - E5 F#5', { vel: 0.85 });
  mel(ev, 'bells', 0, 'E6 - - - - - - - | . . . . . . . . | C#6 - - - - - - - | . . . . . . . . | ' +
    'C#6 - - - - - - - | D#6 - - - - - - - | . . . . . . . . | . . . . . . . .', { vel: 0.4 });
  arp(ev, 'bells', 8, ch, [0, 1, 2, 3, 2, 1, 3, 2], { step: 1, vel: 0.42, oct: 1, hold: 1 });
  arp(ev, 'mallet', 8, ch, [3, 2, 1, 0], { step: 4, vel: 0.5, oct: 1, hold: 2 });
  drums(ev, 'kick', 0, 16, 'x...x...x...x...', { vel: 0.85 });
  drums(ev, 'snare', 0, 7, '....x.......x...', { vel: 0.75 });
  drums(ev, 'snare', 7, 1, '....x...x.x.xxxx', { vel: 0.75 });
  drums(ev, 'snare', 8, 7, '....x.......x...', { vel: 0.75 });
  drums(ev, 'snare', 15, 1, '....x...x.x.xxxx', { vel: 0.75 });
  drums(ev, 'hat', 0, 16, 'o.x.o.x.o.x.o.x.', { vel: 0.5 });
  return { bpm: 150, swing: 0, bars: 16, events: ev };
}

// ---------------------------------------------------------------- BALANCE (C major, 110, pizzicato)
function balance() {
  const ev = [];
  const ch = [
    ['E4', 'G4', 'B4'],     // Cmaj7
    ['E4', 'G4', 'A#4'],    // C#dim7
    ['F4', 'A4', 'C5'],     // Dm7
    ['F4', 'B4', 'D5'],     // G7
    ['G4', 'B4', 'D5'],     // Em7
    ['G4', 'A#4', 'C#5'],   // A7b9
    ['F4', 'A4', 'C5'],     // Dm7
    ['F4', 'C5', 'D5'],     // G7sus
  ];
  const ch16 = [...ch, ...ch];
  pad(ev, 'pad', 0, ch16.map((c) => c.map((n) => up(n, -1))), { vel: 0.25 });
  const bass = 'C3 G2 C3 G2 | C#3 G2 C#3 E3 | D3 A2 D3 A2 | G2 D3 G2 B2 | E3 B2 E3 B2 | A2 E3 A2 C#3 | D3 A2 D3 F3 | G2 D3 G2 D3';
  mel(ev, 'bass', 0, bass, { step: 4, hold: 1, vel: 0.8 });
  mel(ev, 'bass', 8, bass, { step: 4, hold: 1, vel: 0.8 });
  const tune = 'E5 . G5 . B5 . A5 G5 | G5 . E5 . C#5 . E5 G5 | F5 . A5 . C6 . A5 F5 | B4 . D5 F5 G5 - - . | ' +
    'G5 . B5 . E5 . G5 . | G5 . A#5 . A5 . E5 C#5 | D5 F5 A5 . G5 F5 E5 D5 | C5 . D5 . . G4 B4 D5';
  mel(ev, 'pizz', 0, tune, { hold: 1, vel: 0.85 });
  mel(ev, 'vibes', 8, tune, { vel: 0.55 });
  arp(ev, 'pizz', 8, ch, [0, 1, 2, 1], { step: 2, vel: 0.5, hold: 1 });
  // tick-tock clock
  mel(ev, 'mallet', 0, Array(16).fill('G5 D5 G5 D5').join(' | '), { step: 4, hold: 1, vel: 0.22 });
  drums(ev, 'kick', 0, 16, 'x.......x.......', { vel: 0.5 });
  drums(ev, 'snare', 0, 16, '....o.......o..o', { vel: 0.6 });
  return { bpm: 110, swing: 0.2, bars: 16, events: ev };
}

// ---------------------------------------------------------------- RESULTS (C major, 118, celebratory)
function results() {
  const ev = [];
  const ch = [
    ['E3', 'G3', 'B3', 'D4'],                                 // Cmaj9
    ['E3', 'G3', 'A3', 'C4'],                                 // Fmaj9
    ['F3', 'A3', 'C4', 'E4'],                                 // Dm9
    ['F3', 'B3', 'E4'],                                       // G13
    ['E3', 'G3', 'B3', 'D4'],                                 // Cmaj9
    ['G3', 'B3', 'C4', 'E4'],                                 // Am9
    { a: ['E3', 'A3', 'C4'], b: ['E3', 'G3', 'B3', 'D4'] },   // Fmaj7  G6
    ['E3', 'G3', 'C4', 'D4'],                                 // Cadd9
  ];
  const ch16 = [...ch, ...ch];
  pad(ev, 'pad', 0, ch16, { vel: 0.3 });
  comp(ev, 'keys', 0, ch16, [[0, 3], [6, 2], [10, 2], [14, 2]], { vel: 0.4, oct: 1 });
  const bass = 'C2 - . C3 . G2 B2 . | F2 - . F3 . C3 E2 . | D2 - . D3 . A2 C3 . | G2 - . G3 . D3 B2 . | C2 - . C3 . G2 B2 . | A2 - . A3 . E3 G2 . | F2 - . C3 G2 - . D3 | C2 - . G2 C3 - . G2';
  mel(ev, 'bass', 0, bass, { vel: 0.8 });
  mel(ev, 'bass', 8, bass, { vel: 0.8 });
  mel(ev, 'bells', 0,
    'G5 - C6 - E6 - D6 C6 | A5 - G5 A5 C6 - - . | F5 - E5 F5 A5 - G5 F5 | E5 - - D5 . . B4 D5 | ' +
    'G5 - C6 - E6 - G6 - | E6 - D6 C6 B5 - C6 . | A5 C6 A5 F5 G5 B5 D6 E6 | C6 - - - . . . .', { vel: 0.95 });
  mel(ev, 'mallet', 0,
    'E5 - G5 - C6 - B5 A5 | F5 - E5 F5 A5 - - . | D5 - C5 D5 F5 - E5 D5 | C5 - - B4 . . G4 B4 | ' +
    'E5 - G5 - C6 - E6 - | C6 - B5 A5 G5 - A5 . | F5 A5 F5 C5 D5 G5 B5 C6 | G5 - - - . . . .', { vel: 0.45 });
  mel(ev, 'vibes', 8,
    'E5 G5 C6 G5 E5 - D5 C5 | A5 - G5 - E5 - C5 . | D5 F5 A5 - C6 - A5 . | B5 - - G5 F5 - D5 . | ' +
    'E5 G5 B5 - D6 - B5 . | C6 - B5 A5 E5 - G5 . | F5 A5 C6 A5 G5 B5 D6 - | C6 - - - . . . .', { vel: 0.8 });
  arp(ev, 'mallet', 8, ch, [0, 2, 1, 3, 2, 1, 3, 2], { step: 2, vel: 0.3, oct: 1, hold: 1 });
  drums(ev, 'kick', 0, 16, 'x.....x.x.......', { vel: 0.8 });
  drums(ev, 'snare', 0, 16, '....x.......x...', { vel: 0.75 });
  drums(ev, 'hat', 0, 16, 'ooxoooxoooxoooxo', { vel: 0.4 });
  return { bpm: 118, swing: 0.1, bars: 16, events: ev };
}

export const TRACKS = { menu, bowling, tennis, racing, balance, results };

/**
 * Build a playable track. Returns { bpm, swing, start(), stop() }.
 * start() schedules the looping Part at transport position 0; the caller owns the transport.
 */
export function buildTrack(name, inst) {
  const def = TRACKS[name]?.();
  if (!def) return null;
  const events = def.events.map((e) => ({ ...e, time: pos(e.s), dur: len(e.n) }));
  const DRUM_NOISE = { snare: true, hat: true };
  const part = new Tone.Part((time, e) => {
    const x = inst[e.i];
    if (!x) return;
    try {
      if (DRUM_NOISE[e.i]) x.triggerAttackRelease(e.dur, time, humanize(e.vel));
      else x.triggerAttackRelease(e.note, e.dur, time, humanize(e.vel));
    } catch { /* voice stealing edge cases: ignore */ }
  }, events);
  part.loop = true;
  part.loopStart = 0;
  part.loopEnd = `${def.bars}m`;
  return {
    name,
    bpm: def.bpm,
    swing: def.swing,
    start() { inst.preset(name); part.start(0); },
    stop() {
      try { part.stop(); part.clear(); part.dispose(); } catch { /* ignore */ }
    },
  };
}
