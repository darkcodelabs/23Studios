'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const sharp = require('sharp');

const projects = require('./projects');
const dither = require('./dither');

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
const LAUNCHER_ICON_FILENAME = 'launcher_icon.png';
const LAUNCHER_ICON_DIM = [32, 32];
const LAUNCH_IMAGE_FILENAME = 'launch_image.png';
const LAUNCH_IMAGE_DIM = [400, 240];

// Spec Section 7: tiles default to Bayer 4x4 ordered dither (preserves crisp
// edges at 8x8 / 16x16; Floyd-Steinberg destroys tile readability).
const TILE_DITHER_DEFAULT = 'bayer4';
// Spec Section 5: minimum recommended sprite source size is 32x32; smaller
// inputs are accepted but flagged.
const MIN_SPRITE_SOURCE_PX = 32;

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

function pixelCountForDim(dim) {
  if (dim === 8) return 64;
  if (dim === 16) return 256;
  throw assetErr(400, 'bad_tile_dim');
}

function normalizeTileDim(v) {
  // Accept 8 / 16 / "8" / "16". Anything else falls back to 8 (spec default
  // for pulp; SDK call-sites must pass tileDim:16 explicitly).
  if (v === 8 || v === '8') return 8;
  if (v === 16 || v === '16') return 16;
  return 8;
}

function normalizeTileDither(v) {
  if (typeof v === 'string' && dither.isValidAlgo(v)) return v;
  return TILE_DITHER_DEFAULT;
}

/**
 * convertPngToTileFrameEx(buffer, opts?) -> Promise<{ pixels, src_dim }>
 *   opts.tileDim  8 (default) | 16
 *   opts.dither   any dither.isValidAlgo() name (default 'bayer4')
 *
 * Pipeline:
 *   1. sharp probe (capture pre-resize w/h for the legibility warning)
 *   2. sharp resize -> nearest -> greyscale -> raw
 *   3. dither.<algo>() to 1-bit
 *   4. emit "0"/"1" string of length 64 or 256; alpha 0 always maps to '0'
 */
async function convertPngToTileFrameEx(buffer, opts) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw assetErr(400, 'empty_file');
  }
  const tileDim = normalizeTileDim(opts && opts.tileDim);
  const algo = normalizeTileDither(opts && opts.dither);
  const N = pixelCountForDim(tileDim);

  // Probe pre-resize dims (best-effort; failures don't block conversion).
  let srcDim = [0, 0];
  try {
    const meta = await sharp(buffer).metadata();
    if (meta && Number.isInteger(meta.width) && Number.isInteger(meta.height)) {
      srcDim = [meta.width, meta.height];
    }
  } catch (_e) { /* keep [0,0] */ }

  // Pull greyscale + alpha (separate channel so we can preserve alpha=0
  // pixels through the dither).
  const { data, info } = await sharp(buffer)
    .resize(tileDim, tileDim, { kernel: 'nearest', fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== tileDim || info.height !== tileDim) {
    throw assetErr(400, 'bad_image');
  }
  const channels = info.channels; // 4 after ensureAlpha
  if (channels < 3) throw assetErr(400, 'bad_image');

  // Build a greyscale buffer + an alpha mask for the dither step. We feed
  // the dither pure luma; for alpha-0 pixels we override to '0' after.
  const gray = new Uint8Array(N);
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const off = i * channels;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    const a = channels >= 4 ? data[off + 3] : 255;
    // Rec.601 luma.
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    alpha[i] = a;
  }

  const dithered = dither.dither(algo, gray, tileDim, tileDim, 128);

  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    if (alpha[i] === 0) { out[i] = '0'; continue; }
    // dither returns 0 (black) or 255 (white). Pulp "1" = on/black pixel.
    out[i] = dithered[i] === 0 ? '1' : '0';
  }
  return { pixels: out.join(''), src_dim: srcDim };
}

/**
 * convertPngToTileFrame(buffer, opts?) -> Promise<string>
 *
 * Legacy facade preserved for Wave-1/2 callers (e.g. pulp_autopilot). Returns
 * just the pixel string. New callers should prefer convertPngToTileFrameEx
 * which also returns src_dim for the legibility warning.
 *
 * Default behavior changed in this revision: pulp tile frames are now 8x8
 * with Bayer 4x4 dither per spec. Pass opts.tileDim=16 to keep the SDK
 * tile size for callers that still want it.
 */
