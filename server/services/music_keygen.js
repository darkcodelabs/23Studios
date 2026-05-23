'use strict';

// music_keygen.js — Node wrapper around the Python keygenmusic scraper
// + tracker rendering + Playdate IMA ADPCM conversion.
//
// Pipeline:
//   1. fetchKeygenTracks(query, opts) → spawn python scraper, get the
//      first N tracker files from keygenmusic.tk's index, return manifest.
//   2. renderTrackerToWav(trackerPath, wavPath) → openmpt123 renders
//      .mod/.s3m/.xm/.it to 44.1kHz mono PCM WAV.
//   3. convertToPlaydate(wavPath, outPath) → ffmpeg encodes to IMA ADPCM
//      WAV mono 44.1kHz — Playdate's preferred format.

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const SCRAPER_DIR = path.join(__dirname, 'keygen_music');
const SCRAPER_PY = path.join(SCRAPER_DIR, 'scraper.py');

function which(bin) {
  try {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch (_e) { return null; }
}

const FFMPEG_BIN = which('ffmpeg');
const OPENMPT_BIN = which('openmpt123');
const XMP_BIN = which('xmp');
const PYTHON_BIN = which('python3') || which('python');

const TRACKER_EXTS = new Set(['.mod', '.s3m', '.xm', '.it', '.mptm', '.mtm', '.med', '.okt', '.dbm', '.psm']);

function isTrackerFile(p) {
  return TRACKER_EXTS.has(path.extname(p).toLowerCase());
}

// Run the scraper. The Python script downloads first 25 tracker files
// from keygenmusic.tk and writes a manifest.json. We don't take a query
// param — keygenmusic.tk doesn't expose search. Caller picks tracks from
// the returned manifest by group / scene keyword post-hoc.
async function fetchKeygenTracks(opts = {}) {
  const outDir = opts.outDir || path.join('/tmp', 'keygen_tracks');
  const limit = opts.limit || 25;

  if (!PYTHON_BIN) {
    throw new Error('python3 not on PATH — keygen scraper unavailable');
  }
  if (!fs.existsSync(SCRAPER_PY)) {
    throw new Error(`scraper not vendored at ${SCRAPER_PY}`);
  }

  await fsp.mkdir(outDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [SCRAPER_PY], {
      cwd: outDir,
      env: { ...process.env, TRACK_LIMIT: String(limit) }
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdout.on('data', () => {});  // scraper logs progress; ignore stdout
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`scraper exit ${code}: ${stderr.slice(0, 400)}`));
      }
      const manifestPath = path.join(outDir, 'downloads', 'keygenmusic', 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        // Normalize: each entry → { path, title, group, name, year, format }
        const tracks = (Array.isArray(manifest) ? manifest : manifest.tracks || []).map((t) => ({
          path: t.local_path || t.path || null,
          title: t.mdt || t.title || t.st || null,
          group: t.rg || t.group || null,
          name: t.sn || t.name || null,
          year: t.year || null,
          format: t.path ? path.extname(t.path).toLowerCase().slice(1) : null,
          raw: t
        })).filter((t) => t.path);
        resolve(tracks);
      } catch (e) {
        reject(new Error(`scraper manifest unreadable: ${e.message}`));
      }
    });
    proc.on('error', (e) => reject(e));
  });
}

async function renderTrackerToWav(trackerPath, wavPath) {
  if (!OPENMPT_BIN) throw new Error('openmpt123 not on PATH — cannot render tracker formats');
  return new Promise((resolve, reject) => {
    const proc = spawn(OPENMPT_BIN, [
      '--samplerate', '44100',
      '--channels', '1',
      '--render', trackerPath,
      '-o', wavPath,
      '--quiet'
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`openmpt123 exit ${code}: ${stderr.slice(0, 200)}`));
      resolve(wavPath);
    });
    proc.on('error', (e) => reject(e));
  });
}

async function convertToPlaydate(inputPath, outputPath) {
  if (!FFMPEG_BIN) throw new Error('ffmpeg not on PATH — cannot convert to Playdate IMA ADPCM');
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      '-i', inputPath,
      '-acodec', 'adpcm_ima_wav',
      '-ar', '44100',
      '-ac', '1',
      '-y',
      outputPath
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
      resolve(outputPath);
    });
    proc.on('error', (e) => reject(e));
  });
}

// Convenience: pull a tracker file → render to wav → encode IMA ADPCM →
// drop at <destDir>/<basename>.wav. Returns final path or null on fail.
async function fetchAndConvert(opts = {}) {
  const { destDir, scratchDir = '/tmp/keygen_work', limit = 5 } = opts;
  if (!destDir) throw new Error('destDir required');
  await fsp.mkdir(destDir, { recursive: true });
  await fsp.mkdir(scratchDir, { recursive: true });

  const tracks = await fetchKeygenTracks({ outDir: scratchDir, limit });
  const results = [];
  for (const t of tracks) {
    if (!t.path || !fs.existsSync(t.path)) continue;
    const stem = path.basename(t.path).replace(/\.[^.]+$/, '');
    const wavPath = path.join(scratchDir, stem + '.wav');
    const outPath = path.join(destDir, stem + '.wav');
    try {
      if (isTrackerFile(t.path)) {
        await renderTrackerToWav(t.path, wavPath);
      } else {
        // Non-tracker source (mp3 etc) — let ffmpeg handle the convert pass directly
        await convertToPlaydate(t.path, outPath);
        results.push({ ...t, output: outPath });
        continue;
      }
      await convertToPlaydate(wavPath, outPath);
      results.push({ ...t, output: outPath });
    } catch (e) {
      results.push({ ...t, error: e.message });
    }
  }
  return results;
}

function toolsAvailable() {
  return {
    python: !!PYTHON_BIN,
    ffmpeg: !!FFMPEG_BIN,
    openmpt123: !!OPENMPT_BIN,
    xmp: !!XMP_BIN,
    scraper: fs.existsSync(SCRAPER_PY)
  };
}

module.exports = {
  fetchKeygenTracks,
  renderTrackerToWav,
  convertToPlaydate,
  fetchAndConvert,
  toolsAvailable
};
