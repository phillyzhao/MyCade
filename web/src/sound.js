// Thin facade over the audio engine so gameplay code never crashes if audio fails to load.
let engine = null;
const pending = [];
import('./audio/index.js')
  .then((m) => {
    engine = m.audio || m.default;
    for (const [fn, args] of pending.splice(0)) engine?.[fn]?.(...args);
  })
  .catch((e) => console.warn('[sound] audio engine unavailable', e));

const call = (fn, ...args) => {
  try {
    if (engine) return engine[fn]?.(...args);
    if (fn === 'playMusic' || fn === 'unlock') pending.push([fn, args]);
  } catch (e) {
    console.warn('[sound]', fn, e);
  }
};

const nullLoop = { set() {}, stop() {} };

export const sound = {
  unlock: () => call('unlock'),
  music: (track) => call('playMusic', track),
  stopMusic: (f) => call('stopMusic', f),
  sfx: (name, opts) => call('sfx', name, opts),
  sting: (name) => call('sting', name),
  loop: (name) => {
    try {
      return engine?.loop?.(name) || nullLoop;
    } catch {
      return nullLoop;
    }
  },
  toggleMute: () => call('toggleMute'),
  get muted() {
    return !!engine?.muted;
  },
};
