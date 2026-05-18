'use strict';

// Pure-JS 1-bit dithering primitives.
//
// Each algorithm signature is:
//   (srcGray: Uint8Array|Buffer, w: number, h: number, threshold?: number)
//     -> Uint8Array (length w*h, values 0 | 255)
//
// Why: sharp 0.33.x has no native error-diffusion / ordered dither, and
// `threshold(128)` on a downscale produces jaggy aliased garbage. These
// run on a single-channel greyscale buffer that the caller is expected to
// have already produced via sharp (resize -> greyscale -> raw).
//
// Performance target: ~1-3ms for a 400x240 frame on modern hardware. All
// algorithms allocate one working buffer (Int16Array for error diffusion)
// or no buffer at all (ordered dithers) and run in a single linear pass.

const DEFAULT_THRESHOLD = 128;

function clampByte(n) {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n | 0;
}

function normalizeThreshold(t) {
  if (typeof t !== 'number' || !isFinite(t)) return DEFAULT_THRESHOLD;
  if (t < 0) return 0;
  if (t > 255) return 255;
  return t | 0;
}

function assertBuf(src, w, h) {
  if (!src || typeof src.length !== 'number') {
    throw new Error('dither: src must be a typed array or Buffer');
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error('dither: w/h must be positive integers');
  }
  if (src.length !== w * h) {
    throw new Error('dither: src length ' + src.length + ' != w*h ' + (w * h));
  }
}

// -------- threshold (baseline / kept for parity) --------

function threshold(src, w, h, t) {
  assertBuf(src, w, h);
  const tt = normalizeThreshold(t);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < src.length; i++) {
    out[i] = src[i] < tt ? 0 : 255;
  }
  return out;
}

// -------- ordered: Bayer 4x4 --------

const BAYER_4 = [
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5
];

function bayer4(src, w, h, t) {
  assertBuf(src, w, h);
  // Map matrix value (0..15) to a 0..255 bias centered around `t` so a
  // pivot of 128 produces a balanced result. Bias = ((m+0.5)/16 - 0.5)*range
  // where `range` controls how much we perturb around the pivot.
  const tt = normalizeThreshold(t);
  const range = 255; // full range -> classic ordered look
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const yo = (y & 3) << 2;
    for (let x = 0; x < w; x++) {
      const m = BAYER_4[yo + (x & 3)];
      // Threshold per-pixel: tt + bias - half-range
      const bias = ((m + 0.5) / 16) * range - (range / 2);
      const px = src[y * w + x];
      out[y * w + x] = px + bias < tt ? 0 : 255;
    }
  }
  return out;
}

// -------- ordered: Bayer 8x8 --------

const BAYER_8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21
];

function ordered8(src, w, h, t) {
  assertBuf(src, w, h);
  const tt = normalizeThreshold(t);
  const range = 255;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const yo = (y & 7) << 3;
    for (let x = 0; x < w; x++) {
      const m = BAYER_8[yo + (x & 7)];
      const bias = ((m + 0.5) / 64) * range - (range / 2);
      const px = src[y * w + x];
      out[y * w + x] = px + bias < tt ? 0 : 255;
    }
  }
  return out;
}

// -------- error diffusion: Floyd-Steinberg --------
//
//      X  7/16
// 3/16 5/16 1/16

function floyd(src, w, h, t) {
  assertBuf(src, w, h);
  const tt = normalizeThreshold(t);
  // Working buffer in signed 16-bit so error can push values outside 0..255
  // momentarily without overflow.
  const work = new Int16Array(w * h);
  for (let i = 0; i < src.length; i++) work[i] = src[i];

  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = work[i];
      const newPx = old < tt ? 0 : 255;
      out[i] = newPx;
      const err = old - newPx;
      // Right neighbor
      if (x + 1 < w) work[i + 1] = clampByte(work[i + 1] + ((err * 7) >> 4));
      if (y + 1 < h) {
        if (x > 0) work[i + w - 1] = clampByte(work[i + w - 1] + ((err * 3) >> 4));
        work[i + w] = clampByte(work[i + w] + ((err * 5) >> 4));
        if (x + 1 < w) work[i + w + 1] = clampByte(work[i + w + 1] + ((err * 1) >> 4));
      }
    }
  }
  return out;
}

// -------- error diffusion: Atkinson --------
//
//      X  1/8 1/8
// 1/8 1/8 1/8
//      1/8
//
// Only diffuses 6/8 of the error -> crisper, more "Mac-classic" feel,
// well suited for 1-bit pixel art.

function atkinson(src, w, h, t) {
  assertBuf(src, w, h);
  const tt = normalizeThreshold(t);
  const work = new Int16Array(w * h);
  for (let i = 0; i < src.length; i++) work[i] = src[i];

  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = work[i];
      const newPx = old < tt ? 0 : 255;
      out[i] = newPx;
      const share = (old - newPx) >> 3; // err / 8
      if (share === 0) continue;
      if (x + 1 < w) work[i + 1] = clampByte(work[i + 1] + share);
      if (x + 2 < w) work[i + 2] = clampByte(work[i + 2] + share);
      if (y + 1 < h) {
        if (x > 0) work[i + w - 1] = clampByte(work[i + w - 1] + share);
        work[i + w] = clampByte(work[i + w] + share);
        if (x + 1 < w) work[i + w + 1] = clampByte(work[i + w + 1] + share);
      }
      if (y + 2 < h) {
        work[i + 2 * w] = clampByte(work[i + 2 * w] + share);
      }
    }
  }
  return out;
}

// -------- registry / dispatch --------

const ALGORITHMS = Object.freeze({
  atkinson,
  floyd,
  bayer4,
  ordered8,
  threshold
});

function isValidAlgo(name) {
  return typeof name === 'string'
    && Object.prototype.hasOwnProperty.call(ALGORITHMS, name);
}

function dither(name, src, w, h, t) {
  if (!isValidAlgo(name)) throw new Error('dither: unknown algorithm ' + name);
  return ALGORITHMS[name](src, w, h, t);
}

module.exports = {
  DEFAULT_THRESHOLD,
  ALGORITHMS,
  isValidAlgo,
  dither,
  threshold,
  bayer4,
  ordered8,
  floyd,
  atkinson
};