async function convertPngToTileFrame(buffer, opts) {
  const r = await convertPngToTileFrameEx(buffer, opts);
  return r.pixels;
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

// ----- Audio normalize (44.1 kHz mono PCM s16le) -----
//
// Spec Section 2.7: Playdate audio runs at 44,100 Hz. We pipe imports through
// `ffmpeg -ar 44100 -ac 1 -acodec pcm_s16le` so on-disk samples match the
// hardware. If ffmpeg is not on PATH (or fails), we log a warning and accept
// the original buffer as-is — never block the upload on a missing dep.

const PLAYDATE_SAMPLE_RATE = 44100;
let _ffmpegProbed = false;
let _ffmpegOk = false;

function probeFfmpeg() {
  if (_ffmpegProbed) return _ffmpegOk;
  _ffmpegProbed = true;
  try {
    const which = require('child_process').spawnSync(
      process.platform === 'win32' ? 'where' : 'which',
      ['ffmpeg'],
      { shell: false, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 }
    );
    _ffmpegOk = which && which.status === 0
      && typeof which.stdout !== 'undefined'
      && which.stdout.toString().trim().length > 0;
  } catch (_e) {
    _ffmpegOk = false;
  }
  return _ffmpegOk;
}

/**
 * normalizeAudioBuffer(buffer, originalName) -> Promise<{ buffer, normalized, sample_rate, warning? }>
 *
 * If ffmpeg is on PATH, transcodes to 44.1 kHz mono PCM s16le WAV and returns
 * the converted buffer. Otherwise returns the input untouched with a warning.
 */
async function normalizeAudioBuffer(buffer, originalName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw assetErr(400, 'empty_file');
  }
  if (!probeFfmpeg()) {
    return {
      buffer,
      normalized: false,
      sample_rate: null,
      warning: 'ffmpeg_unavailable — kept original sample rate'
    };
  }
  const os = require('os');
  const tag = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inExt = (() => {
    const m = /\.([a-z0-9]{1,8})$/i.exec(originalName || '');
    return m ? '.' + m[1].toLowerCase() : '.bin';
  })();
  const tmpIn = path.join(os.tmpdir(), `pulp_audio_in_${tag}${inExt}`);
  const tmpOut = path.join(os.tmpdir(), `pulp_audio_out_${tag}.wav`);
  try {
    await fsp.writeFile(tmpIn, buffer, { mode: 0o600 });
    const ok = await new Promise((resolve) => {
      const child = spawn('ffmpeg', [
        '-y',
        '-loglevel', 'error',
        '-i', tmpIn,
        '-ar', String(PLAYDATE_SAMPLE_RATE),
        '-ac', '1',
        '-acodec', 'pcm_s16le',
        tmpOut
      ], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_e) { /* noop */ }
        finish(false);
      }, 8000);
      child.on('error', () => { clearTimeout(timer); finish(false); });
      child.on('close', (code) => { clearTimeout(timer); finish(code === 0); });
    });
    if (!ok) {
      return {
        buffer,
        normalized: false,
        sample_rate: null,
        warning: 'ffmpeg_failed — kept original sample rate'
      };
    }
    const out = await fsp.readFile(tmpOut);
    return {
      buffer: out,
      normalized: true,
      sample_rate: PLAYDATE_SAMPLE_RATE
    };
  } finally {
    fsp.unlink(tmpIn).catch(() => {});
    fsp.unlink(tmpOut).catch(() => {});
  }
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

// ----- Launcher icon (32x32) + launch image (400x240) -----
//
// Spec Section 2.6 / Fix #5: SDK launcher expects icon.png (32x32) and
// launchImage.png (400x240, no alpha). Same upload / generate / GET shape as
// launcher-card, just two more files. Set-and-forget — no reprocess needed.

function getLauncherIconPath(project) {
  if (!project || !project.local_path) return null;
  return path.join(project.local_path, PULP_DIR_NAME, LAUNCHER_ICON_FILENAME);
}

function getLaunchImagePath(project) {
  if (!project || !project.local_path) return null;
  return path.join(project.local_path, PULP_DIR_NAME, LAUNCH_IMAGE_FILENAME);
}

async function convertLauncherIcon(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw assetErr(400, 'empty_file');
  }
  const [w, h] = LAUNCHER_ICON_DIM;
  // 32x32 icon: keep alpha so the list-view background shows through, but
  // threshold the colour channel so we end up 1-bit.
  const pngBuffer = await sharp(buffer)
    .resize(w, h, { fit: 'cover', position: 'centre', kernel: 'nearest' })
    .greyscale()
    .threshold(128)
    .png()
    .toBuffer();
  return { pngBuffer, dim: [w, h] };
}

