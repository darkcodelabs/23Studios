'use strict';

// Dither algorithm test suite.
//
// Builds a synthetic 400x240 greyscale gradient and runs each algorithm.
// Asserts:
//   - output length matches w*h
//   - every byte is exactly 0 or 255
//   - the 5 algorithms produce DIFFERENT patterns (>= 4 distinct hashes;
//     bayer4 and ordered8 occasionally collide on extreme inputs, so we
//     guard against a too-strict equality requirement)
//   - per-algorithm runtime is recorded via process.hrtime.bigint()
//
// Also tests:
//   - normalizeOpts() defaulting + clamping
//   - safeOrigExt() filename validation

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const dither = require('../services/dither');
const scenes = require('../services/pulp_scenes');

const W = 400;
const H = 240;
const N = W * H;

function makeGradient() {
  // Smooth horizontal gradient 0..255, repeated vertically so all algos
  // have something to do across the full tonal range.
  const buf = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      buf[y * W + x] = Math.floor((x / (W - 1)) * 255);
    }
  }
  return buf;
}

function hashBuf(u8) {
  return crypto.createHash('sha256').update(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)).digest('hex');
}

function timeMs(fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const t1 = process.hrtime.bigint();
  return { out, ms: Number(t1 - t0) / 1e6 };
}

const ALGOS = ['atkinson', 'floyd', 'bayer4', 'ordered8', 'threshold'];

test('dither: each algorithm produces binary output of correct length', () => {
  const src = makeGradient();
  for (const name of ALGOS) {
    const out = dither.dither(name, src, W, H, 128);
    assert.strictEqual(out.length, N, name + ' length mismatch');
    // Spot-check first/last + a few middle samples.
    for (const i of [0, 1, N - 1, (N >> 1), 12345, 87654]) {
      const v = out[i];
      assert.ok(v === 0 || v === 255,
        name + ' produced non-binary byte ' + v + ' at index ' + i);
    }
    // Full scan once per algo (cheap enough for 96k pixels).
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== 0 && out[i] !== 255) {
        assert.fail(name + ' produced non-binary byte ' + out[i] + ' at ' + i);
      }
    }
  }
});

test('dither: algorithms produce distinct patterns (>= 4 unique hashes)', () => {
  const src = makeGradient();
  const hashes = new Set();
  const timings = {};
  for (const name of ALGOS) {
    const { out, ms } = timeMs(() => dither.dither(name, src, W, H, 128));
    timings[name] = ms;
    hashes.add(hashBuf(out));
  }
  assert.ok(hashes.size >= 4,
    'expected >= 4 distinct dither outputs, got ' + hashes.size);
  // Emit timings for the smoke report. node:test surfaces stdout per test.
  // eslint-disable-next-line no-console
  console.log('[dither perf 400x240]',
    ALGOS.map((n) => n + '=' + timings[n].toFixed(2) + 'ms').join(' '));
});

test('dither: threshold knob shifts coverage', () => {
  const src = makeGradient();
  let blackLo = 0;
  let blackHi = 0;
  const lo = dither.dither('threshold', src, W, H, 32);
  const hi = dither.dither('threshold', src, W, H, 220);
  for (let i = 0; i < N; i++) {
    if (lo[i] === 0) blackLo++;
    if (hi[i] === 0) blackHi++;
  }
  assert.ok(blackHi > blackLo,
    'raising threshold should produce more black pixels: lo=' + blackLo + ' hi=' + blackHi);
});

test('dither: unknown algorithm throws', () => {
  const src = makeGradient();
  assert.throws(() => dither.dither('nope', src, W, H, 128), /unknown algorithm/);
});

test('dither: length mismatch throws', () => {
  const bad = new Uint8Array(10);
  assert.throws(() => dither.dither('floyd', bad, W, H, 128), /src length/);
});

test('pulp_scenes.normalizeOpts: defaults', () => {
  const o = scenes.normalizeOpts({});
  assert.strictEqual(o.dither, 'atkinson');
  assert.strictEqual(o.threshold, 128);
  assert.strictEqual(o.contrast, 1.0);
  assert.strictEqual(o.brightness, 0);
  assert.strictEqual(o.fit, 'cover');
});

test('pulp_scenes.normalizeOpts: clamping + coercion', () => {
  const o = scenes.normalizeOpts({
    dither: 'bogus',          // -> default
    threshold: '999',         // -> clamp 255
    contrast: '0.1',          // -> clamp 0.5
    brightness: '200',        // -> clamp 100
    fit: 'weird'              // -> default
  });
  assert.strictEqual(o.dither, 'atkinson');
  assert.strictEqual(o.threshold, 255);
  assert.strictEqual(o.contrast, 0.5);
  assert.strictEqual(o.brightness, 100);
  assert.strictEqual(o.fit, 'cover');
});

test('pulp_scenes.normalizeOpts: valid values pass through', () => {
  const o = scenes.normalizeOpts({
    dither: 'floyd',
    threshold: 64,
    contrast: 1.5,
    brightness: -25,
    fit: 'contain'
  });
  assert.deepStrictEqual(o, {
    dither: 'floyd',
    threshold: 64,
    contrast: 1.5,
    brightness: -25,
    fit: 'contain'
  });
});

test('pulp_scenes.safeOrigExt: allowed + rejected', () => {
  assert.strictEqual(scenes.safeOrigExt('room.PNG'), '.png');
  assert.strictEqual(scenes.safeOrigExt('shot.jpeg'), '.jpeg');
  assert.strictEqual(scenes.safeOrigExt('a.gif'), '.gif');
  assert.strictEqual(scenes.safeOrigExt('a.b.webp'), '.webp');
  assert.strictEqual(scenes.safeOrigExt('noext'), '');
  assert.strictEqual(scenes.safeOrigExt('a.exe'), '');
  assert.strictEqual(scenes.safeOrigExt('../etc/passwd'), '');
  assert.strictEqual(scenes.safeOrigExt('bad\0byte.png'), '');
});
