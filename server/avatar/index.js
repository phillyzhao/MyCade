// Avatar service: HTTP routes + per-stage concurrency limits around the Gemini -> Tripo pipeline (see pipeline.js).
import path from 'node:path';
import fs from 'node:fs';
import { createCache, newId, normName, runPipeline, sniffMime } from './pipeline.js';

// Stage limits: Gemini (fast, the "wow" moment) gets its own lane so a photo never waits behind
// multi-minute Tripo jobs; Tripo runs at most 2 at a time.
const MAX_IMAGE = 4;
const MAX_3D = 2;

function limiter(max) {
  let running = 0;
  const queue = [];
  const pump = () => {
    while (running < max && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      running++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          running--;
          pump();
        });
    }
  };
  const run = (fn) => new Promise((resolve, reject) => (queue.push({ fn, resolve, reject }), pump()));
  run.busy = () => running >= max;
  return run;
}

export function createAvatarService({ dataDir, onStatus = () => {}, getRoom } = {}) {
  const avatarDir = path.resolve(dataDir, 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });
  const cache = createCache(avatarDir);
  const gateImage = limiter(MAX_IMAGE);
  const tripoGate = limiter(MAX_3D);

  // latest job per room:player, so a superseded upload can't overwrite a newer avatar (or spend Tripo credits)
  const latest = new Map();

  function start({ photo, mime, name, room, player }) {
    const id = newId(name);
    const key = `${room}:${player}`;
    latest.set(key, id);
    const current = () => !(room && player) || latest.get(key) === id;
    const push = (avatar) => {
      if (room && player && current()) onStatus(room, player, avatar);
    };
    const gate3d = (fn) =>
      tripoGate(() => {
        if (!current()) throw new Error('superseded by a newer photo');
        return fn();
      });
    const use3d = process.env.AVATAR_3D !== '0';
    push({ status: 'processing', stage: gateImage.busy() ? 'queued' : 'starting' });
    runPipeline({ photo, mime, name, id, avatarDir, cache, use3d, onStatus: push, gateImage, gate3d }).catch((e) =>
      console.error('[avatar] job error', e)
    );
    return id;
  }

  async function handle(req, res, url, { readBody, json, serveFile }) {
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/avatar' && req.method === 'POST') {
      const room = (url.searchParams.get('room') || '').toUpperCase();
      const player = url.searchParams.get('player') || '';
      let name = (url.searchParams.get('name') || '').trim();
      if (!name && room && player) name = getRoom?.(room)?.players?.get?.(player)?.name || '';
      if (!name) name = player || 'player';
      let body;
      try {
        body = await readBody(req, 15e6);
      } catch (e) {
        json(res, 413, { ok: false, error: e.message });
        return true;
      }
      if (!body?.length) {
        json(res, 400, { ok: false, error: 'empty body' });
        return true;
      }
      const mime = sniffMime(body, String(req.headers['content-type'] || '').split(';')[0].trim());
      const id = start({ photo: body, mime, name, room, player });
      json(res, 200, { ok: true, id });
      return true;
    }

    if (p === '/api/avatar/cache' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      if (name != null) {
        const e = cache.get(name);
        if (!e) json(res, 404, { error: 'not found', name: normName(name) });
        else json(res, 200, e);
      } else json(res, 200, cache.list());
      return true;
    }

    if (p.startsWith('/avatars/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const rel = p.slice('/avatars/'.length);
      const file = path.resolve(avatarDir, rel);
      if (!rel || rel.includes('\0') || !file.startsWith(avatarDir + path.sep) || path.basename(file) === 'cache.json') {
        res.writeHead(404);
        res.end('not found');
        return true;
      }
      serveFile(res, file);
      return true;
    }

    return false;
  }

  return { handle, cache };
}
