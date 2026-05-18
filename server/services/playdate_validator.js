'use strict';

// playdate_validator.js — assert AI-generated assets actually obey the
// 1-bit Playdate spec, AND catch procedural / placeholder garbage before
// it ships.
//
// Two surfaces:
//   * validate1bitPng(pngBuffer, {w, h}) — decode + count gray pixels.
//     Allows a tiny smear (JPEG-ish artifacts at edges) but rejects
//     anything with more than 0.5% intermediate values.
//   * isPlaceholderPixels(pixelString) — port of the heuristic from
//     /tmp/hakcd2_regen_tiles.js for tile-frame pixel strings ('0'/'1').
//     Catches all-on, all-off, extreme bias, and the "circle/diamond"
//     procedural placeholders.

const sharp = require('sharp');

// A pixel is "gray" if it's not within a forgiving band of pure black or
// pure white. Anything in 32..223 counts. (Threshold-rounded JPEG noise
// near 0/255 is tolerated; honest intermediates are rejected.)
const GRAY_LOW  = 32;
const GRAY_HIGH = 223;
// Up to 0.5% of pixels may be gray (rounding artifacts at sharp edges).
const GRAY_BUDGET_RATIO = 0.005;

/**
 * validate1bitPng(pngBuffer, { w, h })
 *  -> { ok: boolean, grayPixels: number, totalPixels: number,
 *       grayRatio: number, dims: { w, h }, reason?: string }
 *
 * w/h is the EXPECTED finished size (e.g. 400x240 for scene, 16x16 for
 * tile). The buffer is decoded as-is — we don't re-resize here; the caller
 * is responsible for downsampling before validation.
 */
async function validate1bitPng(pngBuffer, expected = {}) {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
    return { ok: false, grayPixels: 0, totalPixels: 0, grayRatio: 0,
             dims: { w: 0, h: 0 }, reason: 'empty_buffer' };
  }
  let meta;
  try { meta = await sharp(pngBuffer).metadata(); }
  catch (e) {
    return { ok: false, grayPixels: 0, totalPixels: 0, grayRatio: 0,
             dims: { w: 0, h: 0 }, reason: 'decode_failed:' + (e && e.message) };
  }
  const dims = { w: meta.width || 0, h: meta.height || 0 };

  if (expected.w && expected.h) {
    if (dims.w !== expected.w || dims.h !== expected.h) {
      return { ok: false, grayPixels: 0,
               totalPixels: dims.w * dims.h, grayRatio: 0, dims,
               reason: `dim_mismatch expected=${expected.w}x${expected.h} got=${dims.w}x${dims.h}` };
    }
  }

  // Decode to single-channel greyscale raw so we can inspect every pixel.
  // We use luminance ignoring alpha — fully transparent pixels are OK
  // (Playdate treats transparency as 1 bit) but we still check the RGB.
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels; // 4 (RGBA)
  const total = w * h;

  let grayPixels = 0;
  let nonZeroAlpha = 0;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = channels >= 4 ? data[i + 3] : 255;
    if (a > 0) nonZeroAlpha++;
    // Luminance approx — fast Rec.601.
    const y = (r * 299 + g * 587 + b * 114 + 500) / 1000;
    if (y >= GRAY_LOW && y <= GRAY_HIGH) grayPixels++;
  }
  const grayRatio = total === 0 ? 0 : grayPixels / total;
  const ok = grayRatio <= GRAY_BUDGET_RATIO;
  const reason = ok ? undefined :
    `too_many_gray_pixels gray=${grayPixels}/${total} ratio=${grayRatio.toFixed(4)} budget=${GRAY_BUDGET_RATIO}`;
  return { ok, grayPixels, totalPixels: total, grayRatio,
           nonZeroAlpha, dims, reason };
}

