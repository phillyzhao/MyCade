import { useEffect, useRef, useState } from 'react';
import { useHost, GAMES, activePlayers } from '../store.js';
import { onPlayerEvent } from '../input.js';
import { sound } from '../../sound.js';
import { leaderboard, headToHead, rivalryLine } from '../rivalry.js';
import { addCpu } from './Lobby.jsx';

function TileArt({ id }) {
  // looping CSS mini-scenes, one per channel
  if (id === 'bowling')
    return (
      <div className="art art-bowling">
        <div className="lane" />
        <div className="pins">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} />
          ))}
        </div>
        <div className="ball" />
      </div>
    );
  if (id === 'balance')
    return (
      <div className="art art-balance">
        <div className="isle">
          <div className="marble" />
        </div>
        <div className="isle small">
          <div className="marble" />
        </div>
      </div>
    );
  if (id === 'racing')
    return (
      <div className="art art-racing">
        <div className="track" />
        <div className="kart k1" />
        <div className="kart k2" />
        <div className="kart k3" />
      </div>
    );
  return (
    <div className="art art-tennis">
      <div className="court" />
      <div className="net" />
      <div className="tball" />
    </div>
  );
}

export default function Menu() {
  const players = useHost((s) => s.players);
  const matches = useHost((s) => s.matches);
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(0);
  focusRef.current = focus;
  const act = activePlayers(players);

  const launch = (i) => {
    const g = GAMES[i];
    // Mystery Stack rules: every game is played with at least 4; CPUs fill empty seats
    const have = activePlayers(useHost.getState().players).length;
    for (let i = have; i < 4; i++) addCpu();
    sound.sfx('select');
    useHost.getState().setScreen('game', { game: g.id });
  };

  useEffect(
    () =>
      onPlayerEvent((pid, ev) => {
        if (ev.kind === 'nav') {
          const cols = 2;
          let f = focusRef.current;
          if (ev.dir === 1 || ev.dir === -1) f = (f + ev.dir + GAMES.length) % GAMES.length;
          if (ev.dir === 'up' || ev.dir === 'down') f = (f + cols) % GAMES.length;
          setFocus(f);
          sound.sfx('tick');
        }
        if (ev.kind === 'press' && ev.button === 'a' && ev.down) launch(focusRef.current);
        if (ev.kind === 'press' && ev.button === 'b' && ev.down) useHost.getState().setScreen('lobby');
      }),
    [],
  );

  const board = leaderboard(matches, act);
  const h2h = headToHead(matches).slice(0, 3);

  return (
    <div className="menu fade-in">
      <div className="menu-main">
      <div className="menu-head">
        <h1 className="display-title">PICK A GAME!</h1>
        <span className="pixel">tilt or ◀ ▶ on your phone · A to play</span>
      </div>
      <div className="tiles">
        {GAMES.map((g, i) => (
          <button
            key={g.id}
            className={`tile glass wobble ${focus === i ? 'focus' : ''}`}
            style={{ '--tc': g.color, animationDelay: `${i * 0.07}s` }}
            onMouseEnter={() => focus !== i && (setFocus(i), sound.sfx('tick'))}
            onClick={() => launch(i)}
          >
            <div className="art-wrap" style={{ position: 'relative', flex: 1, display: 'flex', minHeight: 0 }}>
              <div className="tile-tag">{g.tag}</div>
              <TileArt id={g.id} />
            </div>
            <div className="tile-label">
              <i className="stick" />
              <div className="tile-text">
                <div className="tile-title">{g.title}</div>
                <div className="tile-meta">{g.players}</div>
              </div>
              <i className="btns" />
            </div>
          </button>
        ))}
      </div>
      </div>
      <aside className="side glass">
        <h3>Session standings</h3>
        {board.length === 0 && <p className="muted">Play a game to start the rivalry.</p>}
        <ol className="board">
          {board.map((r, i) => (
            <li key={r.name}>
              <span className="rank">{i + 1}</span>
              <span className="player-dot" style={{ '--pc': r.color }} />
              <span className="bname">{r.name}</span>
              <span className="bpts">{r.points}</span>
            </li>
          ))}
        </ol>
        {h2h.length > 0 && (
          <>
            <h4>Rivalries</h4>
            {h2h.map((r) => (
              <div key={r.leader + r.trailer} className="rival">
                {rivalryLine(r)}
              </div>
            ))}
          </>
        )}
        <div className="side-actions">
          <button className="gloss-btn silver small" onClick={() => useHost.getState().setScreen('lobby')}>
            ◀ Lobby
          </button>
          <button className="gloss-btn orange small" disabled={!matches.length} onClick={() => useHost.getState().setScreen('podium')}>
            🏆 CHAMPION
          </button>
        </div>
        <div className="hint">{GAMES[focus].motion}</div>
      </aside>
    </div>
  );
}
