'use strict';

// sdk_perf_audit.js — Phase 13: Static Performance Audit
//
// Walks <project>/source/ + <sdkRoot>/sdk_data/ and produces a static report.
// No pdc, no Simulator, no runtime execution — pure file inspection.
//
// Exports: audit(projectId, sdkRoot) -> Promise<report>
//
// Writes:
//   <sdkRoot>/sdk_data/perf_audit.json  — machine-readable
//   <sdkRoot>/sdk_data/perf_audit.md    — human-readable

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const validator = require('./playdate_validator');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PNG_SIZE_WARN_BYTES  = 200 * 1024;     // 200 KB
const PNG_DIM_WARN_PX      = 800;            // either axis
const MEMORY_BUDGET_BYTES  = 4 * 1024 * 1024; // 4 MB
const DRAW_CALL_WARN       = 20;
const IMPORT_WARN          = 8;
const SAVE_STATE_WARN_LINES = 200;

// Regex used for draw-call counting — counts gfx.draw, sprite:draw, :draw(
const DRAW_RE = /gfx\.draw|sprite:draw|:draw\(/g;

// Regex for Playdate imagetable canonical filename: name-table-W-H.png
// Capture groups: 1=frame_w, 2=frame_h
const IMAGETABLE_RE = /^.+-table-(\d+)-(\d+)\.png$/;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sev(fail, warn) {
  if (fail) return 'fail';
  if (warn) return 'warn';
  return 'ok';
}

/** Walk a directory recursively. Returns array of absolute paths. */
async function walkDir(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  async function recurse(cur) {
    let entries;
    try { entries = await fsp.readdir(cur, { withFileTypes: true }); }
    catch (_e) { return; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        await recurse(full);
      } else if (!ext || e.name.endsWith(ext)) {
        results.push(full);
      }
    }
  }
  await recurse(dir);
  return results;
}

