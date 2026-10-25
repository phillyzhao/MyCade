// miisterygames server: static web app + WebSocket rooms + avatar pipeline + stats API.
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { attach, getRoom, listRooms, setPlayerAvatar } from './rooms.js';
import { createStats } from './stats.js';
import { createAvatarService } from './avatar/index.js';
import { commentate } from './commentary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

const PORT = Number(process.env.PORT || 8787);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const ENABLE_HTTPS = process.env.HTTPS !== '0';

const stats = createStats({ dataDir: DATA });
const avatars = createAvatarService({
  dataDir: DATA,
  onStatus: (room, playerId, avatar) => setPlayerAvatar(room, playerId, avatar),
  getRoom,
});

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|Loopback/i.test(name)) continue;
      if (a.address.startsWith('192.168.56.') || a.address.startsWith('169.254.')) continue;
      out.push(a.address);
    }
  }
  // phone hotspots first (iPhone 172.20.10.x, Android 192.168.43.x), then private LAN, then CGNAT/VPN
  const score = (ip) =>
    ip.startsWith('172.20.10.') || ip.startsWith('192.168.43.') ? 0 : ip.startsWith('192.168.') || ip.startsWith('10.') ? 1 : 2;
  return out.sort((a, b) => score(a) - score(b));
}

function publicUrls() {
  if (process.env.PUBLIC_URL) return [process.env.PUBLIC_URL.replace(/\/$/, '')];
  return lanAddresses().map((ip) => (ENABLE_HTTPS ? `https://${ip}:${HTTPS_PORT}` : `http://${ip}:${PORT}`));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

export function serveFile(res, file, cache = false) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 15e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function onRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }
    if (p === '/api/config') return json(res, 200, { urls: publicUrls(), https: ENABLE_HTTPS, db: stats.pgEnabled });
    if (p === '/api/health') return json(res, 200, { ok: true, rooms: listRooms() });
    if (p === '/api/matches' && req.method === 'GET') return json(res, 200, stats.matches(url.searchParams.get('room')));
    if (p === '/api/records' && req.method === 'GET') return json(res, 200, stats.records());
    if (p === '/api/matches' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      return json(res, 200, stats.addMatch(body));
    }
    if (p === '/api/commentary' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      try {
        return json(res, 200, { line: await commentate(body) });
      } catch (e) {
        return json(res, 200, { line: null, error: e.message });
      }
    }
    if (p === '/api/motion' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      stats.addMotion(Array.isArray(body) ? body : [body]);
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/api/avatar') || p.startsWith('/avatars/')) {
      if (await avatars.handle(req, res, url, { readBody, json, serveFile })) return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    // static app with SPA fallback
    const safe = path.normalize(p).replace(/^[/\\]+/, '');
    const file = path.join(DIST, safe);
    if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return serveFile(res, file, safe.startsWith('assets'));
    }
    const index = path.join(DIST, 'index.html');
    if (fs.existsSync(index)) return serveFile(res, index);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('miisterygames server running. Build the web app (npm run build) or use the Vite dev server.');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
}

function attachWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });
  wss.on('connection', (ws) => {
    ws._socket?.setNoDelay?.(true);
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    attach(ws);
  });
  // drop dead sockets
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 10e3).unref();
}

async function loadCert() {
  const dir = path.join(ROOT, 'certs');
  const keyF = path.join(dir, 'key.pem');
  const certF = path.join(dir, 'cert.pem');
  if (fs.existsSync(keyF) && fs.existsSync(certF)) return { key: fs.readFileSync(keyF), cert: fs.readFileSync(certF) };
  const { default: selfsigned } = await import('selfsigned');
  const altNames = [{ type: 2, value: 'localhost' }, ...lanAddresses().map((ip) => ({ type: 7, ip }))];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'miisterygames.local' }], {
    days: 30,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyF, pems.private);
  fs.writeFileSync(certF, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

const httpServer = http.createServer(onRequest);
attachWs(httpServer);
httpServer.listen(PORT, () => console.log(`[http]  http://localhost:${PORT}`));

if (ENABLE_HTTPS) {
  try {
    const creds = await loadCert();
    const httpsServer = https.createServer(creds, onRequest);
    attachWs(httpsServer);
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`[https] https://localhost:${HTTPS_PORT}`);
      for (const u of publicUrls()) console.log(`[phones] ${u}`);
    });
  } catch (e) {
    console.warn('[https] disabled:', e.message);
  }
}
