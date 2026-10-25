// Press D on the host: live graphs of every player's motion for fast threshold tuning.
import { useEffect, useRef, useState } from 'react';
import { useHost, activePlayers } from '../store.js';
import { getInput, onPlayerEvent } from '../input.js';

function Graph({ pid, color }) {
  const ref = useRef();
  useEffect(() => {
    let raf;
    const draw = () => {
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const W = cv.width;
      const H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(0,20,40,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      const s = getInput(pid);
      const hist = s.history;
      const series = [
        ['tx', '#ff6b6b', 1],
        ['ty', '#6bff95', 1],
        ['st', '#ffd23f', 1],
        ['lin', '#5ec8ff', 1 / 40],
        ['gyro', '#d38bff', 1 / 800],
      ];
      for (const [k, c, sc] of series) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        hist.forEach((h, i) => {
          const x = (i / 180) * W;
          const v = h[k] * sc;
          const y = k === 'lin' || k === 'gyro' ? H - v * H : H / 2 - v * (H / 2.2);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [pid]);
  return <canvas ref={ref} width={360} height={110} style={{ borderLeft: `4px solid ${color}`, display: 'block' }} />;
}

export default function DebugOverlay() {
  const players = useHost((s) => s.players);
  const [log, setLog] = useState([]);
  const [, force] = useState(0);
  useEffect(() => {
    const off = onPlayerEvent((pid, ev) => {
      if (ev.kind === 'press') return;
      setLog((l) => [`${pid} ${ev.kind} ${ev.power != null ? `p=${ev.power.toFixed(2)}` : ''} ${ev.spin != null ? `spin=${ev.spin.toFixed(2)}` : ''}${ev.twist != null ? ` tw=${ev.twist.toFixed(2)}` : ''}${ev.dir != null ? ` dir=${ev.dir}` : ''}${ev.smash ? ' SMASH' : ''}`, ...l].slice(0, 10));
    });
    const iv = setInterval(() => force((x) => x + 1), 250);
    return () => {
      off();
      clearInterval(iv);
    };
  }, []);
  return (
    <div className="debug">
      <div className="debug-title">Motion debug (D) · red tiltX · green tiltY · yellow steer · blue accel · purple gyro</div>
      {activePlayers(players)
        .filter((p) => !p.cpu)
        .map((p) => {
          const s = getInput(p.id);
          const age = performance.now() - s.recv;
          return (
            <div key={p.id} className="debug-row">
              <div className="debug-label">
                {p.name} · {s.recv ? `${age.toFixed(0)}ms ago` : 'no input'} · rtt {s.rtt != null ? `${s.rtt.toFixed(0)}ms` : '-'} · A {s.buttons?.a ? '●' : '○'}
              </div>
              <Graph pid={p.id} color={p.color} />
            </div>
          );
        })}
      <div className="debug-log">
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