/** sha256 of file contents. */
async function sha256File(fp) {
  const buf = await fsp.readFile(fp);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Check: sprite count
// ---------------------------------------------------------------------------

/**
 * Count image-table PNGs (files matching *-table-*.png) under images dir.
 */
function countSprites(pngPaths) {
  return pngPaths.filter((p) => /-table-\d/.test(path.basename(p))).length;
}

// ---------------------------------------------------------------------------
// Check: image sizes + dims
// ---------------------------------------------------------------------------

async function analyzeImages(pngPaths) {
  const results = [];
  for (const fp of pngPaths) {
    let bytes = 0;
    let w = 0;
    let h = 0;
    try {
      const stat = await fsp.stat(fp);
      bytes = stat.size;
      const meta = await sharp(fp).metadata();
      w = meta.width || 0;
      h = meta.height || 0;
    } catch (_e) {
      // unreadable — record 0s, still list it
    }
    const tooBig = bytes > PNG_SIZE_WARN_BYTES;

    // For imagetable sheets, the per-frame dimensions (from the filename) are what
    // matter — the sheet can legitimately exceed 800 px on either axis.
    const itMatch = IMAGETABLE_RE.exec(path.basename(fp));
    let tooBigDim;
    if (itMatch) {
      const frameW = parseInt(itMatch[1], 10);
      const frameH = parseInt(itMatch[2], 10);
      tooBigDim = frameW > PNG_DIM_WARN_PX || frameH > PNG_DIM_WARN_PX;
    } else {
      tooBigDim = w > PNG_DIM_WARN_PX || h > PNG_DIM_WARN_PX;
    }

    const severity = sev(false, tooBig || tooBigDim);
    results.push({ path: fp, bytes, w, h, severity, is_imagetable: !!itMatch });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Check: imagetable geometry (sheet must tile evenly by frame dimensions)
// ---------------------------------------------------------------------------

/**
 * For each PNG whose filename matches *-table-W-H.png, verify:
 *   file_w % W == 0  AND  file_h % H == 0
 * Returns an array of entries — one per imagetable PNG, regardless of outcome.
 * severity: 'ok' if tiling is clean, 'fail' if remainder non-zero.
 */
async function checkImagetableGeometry(pngPaths) {
  const results = [];
  for (const fp of pngPaths) {
    const base = path.basename(fp);
    const m = IMAGETABLE_RE.exec(base);
    if (!m) continue;

    const frameW = parseInt(m[1], 10);
    const frameH = parseInt(m[2], 10);
    let fileW = 0;
    let fileH = 0;
    try {
      const meta = await sharp(fp).metadata();
      fileW = meta.width || 0;
      fileH = meta.height || 0;
    } catch (_e) {
      // unreadable — skip geometry check
      continue;
    }

    const remW = fileW % frameW;
    const remH = fileH % frameH;
    const tilesEvenly = remW === 0 && remH === 0;
    const severity = tilesEvenly ? 'ok' : 'fail';
    results.push({
      path: fp,
      frame_w: frameW,
      frame_h: frameH,
      file_w: fileW,
      file_h: fileH,
      remainder_w: remW,
      remainder_h: remH,
      severity
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Check: memory risk
// ---------------------------------------------------------------------------

async function estimateMemory(imageDir, soundsDir) {
  let imageBytesTotal = 0;
  let audioBytesTotal = 0;

  const imgFiles = await walkDir(imageDir);
  for (const fp of imgFiles) {
    try { imageBytesTotal += (await fsp.stat(fp)).size; } catch (_e) { /* ignore */ }
  }

  const sndFiles = await walkDir(soundsDir);
  for (const fp of sndFiles) {
    try { audioBytesTotal += (await fsp.stat(fp)).size; } catch (_e) { /* ignore */ }
  }

  const total = imageBytesTotal + audioBytesTotal;
  const budgetPct = total / MEMORY_BUDGET_BYTES * 100;
  const severity = sev(total > MEMORY_BUDGET_BYTES, budgetPct > 75);
  return {
    images: imageBytesTotal,
    audio: audioBytesTotal,
    total,
    budget_pct: Math.round(budgetPct * 10) / 10,
    severity
  };
}

// ---------------------------------------------------------------------------
// Check: draw calls per scene
// ---------------------------------------------------------------------------

async function analyzeDrawCalls(scenesDir) {
  const results = [];
  const luaFiles = await walkDir(scenesDir, '.lua');
  for (const fp of luaFiles) {
    let src = '';
    try { src = await fsp.readFile(fp, 'utf8'); } catch (_e) { /* unreadable */ }
    const matches = src.match(DRAW_RE);
    const count = matches ? matches.length : 0;
    const severity = sev(false, count > DRAW_CALL_WARN);
    results.push({ scene: fp, count, severity });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Check: load-time proxy (import count per scene)
// ---------------------------------------------------------------------------

async function analyzeLoadTimes(scenesDir) {
  const results = [];
  const luaFiles = await walkDir(scenesDir, '.lua');
  for (const fp of luaFiles) {
    let src = '';
    try { src = await fsp.readFile(fp, 'utf8'); } catch (_e) { /* unreadable */ }
    const importLines = (src.match(/^import\s+/mg) || []).length;
    const severity = sev(false, importLines > IMPORT_WARN);
    results.push({ scene: fp, imports: importLines, severity });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Check: asset duplication
// ---------------------------------------------------------------------------

async function findDuplicates(pngPaths) {
  const hashMap = {}; // hash -> [paths]
  for (const fp of pngPaths) {
    try {
      const h = await sha256File(fp);
      if (!hashMap[h]) hashMap[h] = [];
      hashMap[h].push(fp);
    } catch (_e) { /* unreadable */ }
  }
  return Object.entries(hashMap)
    .filter(([, files]) => files.length > 1)
    .map(([hash, files]) => ({ hash, count: files.length, files }));
}

// ---------------------------------------------------------------------------
// Check: placeholder detection
// ---------------------------------------------------------------------------

async function checkPlaceholders(pngPaths) {
  const results = [];
  for (const fp of pngPaths) {
    let buf;
    try { buf = await fsp.readFile(fp); } catch (_e) { continue; }
    const result = await validator.isPlaceholderScenePng(buf);
    if (result.placeholder) {
      results.push({ path: fp, kind: result.reason });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Check: save_state size proxy
// ---------------------------------------------------------------------------

async function checkSaveState(sourceDir) {
  const fp = path.join(sourceDir, 'systems', 'save_state.lua');
  if (!fs.existsSync(fp)) return null;
  let lines = 0;
  try {
    const src = await fsp.readFile(fp, 'utf8');
    lines = src.split('\n').length;
  } catch (_e) { /* ignore */ }
  const severity = sev(false, lines > SAVE_STATE_WARN_LINES);
  return { path: fp, lines, severity };
}

// ---------------------------------------------------------------------------
// Fix hints assembler
// ---------------------------------------------------------------------------

function buildFixes({ imageSizes, imagetableGeometry, memEst, drawCalls, loadTimes, duplications, placeholders, saveState }) {
  const fixes = [];

  // Image size warnings — imagetable sheets get a different recommendation
  for (const img of imageSizes) {
    if (img.severity !== 'ok') {
      const reasons = [];
      if (img.bytes > PNG_SIZE_WARN_BYTES) reasons.push(`${(img.bytes / 1024).toFixed(0)} KB exceeds 200 KB limit`);
      if (!img.is_imagetable && (img.w > PNG_DIM_WARN_PX || img.h > PNG_DIM_WARN_PX)) {
        reasons.push(`${img.w}×${img.h} exceeds 800×800`);
      }
      const recommendation = img.is_imagetable
        ? 'Compress imagetable sheet (file size exceeds 200 KB)'
        : 'Resize or split into an image table';
      fixes.push({
        severity: 'warn',
        item: path.basename(img.path),
        recommendation,
        fix_hint: reasons.join('; ')
      });
    }
  }

  // Imagetable geometry failures
  for (const ig of (imagetableGeometry || [])) {
    if (ig.severity !== 'ok') {
      fixes.push({
        severity: 'fail',
        item: path.basename(ig.path),
        recommendation: 'Fix imagetable sheet dimensions so they tile evenly',
        fix_hint: `sheet doesn't tile evenly: file ${ig.file_w}×${ig.file_h}, frame ${ig.frame_w}×${ig.frame_h}, remainder ${ig.remainder_w}×${ig.remainder_h}`
      });
    }
  }

  // Memory budget
  if (memEst.severity !== 'ok') {
    fixes.push({
      severity: memEst.severity,
      item: 'Total asset memory',
      recommendation: `Reduce images + audio to stay under 4 MB (currently ${(memEst.total / 1024 / 1024).toFixed(2)} MB, ${memEst.budget_pct}% of budget)`,
      fix_hint: 'Compress audio, downscale large PNGs, remove unused assets'
    });
  }

  // Draw calls
  for (const sc of drawCalls) {
    if (sc.severity !== 'ok') {
      fixes.push({
        severity: 'warn',
        item: path.basename(sc.scene),
        recommendation: `${sc.count} draw calls exceeds ${DRAW_CALL_WARN} — likely fps hit`,
        fix_hint: 'Batch sprites into a single sprite group or composited background'
      });
    }
  }

  // Import counts
  for (const lt of loadTimes) {
    if (lt.severity !== 'ok') {
      fixes.push({
        severity: 'warn',
        item: path.basename(lt.scene),
        recommendation: `${lt.imports} imports exceed ${IMPORT_WARN} — slow load time`,
        fix_hint: 'Move shared imports to main.lua, use the load-once pattern'
      });
    }
  }

  // Duplications
  for (const dup of duplications) {
    fixes.push({
      severity: 'warn',
      item: `${dup.count} duplicate files (hash ${dup.hash.slice(0, 8)}…)`,
      recommendation: 'Remove redundant copies, use a single canonical asset',
      fix_hint: dup.files.map((f) => path.basename(f)).join(', ')
    });
  }

  // Placeholders
  for (const ph of placeholders) {
    fixes.push({
      severity: 'fail',
      item: path.basename(ph.path),
      recommendation: 'Replace placeholder PNG with real 1-bit art',
      fix_hint: ph.kind
    });
  }

  // Save state
  if (saveState && saveState.severity !== 'ok') {
    fixes.push({
      severity: 'warn',
      item: 'save_state.lua',
      recommendation: `${saveState.lines} lines — likely bloated schema`,
      fix_hint: 'Extract non-persistent data out of save_state; keep schema minimal'
    });
  }

  return fixes;
}

// ---------------------------------------------------------------------------
// Markdown report generator
// ---------------------------------------------------------------------------

function buildMarkdown(report) {
  const { summary, image_sizes, draw_calls, memory_estimate, duplications, placeholders, fixes } = report;
  const lines = [];
  lines.push('# Perf Audit Report');
  lines.push('');
  lines.push(`**Audited:** ${report.audited_at}`);
  lines.push('');

  lines.push('## Summary');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total image bytes | ${(summary.total_image_bytes / 1024).toFixed(1)} KB |`);
  lines.push(`| Total audio bytes | ${(summary.total_audio_bytes / 1024).toFixed(1)} KB |`);
  lines.push(`| Sprite tables | ${summary.sprite_count} |`);
  lines.push(`| Scenes | ${summary.scene_count} |`);
  lines.push(`| Warnings | ${summary.warnings} |`);
  lines.push(`| Errors | ${summary.errors} |`);
  lines.push('');

  lines.push('## Memory Budget');
  lines.push(`- Images: ${(memory_estimate.images / 1024).toFixed(1)} KB`);
  lines.push(`- Audio: ${(memory_estimate.audio / 1024).toFixed(1)} KB`);
  lines.push(`- Total: ${(memory_estimate.total / 1024).toFixed(1)} KB (${memory_estimate.budget_pct}% of 4 MB budget) — **${memory_estimate.severity.toUpperCase()}**`);
  lines.push('');

  if (image_sizes.length > 0) {
    lines.push('## Image Sizes');
    lines.push('| File | Bytes | Dims | Severity |');
    lines.push('|---|---|---|---|');
    for (const img of image_sizes.sort((a, b) => b.bytes - a.bytes)) {
      lines.push(`| ${path.basename(img.path)} | ${img.bytes} | ${img.w}×${img.h} | ${img.severity} |`);
    }
    lines.push('');
  }

  if (draw_calls.length > 0) {
    lines.push('## Draw Calls per Scene');
    lines.push('| Scene | Count | Severity |');
    lines.push('|---|---|---|');
    for (const sc of draw_calls.sort((a, b) => b.count - a.count)) {
      lines.push(`| ${path.basename(sc.scene)} | ${sc.count} | ${sc.severity} |`);
    }
    lines.push('');
  }

  if (duplications.length > 0) {
    lines.push('## Duplicate Assets');
    for (const dup of duplications) {
      lines.push(`- **${dup.count} copies** (hash \`${dup.hash.slice(0, 8)}\`): ${dup.files.map((f) => path.basename(f)).join(', ')}`);
    }
    lines.push('');
  }

  if (placeholders.length > 0) {
    lines.push('## Placeholders Detected');
    for (const ph of placeholders) {
      lines.push(`- ${path.basename(ph.path)} — ${ph.kind}`);
    }
    lines.push('');
  }

  if (fixes.length > 0) {
    lines.push('## Fixes (prioritized)');
    const sorted = [...fixes].sort((a, b) => {
      const rank = { fail: 0, warn: 1, ok: 2 };
      return (rank[a.severity] || 2) - (rank[b.severity] || 2);
    });
    for (const f of sorted) {
      lines.push(`- **[${f.severity.toUpperCase()}]** ${f.item}: ${f.recommendation}`);
      if (f.fix_hint) lines.push(`  - _${f.fix_hint}_`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * audit(projectId, sdkRoot)
 *
 * sdkRoot is the project's local_path (the directory that contains source/).
 * sdk_data lives at <sdkRoot>/sdk_data/.
 *
 * Returns the full report object. Side-effects:
 *   writes <sdkRoot>/sdk_data/perf_audit.json
 *   writes <sdkRoot>/sdk_data/perf_audit.md
 */
async function audit(projectId, sdkRoot) {
  const sourceDir  = path.join(sdkRoot, 'source');
  const imagesDir  = path.join(sourceDir, 'images');
  const soundsDir  = path.join(sourceDir, 'sounds');
  const scenesDir  = path.join(sourceDir, 'scenes');
  const sdkDataDir = path.join(sdkRoot, 'sdk_data');

  // Ensure sdk_data dir exists so we can write reports.
  await fsp.mkdir(sdkDataDir, { recursive: true });

  // Single-pass file walks.
  const pngPaths = await walkDir(imagesDir, '.png');

  // Run all checks.
  const [imageSizes, imagetableGeometry, memEst, drawCalls, loadTimes, duplications, placeholders, saveState] =
    await Promise.all([
      analyzeImages(pngPaths),
      checkImagetableGeometry(pngPaths),
      estimateMemory(imagesDir, soundsDir),
      analyzeDrawCalls(scenesDir),
      analyzeLoadTimes(scenesDir),
      findDuplicates(pngPaths),
      checkPlaceholders(pngPaths),
      checkSaveState(sourceDir)
    ]);

  const spriteCount = countSprites(pngPaths);
  const sceneCount  = drawCalls.length;

  const fixes = buildFixes({ imageSizes, imagetableGeometry, memEst, drawCalls, loadTimes, duplications, placeholders, saveState });

  const warnings = fixes.filter((f) => f.severity === 'warn').length;
  const errors   = fixes.filter((f) => f.severity === 'fail').length;

  const report = {
    audited_at: new Date().toISOString(),
    project_id: projectId,
    summary: {
      total_image_bytes: memEst.images,
      total_audio_bytes: memEst.audio,
      sprite_count: spriteCount,
      scene_count: sceneCount,
      warnings,
      errors
    },
    image_sizes: imageSizes,
    imagetable_geometry: imagetableGeometry,
    draw_calls: drawCalls,
    load_times: loadTimes,
    memory_estimate: memEst,
    duplications,
    placeholders,
    save_state: saveState,
    fixes
  };

  // Persist JSON + markdown reports.
  const jsonPath = path.join(sdkDataDir, 'perf_audit.json');
  const mdPath   = path.join(sdkDataDir, 'perf_audit.md');

  await fsp.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fsp.writeFile(mdPath, buildMarkdown(report));

  return report;
}

/**
 * readLatest(sdkRoot) — load the last persisted report without re-running.
 * Returns null if no report exists.
 */
async function readLatest(sdkRoot) {
  const fp = path.join(sdkRoot, 'sdk_data', 'perf_audit.json');
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(await fsp.readFile(fp, 'utf8'));
  } catch (_e) {
    return null;
  }
}

module.exports = { audit, readLatest };
