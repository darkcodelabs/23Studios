'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const sharp = require('sharp');

const projects = require('./projects');

// ----- Errors -----

function assetErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

// ----- Project / paths -----

const PULP_DIR_NAME = 'pulp_data';
const LAUNCHER_CARD_FILENAME = 'launcher_card.png';
const LAUNCHER_CARD_DIM = [350, 155];

async function loadProjectOrThrow(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) throw assetErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw assetErr(400, 'not_pulp_project');
  return project;
}

async function realDir(p) {
  try {
    const real = await fsp.realpath(p);
    const st = await fsp.lstat(real);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return real;
  } catch (_e) { return null; }
}

async function pulpDirFor(project) {
  if (!project || !project.local_path || !path.isAbsolute(project.local_path)) {
    throw assetErr(400, 'local_path_missing');
  }
  const baseReal = await realDir(project.local_path);
  if (!baseReal) throw assetErr(400, 'local_path_missing');
  const dir = path.join(baseReal, PULP_DIR_NAME);
  // Create if missing, then realpath-check.
  try { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); }
  catch (_e) { /* best-effort */ }
  const dirReal = await realDir(dir);
  if (!dirReal) throw assetErr(400, 'pulp_dir_invalid');
  // Must be inside the base.
  if (!(dirReal === path.join(baseReal, PULP_DIR_NAME))) {
    throw assetErr(400, 'pulp_dir_outside_project');
  }
  return dirReal;
}

function getLauncherCardPath(project) {
  // synchronous, naive join (callers must have validated project beforehand)
  if (!project || !project.local_path) return null;
  return path.join(project.local_path, PULP_DIR_NAME, LAUNCHER_CARD_FILENAME);
}

// ----- Per-project mutex (Promise chain) mirroring pulp_project.js -----

const chains = new Map();
function withLock(projectId, fn) {
  const prev = chains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(projectId, next.catch(() => {}));
  return next;
}

// ----- Filename / id sanitization -----

const PULP_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function rejectUnsafeFilename(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw assetErr(400, 'bad_filename');
  }
  if (name.includes('\0')) throw assetErr(400, 'bad_filename');
  if (name.includes('..')) throw assetErr(400, 'bad_filename');
  if (path.isAbsolute(name)) throw assetErr(400, 'bad_filename');
  if (name.includes('/') || name.includes('\\')) throw assetErr(400, 'bad_filename');
}

function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return name;
  return name.slice(0, idx);
}

function slugifyForId(name) {
  // Lowercase, replace non-alnum/_/- with -, collapse, trim leading non-alnum.
  let s = String(name || '').toLowerCase();
  s = s.replace(/[^a-z0-9_-]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^[-_]+/, '');
  if (!s) s = 'a';
  // Ensure starts alphanumeric
  if (!/^[a-z0-9]/.test(s)) s = 'a' + s;
  return s.slice(0, 56); // leave headroom for "uploaded_" prefix (9 chars) under 64
}

function makeUploadedId(prefix, baseName) {
  const slug = slugifyForId(stripExtension(baseName));
  const id = `${prefix}${slug}`.slice(0, 64);
  if (!PULP_ID_RE.test(id)) {
    throw assetErr(400, 'bad_filename');
  }
  return id;
}

// ----- Tile conversion -----

const TILE_PIXEL_COUNT = 256;

/**
 * convertPngToTileFrame(buffer) -> Promise<256-char string of '0'/'1'>
 * - sharp resize 16x16 kernel:'nearest' -> greyscale -> threshold > 127.
 * - Alpha == 0 always maps to '0'.
 */
