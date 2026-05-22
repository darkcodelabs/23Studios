'use strict';

// Phase 4.5 Patch F — dither variant generator.
//
// Generates the five dither variants spec'd in
// docs/23studios_phase4_image_quality.md Patch B for a single source asset.
// Re-uses the existing server/services/dither.js dispatcher (atkinson /
// floyd / bayer4 / threshold) — pulp_ai.js already routes through it via
// the same pattern (see `ditherTo1bit` in pulp_ai.js).
//
// Variant table (matches Patch B):
//
//   atkinson         — atkinson, contrast 1.15
//   atkinson_punchy  — atkinson, contrast 1.30, brightness 1.05
//   floyd_steinberg  — floyd,    contrast 1.15
//   bayer4x4         — bayer4,   contrast 1.15
//   threshold        — threshold (no error diffusion), contrast 1.15
//
// Pre-processing pipeline (sharp):
//   1. read source PNG bytes (prefer high-res art_source/ over already-1bit
//      sdk_data/{scenes,characters,launcher}/<name>.png)
//   2. greyscale
//   3. .linear(contrast, brightnessOffset) — sharp's linear takes (a, b)
//      where out = a*in + b. We translate (contrast, brightness) into
//      a = contrast, b = (brightness - 1) * 128 so brightness=1.0 → b=0.
//   4. resize to 400x240 nearest-neighbour
//   5. .raw() greyscale Uint8Array → dither.js dispatcher
//   6. re-encode 1-bit b-w PNG via sharp
//
// Output layout (per spec line 315):
//   <local_path>/sdk_data/dither_variants/<sanitized_asset_id>/<algo>.png
//
// Returns a manifest:
//   { source_asset_id, source_path, target_w, target_h,
//     variants: { atkinson: { path, bytes }, ... } }

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const ditherMod = require('./dither');
const projects = require('./projects');

// Default Playdate landscape target. The variant picker is currently
// scene-scoped (Patch F acceptance test uses scene:title_dial_tone) so we
// fix to 400x240 across all five variants for a clean side-by-side.
const TARGET_W = 400;
const TARGET_H = 240;

// Spec table. Keep ordering stable — the UI renders left-to-right in this
// order and the gallery JSON serializes Object keys in declaration order.
const VARIANTS = [
  { name: 'atkinson',        algo: 'atkinson',  contrast: 1.15, brightness: 1.00 },
  { name: 'atkinson_punchy', algo: 'atkinson',  contrast: 1.30, brightness: 1.05 },
  { name: 'floyd_steinberg', algo: 'floyd',     contrast: 1.15, brightness: 1.00 },
  { name: 'bayer4x4',        algo: 'bayer4',    contrast: 1.15, brightness: 1.00 },
  { name: 'threshold',       algo: 'threshold', contrast: 1.15, brightness: 1.00 }
];

// Map asset type → on-disk subdirectory under sdk_data.
const TYPE_DIR = {
  scene: 'scenes',
  portrait: 'characters',
  launcher: 'launcher'
};

// Reverse map for resolving asset.type from a parsed id.
function parseAssetId(assetId) {
  if (typeof assetId !== 'string' || !assetId.includes(':')) return null;
  const idx = assetId.indexOf(':');
  const type = assetId.slice(0, idx);
  const name = assetId.slice(idx + 1);
  if (!type || !name) return null;
  if (!TYPE_DIR[type]) return null;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  return { type, name };
}

// Asset id → safe directory name (colon is fine on linux but ugly).
function sanitizeAssetId(assetId) {
  return String(assetId || '').replace(/[^A-Za-z0-9_.-]/g, '_');
}

// Locate the source PNG on disk. Prefer art_source/<type-dir>/<name>.png
// (the pre-dither, higher-resolution copy) if present — that's the input
// the variant test wants to dither five different ways. Fall back to the
// canonical sdk_data/<type-dir>/<name>.png (already 1-bit, but a valid
// re-dither input if no source survives).
function resolveSourcePath(localPath, parsed) {
  const typeDir = TYPE_DIR[parsed.type];
  const candidates = [
    path.join(localPath, 'sdk_data', 'art_source', typeDir, parsed.name + '.png'),
    path.join(localPath, 'sdk_data', typeDir, parsed.name + '.png')
  ];
  for (const cand of candidates) {
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch (_e) { /* try next */ }
  }
  return null;
}

