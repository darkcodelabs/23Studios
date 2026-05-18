'use strict';

// Procedural baseline SFX generator. Port of HAKCD's gen_sfx.py
// (.claude/skills/playdate-dev/scripts/gen_sfx.py). Pure Node — writes
// mono 22050 Hz 16-bit PCM WAVs with no native deps.
//
// Six presets: click, select, deny, kombo_hit, alert, coin.
// Output matches HAKCD's source/sounds/ format exactly so generated
// files drop in beside hand-authored content.
//
// Usage:
//   const sfx = require('./sfx_synth');
//   await sfx.generateBaseline({ destDir: '/path/sounds' });
//   await sfx.generateOne({ name: 'coin', destPath: '/path/coin.wav' });

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const PEAK_AMPLITUDE = 0.85;

// ---------- WAV writer ----------

function writeWav(destPath, samplesF32) {
  // Clip + quantize to int16
  const n = samplesF32.length;
  const dataBytes = n * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // fmt chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < n; i++) {
    let s = samplesF32[i];
    if (s > 1) s = 1; else if (s < -1) s = -1;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
}

// ---------- DSP helpers ----------

function envelope(n, attackFrac, releaseFrac) {
  let a = Math.max(1, Math.floor(n * attackFrac));
  let r = Math.max(1, Math.floor(n * releaseFrac));
  let s = n - a - r;
  if (s < 0) {
    s = 0;
    a = Math.min(a, n >> 1);
    r = n - a;
  }
  const env = new Float32Array(n);
  for (let i = 0; i < a; i++) env[i] = i / (a - 1 || 1);
  for (let i = 0; i < s; i++) env[a + i] = 1;
  for (let i = 0; i < r; i++) env[a + s + i] = 1 - i / (r - 1 || 1);
  return env;
}

function expDecay(n, k) {
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.exp(-(i / (n - 1)) * k);
  return env;
}

// Generate square wave from per-sample frequency array. Phase accumulated
// in cycles to avoid drift over long signals.
function squareWave(freqs) {
  const n = freqs.length;
  const out = new Float32Array(n);
  let phase = 0;
  const dt = 1 / SAMPLE_RATE;
  for (let i = 0; i < n; i++) {
    phase += freqs[i] * dt;
    out[i] = Math.sin(2 * Math.PI * phase) >= 0 ? 1 : -1;
  }
  return out;
}

function noise(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
  return out;
}

function linspaceConst(n, value) {
  const arr = new Float32Array(n);
  arr.fill(value);
  return arr;
}

function linspaceRange(n, from, to) {
  const arr = new Float32Array(n);
  const step = (to - from) / (n - 1 || 1);
  for (let i = 0; i < n; i++) arr[i] = from + step * i;
  return arr;
}

function multiplyTriple(a, b, scalar) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * b[i] * scalar;
  return out;
}

function sumThree(a, b, c) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i] + c[i]) / 3;
  return out;
}

function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// ---------- Presets ----------

function presetClick({ duration = 0.04 } = {}) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const sig = noise(n);
  const env = expDecay(n, 7);
  return multiplyTriple(sig, env, PEAK_AMPLITUDE);
}

function presetSelect({ duration = 0.12, start_hz = 600, end_hz = 1400 } = {}) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const freqs = linspaceRange(n, start_hz, end_hz);
  const sig = squareWave(freqs);
  const env = envelope(n, 0.05, 0.3);
  return multiplyTriple(sig, env, PEAK_AMPLITUDE);
}

function presetDeny({ duration = 0.2, start_hz = 500, end_hz = 180 } = {}) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const freqs = linspaceRange(n, start_hz, end_hz);
  const sig = squareWave(freqs);
  const env = envelope(n, 0.02, 0.5);
  return multiplyTriple(sig, env, PEAK_AMPLITUDE);
}

function presetKomboHit({ duration = 0.4, root_hz = 440 } = {}) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const third = root_hz * (5 / 4);
  const fifth = root_hz * (3 / 2);
  const s1 = squareWave(linspaceConst(n, root_hz));
  const s3 = squareWave(linspaceConst(n, third));
  const s5 = squareWave(linspaceConst(n, fifth));
  const mix = sumThree(s1, s3, s5);
  const env = expDecay(n, 4);
  return multiplyTriple(mix, env, PEAK_AMPLITUDE);
}

function presetAlert({ duration = 0.6, hi_hz = 880, lo_hz = 660, rate_hz = 8 } = {}) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const freqs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const toggle = Math.sin(2 * Math.PI * rate_hz * t) >= 0 ? 1 : 0;
    freqs[i] = lo_hz + (hi_hz - lo_hz) * toggle;
  }
  const sig = squareWave(freqs);
  const env = envelope(n, 0.02, 0.1);
  return multiplyTriple(sig, env, PEAK_AMPLITUDE);
}

function presetCoin({ duration = 0.25, low_hz = 660, high_hz = 990 } = {}) {
  const shortN = Math.floor(SAMPLE_RATE * 0.06);
  const longN = Math.floor(SAMPLE_RATE * (duration - 0.06));
  const f1 = linspaceConst(shortN, low_hz);
  const f2 = linspaceConst(longN, high_hz);
  const sig = concat(squareWave(f1), squareWave(f2));
  const env = envelope(sig.length, 0.02, 0.4);
  return multiplyTriple(sig, env, PEAK_AMPLITUDE);
}

const PRESETS = Object.freeze({
  click:     presetClick,
  select:    presetSelect,
  deny:      presetDeny,
  kombo_hit: presetKomboHit,
  alert:     presetAlert,
  coin:      presetCoin
});

const BASELINE_NAMES = Object.freeze(['click', 'select', 'deny', 'kombo_hit', 'alert', 'coin']);

// ---------- Public API ----------

function generateOne({ name, destPath, opts = {} }) {
  const fn = PRESETS[name];
  if (!fn) {
    const e = new Error('unknown_preset: ' + name);
    e.code = 'unknown_preset';
    throw e;
  }
  const samples = fn(opts);
  writeWav(destPath, samples);
  return {
    name,
    path: destPath,
    ms: Math.round((samples.length / SAMPLE_RATE) * 1000),
    bytes: fs.statSync(destPath).size
  };
}

function generateBaseline({ destDir }) {
  if (!destDir) {
    const e = new Error('generateBaseline: destDir required');
    e.code = 'bad_args';
    throw e;
  }
  fs.mkdirSync(destDir, { recursive: true });
  const out = {};
  for (const name of BASELINE_NAMES) {
    const destPath = path.join(destDir, name + '.wav');
    out[name] = generateOne({ name, destPath });
  }
  return out;
}

module.exports = {
  generateOne,
  generateBaseline,
  BASELINE_NAMES,
  PRESETS,
  SAMPLE_RATE,
  _internals: { writeWav, envelope, squareWave, noise }
};
