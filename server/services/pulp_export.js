'use strict';

// Pulp .pdx export pipeline.
//
//  startExport({ project, target, onEvent }) -> { jobId, donePromise }
//  getJob(jobId) -> { id, project_id, status, pdx_path?, error? }
//
// Pipeline (each step emits a 'progress' event via onEvent):
//   1. validate    — transpile every script; abort if any errors
//   2. stage       — mkdir build tree under /tmp
//   3. runtime     — copy pulp_runtime_lua/* -> source/runtime/
//   4. data        — write source/assets/game_data.lua
//   5. tiles       — render 16x16 frames to PNG (sharp, manual fallback)
//   6. transpile   — emit per-script Lua files
//   7. main        — write source/main.lua + pdxinfo
//   8. pdc         — run Playdate SDK compiler (subprocess, shell:false)
//   9. publish     — copy pdx into <project.local_path>/pulp_build/

const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const pulpProject = require('./pulp_project');
const { transpile } = require('./pulp_transpiler');

let sharp = null;
let sharpLoadError = null;
try { sharp = require('sharp'); }
catch (e) { sharpLoadError = e && e.message ? e.message : String(e); }

const RUNTIME_DIR = path.join(__dirname, 'pulp_runtime_lua');
const ROOT_BUILD_DIR = path.join(os.tmpdir(), '23studios_build');

// Tile/room/sound IDs are already validated against
//   ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$
// when stored, but we re-check before any filesystem use.
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// In-memory job store. Jobs do not survive process restarts; that's fine —
// the route layer treats missing jobs as 404.
const JOBS = new Map();

function newJobId() {
  return 'job_' + crypto.randomBytes(8).toString('hex');
}

function safeId(id) {
  return typeof id === 'string' && SAFE_ID.test(id);
}

function emit(onEvent, evt) {
  if (typeof onEvent !== 'function') return;
  try { onEvent(evt); } catch (_e) { /* never let UI errors break export */ }
}

function progress(onEvent, step, pct, msg) {
  emit(onEvent, { type: 'progress', step, pct, msg });
}

function log(onEvent, text) {
  emit(onEvent, { type: 'log', text });
}

// ----- Lua serialization -------------------------------------------------