// Pre-process: greyscale → linear contrast/brightness → resize → raw u8.
async function preprocessGrey(sourceBytes, contrast, brightness) {
  // sharp.linear(a, b): out = a*in + b, where in is 0..255. To translate
  // (contrast, brightness) into (a, b) we anchor the contrast around the
  // mid-grey pivot (128) and add a brightness offset:
  //   a = contrast
  //   b = (brightness - 1.0) * 128 + (1 - contrast) * 128
  // This keeps a contrast of 1.0 a no-op and lets brightness >1 shift
  // values up. We let sharp clamp out-of-range on its own.
  const a = contrast;
  const b = (brightness - 1.0) * 128 + (1 - contrast) * 128;

  const raw = await sharp(sourceBytes)
    .greyscale()
    .linear(a, b)
    .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre', kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer();

  return raw; // length === TARGET_W * TARGET_H, single channel
}

// Run dither.js dispatcher + re-encode as 1-bit b-w PNG.
async function ditherToPng(greyRaw, algo) {
  let dithered;
  if (algo === 'threshold') {
    dithered = ditherMod.threshold(greyRaw, TARGET_W, TARGET_H, 128);
  } else if (ditherMod.isValidAlgo(algo)) {
    dithered = ditherMod.dither(algo, greyRaw, TARGET_W, TARGET_H, 128);
  } else {
    throw new Error('dither_variants: unknown algo ' + algo);
  }
  return sharp(Buffer.from(dithered), { raw: { width: TARGET_W, height: TARGET_H, channels: 1 } })
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

// Resolve project's local_path, throwing a typed error mirroring gallery.js.
async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) {
    const err = new Error('project not found: ' + projectId);
    err.status = 404; err.code = 'not_found';
    throw err;
  }
  if (!proj.local_path) {
    const err = new Error('project ' + projectId + ' has no local_path');
    err.status = 400; err.code = 'no_local_path';
    throw err;
  }
  return proj;
}

// Public default out-dir helper. Callers (CLI + route) reuse this so the
// variant URL the gallery route returns matches where files are written.
function defaultOutDir(localPath, assetId) {
  return path.join(localPath, 'sdk_data', 'dither_variants', sanitizeAssetId(assetId));
}

// Main entry point.
//
//   projectId      — string, must exist in projects.json
//   sourceAssetId  — "<type>:<name>", e.g. "scene:title_dial_tone"
//   outDir         — absolute path; defaults to
//                    <local_path>/sdk_data/dither_variants/<sanitized_id>/
//
// Returns:
//   { source_asset_id, source_path, target_w, target_h,
//     variants: { <name>: { path, bytes }, ... } }
async function generateVariants(projectId, sourceAssetId, outDir) {
  const parsed = parseAssetId(sourceAssetId);
  if (!parsed) {
    const err = new Error('invalid asset id (expected "<type>:<name>")');
    err.status = 400; err.code = 'bad_asset_id';
    throw err;
  }

  const proj = await resolveProject(projectId);
  const sourcePath = resolveSourcePath(proj.local_path, parsed);
  if (!sourcePath) {
    const err = new Error('source asset not found on disk for ' + sourceAssetId);
    err.status = 404; err.code = 'source_missing';
    throw err;
  }

  const destDir = outDir || defaultOutDir(proj.local_path, sourceAssetId);
  await fsp.mkdir(destDir, { recursive: true });

  const sourceBytes = await fsp.readFile(sourcePath);

  const result = {
    source_asset_id: sourceAssetId,
    source_path: sourcePath,
    target_w: TARGET_W,
    target_h: TARGET_H,
    variants: {}
  };

  for (const v of VARIANTS) {
    const greyRaw = await preprocessGrey(sourceBytes, v.contrast, v.brightness);
    const pngBuf = await ditherToPng(greyRaw, v.algo);
    const destPath = path.join(destDir, v.name + '.png');
    await fsp.writeFile(destPath, pngBuf);
    result.variants[v.name] = {
      path: destPath,
      bytes: pngBuf.length,
      algo: v.algo,
      contrast: v.contrast,
      brightness: v.brightness
    };
  }

  return result;
}

module.exports = {
  generateVariants,
  defaultOutDir,
  sanitizeAssetId,
  parseAssetId,
  VARIANTS,
  TARGET_W,
  TARGET_H,
  _internals: { resolveSourcePath, preprocessGrey, ditherToPng }
};
