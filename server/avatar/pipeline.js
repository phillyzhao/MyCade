// Avatar pipeline: photo -> Gemini toy restyle (PNG) -> Tripo image_to_model + rig (GLB) -> GLB inspection.
// Shared by the HTTP service (index.js) and the pre-generation CLI (pregen.js).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PROMPT =
  'Turn this person into a cute toy-like 3D party game character in the style of a Nintendo Mii / Wii-era avatar: smooth clean shapes, simple friendly face with small dot eyes, soft matte plastic look. Keep their hair, skin tone, clothing colors, and accessories. Proportions: oversized round head, simple rounded body, short limbs, mitten hands, no fingers. Full body, front view, standing in a T-pose with arms straight out to the sides, legs slightly apart, neutral expression, centered, plain white background, soft even lighting, no shadows, no text, no logos.';
const STRICT_PROMPT =
  PROMPT +
  ' IMPORTANT: Respond with exactly one generated image and nothing else. The output must be a single full-body character (head to feet fully visible) on a pure white background, arms horizontal in a T-pose.';

const log = (...a) => console.log('[avatar]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const normName = (name) => String(name || '').trim().toLowerCase();
const slug = (name) => normName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'player';
export const newId = (name) => `${slug(name)}-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

export function sniffMime(buf, fallback) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'image/heic';
  return fallback && fallback.startsWith('image/') ? fallback : 'image/jpeg';
}
const extFor = (mime) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[mime] || 'png';

// ---------------------------------------------------------------- Gemini

export function geminiConfigured() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT);
}

let _ai = null;
async function genai() {
  if (_ai) return _ai;
  const { GoogleGenAI } = await import('@google/genai');
  if (process.env.GOOGLE_CLOUD_PROJECT && (process.env.GOOGLE_GENAI_USE_VERTEXAI !== 'false' || !process.env.GEMINI_API_KEY)) {
    _ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
    });
  } else {
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

async function geminiOnce(prompt, photo, mime) {
  const ai = await genai();
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const resp = await withTimeout(
    ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: photo.toString('base64') } }] }],
      config: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
    120e3,
    'gemini timeout'
  );
  for (const cand of resp.candidates || []) {
    for (const part of cand.content?.parts || []) {
      const d = part.inlineData || part.inline_data;
      if (d?.data) return { data: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png' };
    }
  }
  const reason = resp.candidates?.[0]?.finishReason || resp.promptFeedback?.blockReason || 'no image in response';
  const text = (resp.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
  throw new Error(`gemini: ${reason}${text ? ` (${text})` : ''}`);
}

// Downscale (long side <= 768px) + apply EXIF rotation before sending: big phone photos slow Gemini down a lot.
async function prepPhoto(photo, mime) {
  try {
    const { default: sharp } = await import('sharp');
    const data = await sharp(photo, { failOn: 'none' })
      .rotate()
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { photo: data, mime: 'image/jpeg' };
  } catch (e) {
    log('downscale skipped:', e.message);
    return { photo, mime: mime === 'image/heic' ? 'image/heic' : mime };
  }
}

export async function restyle(photo, mime) {
  ({ photo, mime } = await prepPhoto(photo, mime));
  try {
    return await geminiOnce(PROMPT, photo, mime);
  } catch (e) {
    log('gemini attempt 1 failed:', e.message, '- retrying with stricter prompt');
    return await geminiOnce(STRICT_PROMPT, photo, mime);
  }
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(msg)), ms)))]).finally(() =>
    clearTimeout(t)
  );
}

// ---------------------------------------------------------------- Tripo
// Supports the current apiv3 (https://openapi.tripo3d.ai/v3/...) and the legacy v2 OpenAPI
// (https://api.tripo3d.ai/v2/openapi). TRIPO_API_VERSION=v2|v3 forces one; default tries v3 and
// falls back to v2 only if the v3 upload endpoint itself is missing (no credits are spent by uploads).

const V3_BASE = (process.env.TRIPO_API_BASE || 'https://openapi.tripo3d.ai').replace(/\/$/, '');
const V2_BASE = (process.env.TRIPO_V2_BASE || 'https://api.tripo3d.ai/v2/openapi').replace(/\/$/, '');

class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

async function tripoFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.TRIPO_API_KEY}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(60e3),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok || !body || (body.code != null && body.code !== 0)) {
    const msg = body?.message || body?.error || body?.msg || text.slice(0, 200);
    throw new HttpError(res.status, `tripo ${init.method || 'GET'} ${new URL(url).pathname} -> ${res.status} ${body?.code ?? ''} ${msg}`);
  }
  return 'data' in body ? body.data : body;
}

async function tripoUpload(api, png, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: mime }), `avatar.${extFor(mime)}`);
  if (api === 'v3') {
    const d = await tripoFetch(`${V3_BASE}/v3/files`, { method: 'POST', body: fd });
    const token = d?.file_token || d?.image_token;
    if (!token) throw new Error('tripo upload: no file_token');
    return token;
  }
  const d = await tripoFetch(`${V2_BASE}/upload`, { method: 'POST', body: fd });
  const token = d?.image_token || d?.file_token;
  if (!token) throw new Error('tripo upload: no image_token');
  return token;
}

// keep meshes light for the browser; TRIPO_FACE_LIMIT=0 disables
const faceLimit = () => Number(process.env.TRIPO_FACE_LIMIT ?? 30000) || 0;

async function tripoCreate(api, kind, args) {
  const post = (url, body) =>
    tripoFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let d;
  if (api === 'v3') {
    if (kind === 'model') {
      // apiv3 requires `model` (allowed late 2026: P1-20260311, P2-20260801, v2.5-20250123, v3.0-20250812, v3.1-20260211)
      const body = { input: args.token, model: process.env.TRIPO_MODEL_VERSION || 'v3.1-20260211' };
      if (faceLimit()) body.face_limit = faceLimit();
      d = await post(`${V3_BASE}/v3/generation/image-to-model`, body);
    } else if (kind === 'rigcheck') d = await post(`${V3_BASE}/v3/animations/rig-check`, { input: args.taskId });
    // rig `model` must be given explicitly (allowed: v1.0-20240301, v2.5-20260210, v3.0-20260909)
    else d = await post(`${V3_BASE}/v3/animations/rig`, {
      input: args.taskId,
      model: process.env.TRIPO_RIG_MODEL || 'v2.5-20260210',
      out_format: 'glb',
    });
  } else {
    let body;
    if (kind === 'model') {
      body = { type: 'image_to_model', file: { type: args.ext === 'jpg' ? 'jpg' : 'png', file_token: args.token } };
      if (process.env.TRIPO_MODEL_VERSION) body.model_version = process.env.TRIPO_MODEL_VERSION;
      if (faceLimit()) body.face_limit = faceLimit();
    } else if (kind === 'rigcheck') body = { type: 'animate_prerigcheck', original_model_task_id: args.taskId };
    else body = { type: 'animate_rig', original_model_task_id: args.taskId, out_format: 'glb', spec: 'tripo' };
    d = await post(`${V2_BASE}/task`, body);
  }
  if (!d?.task_id) throw new Error(`tripo ${kind}: no task_id`);
  return d.task_id;
}

async function tripoWait(api, taskId, timeoutMs, onProgress) {
  const url = api === 'v3' ? `${V3_BASE}/v3/tasks/${taskId}` : `${V2_BASE}/task/${taskId}`;
  const end = Date.now() + timeoutMs;
  let lastP = -1;
  let errs = 0;
  while (Date.now() < end) {
    let t;
    try {
      t = await tripoFetch(url);
      errs = 0;
    } catch (e) {
      // transient poll errors are fine (polling is free); give up after several in a row
      if (++errs >= 5) throw e;
      await sleep(3000);
      continue;
    }
    const st = String(t.status || '').toLowerCase();
    if (st === 'success') return t;
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(st)) {
      throw new Error(`tripo task ${st}${t.error_msg || t.error_message ? `: ${t.error_msg || t.error_message}` : ''}`);
    }
    if (typeof t.progress === 'number' && t.progress !== lastP) {
      lastP = t.progress;
      onProgress?.(t.progress);
    }
    await sleep(3000);
  }
  throw new Error('tripo task timeout');
}

function pickUrl(output, keys) {
  for (const k of keys) {
    const v = output?.[k];
    if (typeof v === 'string' && v.startsWith('http')) return v;
    if (v && typeof v === 'object' && typeof v.url === 'string') return v.url;
  }
  return null;
}

async function download(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120e3) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(file, buf);
  return buf;
}

/**
 * Image -> GLB (+ rig). Never retries credit-spending calls. Returns { glbFile, rigged, rigError? }.
 * Throws only if no model at all could be produced.
 */
export async function tripoModel(png, mime, glbFile, stage) {
  let api = (process.env.TRIPO_API_VERSION || '').toLowerCase() === 'v2' ? 'v2' : 'v3';
  let token;
  try {
    token = await tripoUpload(api, png, mime);
  } catch (e) {
    if (api === 'v3' && !process.env.TRIPO_API_VERSION && (e.status === 404 || e.status === 405 || !e.status)) {
      log('tripo v3 upload failed (', e.message, ') - falling back to v2 API');
      api = 'v2';
      token = await tripoUpload(api, png, mime);
    } else throw e;
  }
  stage('modeling');
  const modelTask = await tripoCreate(api, 'model', { token, ext: extFor(mime) });
  log(`tripo(${api}) model task`, modelTask);
  const m = await tripoWait(api, modelTask, 4 * 60e3, (p) => stage(`modeling ${p}%`));
  const modelUrl = pickUrl(m.output, ['pbr_model', 'pbr_model_url', 'model', 'model_url', 'base_model', 'base_model_url']);
  if (!modelUrl) throw new Error('tripo model: no model url in output');
  await download(modelUrl, glbFile);
  log('downloaded base model ->', path.basename(glbFile));

  if (process.env.AVATAR_RIG === '0') return { glbFile, rigged: false, rigError: 'rigging disabled', modelTask };
  return { ...(await tripoRig(api, modelTask, glbFile, stage)), modelTask };
}

/** Rig an existing Tripo model task and download the rigged GLB over glbFile. Never throws. */
export async function tripoRig(api, modelTask, glbFile, stage = () => {}, { skipCheck = false } = {}) {
  try {
    if (!skipCheck) {
    stage('rig check');
    const checkTask = await tripoCreate(api, 'rigcheck', { taskId: modelTask });
    const c = await tripoWait(api, checkTask, 2 * 60e3);
    const riggable = c.output?.riggable;
    log('tripo rig check:', JSON.stringify({ riggable, rig_type: c.output?.rig_type || c.output?.topology }));
    if (riggable === false) return { glbFile, rigged: false, rigError: 'model not riggable' };
    }
    stage('rigging');
    const rigTask = await tripoCreate(api, 'rig', { taskId: modelTask });
    const r = await tripoWait(api, rigTask, 3 * 60e3, (p) => stage(`rigging ${p}%`));
    const rigUrl = pickUrl(r.output, ['model', 'model_url', 'pbr_model', 'pbr_model_url']);
    if (!rigUrl) throw new Error('rig: no model url in output');
    await download(rigUrl, glbFile);
    log('downloaded rigged model ->', path.basename(glbFile));
    return { glbFile, rigged: true };
  } catch (e) {
    log('rigging failed, keeping unrigged model:', e.message);
    return { glbFile, rigged: false, rigError: e.message };
  }
}

// ---------------------------------------------------------------- GLB inspection

const SIDE_DROP = new Set(['l', 'r', 'c', 'j', 'bip', 'bip01', 'bip001', 'def', 'mixamorig', 'jbip', 'armature', 'b', 'bone', 'jnt', 'joint', 'mch', 'org', 'cc', 'base']);
const EXCLUDE_TOK = /^(end|nub|top|twist|roll|index|thumb|middle|ring|pinky|little|finger|toe|toebase|ik|pole|target|eye|jaw|ear|hair|tongue|tail|tip|helper|ctrl)\d*$/;

function parseJoint(raw) {
  let s = String(raw);
  s = s.slice(Math.max(s.lastIndexOf(':'), s.lastIndexOf('|')) + 1);
  // split camelCase so "LeftUpLeg"/"LUpperArm" tokenise
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase();
  s = s.replace(/left/g, ' l ').replace(/right/g, ' r ');
  const toks = s.split(/[^a-z0-9]+/).filter(Boolean);
  const side = toks.includes('l') ? 'l' : toks.includes('r') ? 'r' : null;
  const core = toks.filter((t) => !SIDE_DROP.has(t)).join('');
  const excluded = toks.some((t) => EXCLUDE_TOK.test(t)) || /(end|nub)$/.test(core);
  return { raw, side, core, base: core.replace(/\d+$/, ''), excluded };
}

const LIMBS = {
  UpperArm: [/^upperarm$/, /^uparm$/, /^arm$/],
  LowerArm: [/^(forearm|lowerarm|lowarm)$/, /^elbow$/],
  Hand: [/^hand$/, /^wrist$/],
  UpperLeg: [/^(upleg|upperleg|thigh)$/, /^hip$/],
  LowerLeg: [/^(lowerleg|lowleg|calf|shin)$/, /^leg$/, /^knee$/],
  Foot: [/^foot$/, /^ankle$/],
};

/**
 * jointNames: skin joint names. info (optional): { pos: {name: [x,y,z] world}, weight: {name: dominant vertex count} }
 * used for Tripo's generic skeleton (tripo::Root, Spine_N, Head_N, <g>_Left_Limb_<i>) and to pick the head joint.
 */
export function mapBones(jointNames, info = {}) {
  const pos = info.pos || {};
  const weight = info.weight || {};
  const all = jointNames.map(parseJoint);
  const js = all.filter((j) => !j.excluded);
  const center = js.filter((j) => !j.side);
  const bones = {};
  const first = (list, regs, key = 'base') => {
    for (const re of regs) {
      const hit = list.find((j) => re.test(j[key]));
      if (hit) return hit.raw;
    }
    return undefined;
  };

  // --- Tripo auto-rig: limbs are "<group>_<Side>_Limb_<index>"; the group whose root sits higher is the arms.
  const tail = (n) => String(n).slice(Math.max(String(n).lastIndexOf(':'), String(n).lastIndexOf('|')) + 1);
  const limbs = {};
  for (const n of jointNames) {
    const m = /^(\d+)_(left|right)_limb_(\d+)$/i.exec(tail(n));
    if (m) ((limbs[m[1]] ||= { l: [], r: [] })[m[2][0].toLowerCase()])[+m[3]] = n;
  }
  const groups = Object.values(limbs).filter((g) => g.l[0] && g.r[0]);
  if (groups.length >= 2) {
    const y = (g) => (pos[g.l[0]]?.[1] ?? 0) + (pos[g.r[0]]?.[1] ?? 0);
    groups.sort((a, b) => y(b) - y(a));
    const [arms, legs] = groups;
    for (const [side, prefix] of [['l', 'left'], ['r', 'right']]) {
      [bones[prefix + 'UpperArm'], bones[prefix + 'LowerArm'], bones[prefix + 'Hand']] = arms[side];
      [bones[prefix + 'UpperLeg'], bones[prefix + 'LowerLeg'], bones[prefix + 'Foot']] = legs[side];
    }
  }

  bones.hips = first(center, [/^hips?$/, /^pelvis$/, /^root$/]);
  const spines = center.filter((j) => /^(spine\d*|chest|upperchest|torso|abdomen)$/.test(j.core));
  if (spines.length) {
    bones.spine = spines[0].raw;
    const chest = spines.find((j) => /chest/.test(j.core)) || (spines.length > 1 ? spines[spines.length - 1] : null);
    if (chest) bones.chest = chest.raw;
  }
  bones.neck = first(center, [/^neck$/]);
  // head: an exact "head" joint, else (Tripo Head_0..N chain) the head-chain joint driving the most vertices
  const heads = all.filter((j) => !j.side && /^head\d*$/.test(j.core));
  if (heads.length > 1 && Object.keys(weight).length) {
    const best = [...heads].sort((a, b) => (weight[b.raw] || 0) - (weight[a.raw] || 0))[0];
    bones.head = best.raw;
    if (!bones.neck && heads[0].raw !== best.raw) bones.neck = heads[0].raw;
  } else bones.head = first(center, [/^head$/]);

  for (const [side, prefix] of [['l', 'left'], ['r', 'right']]) {
    const list = js.filter((j) => j.side === side);
    for (const [part, regs] of Object.entries(LIMBS)) bones[prefix + part] ||= first(list, regs);
  }
  // loose fallback: substring match for anything still missing
  const loose = {
    hips: [center, /hip|pelvis/], head: [center, /head/], neck: [all.filter((j) => !j.side), /neck/],
  };
  for (const [k, [list, re]] of Object.entries(loose)) if (!bones[k]) bones[k] = list.find((j) => re.test(j.core))?.raw;
  for (const [side, prefix] of [['l', 'left'], ['r', 'right']]) {
    const list = js.filter((j) => j.side === side);
    const used = new Set(Object.values(bones));
    const lf = { UpperArm: /upperarm|uparm/, LowerArm: /forearm|lowerarm/, Hand: /hand/, UpperLeg: /upleg|thigh|upperleg/, LowerLeg: /calf|lowerleg|shin/, Foot: /foot/ };
    for (const [part, re] of Object.entries(lf)) {
      if (!bones[prefix + part]) bones[prefix + part] = list.find((j) => re.test(j.core) && !used.has(j.raw))?.raw;
    }
  }
  for (const k of Object.keys(bones)) if (!bones[k]) delete bones[k];
  return bones;
}

// column-major 4x4 helpers (glTF convention)
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  return o;
}
const xf = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

export async function inspectGlb(file) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(await fsp.readFile(file)));
  const root = doc.getRoot();
  const joints = [];
  const pos = {};
  const weight = {};
  for (const skin of root.listSkins())
    for (const j of skin.listJoints()) {
      if (!joints.includes(j.getName())) joints.push(j.getName());
      pos[j.getName()] = j.getWorldTranslation().map((v) => +v.toFixed(4));
    }

  // Rest-pose bounds as a renderer shows them: skinned vertices = sum(w * jointWorld * IBM * v)
  // (the skinned mesh node's own transform is ignored per glTF spec); static meshes use the node world matrix.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (q) => {
    for (let k = 0; k < 3; k++) {
      if (q[k] < min[k]) min[k] = q[k];
      if (q[k] > max[k]) max[k] = q[k];
    }
  };
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const meshNodes = [];
  scene?.traverse((n) => n.getMesh() && meshNodes.push(n));
  const p = [], jv = [], wv = [], ibm = [];
  for (const node of meshNodes) {
    const skin = node.getSkin();
    let mats = null;
    let sj = null;
    if (skin) {
      sj = skin.listJoints();
      const ibmAcc = skin.getInverseBindMatrices();
      mats = sj.map((j, i) => {
        if (ibmAcc) ibmAcc.getElement(i, ibm);
        else ibm.splice(0, 16, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        return mul4(j.getWorldMatrix(), ibm);
      });
    }
    const world = node.getWorldMatrix();
    for (const prim of node.getMesh().listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      if (!P) continue;
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      for (let i = 0, n = P.getCount(); i < n; i++) {
        P.getElement(i, p);
        if (mats && J && W) {
          J.getElement(i, jv);
          W.getElement(i, wv);
          const out = [0, 0, 0];
          let best = 0;
          for (let k = 0; k < 4; k++) {
            if (wv[k] > wv[best]) best = k;
            if (!wv[k]) continue;
            const q = xf(mats[jv[k]], p);
            out[0] += wv[k] * q[0];
            out[1] += wv[k] * q[1];
            out[2] += wv[k] * q[2];
          }
          const bn = sj[jv[best]]?.getName();
          if (bn) weight[bn] = (weight[bn] || 0) + 1;
          grow(out);
        } else grow(xf(world, p));
      }
    }
  }
  const bbox = min.every(Number.isFinite) ? { min, max } : null;
  const bones = mapBones(joints, { pos, weight });
  const rigged = !!(bones.hips && bones.head && bones.leftUpperArm && bones.rightUpperArm);

  // Facing: character-left = leftUpperArm - rightUpperArm; forward = left x up. yaw = rotation.y that makes it face +Z.
  let forward = null;
  let yaw = 0;
  const L = pos[bones.leftUpperArm], R = pos[bones.rightUpperArm];
  if (L && R) {
    const lx = L[0] - R[0], lz = L[2] - R[2];
    const len = Math.hypot(lx, lz) || 1;
    forward = [+(-lz / len).toFixed(3), 0, +(lx / len).toFixed(3)];
    yaw = -Math.atan2(forward[0], forward[2]);
    yaw = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2); // Tripo output is axis aligned; snap to 90deg
    yaw = +yaw.toFixed(6) || 0;
  }

  return {
    joints,
    bones,
    rigged,
    height: bbox ? +(bbox.max[1] - bbox.min[1]).toFixed(5) : null,
    minY: bbox ? +bbox.min[1].toFixed(5) : null,
    bbox: bbox && { min: bbox.min.map((v) => +v.toFixed(5)), max: bbox.max.map((v) => +v.toFixed(5)) },
    forward,
    yaw,
    animations: root.listAnimations().map((a) => a.getName()),
  };
}

// ---------------------------------------------------------------- cache

export function createCache(avatarDir) {
  const file = path.join(avatarDir, 'cache.json');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const save = () => {
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    } catch {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }
  };
  return {
    get: (name) => data[normName(name)] || null,
    set(name, entry) {
      data[normName(name)] = { ...entry, name: String(name).trim(), updatedAt: new Date().toISOString() };
      save();
    },
    list: () => Object.values(data),
  };
}

// ---------------------------------------------------------------- full pipeline

/**
 * Runs the whole pipeline. Never throws; reports progress through onStatus(avatar).
 * opts: { photo: Buffer, mime, name, id, avatarDir, cache, use3d: boolean, reuseImage?, onStatus, gateImage?, gate3d? }
 * gateImage / gate3d: optional concurrency limiters (fn => Promise) for the Gemini and Tripo stages.
 * Returns the final avatar object.
 */
export async function runPipeline({
  photo, mime, name, id, avatarDir, cache, use3d = true, reuseImage = null, onStatus = () => {},
  gateImage = (fn) => fn(), gate3d = (fn) => fn(),
}) {
  const status = (a) => {
    try {
      onStatus(a);
    } catch (e) {
      log('onStatus error:', e.message);
    }
  };
  let image = null;
  try {
    await fsp.mkdir(avatarDir, { recursive: true });
    if (!reuseImage && !geminiConfigured()) {
      const a = { status: 'failed', error: 'no GEMINI_API_KEY' };
      status(a);
      return a;
    }
    let out;
    if (reuseImage) {
      // reuse a previously generated image (e.g. pregen adding 3D to an image-only cache entry)
      const buf = await fsp.readFile(path.join(avatarDir, path.basename(reuseImage)));
      out = { data: buf, mime: sniffMime(buf, 'image/png') };
      image = `/avatars/${path.basename(reuseImage)}`;
      log(`${name}: reusing image ${image}`);
    } else {
      status({ status: 'processing', stage: 'stylizing' });
      const t0 = Date.now();
      const raw = photo;
      photo = null; // raw upload is never written to disk; only the closure below holds it until Gemini returns
      out = await gateImage(() => restyle(raw, mime));
      const imgFile = `${id}.${extFor(out.mime)}`;
      await fsp.writeFile(path.join(avatarDir, imgFile), out.data);
      image = `/avatars/${imgFile}`;
      log(`${name}: image ready in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${imgFile}`);
    }
    status({ status: 'image', stage: use3d && process.env.TRIPO_API_KEY ? 'modeling' : 'done', image });

    if (!use3d || !process.env.TRIPO_API_KEY) {
      const a = { status: 'ready', image, glb: null, rigged: false };
      cache?.set(name, { image, glb: null, rigged: false });
      status(a);
      return a;
    }

    const glbFile = path.join(avatarDir, `${id}.glb`);
    const t1 = Date.now();
    const res = await gate3d(() =>
      withTimeout(
        tripoModel(out.data, out.mime, glbFile, (stage) => status({ status: 'image', stage, image })),
        9 * 60e3,
        'tripo pipeline timeout'
      )
    );
    log(`${name}: model ready in ${((Date.now() - t1) / 1000).toFixed(1)}s (tripo rigged=${res.rigged})`);

    let meta = { bones: {}, rigged: false, height: null, minY: null, joints: [] };
    try {
      meta = await inspectGlb(glbFile);
    } catch (e) {
      log('glb inspection failed:', e.message);
    }
    const rigged = !!(res.rigged && meta.rigged);
    const glb = `/avatars/${id}.glb`;
    const sidecar = { id, name, image, glb, rigged, tripoRigged: res.rigged, rigError: res.rigError, tripoModelTask: res.modelTask, ...meta };
    await fsp.writeFile(path.join(avatarDir, `${id}.json`), JSON.stringify(sidecar, null, 2));
    const a = { status: 'ready', image, glb, rigged, bones: meta.bones, height: meta.height, minY: meta.minY, yaw: meta.yaw ?? 0 };
    cache?.set(name, { image, glb, rigged, bones: meta.bones, height: meta.height, minY: meta.minY, yaw: meta.yaw ?? 0, meta: `/avatars/${id}.json` });
    status(a);
    return a;
  } catch (e) {
    log(`${name}: pipeline failed:`, e.stack || e.message);
    const a = { status: 'failed', error: String(e.message || e).slice(0, 300) };
    if (image) {
      a.image = image;
      // the image card is still a usable avatar: cache it unless we already have a better (3D) entry
      const prev = cache?.get(name);
      if (!prev?.glb) cache?.set(name, { image, glb: null, rigged: false });
    }
    status(a);
    return a;
  }
}