async function convertPngToTileFrame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw assetErr(400, 'empty_file');
  }
  const { data, info } = await sharp(buffer)
    .resize(16, 16, { kernel: 'nearest', fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 16 || info.height !== 16) {
    throw assetErr(400, 'bad_image');
  }
  const channels = info.channels; // 4 (RGBA) after ensureAlpha
  if (channels < 3) {
    throw assetErr(400, 'bad_image');
  }
  const out = new Array(TILE_PIXEL_COUNT);
  for (let i = 0; i < TILE_PIXEL_COUNT; i++) {
    const off = i * channels;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    const a = channels >= 4 ? data[off + 3] : 255;
    if (a === 0) { out[i] = '0'; continue; }
    // Rec. 601 luma; treat ">127" as "on" (black-on tile pixel).
    // Contract: "threshold > 127 = '1'". Lower luminance == darker == on.
    // We invert so "dark pixel" -> '1'.
    const luma = (0.299 * r + 0.587 * g + 0.114 * b);
    const darkness = 255 - luma;
    out[i] = darkness > 127 ? '1' : '0';
  }
  return out.join('');
}

// ----- Sound spec inference -----

const FILENAME_HEURISTICS = [
  { re: /(click|tap|beep)/i, set: { waveform: 'square', duration_ms: 80 } },
  { re: /(noise|wind|static)/i, set: { waveform: 'noise' } },
  { re: /(sweep|sci|fi|scifi)/i, set: { sweep: true } }
];

function clamp(n, lo, hi) {
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function probeDurationMsViaFfprobe(filePath) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn('ffprobe', [
        '-v', 'error',
        '-i', filePath,
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0'
      ], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (_e) {
      return resolve(null);
    }
    let out = '';
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch (_e) { /* noop */ }
      finish(null);
    }, 3000);
    p.stdout.on('data', (d) => { out += d.toString(); if (out.length > 1024) out = out.slice(0, 1024); });
    p.on('error', () => { clearTimeout(timer); finish(null); });
    p.on('close', () => {
      clearTimeout(timer);
      const n = parseFloat(out.trim());
      if (!isFinite(n) || n <= 0) return finish(null);
      finish(Math.round(n * 1000));
    });
  });
}

function durationMsFromWavHeader(buffer) {
  // RIFF/WAVE PCM: bytes 0..3 "RIFF", 8..11 "WAVE", "fmt " chunk at offset 12.
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  if (buffer.slice(8, 12).toString('ascii') !== 'WAVE') return null;
  if (buffer.slice(12, 16).toString('ascii') !== 'fmt ') return null;
  try {
    // fmt chunk size at 16..19
    const fmtSize = buffer.readUInt32LE(16);
    // audioFormat (20..21), numChannels (22..23), sampleRate (24..27),
    // byteRate (28..31), blockAlign (32..33), bitsPerSample (34..35)
    const sampleRate = buffer.readUInt32LE(24);
    const byteRate = buffer.readUInt32LE(28);
    if (!byteRate || !sampleRate) return null;
    // Find "data" chunk after fmt chunk.
    let off = 20 + fmtSize;
    while (off + 8 <= buffer.length) {
      const id = buffer.slice(off, off + 4).toString('ascii');
      const sz = buffer.readUInt32LE(off + 4);
      if (id === 'data') {
        const ms = (sz / byteRate) * 1000;
        if (!isFinite(ms) || ms <= 0) return null;
        return Math.round(ms);
      }
      off += 8 + sz;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

/**
 * Best-effort duration inference.
 * Tries ffprobe (via temp file). Falls back to WAV header parsing.
 * Default 200 ms. Capped 50..5000.
 */
async function inferDurationMs(buffer, originalName) {
  // Try WAV header first (in-memory, no temp file).
  const wav = durationMsFromWavHeader(buffer);
  if (wav != null) return clamp(wav, 50, 5000);

  // Try ffprobe via a tempfile.
  const tmp = path.join(
    require('os').tmpdir(),
    `pulpasset_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`
  );
  try {
    await fsp.writeFile(tmp, buffer, { mode: 0o600 });
    const ms = await probeDurationMsViaFfprobe(tmp);
    if (ms != null) return clamp(ms, 50, 5000);
  } catch (_e) {
    /* fall through */
  } finally {
    fsp.unlink(tmp).catch(() => {});
  }
  return 200;
}

/**
 * inferSoundSpec(buffer, filename) -> Promise<spec>
 * spec lacks { id, name } — caller fills those.
 */
async function inferSoundSpec(buffer, filename) {
  const duration_ms = await inferDurationMs(buffer, filename);

  let waveform = 'square';
  let freq_start = 440;
  let freq_end = 440;
  let durationOverride = null;
  let sweep = false;

  for (const h of FILENAME_HEURISTICS) {
    if (!h.re.test(filename || '')) continue;
    if (h.set.waveform) waveform = h.set.waveform;
    if (h.set.duration_ms) durationOverride = h.set.duration_ms;
    if (h.set.sweep) sweep = true;
  }
  if (sweep) freq_end = Math.round(freq_start / 2);

  const finalDuration = durationOverride != null
    ? clamp(durationOverride, 50, 5000)
    : duration_ms;

  return {
    waveform,
    freq_start,
    freq_end,
    duration_ms: finalDuration,
    envelope: { attack: 5, decay: 50, sustain: 0.6, release: 80 }
  };
}

// ----- Launcher card -----

/**
 * convertLauncherCard(buffer) -> Promise<{ pngBuffer, dim:[w,h] }>
 * Resize cover-fit -> greyscale -> 1-bit threshold @ 50% -> PNG.
 */
async function convertLauncherCard(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw assetErr(400, 'empty_file');
  }
  const [w, h] = LAUNCHER_CARD_DIM;
  const pngBuffer = await sharp(buffer)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .greyscale()
    .threshold(128)
    .toColourspace('b-w')
    .png()
    .toBuffer();
  return { pngBuffer, dim: [w, h] };
}

async function saveLauncherCard(projectId, pngBuffer) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const dir = await pulpDirFor(project);
    const file = path.join(dir, LAUNCHER_CARD_FILENAME);
    // Atomic write via tmp + rename.
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fsp.writeFile(tmp, pngBuffer, { mode: 0o600 });
    await fsp.rename(tmp, file);
    return { file, size_bytes: pngBuffer.length };
  });
}

