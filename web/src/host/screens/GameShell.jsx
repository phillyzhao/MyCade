// Shared game flow: intro card -> 3-2-1 -> play -> results card -> back to menu.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MODE } from '@shared/protocol.js';
import { useHost, GAMES, activePlayers } from '../store.js';
import { onPlayerEvent } from '../input.js';
import { sendScreen } from '../net.js';
import { sound } from '../../sound.js';
import { confetti, popup } from '../../ui/fx.jsx';
import { rankBy, PLACE_POINTS } from '../rivalry.js';
import { AvatarHead } from './PlayerBadge.jsx';

const LOADERS = {
  bowling: lazy(() => import('../../games/bowling/Bowling.jsx')),
  balance: lazy(() => import('../../games/balance/Balance.jsx')),
  racing: lazy(() => import('../../games/racing/Racing.jsx')),
  tennis: lazy(() => import('../../games/tennis/Tennis.jsx')),
};

const HOW = {
  bowling: { motion: 'bowl', lines: ['Tilt your phone left/right to line up', 'Hold A, swing your arm back then forward', 'Let go of A to release. Twist your wrist for spin!'] },
  balance: { motion: 'tilt', lines: ['Hold your phone flat', 'Tilt it to tilt your floating island', 'Keep your marble on. Last one standing wins!'] },
  racing: { motion: 'wheel', lines: ['Hold your phone sideways like a wheel', 'Right side = gas, left side = brake', 'Shake when the boost meter is full!'] },
  tennis: { motion: 'swing', lines: ['Your player runs to the ball for you', 'Swing your phone like a racket when it arrives', 'Swing fast and downward to SMASH. Flick up to toss your serve.'] },
};

function MotionLoop({ kind }) {
  return (
    <div className={`motion-loop ml-${kind}`}>
      <div className="ml-phone">
        <div className="ml-screen">
          <span>A</span>
        </div>
      </div>
      <div className="ml-trail" />
    </div>
  );
}

