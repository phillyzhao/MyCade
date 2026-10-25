// Shared visual effects: sky backdrop, bouncy popups, confetti, screen shake.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

export function ArcadeBackground() {
  return (
    <div className="arcade-bg" aria-hidden>
      <div className="tile-pattern" />
    </div>
  );
}

// ---------------- popups ----------------
const usePopups = create((set) => ({
  items: [],
  push: (p) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ items: [...s.items.slice(-2), { id, ...p }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), p.duration || 1700);
  },
}));

/** popup({text, sub, kind: 'gold'|'good'|'info'|'bad', duration, shake, confetti}) */
export function popup(p) {
  usePopups.getState().push(p);
  if (p.shake) screenShake();
  if (p.confetti) confetti(p.confetti === true ? {} : p.confetti);
}

export function PopupLayer() {
  const items = usePopups((s) => s.items);
  return (
    <div className="popup-layer">
      {items.map((p) => (
        <div
          key={p.id}
          className={`popup ${p.kind || 'gold'}`}
          style={{ animationDelay: `0s, ${((p.duration || 1700) - 350) / 1000}s`, top: p.top }}
        >
          <div className="big">{p.text}</div>
          {p.sub && <div className="sub">{p.sub}</div>}
          {(p.kind === 'gold' || p.kind === 'good' || !p.kind) &&
            Array.from({ length: 14 }, (_, i) => {
              const a = (i / 14) * Math.PI * 2;
              const r = 160 + (i % 3) * 70;
              return <span key={i} className="spark" style={{ '--dx': `${Math.cos(a) * r}px`, '--dy': `${Math.sin(a) * r * 0.6}px`, animationDelay: `${(i % 4) * 0.04}s` }} />;
            })}
        </div>
      ))}
    </div>
  );
}

export function screenShake() {
  const el = document.getElementById('stage');
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// ---------------- confetti ----------------
let confettiFire = null;
export function confetti(opts = {}) {
  confettiFire?.(opts);
}

const CONFETTI_COLORS = ['#ffd23a', '#ff2d2d', '#9dff3a', '#b04bff', '#ff7a1a', '#ffffff', '#19b8ff'];

export function ConfettiLayer() {
  const ref = useRef();
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    let parts = [];
    let raf = 0;
    const resize = () => {
      cv.width = innerWidth * devicePixelRatio;
      cv.height = innerHeight * devicePixelRatio;
    };
    resize();
    addEventListener('resize', resize);
    confettiFire = ({ count = 160, x = 0.5, y = 0.35, spread = 1 } = {}) => {
      const W = cv.width;
      const H = cv.height;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2 * spread;
        const v = (8 + Math.random() * 14) * devicePixelRatio;
        parts.push({
          x: x * W, y: y * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          w: (6 + Math.random() * 8) * devicePixelRatio, h: (8 + Math.random() * 10) * devicePixelRatio,
          r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: CONFETTI_COLORS[i % CONFETTI_COLORS.length], life: 0,
          bubble: Math.random() < 0.12,
        });
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts = parts.filter((p) => p.y < cv.height + 50 && p.life < 400);
      for (const p of parts) {
        p.life++;
        p.vy += 0.32 * devicePixelRatio;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.bubble) {
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, p.w, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(-p.w * 0.35, -p.w * 0.35, p.w * 0.25, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.rotate(p.r);
          ctx.scale(1, Math.cos(p.life * 0.15));
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      raf = parts.length ? requestAnimationFrame(tick) : 0;
    };
    return () => {
      removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
      confettiFire = null;
    };
  }, []);
  return <canvas ref={ref} className="confetti-canvas" style={{ width: '100%', height: '100%' }} />;
}
