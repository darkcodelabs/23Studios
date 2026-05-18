'use strict';

// music_library
//
// Local-development helper for rendering scene-tracker modules (.mod, .s3m,
// .xm, .it, .mptm) into PCM WAV files, indexing them into a manifest, and
// picking a track for a given Pulp scene.
//
// LEGAL: tracker music sourced from keygenmusic.tk is for local development
// reference only. Do NOT bundle into a public release. This module prints a
// disclaimer to stderr on every seedLocalLibrary() call. See README.md in
// hakcd/tools/keygenmusic_scraper.

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const SUPPORTED_EXTS = new Set(['.mod', '.s3m', '.xm', '.it', '.mptm']);

const DISCLAIMER_LINES = [
  '[music_library] LEGAL: tracker music from keygenmusic.tk is for local',
  '[music_library] development reference only. Do NOT bundle into a public',
  '[music_library] release. See keygenmusic.tk/terms.'
];

function printDisclaimer() {
  for (const line of DISCLAIMER_LINES) {
    process.stderr.write(line + '\n');
  }
}

function makeError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  err.message = message;
  if (cause) err.cause = cause;
  return err;
}

function runCmd(cmd, args, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(makeError('spawn_failed', `failed to spawn ${cmd}: ${e.message}`, e));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) { /* noop */ }
      reject(makeError('timeout', `${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(makeError('spawn_failed', `${cmd} error: ${err.message}`, err));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(makeError('nonzero_exit', `${cmd} exit ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

async function commandExists(cmd) {
  try {
    await runCmd('which', [cmd], { timeoutMs: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function ffprobeMeta(wavPath) {
  // Returns { duration_ms, sample_rate, channels, codec }
  const { stdout } = await runCmd('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels,codec_name:format=duration',
    '-of', 'json',
    wavPath
  ]);
  let parsed;
  try { parsed = JSON.parse(stdout); }
  catch (e) { throw makeError('ffprobe_parse', `ffprobe json parse failed for ${wavPath}: ${e.message}`, e); }
  const stream = (parsed.streams && parsed.streams[0]) || {};
  const fmt = parsed.format || {};
  const durSec = parseFloat(fmt.duration);
  return {
    duration_ms: Number.isFinite(durSec) ? Math.round(durSec * 1000) : 0,
    sample_rate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : null,
    channels: stream.channels != null ? stream.channels : null,
    codec: stream.codec_name || null
  };
}

// Render a tracker module to WAV. Uses openmpt123 if available, otherwise
// xmp. Falls back to ffmpeg to coerce the rendered WAV to PCM s16le mono @
// targetHz if necessary.
async function renderTrack({ src, destWav, targetHz = 44100, channels = 1 }) {
  if (!src) throw makeError('bad_args', 'renderTrack: src required');
  if (!destWav) throw makeError('bad_args', 'renderTrack: destWav required');

  await fsp.mkdir(path.dirname(destWav), { recursive: true });

  const hasOpenMpt = await commandExists('openmpt123');
  const hasXmp = await commandExists('xmp');
  const hasFfmpeg = await commandExists('ffmpeg');

  if (!hasOpenMpt && !hasXmp) {
    throw makeError('no_converter',
      'no tracker renderer available: install openmpt123 (preferred) or xmp');
  }
  if (!hasFfmpeg) {
    throw makeError('no_converter',
      'ffmpeg required to coerce rendered wav to PCM s16le; install ffmpeg');
  }

  const rawWav = destWav + '.raw.wav';
  try {
    if (hasOpenMpt) {
      // openmpt123's --render mode writes <input>.wav next to the input —
      // there is no --output flag for individual file mode (only --output-type).
      // Strategy: render in place, then move the produced wav to rawWav.
      // The default output type is "auto" which yields wav.
      const sideWav = src + '.wav';
      try {
        await runCmd('openmpt123', [
          '--quiet',
          '--render',
          '--output-type', 'wav',
          '--samplerate', String(targetHz),
          '--channels', String(channels === 1 ? 1 : 2),
          src
        ]);
      } catch (e) {
        throw makeError('render_failed',
          `openmpt123 failed for ${src}: ${e.message}`, e);
      }
      try {
        await fsp.rename(sideWav, rawWav);
      } catch (e) {
        throw makeError('render_failed',
          `openmpt123 produced no output at ${sideWav}: ${e.message}`, e);
      }
    } else {
      // xmp fallback. xmp writes wav to stdout with --output-file -.
      try {
        await runCmd('xmp', [
          '-d', 'file',
          '--output-file', rawWav,
          '-c',
          src
        ]);
      } catch (e) {
        throw makeError('render_failed', `xmp failed for ${src}: ${e.message}`, e);
      }
    }

    // Coerce to PCM s16le mono @ targetHz with ffmpeg. This also normalises
    // any quirks left by the renderer (sample format, channel count, headers).
    try {
      await runCmd('ffmpeg', [
        '-y',
        '-loglevel', 'error',
        '-i', rawWav,
        '-ac', String(channels === 1 ? 1 : 2),
        '-ar', String(targetHz),
        '-c:a', 'pcm_s16le',
        destWav
      ]);
    } catch (e) {
      throw makeError('render_failed', `ffmpeg coerce failed for ${src}: ${e.message}`, e);
    }

    const stat = await fsp.stat(destWav);
    const meta = await ffprobeMeta(destWav);
    return {
      src,
      destWav,
      duration_ms: meta.duration_ms,
      bytes: stat.size
    };
  } finally {
    try { await fsp.unlink(rawWav); } catch (_) { /* noop */ }
  }
}

async function walkSourceDir(sourceDir) {
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  } catch (e) {
    throw makeError('source_unreadable', `cannot read sourceDir ${sourceDir}: ${e.message}`, e);
  }
  for (const ent of entries) {
    const full = path.join(sourceDir, ent.name);
    if (ent.isDirectory()) {
      const nested = await walkSourceDir(full);
      out.push(...nested);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        out.push({ src: full, ext, name: ent.name });
      }
    }
  }
  return out;
}

// HAKCD keygen convention: "<composer> - <rest>.<ext>"
function parseComposer(basename) {
  const noExt = basename.replace(/\.[^.]+$/, '');
  const m = noExt.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (m) return { composer: m[1].trim(), rest: m[2].trim() };
  return { composer: null, rest: noExt };
}

function safeStem(name) {
  // Keep human-readable but filesystem-safe stem (used for dest .wav name).
  return name.replace(/\.[^.]+$/, '');
}

async function seedLocalLibrary({ destDir, sourceDir, limit = null }) {
  printDisclaimer();

  if (!destDir) throw makeError('bad_args', 'seedLocalLibrary: destDir required');
  if (!sourceDir) throw makeError('bad_args', 'seedLocalLibrary: sourceDir required');

  await fsp.mkdir(destDir, { recursive: true });

  const all = await walkSourceDir(sourceDir);
  all.sort((a, b) => a.name.localeCompare(b.name));
  const picked = (limit && limit > 0) ? all.slice(0, limit) : all;

  const manifest = [];
  const skipped = [];
  const errors = [];

  for (const item of picked) {
    const stem = safeStem(item.name);
    const destWav = path.join(destDir, stem + '.wav');
    const { composer } = parseComposer(item.name);
    const format = item.ext.replace(/^\./, '');
    const id = stem;

    let needsRender = true;
    try {
      const [destStat, srcStat] = await Promise.all([
        fsp.stat(destWav).catch(() => null),
        fsp.stat(item.src)
      ]);
      if (destStat && destStat.mtimeMs >= srcStat.mtimeMs) {
        needsRender = false;
      }
    } catch (_) {
      needsRender = true;
    }

    if (!needsRender) {
      try {
        const stat = await fsp.stat(destWav);
        const meta = await ffprobeMeta(destWav);
        manifest.push({
          id,
          source: item.src,
          wav: destWav,
          duration_ms: meta.duration_ms,
          bytes: stat.size,
          composer,
          format
        });
        skipped.push({ id, reason: 'dest_newer_than_source' });
        continue;
      } catch (e) {
        // ffprobe failed on existing dest; re-render.
        needsRender = true;
      }
    }

    try {
      const rendered = await renderTrack({ src: item.src, destWav });
      manifest.push({
        id,
        source: item.src,
        wav: rendered.destWav,
        duration_ms: rendered.duration_ms,
        bytes: rendered.bytes,
        composer,
        format
      });
    } catch (e) {
      errors.push({
        id,
        source: item.src,
        code: e.code || 'render_failed',
        message: e.message
      });
    }
  }

  const manifestPath = path.join(destDir, 'manifest.json');
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { destDir, manifest, skipped, errors };
}

// Heuristic: "short scenes" (title / menu / intro) want sub-90s tracks.
function isShortSceneType(scene) {
  if (!scene) return false;
  const hay = `${(scene.name || '')} ${(scene.type || '')}`.toLowerCase();
  return /\b(title|menu|intro)\b/.test(hay);
}

let _rrCursor = 0;

function pickForScene({ library, scene, used = new Set() }) {
  if (!Array.isArray(library) || library.length === 0) {
    return { trackId: null, reason: 'empty_library' };
  }
  const wantShort = isShortSceneType(scene);
  const SHORT_MS = 90 * 1000;

  const candidates = library.filter(t => !used.has(t.id));
  const pool = candidates.length ? candidates : library;

  if (wantShort) {
    const short = pool.filter(t => Number.isFinite(t.duration_ms) && t.duration_ms > 0 && t.duration_ms < SHORT_MS);
    if (short.length) {
      const t = short[_rrCursor % short.length];
      _rrCursor += 1;
      return { trackId: t.id, reason: 'short_scene_match' };
    }
  }

  const t = pool[_rrCursor % pool.length];
  _rrCursor += 1;
  return {
    trackId: t.id,
    reason: candidates.length ? 'round_robin' : 'round_robin_reused'
  };
}

module.exports = {
  renderTrack,
  seedLocalLibrary,
  pickForScene
};