export default function GameShell() {
  const gameId = useHost((s) => s.game);
  const room = useHost((s) => s.room);
  const players = useHost((s) => s.players);
  const [phase, setPhase] = useState('intro'); // intro | countdown | play | results
  const [count, setCount] = useState(3);
  const [result, setResult] = useState(null);
  const [commentary, setCommentary] = useState(null);
  const [roster] = useState(() => activePlayers(useHost.getState().players));
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const meta = GAMES.find((g) => g.id === gameId);
  const Game = LOADERS[gameId];

  // keep avatar updates flowing into the roster (Buddies swap in live)
  const liveRoster = roster.map((r) => players.find((p) => p.id === r.id) || r);

  const startCountdown = useCallback(() => {
    if (phaseRef.current !== 'intro') return;
    setPhase('countdown');
    setCount(3);
    sound.sfx('countdown');
  }, []);

  useEffect(() => {
    sound.music(gameId);
    sendScreen('all', { mode: MODE.WAIT, prompt: 'Press A when you are ready!', game: gameId });
    const t = setTimeout(startCountdown, 9000);
    return () => clearTimeout(t);
  }, [gameId, startCountdown]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count === 0) {
      sound.sfx('go');
      popup({ text: 'GO!', kind: 'good', duration: 900 });
      setPhase('play');
      return;
    }
    const t = setTimeout(() => {
      setCount((c) => c - 1);
      if (count - 1 > 0) sound.sfx('countdown');
    }, 800);
    return () => clearTimeout(t);
  }, [phase, count]);

  useEffect(
    () =>
      onPlayerEvent((pid, ev) => {
        if (!(ev.kind === 'press' && ev.button === 'a' && ev.down)) return;
        if (phaseRef.current === 'intro') startCountdown();
        else if (phaseRef.current === 'results') {
          sound.sfx('select');
          useHost.getState().setScreen('menu');
        }
      }),
    [startCountdown],
  );

  const onDone = useCallback(
    (res) => {
      if (phaseRef.current === 'results') return;
      const ranked = rankBy(
        res.standings.map((s) => ({ ...s })),
        res.higherIsBetter !== false,
      ).map((s) => {
        const p = roster.find((r) => r.id === s.pid) || {};
        return { ...s, name: p.name, color: p.color };
      });
      const match = { id: `m${Date.now()}`, room, game: gameId, standings: ranked, records: res.records || {}, highlights: res.highlights || [], at: Date.now() };
      useHost.getState().addMatch(match);
      fetch('/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(match) }).catch(() => {});
      setResult(match);
      setPhase('results');
      fetch('/api/commentary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: gameId, standings: ranked.map((s) => ({ ...s, cpu: roster.find((r) => r.id === s.pid)?.cpu })), highlights: res.highlights || [] }),
      })
        .then((r) => r.json())
        .then((d) => d.line && setCommentary(d.line))
        .catch(() => {});
      sound.music('results');
      sound.sting('victory');
      confetti({ count: 220 });
      setTimeout(() => confetti({ count: 120, x: 0.2 }), 500);
      setTimeout(() => confetti({ count: 120, x: 0.8 }), 900);
      const winner = ranked[0];
      for (const p of roster) {
        const mine = ranked.find((s) => s.pid === p.id);
        sendScreen(p.id, {
          mode: MODE.RESULTS,
          prompt: mine?.rank === 1 ? 'You WON! 🏆' : `You placed #${mine?.rank ?? '-'}`,
          sub: 'Press A to continue',
        });
      }
      if (winner) popup({ text: `${winner.name} wins!`, kind: 'gold', duration: 2200 });
    },
    [roster, room, gameId],
  );

  const how = HOW[gameId];
  return (
    <div className="gameshell">
      <div className="game-stage">
        <Suspense fallback={<div className="boot">loading {meta?.title}…</div>}>
          {Game && <Game players={liveRoster} playing={phase === 'play'} phase={phase} onDone={onDone} />}
        </Suspense>
      </div>

      {phase === 'intro' && (
        <div className="overlay">
          <div className="intro-card glass bounce-in" style={{ '--tc': meta?.color }}>
            <div className="intro-head burst">
              <div className="intro-tag">{meta?.tag}</div>
              <h1 className="display-title intro-title">{meta?.title?.toUpperCase()}!</h1>
            </div>
            <div className="intro-body">
              <MotionLoop kind={how.motion} />
              <ol className="howto">
                {how.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ol>
            </div>
            <div className="intro-foot">
              <div className="intro-players">
                {roster.map((p) => (
                  <AvatarHead key={p.id} player={p} size={44} />
                ))}
              </div>
              <button className="gloss-btn green" onClick={startCountdown}>
                Press A to start
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'countdown' && count > 0 && (
        <div className="overlay countdown" key={count}>
          <div className="count-num">{count}</div>
        </div>
      )}

      {phase === 'results' && result && (
        <div className="overlay">
          <div className="results-card glass bounce-in">
            <h2 className="display-title results-title">RESULTS!</h2>
            <ol className="results-list">
              {result.standings.map((s, i) => (
                <li key={s.pid} className={`rrow r${s.rank}`} style={{ '--pc': s.color, animationDelay: `${0.15 + i * 0.12}s` }}>
                  <span className="rmedal">{s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank}</span>
                  <AvatarHead player={roster.find((r) => r.id === s.pid) || s} size={48} />
                  <span className="rname">{s.name}</span>
                  <span className="rscore">{s.label ?? s.score}</span>
                  <span className="rpts">+{PLACE_POINTS[s.rank - 1] || 0}</span>
                </li>
              ))}
            </ol>
            {commentary && (
              <div className="commentary">
                <span className="pixel">COMMENTATOR</span>
                {commentary}
              </div>
            )}
            {result.highlights?.length > 0 && (
              <div className="highlights">
                {result.highlights.map((h) => (
                  <div key={h} className="chip">
                    ⭐ {h}
                  </div>
                ))}
              </div>
            )}
            <button className="gloss-btn" onClick={() => useHost.getState().setScreen('menu')}>
              Press A to continue
            </button>
          </div>
        </div>
      )}
      {phase !== 'results' && (
        <button className="quit-btn gloss-btn silver small" onClick={() => useHost.getState().setScreen('menu')}>
          ✕ Quit
        </button>
      )}
    </div>
  );
}