// ----- Multi-file tile import (no disk persistence here) -----

async function buildTileFromFile({ buffer, originalName, type, solid }) {
  const id = makeUploadedId('uploaded_', originalName);
  const frame = await convertPngToTileFrame(buffer);
  return {
    id,
    name: stripExtension(originalName).slice(0, 1024) || 'tile',
    type,
    solid: !!solid,
    frames: [{ pixels: frame }],
    fps: 0,
    script: ''
  };
}

async function buildSoundFromFile({ buffer, originalName }) {
  const id = makeUploadedId('uploaded_', originalName);
  const spec = await inferSoundSpec(buffer, originalName);
  return {
    id,
    name: stripExtension(originalName).slice(0, 1024) || 'sound',
    waveform: spec.waveform,
    freq_start: spec.freq_start,
    freq_end: spec.freq_end,
    duration_ms: spec.duration_ms,
    envelope: spec.envelope
  };
}

// ----- Validation helpers (callers pass parsed body field strings) -----

const VALID_TILE_TYPES = new Set(['world', 'sprite', 'item', 'exit', 'player']);

function normalizeTileType(s) {
  if (typeof s !== 'string') return 'sprite';
  return VALID_TILE_TYPES.has(s) ? s : 'sprite';
}

function normalizeSolidFlag(v) {
  if (v === true || v === 'true' || v === '1') return true;
  return false;
}

module.exports = {
  // service surface
  loadProjectOrThrow,
  pulpDirFor,
  getLauncherCardPath,
  convertPngToTileFrame,
  inferSoundSpec,
  convertLauncherCard,
  saveLauncherCard,
  buildTileFromFile,
  buildSoundFromFile,
  rejectUnsafeFilename,
  normalizeTileType,
  normalizeSolidFlag,
  assetErr,
  LAUNCHER_CARD_FILENAME,
  LAUNCHER_CARD_DIM
};
