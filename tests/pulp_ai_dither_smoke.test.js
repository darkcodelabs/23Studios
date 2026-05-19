'use strict';

// pulp_ai_dither_smoke.test.js — ordered dither regression smoke
//
// Verifies that ditherTo1bit + toScenePng + toPortraitPng all produce valid
// 1-bit b-w PNGs with real halftone detail instead of the destructive
// threshold(128) hard-cutoff that previously lost all midtone information.
//
// Run: node --test tests/pulp_ai_dither_smoke.test.js
// Or via: cd server && npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Resolve sharp from server's own node_modules (tests live at repo root /tests/).
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../server')] }));

const { _internals } = require('../server/services/pulp_ai');
const { ditherTo1bit, resolveDitherMode } = _internals;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic horizontal grayscale gradient PNG (w x h).
 * Column x has luma = Math.round((x / (w-1)) * 255).
 * This guarantees a full 0..255 ramp: threshold(128) will saturate the left
 * half to all-black and the right half to all-white, whereas ordered dithers
 * will produce a mix of black/white across the entire width.
 */
async function makeGradientPng(w, h) {
  const buf = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      buf[y * w + x] = Math.round((x / (w - 1)) * 255);
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

/**
 * Count black↔white transitions in the middle row of a 1-bit PNG.
 * A transition is any adjacent pair of pixels with different values.
 * We decode via greyscale().raw() to ensure a single-channel 8-bit buffer
 * regardless of how sharp internally expands the b-w colourspace PNG.
 */
async function transitionsInMiddleRow(pngBuf, w, h) {
  const rawBuf = await sharp(pngBuf)
    .greyscale()
    .raw()
    .toBuffer();
  const midY = Math.floor(h / 2);
  let count = 0;
  for (let x = 1; x < w; x++) {
    const prev = rawBuf[midY * w + x - 1];
    const curr = rawBuf[midY * w + x];
    if ((prev === 0) !== (curr === 0)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Test: resolveDitherMode helper
// ---------------------------------------------------------------------------

test('resolveDitherMode returns default when env is empty/invalid', () => {
  assert.equal(resolveDitherMode('', 'atkinson'), 'atkinson');
  assert.equal(resolveDitherMode(undefined, 'bayer4'), 'bayer4');
  assert.equal(resolveDitherMode('garbage', 'atkinson'), 'atkinson');
  assert.equal(resolveDitherMode('THRESHOLD', 'atkinson'), 'threshold'); // case-fold
});

test('resolveDitherMode accepts all valid mode names', () => {
  for (const mode of ['atkinson', 'bayer4', 'bayer2', 'ordered8', 'floyd', 'threshold']) {
    assert.equal(resolveDitherMode(mode, 'atkinson'), mode, `mode ${mode} should be accepted`);
  }
});

// ---------------------------------------------------------------------------
// Test: ditherTo1bit output contract per mode
// ---------------------------------------------------------------------------

const MODES = ['atkinson', 'bayer4', 'bayer2', 'ordered8', 'threshold'];
const W = 200;
const H = 120;

// Shared gradient — generated once, reused across mode tests.
let gradientPng;

test('generate synthetic gradient', async () => {
  gradientPng = await makeGradientPng(W, H);
  const meta = await sharp(gradientPng).metadata();
  assert.equal(meta.format, 'png', 'gradient is PNG');
  assert.equal(meta.width, W);
  assert.equal(meta.height, H);
});

for (const mode of MODES) {
  test(`ditherTo1bit mode=${mode} produces valid 1-bit PNG`, async () => {
    // ditherTo1bit expects a buffer already sized to w×h — gradient is already W×H.
    const out = await ditherTo1bit(gradientPng, W, H, mode);

    // 1. Must be a Buffer.
    assert.ok(Buffer.isBuffer(out), 'output is a Buffer');

    // 2. Sharp can parse it (valid PNG).
    let meta;
    try {
      meta = await sharp(out).metadata();
    } catch (e) {
      assert.fail(`sharp could not parse output as PNG: ${e.message}`);
    }
    assert.equal(meta.format, 'png', 'output format is png');

    // 3. Dimensions preserved.
    assert.equal(meta.width, W, 'output width matches');
    assert.equal(meta.height, H, 'output height matches');

    // 4. 1-bit colourspace — sharp reports space='b-w' and channels=1.
    assert.equal(meta.channels, 1, `channels=1 for mode ${mode}`);
    assert.equal(meta.space, 'b-w', `colourspace is b-w for mode ${mode}`);

    // 5. Output contains BOTH black AND white pixels (not saturated).
    const rawBuf = await sharp(out).raw().toBuffer();
    const hasBlack = rawBuf.some(v => v === 0);
    const hasWhite = rawBuf.some(v => v === 255);
    assert.ok(hasBlack, `mode ${mode}: output has black pixels`);
    assert.ok(hasWhite, `mode ${mode}: output has white pixels`);
  });
}

// ---------------------------------------------------------------------------
// Test: ordered dithers have more B/W transitions than threshold
// (rough proxy for halftone preservation — threshold saturates large regions)
// ---------------------------------------------------------------------------

test('atkinson and bayer4 have more transitions than threshold in middle row', async () => {
  const thresholdOut = await ditherTo1bit(gradientPng, W, H, 'threshold');
  const atkinsonOut  = await ditherTo1bit(gradientPng, W, H, 'atkinson');
  const bayer4Out    = await ditherTo1bit(gradientPng, W, H, 'bayer4');

  const thresholdT = await transitionsInMiddleRow(thresholdOut, W, H);
  const atkinsonT  = await transitionsInMiddleRow(atkinsonOut,  W, H);
  const bayer4T    = await transitionsInMiddleRow(bayer4Out,    W, H);

  // threshold(128) on a gradient has exactly ONE transition at the midpoint.
  // Any ordered dither should produce many more.
  assert.ok(
    atkinsonT > thresholdT,
    `atkinson (${atkinsonT} transitions) > threshold (${thresholdT})`
  );
  assert.ok(
    bayer4T > thresholdT,
    `bayer4 (${bayer4T} transitions) > threshold (${thresholdT})`
  );
});

// ---------------------------------------------------------------------------
// Test: env var routing (PULP_AI_SCENE_DITHER / PULP_AI_PORTRAIT_DITHER)
// ---------------------------------------------------------------------------

test('toScenePng honours PULP_AI_SCENE_DITHER=bayer4', async () => {
  const orig = process.env.PULP_AI_SCENE_DITHER;
  try {
    process.env.PULP_AI_SCENE_DITHER = 'bayer4';
    const { toScenePng } = _internals;
    const out = await toScenePng(gradientPng, W, H);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.channels, 1);
    assert.equal(meta.space, 'b-w');
  } finally {
    if (orig === undefined) delete process.env.PULP_AI_SCENE_DITHER;
    else process.env.PULP_AI_SCENE_DITHER = orig;
  }
});

test('toPortraitPng honours PULP_AI_PORTRAIT_DITHER=atkinson', async () => {
  const orig = process.env.PULP_AI_PORTRAIT_DITHER;
  try {
    process.env.PULP_AI_PORTRAIT_DITHER = 'atkinson';
    const { toPortraitPng } = _internals;
    const out = await toPortraitPng(gradientPng, W, H);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.channels, 1);
    assert.equal(meta.space, 'b-w');
  } finally {
    if (orig === undefined) delete process.env.PULP_AI_PORTRAIT_DITHER;
    else process.env.PULP_AI_PORTRAIT_DITHER = orig;
  }
});

test('toScenePng falls back to atkinson when PULP_AI_SCENE_DITHER is unset', async () => {
  const orig = process.env.PULP_AI_SCENE_DITHER;
  try {
    delete process.env.PULP_AI_SCENE_DITHER;
    const { toScenePng } = _internals;
    const out = await toScenePng(gradientPng, W, H);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.space, 'b-w');
    // Atkinson default: should have many transitions (not threshold=1).
    const t = await transitionsInMiddleRow(out, W, H);
    assert.ok(t > 1, `default scene dither has ${t} transitions (>1, so not hard threshold)`);
  } finally {
    if (orig === undefined) delete process.env.PULP_AI_SCENE_DITHER;
    else process.env.PULP_AI_SCENE_DITHER = orig;
  }
});

test('toPortraitPng falls back to bayer4 when PULP_AI_PORTRAIT_DITHER is unset', async () => {
  const orig = process.env.PULP_AI_PORTRAIT_DITHER;
  try {
    delete process.env.PULP_AI_PORTRAIT_DITHER;
    const { toPortraitPng } = _internals;
    const out = await toPortraitPng(gradientPng, W, H);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.space, 'b-w');
    const t = await transitionsInMiddleRow(out, W, H);
    assert.ok(t > 1, `default portrait dither has ${t} transitions (>1, so not hard threshold)`);
  } finally {
    if (orig === undefined) delete process.env.PULP_AI_PORTRAIT_DITHER;
    else process.env.PULP_AI_PORTRAIT_DITHER = orig;
  }
});
