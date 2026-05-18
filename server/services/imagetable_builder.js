'use strict';

// Imagetable sheet builder.
//
// Produces a Playdate-compatible sprite sheet PNG laid out as a fixed grid
// of equal-sized frames. The Playdate SDK auto-slices these when the file
// is named `<name>-table-<W>-<H>.png` (see references/imagetable-conventions.md).
//
// Two input forms are supported:
//
//   1. Pixel-string frames: `buildSheet({ frames: ['0101...', ...], frameW,
//      frameH, cols })`. Each pixel string is `frameW * frameH` chars of '0'
//      or '1'. '1' renders as opaque black, '0' as transparent. Output is a
//      `(cols * frameW) x (rows * frameH)` RGBA PNG suitable for pdc's 1-bit
//      conversion.
//
//   2. Sharp-buffer frames: `buildSheet({ frames: [Buffer, ...], frameW,
//      frameH, cols })`. Each buffer must be a raw RGBA buffer of the right
//      size. Used by the cyber_glove scaffold placeholder generator which
//      composites geometric primitives via sharp.
//
// Returns a PNG Buffer. Caller is responsible for `fs.writeFile`.

let sharp = null;
let sharpLoadError = null;
try { sharp = require('sharp'); }
catch (e) { sharpLoadError = e && e.message ? e.message : String(e); }

/**
 * pixelsToRawRGBA(pixels, w, h)
 * Convert a '0'/'1' string into a w*h RGBA buffer. '1' -> opaque black.
 * '0' -> fully transparent (matches Playdate 1-bit + alpha mask semantics).
 */
function pixelsToRawRGBA(pixels, w, h) {
  const N = w * h;
  if (typeof pixels !== 'string' || pixels.length !== N) {
    throw new Error(`pixel-string length ${pixels && pixels.length} != ${N}`);
  }
  const buf = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const on = pixels.charCodeAt(i) === 49; // '1'
    const off = i * 4;
    if (on) {
      buf[off] = 0;
      buf[off + 1] = 0;
      buf[off + 2] = 0;
      buf[off + 3] = 255;
    } else {
      // Transparent. Color channels left at 0; alpha = 0.
      buf[off + 3] = 0;
    }
  }
  return buf;
}

/**
 * buildSheet({ frames, frameW, frameH, cols }) -> Promise<Buffer>
 *
 * frames    array of pixel-strings ('0'/'1') OR raw RGBA Buffers
 * frameW    frame width in px
 * frameH    frame height in px
 * cols      columns in the sheet; rows are computed from frames.length
 *
 * Returns a PNG Buffer (RGBA, with alpha mask) sized
 *   width  = cols * frameW
 *   height = ceil(frames.length / cols) * frameH
 *
 * Empty cells (when frames.length isn't a multiple of cols) stay
 * fully transparent.
 */
async function buildSheet({ frames, frameW, frameH, cols }) {
  if (!sharp) {
    throw new Error('sharp unavailable: ' + (sharpLoadError || 'unknown'));
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('frames must be a non-empty array');
  }
  const W = Number(frameW), H = Number(frameH), C = Number(cols);
  if (!Number.isInteger(W) || W <= 0) throw new Error('frameW must be a positive int');
  if (!Number.isInteger(H) || H <= 0) throw new Error('frameH must be a positive int');
  if (!Number.isInteger(C) || C <= 0) throw new Error('cols must be a positive int');

  const rows = Math.ceil(frames.length / C);
  const sheetW = C * W;
  const sheetH = rows * H;

  // Base sheet: fully transparent.
  const base = Buffer.alloc(sheetW * sheetH * 4); // all zeros

  const composites = [];
  for (let i = 0; i < frames.length; i++) {
    const cx = (i % C) * W;
    const cy = Math.floor(i / C) * H;
    const fr = frames[i];
    let raw;
    if (typeof fr === 'string') {
      raw = pixelsToRawRGBA(fr, W, H);
    } else if (Buffer.isBuffer(fr)) {
      if (fr.length !== W * H * 4) {
        throw new Error(`frame ${i} buffer length ${fr.length} != ${W * H * 4}`);
      }
      raw = fr;
    } else {
      throw new Error(`frame ${i} must be a pixel-string or RGBA Buffer`);
    }
    composites.push({
      input: raw,
      raw: { width: W, height: H, channels: 4 },
      left: cx,
      top: cy,
    });
  }

  return await sharp(base, { raw: { width: sheetW, height: sheetH, channels: 4 } })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * sheetNameFor(name, frameW, frameH) -> string
 * Returns the canonical filename: `<name>-table-<W>-<H>.png`.
 */
function sheetNameFor(name, frameW, frameH) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error('unsafe sheet name: ' + name);
  }
  return `${name}-table-${frameW}-${frameH}.png`;
}

module.exports = {
  buildSheet,
  pixelsToRawRGBA,
  sheetNameFor,
  isAvailable: () => !!sharp,
  loadError: () => sharpLoadError,
};