function luaString(s) {
  // Use long-bracket form to skip escape gymnastics; pick a level the string
  // can't contain.
  const str = (s == null) ? '' : String(s);
  for (let n = 0; n < 12; n++) {
    const eq = '='.repeat(n);
    if (!str.includes(`]${eq}]`)) {
      return `[${eq}[${str}]${eq}]`;
    }
  }
  // Fallback to escaped short string.
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

function luaValue(v, indent) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '0';
    return String(v);
  }
  if (typeof v === 'string') return luaString(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '{}';
    const parts = v.map((x) => padIn + luaValue(x, indent + 1));
    return '{\n' + parts.join(',\n') + '\n' + pad + '}';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const parts = keys.map((k) => {
      const keyStr = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${luaString(k)}]`;
      return `${padIn}${keyStr} = ${luaValue(v[k], indent + 1)}`;
    });
    return '{\n' + parts.join(',\n') + '\n' + pad + '}';
  }
  return 'nil';
}

function toLuaModule(data) {
  return 'return ' + luaValue(data, 0) + '\n';
}

// ----- PNG generation -----------------------------------------------------
//
// Generates a 1-bit (black/white) PNG from the "01" pixel string used by the
// Pulp tile schema. "1" -> black, "0" -> white. Tile dim is inferred from
// pixel string length (64 -> 8x8, 256 -> 16x16) so the same encoder handles
// both the canonical 8x8 Pulp tiles and legacy 16x16 SDK tiles.
//
// Prefers sharp for proper PNG output; falls back to a hand-rolled encoder
// (16x16 only — manual encoder hard-codes 1-bit greyscale at 16 px).

const PNG_FALLBACK_USED = { flag: false };

function tileDimForPixels(pixels) {
  if (typeof pixels !== 'string') return null;
  if (pixels.length === 256 && /^[01]{256}$/.test(pixels)) return 16;
  if (pixels.length === 64 && /^[01]{64}$/.test(pixels)) return 8;
  return null;
}

async function renderTilePng(pixels, outPath) {
  const dim = tileDimForPixels(pixels);
  if (!dim) throw new Error('invalid tile pixels');

  if (sharp) {
    const N = dim * dim;
    const buf = Buffer.alloc(N * 4);
    for (let i = 0; i < N; i++) {
      const v = pixels.charCodeAt(i) === 49 /* '1' */ ? 0 : 255;
      const off = i * 4;
      buf[off] = v;
      buf[off + 1] = v;
      buf[off + 2] = v;
      buf[off + 3] = 255;
    }
    await sharp(buf, { raw: { width: dim, height: dim, channels: 4 } })
      .png()
      .toFile(outPath);
    return { used_sharp: true, dim };
  }

  if (dim !== 16) {
    // The hand-rolled encoder is hard-coded for 16x16; if sharp is missing
    // and we have an 8x8 tile we can't safely fall back. This is a build-
    // time failure rather than silent corruption.
    throw new Error('no sharp + non-16 tile dim: cannot encode');
  }

  PNG_FALLBACK_USED.flag = true;
  await fsp.writeFile(outPath, encodePngManual(pixels));
  return { used_sharp: false, dim };
}

/**
 * renderTileTablePng(frames, dim, outPath)
 *   Spec Section 8 / Fix #2: write per-tile multi-frame images as a single
 *   `<id>-table-<W>-<H>.png` sprite sheet so pdc auto-detects cells from
 *   the filename. Cells are laid out left-to-right, top-to-bottom across
 *   a single horizontal strip.
 */
async function renderTileTablePng(frames, dim, outPath) {
  if (!sharp) {
    throw new Error('no sharp: cannot encode sprite table');
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('empty frames');
  }
  const count = frames.length;
  const W = dim * count;
  const H = dim;
  const out = Buffer.alloc(W * H * 4);
  // Pre-fill alpha = 255 for the whole sheet.
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  for (let fi = 0; fi < count; fi++) {
    const pixels = frames[fi] && frames[fi].pixels;
    const fd = tileDimForPixels(pixels);
    if (fd !== dim) {
      throw new Error(`frame ${fi} dim mismatch: expected ${dim}, got ${fd}`);
    }
    const xOff = fi * dim;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const sIdx = y * dim + x;
        const v = pixels.charCodeAt(sIdx) === 49 ? 0 : 255;
        const dIdx = (y * W + (xOff + x)) * 4;
        out[dIdx] = v;
        out[dIdx + 1] = v;
        out[dIdx + 2] = v;
        out[dIdx + 3] = 255;
      }
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(outPath);
  return { used_sharp: true, dim, count, sheet_dim: [W, H] };
}

// CRC32 (RFC 1952) and a minimal 1-bit greyscale (color type 0) PNG encoder.
// Only used if sharp can't be loaded.
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
function chunk(typeStr, data) {
  const type = Buffer.from(typeStr, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([len, type, data, crc]);
}
function deflateUncompressed(raw) {
  // Stream of stored blocks; one is enough for 32 bytes (well under 65535).
  const out = [];
  // zlib header: deflate, 32k window, default compression, no preset dict.
  out.push(Buffer.from([0x78, 0x01]));
  // Single final stored block.
  const head = Buffer.alloc(5);
  head[0] = 0x01;              // BFINAL=1, BTYPE=00 (stored)
  head.writeUInt16LE(raw.length, 1);
  head.writeUInt16LE(~raw.length & 0xffff, 3);
  out.push(head);
  out.push(raw);
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(raw), 0);
  out.push(adler);
  return Buffer.concat(out);
}
function encodePngManual(pixels) {
  // 16x16 1-bit, color type 0 (greyscale), 1 bit per sample.
  // Row = filter byte (0) + 2 packed bytes (16 bits / 8 = 2 bytes).
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let b0 = 0, b1 = 0;
    for (let x = 0; x < 16; x++) {
      const c = pixels.charCodeAt(y * 16 + x);
      // PNG greyscale: 0 = black, 1 = white. Pulp "1" = black -> bit 0.
      const bit = c === 49 ? 0 : 1;
      if (x < 8) b0 |= bit << (7 - x);
      else b1 |= bit << (7 - (x - 8));
    }
    rows.push(Buffer.from([0, b0, b1]));
  }
  const raw = Buffer.concat(rows);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0);  // width
  ihdr.writeUInt32BE(16, 4);  // height
  ihdr[8] = 1;                // bit depth
  ihdr[9] = 0;                // color type (greyscale)
  ihdr[10] = 0;               // compression
  ihdr[11] = 0;               // filter
  ihdr[12] = 0;               // interlace

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateUncompressed(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----- Pipeline ----------------------------------------------------------

async function copyDir(src, dst) {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(sp, dp);
    else if (e.isFile()) await fsp.copyFile(sp, dp);
  }
}

function collectTranspileErrors(project) {
  const all = [];
  function run(src, opts, label) {
    if (typeof src !== 'string' || !src.trim()) return null;
    const r = transpile(src, opts);
    if (r.errors && r.errors.length) {
      for (const err of r.errors) {
        all.push({ where: label, line: err.line, col: err.col, message: err.message });
      }
    }
    return r;
  }
  const game = run(project.game_script, { scope: 'game', namespace: 'game' }, 'game_script');
  const tiles = [];
  for (const t of project.tiles || []) {
    if (!safeId(t.id)) {
      all.push({ where: `tile:${t.id}`, message: 'unsafe tile id' });
      continue;
    }
    const r = run(t.script, { scope: 'tile', namespace: `tile_${t.id}` }, `tile:${t.id}`);
    if (r) tiles.push({ id: t.id, lua: r.lua });
  }
  const rooms = [];
  for (const r of project.rooms || []) {
    if (!safeId(r.id)) {
      all.push({ where: `room:${r.id}`, message: 'unsafe room id' });
      continue;
    }
    const tr = run(r.script, { scope: 'room', namespace: `room_${r.id}` }, `room:${r.id}`);
    if (tr) rooms.push({ id: r.id, lua: tr.lua });
  }
  return { errors: all, game, tiles, rooms };
}

function buildGameData(project) {
  // Strip the script source (codegen wrote it out separately) — keep only
  // data the runtime actually needs.
  return {
    name: project.name,
    author: project.author,
    version: project.version,
    config: project.config,
    player: project.player,
    tiles: (project.tiles || []).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      solid: !!t.solid,
      fps: t.fps,
      frame_count: (t.frames || []).length,
    })),
    rooms: (project.rooms || []).map((r) => ({
      id: r.id,
      name: r.name,
      song: r.song || '',
      grid: r.grid || [],
    })),
    sounds: (project.sounds || []).map((s) => ({
      id: s.id,
      name: s.name,
      waveform: s.waveform,
      freq_start: s.freq_start,
      freq_end: s.freq_end,
      duration_ms: s.duration_ms,
      envelope: s.envelope,
    })),
    songs: (project.songs || []).map((s) => ({
      id: s.id,
      name: s.name,
      bpm: s.bpm,
      loop_from: s.loop_from,
      tracks: s.tracks,
    })),
  };
}

function buildMainLua(transpiled) {
  const lines = [
    '-- Generated by 23studios pulp_export. Do not edit.',
    'import "CoreLibs/object"',
    'import "CoreLibs/graphics"',
    'import "CoreLibs/sprites"',
    'import "CoreLibs/timer"',
    '',
    'package.path = package.path .. ";source/?.lua"',
    '',
    "local pulp = require('runtime.pulp_runtime')",
    "local game_data = require('assets.game_data')",
    'if pulp.boot then pulp.boot(game_data) end',
    '',
  ];
  if (transpiled.game) lines.push("require('scripts.game')");
  for (const t of transpiled.tiles) lines.push(`require('scripts.tile_${t.id}')`);
  for (const r of transpiled.rooms) lines.push(`require('scripts.room_${r.id}')`);
  lines.push('');
  lines.push('if pulp.run then pulp.run() end');
  lines.push('');
  return lines.join('\n');
}

function buildPdxInfo(project, jobId) {
  // bundleID must be reverse-DNS-ish; sanitize project name to alnum.
  const safeName = (project.name || 'pulp').replace(/[^A-Za-z0-9]/g, '').slice(0, 32) || 'pulp';
  const buildNumber = Math.floor(Date.now() / 1000);
  return [
    `name=${project.name || 'Untitled'}`,
    `author=${project.author || ''}`,
    `description=Built by 23 Studios from Pulp project ${project.id || ''}`,
    `bundleID=com.23studios.${safeName.toLowerCase()}`,
    `version=${project.version || '0.1.0'}`,
    `buildNumber=${buildNumber}`,
    'imagePath=launcher',
    `buildJobId=${jobId}`,
    '',
  ].join('\n');
}

function findPdc() {
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, 'pdc' + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch (_e) { /* keep looking */ }
    }
  }
  return null;
}

function runPdc(pdcBin, sourceDir, outPdx, onEvent) {
  return new Promise((resolve, reject) => {
    const args = [sourceDir, outPdx];
    const child = spawn(pdcBin, args, { shell: false, windowsHide: true });
    child.stdout.on('data', (b) => {
      const s = b.toString('utf8');
      for (const line of s.split(/\r?\n/)) if (line) log(onEvent, '[pdc] ' + line);
    });
    child.stderr.on('data', (b) => {
      const s = b.toString('utf8');
      for (const line of s.split(/\r?\n/)) if (line) log(onEvent, '[pdc!] ' + line);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('pdc exited with code ' + code));
    });
  });
}

async function runExport(job, project, onEvent) {
  const jobId = job.id;
  const stageRoot = path.join(ROOT_BUILD_DIR, jobId);
  const sourceDir = path.join(stageRoot, 'source');
  const buildDir = path.join(stageRoot, 'build');
  const tilesDir = path.join(sourceDir, 'assets', 'tiles');
  const soundsDir = path.join(sourceDir, 'assets', 'sounds');
  const runtimeDir = path.join(sourceDir, 'runtime');
  const scriptsDir = path.join(sourceDir, 'scripts');
  const assetsDir = path.join(sourceDir, 'assets');

  job.stage_dir = stageRoot;
  job.status = 'running';

  // Step 1: validate
  progress(onEvent, 'validate', 5, 'transpiling scripts');
  const trans = collectTranspileErrors(project);
  if (trans.errors.length > 0) {
    const summary = trans.errors.slice(0, 8).map((e) => {
      const loc = e.line ? ` line ${e.line}:${e.col || 0}` : '';
      return `  - [${e.where}]${loc} ${e.message}`;
    }).join('\n');
    const more = trans.errors.length > 8 ? `\n  (+${trans.errors.length - 8} more)` : '';
    throw new Error('Script errors:\n' + summary + more);
  }
  log(onEvent, `transpile ok — game=${trans.game ? 1 : 0} tiles=${trans.tiles.length} rooms=${trans.rooms.length}`);

  // Step 2: stage
  progress(onEvent, 'stage', 15, 'preparing build tree');
  await fsp.rm(stageRoot, { recursive: true, force: true });
  await fsp.mkdir(sourceDir, { recursive: true });
  await fsp.mkdir(buildDir, { recursive: true });
  await fsp.mkdir(tilesDir, { recursive: true });
  await fsp.mkdir(soundsDir, { recursive: true });
  await fsp.mkdir(scriptsDir, { recursive: true });
  await fsp.mkdir(assetsDir, { recursive: true });

  // Step 3: copy runtime
  progress(onEvent, 'runtime', 25, 'copying pulp runtime');
  await copyDir(RUNTIME_DIR, runtimeDir);

  // Step 4: write game_data.lua
  progress(onEvent, 'data', 35, 'writing game_data.lua');
  const gameData = buildGameData(project);
  await fsp.writeFile(path.join(assetsDir, 'game_data.lua'), toLuaModule(gameData));

  // Step 5: render tile frames
  //
  // Spec Section 8 / Fix #2: multi-frame tiles emit a single
  //   <id>-table-<W>-<H>.png  sprite sheet so pdc recognizes them.
  // Single-frame tiles emit  <id>__0.png  for backward compat with the
  // runtime loader's existing per-frame fallback path.
  progress(onEvent, 'tiles', 45, 'rendering tile frames');
  let usedSharp = !!sharp;
  let renderedFrames = 0;
  let renderedTables = 0;
  let skippedFrames = 0;
  for (const t of project.tiles || []) {
    if (!safeId(t.id)) continue;
    const frames = Array.isArray(t.frames) ? t.frames : [];
    if (frames.length === 0) continue;

    if (frames.length > 1) {
      // Sprite-table emit (canonical Playdate sheet naming).
      const dim = tileDimForPixels(frames[0] && frames[0].pixels);
      if (!dim) {
        skippedFrames += frames.length;
        log(onEvent, `skip tile ${t.id}: invalid pixels for frame 0`);
        continue;
      }
      const out = path.join(tilesDir, `${t.id}-table-${dim}-${dim}.png`);
      try {
        const r = await renderTileTablePng(frames, dim, out);
        if (!r.used_sharp) usedSharp = false;
        renderedFrames += frames.length;
        renderedTables++;
      } catch (e) {
        skippedFrames += frames.length;
        log(onEvent, `skip tile ${t.id} table: ${e.message}`);
      }
      continue;
    }

    // Single-frame path.
    const frame = frames[0];
    const out = path.join(tilesDir, `${t.id}__0.png`);
    try {
      const r = await renderTilePng(frame.pixels, out);
      if (!r.used_sharp) usedSharp = false;
      renderedFrames++;
    } catch (e) {
      skippedFrames++;
      log(onEvent, `skip tile ${t.id} frame 0: ${e.message}`);
    }
  }
  log(onEvent, `rendered ${renderedFrames} tile frame(s) across ${renderedTables} sprite-table(s)`
    + (skippedFrames ? `, skipped ${skippedFrames}` : '')
    + ` (sharp=${usedSharp})`);
  if (!sharp) {
    log(onEvent, `WARN: sharp not loaded (${sharpLoadError}); used manual PNG encoder fallback`);
  }

  // Step 6: emit transpiled scripts
  progress(onEvent, 'transpile', 60, 'writing per-script lua');
  if (trans.game && trans.game.lua) {
    await fsp.writeFile(path.join(scriptsDir, 'game.lua'), trans.game.lua);
  }
  for (const t of trans.tiles) {
    await fsp.writeFile(path.join(scriptsDir, `tile_${t.id}.lua`), t.lua);
  }
  for (const r of trans.rooms) {
    await fsp.writeFile(path.join(scriptsDir, `room_${r.id}.lua`), r.lua);
  }

  // Step 7: write main.lua + pdxinfo
  progress(onEvent, 'main', 70, 'writing main.lua + pdxinfo');
  await fsp.writeFile(path.join(sourceDir, 'main.lua'), buildMainLua(trans));
  await fsp.writeFile(path.join(sourceDir, 'pdxinfo'), buildPdxInfo(project, jobId));

  // Step 8: pdc
  progress(onEvent, 'pdc', 80, 'invoking Playdate SDK compiler');
  const pdcBin = findPdc();
  const projectIdSafe = safeId(project.id) ? project.id : 'pulp_game';
  const outPdx = path.join(buildDir, `${projectIdSafe}.pdx`);
  if (!pdcBin) {
    throw new Error(
      'Playdate SDK compiler `pdc` not found on PATH. ' +
      'Install the Playdate SDK from https://play.date/dev/ and ensure `pdc` is on PATH.'
    );
  }
  log(onEvent, `using pdc at ${pdcBin}`);
  await runPdc(pdcBin, sourceDir, outPdx, onEvent);

  // pdc may produce either a .pdx file or a .pdx directory bundle — keep both
  // shapes; the route layer streams whatever's there.
  let pdxStat;
  try { pdxStat = await fsp.stat(outPdx); }
  catch (_e) { throw new Error('pdc finished but output missing: ' + outPdx); }

  // Step 9: publish into project's local_path/pulp_build/ (separate from the
  // host project's own `build/` so a pulp export doesn't shadow an SDK build).
  progress(onEvent, 'publish', 92, 'publishing pdx');
  let publishedPath = null;
  if (project.local_path && fs.existsSync(project.local_path)) {
    const projBuildDir = path.join(project.local_path, 'pulp_build');
    try {
      await fsp.mkdir(projBuildDir, { recursive: true });
      const dst = path.join(projBuildDir, `${projectIdSafe}.pdx`);
      if (pdxStat.isDirectory()) {
        await fsp.rm(dst, { recursive: true, force: true });
        await copyDir(outPdx, dst);
      } else {
        await fsp.copyFile(outPdx, dst);
      }
      publishedPath = dst;
      log(onEvent, `published to ${dst}`);
    } catch (e) {
      log(onEvent, `WARN: failed to publish into project tree: ${e.message}`);
    }
  } else {
    log(onEvent, 'WARN: project local_path missing; skipping publish step');
  }

  // Step 9.5: optional smoke test — if HAKCD's gold tools/smoke_test.sh ships
  // in the host project, shell out to verify the .pdx actually boots in the
  // Playdate simulator. Non-fatal: a failed smoke test logs a WARN but the
  // job still completes as 'done' so the user gets the .pdx download.
  const smokeScript = project.local_path
    ? path.join(project.local_path, 'tools', 'smoke_test.sh')
    : null;
  if (smokeScript && fs.existsSync(smokeScript) && publishedPath) {
    progress(onEvent, 'smoke', 96, 'running tools/smoke_test.sh');
    try {
      const { spawnSync } = require('child_process');
      const res = spawnSync(smokeScript, [publishedPath, '--allow-skip'], {
        cwd: project.local_path,
        shell: false,
        timeout: 45000,
        encoding: 'utf8'
      });
      if (res.stdout) for (const line of res.stdout.split(/\r?\n/)) if (line) log(onEvent, `[smoke] ${line}`);
      if (res.stderr) for (const line of res.stderr.split(/\r?\n/)) if (line) log(onEvent, `[smoke!] ${line}`);
      if (res.status === 0) {
        log(onEvent, 'smoke_test PASSED');
      } else {
        log(onEvent, `WARN: smoke_test exit ${res.status} — pdx may crash on Playdate`);
      }
    } catch (e) {
      log(onEvent, `WARN: smoke_test failed to launch: ${e.message}`);
    }
  }

  job.pdx_path = outPdx;
  job.published_path = publishedPath;
  job.is_dir = pdxStat.isDirectory();
  job.status = 'done';

  progress(onEvent, 'done', 100, 'export complete');
}

function startExport({ project, onEvent }) {
  if (!project || project.game_type !== 'pulp') {
    throw Object.assign(new Error('not_pulp_project'), { status: 400, code: 'not_pulp_project' });
  }
  const id = newJobId();
  const job = {
    id,
    project_id: project.id,
    status: 'pending',
    created_at: Date.now(),
    pdx_path: null,
    published_path: null,
    is_dir: false,
    error: null,
    stage_dir: null,
  };
  JOBS.set(id, job);

  const donePromise = (async () => {
    try {
      const r = await pulpProject.readPulp(project.id);
      await runExport(job, r.project, onEvent);
      emit(onEvent, { type: 'done', download_url: `/api/projects/${project.id}/pulp/export/jobs/${id}/download` });
    } catch (err) {
      job.status = 'error';
      job.error = err && err.message ? err.message : String(err);
      const errId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      emit(onEvent, { type: 'error', message: job.error, id: errId });
    }
  })();

  return { jobId: id, donePromise };
}

function getJob(jobId) {
  return JOBS.get(jobId) || null;
}

function getJobsByProject(projectId) {
  const out = [];
  for (const j of JOBS.values()) if (j.project_id === projectId) out.push(j);
  return out;
}

module.exports = {
  startExport,
  getJob,
  getJobsByProject,
  // exposed for tests / introspection
  _internals: {
    luaValue,
    toLuaModule,
    buildGameData,
    findPdc,
    tileDimForPixels,
    renderTilePng,
    renderTileTablePng,
    sharpAvailable: () => !!sharp,
    fallbackUsed: () => PNG_FALLBACK_USED.flag,
  },
};