async function convertLaunchImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw assetErr(400, 'empty_file');
  }
  const [w, h] = LAUNCH_IMAGE_DIM;
  // Launch image must NOT have alpha per spec (loading screen).
  const pngBuffer = await sharp(buffer)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .greyscale()
    .threshold(128)
    .toColourspace('b-w')
    .removeAlpha()
    .png()
    .toBuffer();
  return { pngBuffer, dim: [w, h] };
}

async function saveLauncherIcon(projectId, pngBuffer) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const dir = await pulpDirFor(project);
    const file = path.join(dir, LAUNCHER_ICON_FILENAME);
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fsp.writeFile(tmp, pngBuffer, { mode: 0o600 });
    await fsp.rename(tmp, file);
    return { file, size_bytes: pngBuffer.length };
  });
}

async function saveLaunchImage(projectId, pngBuffer) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const dir = await pulpDirFor(project);
    const file = path.join(dir, LAUNCH_IMAGE_FILENAME);
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fsp.writeFile(tmp, pngBuffer, { mode: 0o600 });
    await fsp.rename(tmp, file);
    return { file, size_bytes: pngBuffer.length };
  });
}

// ----- Multi-file tile import (no disk persistence here) -----

async function buildTileFromFile({ buffer, originalName, type, solid, tileDim, dither: ditherAlgo }) {
  const id = makeUploadedId('uploaded_', originalName);
  const { pixels, src_dim } = await convertPngToTileFrameEx(buffer, {
    tileDim,
    dither: ditherAlgo
  });
  const tile = {
    id,
    name: stripExtension(originalName).slice(0, 1024) || 'tile',
    type,
    solid: !!solid,
    frames: [{ pixels }],
    fps: 0,
    script: ''
  };
  // Spec Section 5: warn (don't fail) when source asset is smaller than the
  // 32x32 minimum recommended sprite size.
  const warnings = [];
  if (Array.isArray(src_dim) && src_dim.length === 2
      && src_dim[0] > 0 && src_dim[1] > 0
      && (src_dim[0] < MIN_SPRITE_SOURCE_PX || src_dim[1] < MIN_SPRITE_SOURCE_PX)) {
    warnings.push(
      `undersized_source — recommend >=${MIN_SPRITE_SOURCE_PX}x${MIN_SPRITE_SOURCE_PX} `
      + `for legibility (got ${src_dim[0]}x${src_dim[1]})`
    );
  }
  return { tile, warnings, src_dim };
}

async function buildSoundFromFile({ buffer, originalName }) {
  const id = makeUploadedId('uploaded_', originalName);
  // Spec Section 2.7 / Fix #3: normalize to 44.1 kHz mono PCM s16le before
  // probing. Duration inference reads the normalized header so we get the
  // post-conversion duration too.
  const norm = await normalizeAudioBuffer(buffer, originalName);
  const spec = await inferSoundSpec(norm.buffer, originalName);
  const sound = {
    id,
    name: stripExtension(originalName).slice(0, 1024) || 'sound',
    waveform: spec.waveform,
    freq_start: spec.freq_start,
    freq_end: spec.freq_end,
    duration_ms: spec.duration_ms,
    envelope: spec.envelope
  };
  const warnings = [];
  if (norm.warning) warnings.push(norm.warning);
  return { sound, warnings, normalized: norm.normalized, sample_rate: norm.sample_rate };
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
  getLauncherIconPath,
  getLaunchImagePath,
  convertPngToTileFrame,
  convertPngToTileFrameEx,
  inferSoundSpec,
  normalizeAudioBuffer,
  convertLauncherCard,
  convertLauncherIcon,
  convertLaunchImage,
  saveLauncherCard,
  saveLauncherIcon,
  saveLaunchImage,
  buildTileFromFile,
  buildSoundFromFile,
  rejectUnsafeFilename,
  normalizeTileType,
  normalizeSolidFlag,
  normalizeTileDim,
  normalizeTileDither,
  probeFfmpeg,
  assetErr,
  TILE_DITHER_DEFAULT,
  MIN_SPRITE_SOURCE_PX,
  PLAYDATE_SAMPLE_RATE,
  LAUNCHER_CARD_FILENAME,
  LAUNCHER_CARD_DIM,
  LAUNCHER_ICON_FILENAME,
  LAUNCHER_ICON_DIM,
  LAUNCH_IMAGE_FILENAME,
  LAUNCH_IMAGE_DIM
};
