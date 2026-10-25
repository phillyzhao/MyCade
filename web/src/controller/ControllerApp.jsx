// Phone controller: join -> enable motion -> calibrate -> per-game controller UI. Streams input at 60 Hz.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MSG, MODE, PLAYER_COLORS } from '@shared/protocol.js';
import { MotionEngine } from '@shared/motion/index.js';
import { MOTION } from '@shared/config.js';
import { createSocket } from '../net/socket.js';
import { BRAND, AVATAR_NAME } from '../brand.js';
import './controller.css';

const ls = {
  get: (k, d) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

function clientId() {
  let id = ls.get('mp.cid');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    ls.set('mp.cid', id);
  }
  return id;
}

const r3 = (v) => Math.round((v || 0) * 1000) / 1000;

export default function ControllerApp({ room: initialRoom }) {
  const [room, setRoom] = useState(initialRoom || '');
  const [name, setName] = useState(() => ls.get('mp.name', ''));
  const [color, setColor] = useState(() => ls.get('mp.color', PLAYER_COLORS[Math.floor(Math.random() * 4)].hex));
  const [step, setStep] = useState('join'); // join | calibrate | play
  const [error, setError] = useState('');
  const [me, setMe] = useState(null); // {playerId, slot}
  const [screen, setScreen] = useState({ mode: MODE.LOBBY, prompt: 'Connecting…' });
  const [net, setNet] = useState('connecting');
  const [rtt, setRtt] = useState(null);
  const [virtual, setVirtual] = useState(false);
  const [avatar, setAvatar] = useState(null);
  const [flash, setFlash] = useState(null);
  const [aDown, setADown] = useState(false);
  const [, tick] = useState(0);

  const engine = useMemo(() => new MotionEngine(MOTION), []);
  const sockRef = useRef(null);
  const joinedRef = useRef(false);
  const meRef = useRef(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const pad = useRef({ gas: false, brake: false });
  const rttRef = useRef(null);
  const lastMotion = useRef(0);

  // ---- socket
  useEffect(() => {
    const sock = createSocket({
      onStatus: setNet,
      onOpen: () => {
        if (joinedRef.current) sendJoin();
      },
      onMessage: (msg) => {
        switch (msg.type) {
          case MSG.JOINED:
            meRef.current = msg;
            setMe(msg);
            if (msg.avatar) setAvatar(msg.avatar);
            setError('');
            break;
          case MSG.ERROR:
            setError(msg.message || msg.code);
            if (msg.code === 'no_room' || msg.code === 'full') {
              joinedRef.current = false;
              setStep('join');
            }
            break;
          case MSG.SCREEN: {
            const { type, to, ...s } = msg;
            setScreen((prev) => {
              return s;
            });
            if (s.flash) {
              setFlash({ text: s.flash, id: Date.now() });
              navigator.vibrate?.(60);
            }
            break;
          }
          case MSG.HAPTIC:
            navigator.vibrate?.(msg.pattern || 40);
            break;
          case MSG.AVATAR_STATUS: {
            const { type, playerId, ...a } = msg;
            setAvatar((prev) => ({ ...prev, ...a }));
            break;
          }
          case MSG.PONG:
            rttRef.current = performance.now() - msg.t;
            setRtt(rttRef.current);
            break;
          default:
            break;
        }
      },
    });
    sockRef.current = sock;
    const ping = setInterval(() => sock.send({ type: MSG.PING, t: performance.now() }, { queueIfClosed: false }), 2000);
    return () => {
      clearInterval(ping);
      sock.close();
    };
  }, []);

  const sendJoin = useCallback(() => {
    sockRef.current?.send({ type: MSG.JOIN, room: (room || '').toUpperCase(), name: (name || 'Player').trim(), color, clientId: clientId() });
  }, [room, name, color]);

  // ---- motion events -> host
  useEffect(() => {
    return engine.onEvent((ev) => {
      sockRef.current?.send({ type: MSG.EVENT, ...ev }, { queueIfClosed: false });
      if (ev.kind === 'swing') {
        setFlash({ text: ev.smash ? 'SMASH!' : ev.power > 0.7 ? 'POW!' : 'swing!', id: Date.now() });
        navigator.vibrate?.(ev.power > 0.7 ? [30, 20, 60] : 35);
      }
      if (ev.kind === 'release') navigator.vibrate?.(50);
      if (ev.kind === 'shake') {
        setFlash({ text: 'SHAKE!', id: Date.now() });
        navigator.vibrate?.([20, 20, 20]);
      }
    });
  }, [engine]);

  // ---- devicemotion
  const onMotion = useCallback(
    (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      lastMotion.current = performance.now();
      engine.feed({
        t: performance.now(),
        accG: { x: g.x, y: g.y, z: g.z },
        acc: e.acceleration && e.acceleration.x != null ? { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z } : null,
        rot: e.rotationRate ? { alpha: e.rotationRate.alpha || 0, beta: e.rotationRate.beta || 0, gamma: e.rotationRate.gamma || 0 } : null,
      });
    },
    [engine],
  );

  // ---- 60 Hz input stream
  useEffect(() => {
    if (step !== 'play') return;
    const iv = setInterval(() => {
      const s = sockRef.current;
      if (!s || !s.ready || s.buffered > 4096) return; // never queue stale input
      const st = engine.state;
      s.send(
        {
          type: MSG.INPUT,
          t: Date.now(),
          tilt: { x: r3(st.tilt.x), y: r3(st.tilt.y) },
          steer: r3(st.steer),
          lin: r3(st.lin),
          gyro: Math.round(st.gyro),
          rot: { alpha: Math.round(st.rot.alpha || 0), beta: Math.round(st.rot.beta || 0), gamma: Math.round(st.rot.gamma || 0) },
          buttons: { a: engine.aHeld, b: false },
          gas: pad.current.gas,
          brake: pad.current.brake,
          rtt: rttRef.current,
        },
        { queueIfClosed: false },
      );
    }, 1000 / MOTION.inputHz);
    // menu navigation by tilt
    let armed = true;
    const nav = setInterval(() => {
      const m = screenRef.current.mode;
      if (m !== MODE.MENU) return;
      const x = engine.state.tilt.x;
      if (armed && Math.abs(x) > 0.55) {
        armed = false;
        sockRef.current?.send({ type: MSG.EVENT, kind: 'nav', dir: x > 0 ? 1 : -1 });
        navigator.vibrate?.(15);
      } else if (Math.abs(x) < 0.2) armed = true;
    }, 50);
    const ui = setInterval(() => tick((x) => x + 1), 66);
    return () => {
      clearInterval(iv);
      clearInterval(nav);
      clearInterval(ui);
    };
  }, [step, engine]);

  // ---- join (this tap also grants iOS motion permission)
  const join = async () => {
    setError('');
    if (!room || room.length !== 4) return setError('Enter the 4-letter room code');
    if (!name.trim()) return setError('Enter your name');
    let granted = true;
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        granted = (await DeviceMotionEvent.requestPermission()) === 'granted';
      }
    } catch (e) {
      granted = false;
    }
    if (!window.isSecureContext) setError('Motion needs HTTPS. Open the https:// link from the QR code.');
    else if (!granted) setError('Motion permission denied. Using touch mode. (Settings > Safari > Motion & Orientation)');
    window.addEventListener('devicemotion', onMotion);
    ls.set('mp.name', name.trim());
    ls.set('mp.color', color);
    joinedRef.current = true;
    sendJoin();
    try {
      await navigator.wakeLock?.request('screen');
    } catch {}
    setStep('calibrate');
    // detect missing sensors (desktop) after a moment
    setTimeout(() => {
      if (!lastMotion.current) {
        setVirtual(true);
        engine.state.calibrated = true;
        setStep('play');
      }
    }, 1200);
  };

  const calibrate = async () => {
    setStep('calibrate');
    await engine.calibrate(900);
    navigator.vibrate?.([20, 40, 20]);
    setStep('play');
  };

  useEffect(() => {
    if (step === 'calibrate' && !virtual) {
      const t = setTimeout(() => {
        if (lastMotion.current) calibrate();
      }, 600);
      return () => clearTimeout(t);
    }
  }, [step, virtual]);

  // ---- buttons
  const press = (button, down) => {
    if (button === 'a') {
      engine.setButton('a', down);
      setADown(down);
      if (virtual && !down) {
        // touch mode release: strength from how long A was held
        const held = performance.now() - (engine.gripT || performance.now());
        sockRef.current?.send({ type: MSG.EVENT, kind: 'release', power: Math.min(1, 0.4 + held / 1500), spin: engine.state.tilt.x * 0.8, held });
      }
    }
    sockRef.current?.send({ type: MSG.EVENT, kind: 'press', button, down }, { queueIfClosed: false });
    if (down) navigator.vibrate?.(12);
  };

  // ---- avatar photo
  const fileRef = useRef();
  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !meRef.current) return;
    setAvatar({ status: 'uploading' });
    try {
      const blob = await downscale(file, 1024);
      const r = await fetch(`/api/avatar?room=${room}&player=${meRef.current.playerId}&name=${encodeURIComponent(name.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!r.ok) throw new Error(`upload failed (${r.status})`);
      setAvatar({ status: 'processing' });
    } catch (err) {
      setAvatar({ status: 'failed', error: err.message });
    }
  };

  // ---------------- render ----------------
  if (step === 'join') {
    return (
      <div className="ctl ctl-join">
        <div className="ctl-brand">{BRAND}</div>
        <div className="join-box">
          {!initialRoom && (
            <label>
              Room code
              <input value={room} maxLength={4} onChange={(e) => setRoom(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="ABCD" className="room-input" autoCapitalize="characters" />
            </label>
          )}
          {initialRoom && (
            <div className="room-tag">
              Room <b>{room}</b>
            </div>
          )}
          <label>
            Your name
            <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="nickname" />
          </label>
          <div className="colors">
            {PLAYER_COLORS.map((c) => (
              <button key={c.id} className={`swatch ${color === c.hex ? 'on' : ''}`} style={{ '--pc': c.hex }} onClick={() => setColor(c.hex)} aria-label={c.name} />
            ))}
          </div>
          <button className="big-gloss" style={{ '--pc': color }} onClick={join}>
            Tap to join + enable motion
          </button>
          {error && <div className="ctl-error">{error}</div>}
        </div>
      </div>
    );
  }

  if (step === 'calibrate') {
    return (
      <div className="ctl ctl-cal" style={{ '--pc': color }}>
        <div className="cal-phone" />
        <h2>Hold your phone flat and still</h2>
        <div className="cal-bar">
          <i />
        </div>
        <p>Calibrating motion…</p>
      </div>
    );
  }

  const mode = screen.mode;
  const st = engine.state;
  const pc = screen.color || color;

  return (
    <div className={`ctl ctl-play mode-${mode}`} style={{ '--pc': pc }}>
      <header className="ctl-top">
        <span className="ctl-name">
          <i className="dot" />
          {name}
        </span>
        <span className={`ctl-net ${net}`}>{net === 'open' ? (rtt != null ? `${Math.round(rtt)} ms` : 'online') : net}</span>
        <button className="ctl-mini" onClick={calibrate} disabled={virtual}>
          ⟲ Calibrate
        </button>
      </header>

      {flash && (
        <div key={flash.id} className="ctl-flash">
          {flash.text}
        </div>
      )}

      <div className="ctl-prompt">
        {screen.title && <div className="ctl-title">{screen.title}</div>}
        <div>{screen.prompt}</div>
        {screen.sub && <div className="ctl-sub">{screen.sub}</div>}
        {virtual && <div className="ctl-sub">No motion sensors: touch mode</div>}
      </div>

      {(mode === MODE.LOBBY || mode === MODE.MENU) && (
        <>
          <AvatarPanel avatar={avatar} onTake={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
          <div className="ctl-row">
            <button className="arrow" onPointerDown={() => sockRef.current?.send({ type: MSG.EVENT, kind: 'nav', dir: -1 })}>
              ◀
            </button>
            <AButton down={aDown} press={press} />
            <button className="arrow" onPointerDown={() => sockRef.current?.send({ type: MSG.EVENT, kind: 'nav', dir: 1 })}>
              ▶
            </button>
          </div>
          {mode === MODE.MENU && <TiltDot x={st.tilt.x} y={0} small />}
        </>
      )}

      {(mode === MODE.WAIT || mode === MODE.RESULTS) && (
        <div className="ctl-center">
          <AButton down={aDown} press={press} />
        </div>
      )}

      {mode === MODE.BOWL && (
        <div className="ctl-center">
          {screen.active ? (
            <>
              <TiltDot x={st.tilt.x} y={0} label="aim" />
              <AButton down={aDown} press={press} hold label={aDown ? 'SWING!' : 'HOLD A'} />
              {virtual && <TouchTilt engine={engine} />}
            </>
          ) : (
            <div className="ctl-waiting">{screen.waitingFor ? `Waiting for ${screen.waitingFor}…` : 'Waiting…'}</div>
          )}
        </div>
      )}

      {mode === MODE.TENNIS && (
        <div className="ctl-center">
          <div className={`racket ${screen.hot ? 'hot' : ''}`}>{screen.hot ? 'SWING!' : 'ready…'}</div>
          {virtual && (
            <button className="big-gloss" onPointerDown={() => sockRef.current?.send({ type: MSG.EVENT, kind: 'swing', power: 0.8, dir: 1, smash: false, twist: 0 })}>
              Swing (touch)
            </button>
          )}
        </div>
      )}

      {mode === MODE.RACE && (
        <RacePad pad={pad} engine={engine} boost={screen.boost} virtual={virtual} sock={sockRef} />
      )}

      {mode === MODE.BALANCE && (
        <div className="ctl-center">
          <TiltDot x={st.tilt.x} y={st.tilt.y} big />
          {virtual && <TouchTilt engine={engine} />}
        </div>
      )}
    </div>
  );
}

function AButton({ down, press, label = 'A', hold }) {
  return (
    <button
      className={`a-btn ${down ? 'down' : ''} ${hold ? 'hold' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press('a', true);
      }}
      onPointerUp={() => press('a', false)}
      onPointerCancel={() => press('a', false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span>{label}</span>
    </button>
  );
}

function TiltDot({ x, y, big, small, label }) {
  return (
    <div className={`tilt ${big ? 'big' : ''} ${small ? 'small' : ''}`}>
      <div className="tilt-ring" />
      <div className="tilt-dot" style={{ transform: `translate(${x * 42}%, ${-y * 42}%)` }} />
      {label && <span className="tilt-label">{label}</span>}
    </div>
  );
}

function TouchTilt({ engine }) {
  // desktop/touch fallback: drag to set tilt
  const ref = useRef();
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    engine.state.tilt.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    engine.state.tilt.y = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
    engine.state.steer = engine.state.tilt.x;
  };
  return (
    <div ref={ref} className="touch-tilt" onPointerMove={(e) => e.buttons && move(e)} onPointerDown={move}>
      drag to tilt
    </div>
  );
}

