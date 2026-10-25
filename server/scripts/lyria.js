// Generate background music for Mycade with Google Lyria on Vertex AI.
// Usage: node server/scripts/lyria.js [trackName ...]   (default: all tracks)
// Writes web/public/music/<name>.mp3 (via ffmpeg) and web/public/music/tracks.json.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env') });

if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = 'us-central1';
const MODEL = process.env.LYRIA_MODEL || 'lyria-002';
const OUT_DIR = path.join(ROOT, 'web', 'public', 'music');
const WAV_DIR = path.join(OUT_DIR, '_wav');

const NEGATIVE = 'vocals, singing, lyrics, speech, dark, sad, horror, distorted noise, low quality';

const TRACKS = {
  menu: 'Upbeat retro arcade lounge instrumental, funky bass, bright synth chords, chiptune sparkles, groovy drums, 110 bpm, feel-good party game menu music, loopable',
  bowling: 'Laid-back jazzy lounge groove instrumental, walking bass, brushed drums, vibraphone and electric piano, playful bowling alley vibe, loopable',
  tennis: 'Sunny upbeat sports anthem instrumental, bouncy pop rock with marimba and claps, energetic but light, loopable',
  racing: 'High-energy arcade racing instrumental, driving synth bass, fast drums, electric guitar riffs, 150 bpm, adrenaline, loopable',
  balance: 'Playful quirky tension instrumental, pizzicato strings, ticking percussion, whimsical woodwinds, cartoon suspense, loopable',
  results: 'Triumphant celebratory victory music instrumental, brass fanfare, big drums, joyful party, loopable',
};

async function getToken() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function generate(name, prompt, token) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt, negative_prompt: NEGATIVE }],
      parameters: { sample_count: 1 },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 1000)}`);
  const json = JSON.parse(text);
  const pred = json.predictions?.[0];
  const b64 = pred?.bytesBase64Encoded || pred?.audioContent;
  if (!b64) throw new Error(`No audio in response: ${text.slice(0, 500)}`);
  const buf = Buffer.from(b64, 'base64');
  fs.mkdirSync(WAV_DIR, { recursive: true });
  const wav = path.join(WAV_DIR, `${name}.wav`);
  fs.writeFileSync(wav, buf);
  return wav;
}

function encode(name, wav) {
  const mp3 = path.join(OUT_DIR, `${name}.mp3`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3]);
  fs.unlinkSync(wav);
  return mp3;
}

function writeManifest() {
  const manifest = {};
  for (const name of Object.keys(TRACKS)) {
    if (fs.existsSync(path.join(OUT_DIR, `${name}.mp3`))) manifest[name] = `/music/${name}.mp3`;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'tracks.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function main() {
  if (!PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT missing from .env');
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TRACKS);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const token = await getToken();
  const failures = [];
  for (const name of names) {
    const prompt = TRACKS[name];
    if (!prompt) { console.warn(`Unknown track: ${name}`); continue; }
    const t0 = Date.now();
    try {
      console.log(`[${name}] generating with ${MODEL}...`);
      const wav = await generate(name, prompt, token);
      const mp3 = encode(name, wav);
      console.log(`[${name}] ok -> ${path.relative(ROOT, mp3)} (${(fs.statSync(mp3).size / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.error(`[${name}] FAILED: ${err.message}`);
      failures.push(name);
    }
  }
  if (fs.existsSync(WAV_DIR) && fs.readdirSync(WAV_DIR).length === 0) fs.rmdirSync(WAV_DIR);
  console.log('tracks.json:', writeManifest());
  if (failures.length) { console.error('Failed:', failures.join(', ')); process.exitCode = 1; }
}

main().catch((err) => { console.error(err); process.exit(1); });