/**
 * isPlaceholderPixels(pixelString)
 *  -> { placeholder: boolean, reason: string }
 *
 * Port of the heuristic from /tmp/hakcd2_regen_tiles.js. Detects:
 *   - missing / non-string / wrong length
 *   - all-black or all-white (or near-extreme bias)
 *   - perfectly horizontally-symmetric shapes (circles, diamonds,
 *     wireframe boxes) which are the tell of placeholderTilePng() output.
 */
function isPlaceholderPixels(pix) {
  if (typeof pix !== 'string') {
    return { placeholder: true, reason: 'not_string' };
  }
  const total = pix.length;
  if (total < 64) {
    return { placeholder: true, reason: `too_short:${total}` };
  }
  // Only 64 (8x8) and 256 (16x16) are valid Pulp lengths.
  if (total !== 64 && total !== 256) {
    return { placeholder: true, reason: `bad_length:${total}` };
  }
  const ones = (pix.match(/1/g) || []).length;
  const ratio = ones / total;
  if (ratio < 0.05) return { placeholder: true, reason: `near_all_white:${ratio.toFixed(3)}` };
  if (ratio > 0.95) return { placeholder: true, reason: `near_all_black:${ratio.toFixed(3)}` };

  const dim = total === 64 ? 8 : 16;
  let symRows = 0;
  for (let y = 0; y < dim; y++) {
    const row = pix.slice(y * dim, (y + 1) * dim);
    const rev = row.split('').reverse().join('');
    if (row === rev) symRows++;
  }
  // Pure procedural circle/diamond placeholders are symmetric on every row.
  // Tolerate up to dim-2 symmetric rows (real art occasionally lines up).
  if (symRows >= dim - 1) {
    return { placeholder: true, reason: `symmetric_rows:${symRows}/${dim}` };
  }

  return { placeholder: false, reason: '' };
}

/**
 * isPlaceholderScenePng(pngBuffer)
 *  -> Promise<{ placeholder: boolean, reason: string }>
 *
 * For scene backgrounds we use a different sniff: pulp_ai.placeholderScenePng
 * emits a ~25% black Bayer dot field with a 2-px border + a "hash bar"
 * stripe near y=4. Real AI-generated scenes have wildly varying row
 * histograms; the procedural placeholder has near-uniform row energy.
 * We compute the per-row black ratio and reject if the stddev is tiny.
 */
async function isPlaceholderScenePng(pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
    return { placeholder: true, reason: 'empty_buffer' };
  }
  let raw;
  let meta;
  try {
    const out = await sharp(pngBuffer).greyscale().raw()
      .toBuffer({ resolveWithObject: true });
    raw = out.data;
    meta = out.info;
  } catch (e) {
    return { placeholder: true, reason: 'decode_failed:' + (e && e.message) };
  }
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w === 0 || h === 0) return { placeholder: true, reason: 'zero_dim' };
  const rowBlackRatios = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let blacks = 0;
    for (let x = 0; x < w; x++) {
      if (raw[y * w + x] < 128) blacks++;
    }
    rowBlackRatios[y] = blacks / w;
  }
  let mean = 0;
  for (let y = 0; y < h; y++) mean += rowBlackRatios[y];
  mean /= h;
  let variance = 0;
  for (let y = 0; y < h; y++) {
    const d = rowBlackRatios[y] - mean;
    variance += d * d;
  }
  variance /= h;
  const stddev = Math.sqrt(variance);
  // Procedural placeholder: ~25% black with stddev < 0.04 across rows.
  // Real scene art: rich vertical structure -> stddev typically > 0.08.
  if (stddev < 0.04) {
    return { placeholder: true,
             reason: `flat_row_histogram mean=${mean.toFixed(3)} stddev=${stddev.toFixed(4)}` };
  }
  return { placeholder: false, reason: '' };
}

module.exports = {
  GRAY_LOW,
  GRAY_HIGH,
  GRAY_BUDGET_RATIO,
  validate1bitPng,
  isPlaceholderPixels,
  isPlaceholderScenePng
};