function RacePad({ pad, engine, boost, virtual, sock }) {
  const set = (k, v) => {
    pad.current[k] = v;
  };
  return (
    <div className="race-pad">
      <button className="pedal brake" onPointerDown={(e) => (e.currentTarget.setPointerCapture?.(e.pointerId), set('brake', true))} onPointerUp={() => set('brake', false)} onPointerCancel={() => set('brake', false)}>
        BRAKE
      </button>
      <div className="wheel-mid">
        <div className="wheel" style={{ transform: `rotate(${engine.state.steer * 90}deg)` }} />
        <div className={`boost ${boost >= 1 ? 'full' : ''}`}>
          <i style={{ width: `${Math.round((boost || 0) * 100)}%` }} />
          <span>{boost >= 1 ? 'SHAKE TO BOOST!' : 'boost'}</span>
        </div>
        <button className="ctl-mini" onClick={() => engine.zeroSteer()}>
          center wheel
        </button>
        {virtual && (
          <button className="ctl-mini" onClick={() => sock.current?.send({ type: MSG.EVENT, kind: 'shake' })}>
            boost
          </button>
        )}
      </div>
      <button className="pedal gas" onPointerDown={(e) => (e.currentTarget.setPointerCapture?.(e.pointerId), set('gas', true))} onPointerUp={() => set('gas', false)} onPointerCancel={() => set('gas', false)}>
        GAS
      </button>
    </div>
  );
}

function AvatarPanel({ avatar, onTake }) {
  const st = avatar?.status;
  return (
    <div className="avatar-panel">
      <div className="avatar-preview">
        {avatar?.image ? <img src={avatar.image} alt="" /> : <span>{st === 'uploading' || st === 'processing' ? '✨' : '🙂'}</span>}
      </div>
      <div className="avatar-info">
        <b>Your {AVATAR_NAME}</b>
        <div>
          {!st && 'Snap a full-body photo (stand back, arms slightly out)'}
          {st === 'uploading' && 'Uploading…'}
          {st === 'processing' && `Making your ${AVATAR_NAME}…`}
          {st === 'image' && `Look at you! Building 3D…`}
          {st === 'ready' && `${AVATAR_NAME} ready!`}
          {st === 'failed' && (avatar.image ? `${AVATAR_NAME} card ready` : 'Could not make it, try again')}
        </div>
        <button className="ctl-mini" onClick={onTake}>
          📸 {avatar?.image ? 'Retake' : 'Take photo'}
        </button>
      </div>
    </div>
  );
}

async function downscale(file, max) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s);
  cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob((b) => res(b || file), 'image/jpeg', 0.88));
}
