// Pre-generate cached avatars from a folder of photos (file name = player name).
//   node server/avatar/pregen.js <photosDir> [--image-only] [--force]
// Cache-aware: skips Tripo for names that already have a GLB in the cache unless --force
// (and skips the name entirely if it already has a GLB, or an image when --image-only).
// If a name only has a cached image, that image is reused for Tripo (no new Gemini call) unless --force.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(REPO, '.env'), quiet: true });

const { createCache, newId, runPipeline, sniffMime } = await import('./pipeline.js');

const args = process.argv.slice(2);
const imageOnly = args.includes('--image-only');
const force = args.includes('--force');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: node server/avatar/pregen.js <photosDir> [--image-only] [--force]');
  process.exit(1);
}
const photosDir = path.resolve(dir);
const avatarDir = path.join(REPO, 'server', 'data', 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });
const cache = createCache(avatarDir);

const files = fs
  .readdirSync(photosDir)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();
if (!files.length) {
  console.error('no images in', photosDir);
  process.exit(1);
}

let ok = 0;
for (const f of files) {
  const name = path.basename(f, path.extname(f));
  const prev = cache.get(name);
  if (!force && prev && (prev.glb || (imageOnly && prev.image))) {
    console.log(`= ${name}: already cached (${prev.glb ? 'glb' : 'image'}), skipping (use --force to redo)`);
    ok++;
    continue;
  }
  console.log(`> ${name}: generating${imageOnly ? ' (image only)' : ''}...`);
  const photo = fs.readFileSync(path.join(photosDir, f)); // source photo is read only, never modified
  const t0 = Date.now();
  const result = await runPipeline({
    photo,
    mime: sniffMime(photo),
    name,
    id: newId(name),
    avatarDir,
    cache,
    use3d: !imageOnly,
    // adding 3D to an image-only entry: reuse its image (skips Gemini) unless --force
    reuseImage: !force && !imageOnly && prev?.image && fs.existsSync(path.join(avatarDir, path.basename(prev.image))) ? prev.image : null,
    onStatus: (a) => console.log(`  ${name}: ${a.status}${a.stage ? ` [${a.stage}]` : ''}${a.error ? ` - ${a.error}` : ''}`),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (result.status === 'ready') {
    ok++;
    console.log(`✓ ${name} (${secs}s): image=${result.image} glb=${result.glb} rigged=${result.rigged}`);
  } else console.log(`✗ ${name} (${secs}s): ${result.error}`);
}
console.log(`done: ${ok}/${files.length} ready. cache: ${path.join(avatarDir, 'cache.json')}`);
