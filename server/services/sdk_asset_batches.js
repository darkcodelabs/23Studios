'use strict';

// sdk_asset_batches.js — 3-batch asset generation with per-batch contact sheets
// and gate files so the user can stop after Batch 1 if vibes are wrong.
//
// Batch structure (scenes / portraits / launcher / items):
//   b1 — first 1/3  (title screen, player, key scenes)
//   b2 — middle 1/3 (NPCs, secondary scenes)
//   b3 — remainder  (polish / long-tail)
//
// Contact sheets:
//   scene    — 3×3 grid, each cell 200×120 (source 400×240 scaled down)   → 600×360 output
//   portrait — 4×4 grid, each cell 64×64 (source already 64×64)           → 256×256 output
//   launcher / item — 3×3 grid at same 200×120 cell size
//
// Gate files live at <sdkRoot>/sdk_data/gates/batch_<batch_id>.json and are
// polled by sdk_autopilot before advancing to the next batch.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const pulpAi = require('./pulp_ai');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// sdkRoot is already <project>/sdk_data (set by ensureDirs in sdk_autopilot).
// Sub-dirs live directly under sdkRoot.
function batchesDir(sdkRoot) {
  return path.join(sdkRoot, 'batches');
}
function gatesDir(sdkRoot) {
  return path.join(sdkRoot, 'gates');
}

async function ensureBatchDirs(sdkRoot) {
  await fsp.mkdir(batchesDir(sdkRoot), { recursive: true });
  await fsp.mkdir(gatesDir(sdkRoot), { recursive: true });
}

// ---------------------------------------------------------------------------
// planBatches — split items list into 3 ordered batches by importance
// ---------------------------------------------------------------------------

/**
 * planBatches(items) — splits a list (scenes or characters) into 3 batches.
 *
 *   Batch 1 (b1) — first 1/3  — title scene, player character, key scenes
 *   Batch 2 (b2) — middle 1/3 — NPCs, secondary scenes
 *   Batch 3 (b3) — remainder  — polish / long-tail
 *
 * Items is an array of objects with at least an `id` field. The function
 * does a ceiling split so every item lands in exactly one batch and no batch
 * is empty when items.length >= 1.
 *
 * Returns [ { batch_id: 'b1', items: [...] }, { batch_id: 'b2', ... }, { batch_id: 'b3', ... } ]
 */
function planBatches(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [
      { batch_id: 'b1', items: [] },
      { batch_id: 'b2', items: [] },
      { batch_id: 'b3', items: [] }
    ];
  }
  const total = items.length;
  // Ceiling divide: e.g. 9 → [3,3,3], 10 → [4,3,3], 7 → [3,2,2]
  const b1Size = Math.ceil(total / 3);
  const b2Size = Math.ceil((total - b1Size) / 2);
  const b3Size = total - b1Size - b2Size;

  return [
    { batch_id: 'b1', items: items.slice(0, b1Size) },
    { batch_id: 'b2', items: items.slice(b1Size, b1Size + b2Size) },
    { batch_id: 'b3', items: items.slice(b1Size + b2Size) }
  ];
}

// ---------------------------------------------------------------------------
// buildContactSheet — composite PNGs into a grid mosaic using sharp
// ---------------------------------------------------------------------------

/**
 * Contact-sheet grid config per kind.
 * cols × rows cells, each cell at cellW × cellH pixels.
 */
function gridConfig(kind) {
  if (kind === 'portrait') {
    return { cols: 4, rows: 4, cellW: 64, cellH: 64 };
  }
  // scene, launcher, item — 3×3 at 200×120
  return { cols: 3, rows: 3, cellW: 200, cellH: 120 };
}

/**
 * buildContactSheet(batchDir, kind) — compose all PNGs in batchDir into a
 * contact sheet. Returns the output path or null if sharp is unavailable or
 * no PNGs found.
 *
 * batchDir  — directory containing the generated PNGs for this batch
 * kind      — 'scene' | 'portrait' | 'launcher' | 'item'
 * outPath   — full path where the contact sheet PNG should be written
 */
async function buildContactSheet(batchDir, kind, outPath) {
  let pngFiles;
  try {
    const entries = await fsp.readdir(batchDir);
    pngFiles = entries
      .filter((e) => e.toLowerCase().endsWith('.png'))
      .sort()
      .map((e) => path.join(batchDir, e));
  } catch (e) {
    console.warn('[sdk_asset_batches] buildContactSheet: cannot read batchDir', batchDir, e.message);
    return null;
  }

  if (!pngFiles || pngFiles.length === 0) {
    console.warn('[sdk_asset_batches] buildContactSheet: no PNGs in', batchDir);
    return null;
  }

  let sharp;
  try {
    sharp = require('sharp');
  } catch (_e) {
    console.warn('[sdk_asset_batches] buildContactSheet: sharp not available — skipping mosaic');
    return null;
  }

  const cfg = gridConfig(kind);
  const { cols, rows, cellW, cellH } = cfg;
  const totalW = cols * cellW;
  const totalH = rows * cellH;

  try {
    // Build a blank canvas then composite each thumbnail into it.
    const composites = [];
    for (let i = 0; i < pngFiles.length && i < cols * rows; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      try {
        const thumb = await sharp(pngFiles[i])
          .resize(cellW, cellH, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
          .png()
          .toBuffer();
        composites.push({
          input: thumb,
          left: col * cellW,
          top: row * cellH
        });
      } catch (cellErr) {
        console.warn('[sdk_asset_batches] buildContactSheet: cell', i, 'failed:', cellErr.message);
      }
    }

    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await sharp({
      create: {
        width: totalW,
        height: totalH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 255 }
      }
    })
      .composite(composites)
      .png()
      .toFile(outPath);

    return outPath;
  } catch (e) {
    console.warn('[sdk_asset_batches] buildContactSheet: mosaic failed —', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// runBatch — generate all assets for one batch, write PNGs + art_source mirror
// ---------------------------------------------------------------------------

/**
 * runBatch(projectId, sdkRoot, kind, batch, opts)
 *
 * kind    — 'scene' | 'portrait' | 'launcher' | 'item'
 * batch   — { batch_id: 'b1', items: [...] }  (items have at least {id, ...})
 * opts    — { emit, job, promptFn }
 *   emit      — function(kind, data) for progress events
 *   job       — { cancelled: bool } — set to bail early
 *   promptFn  — function(item) → string — build the generation prompt for an item
 *               (callers supply this; keeps generation logic in autopilot)
 *
 * Returns { batch_id, kind, items: [...ids], generated_at, bytes_total, contact_sheet_path }
 * Also writes manifest JSON alongside the contact sheet.
 */
async function runBatch(projectId, sdkRoot, kind, batch, opts = {}) {
  const { emit: ev = () => {}, job = null, promptFn = null } = opts;

  await ensureBatchDirs(sdkRoot);

  // Output dirs for the generated PNGs (existing autopilot convention)
  const kindOutputDir = {
    scene: path.join(sdkRoot, 'scenes'),
    portrait: path.join(sdkRoot, 'characters'),
    launcher: path.join(sdkRoot, 'launcher'),
    item: path.join(sdkRoot, 'items')
  }[kind] || path.join(sdkRoot, kind + 's');

  await fsp.mkdir(kindOutputDir, { recursive: true });

  // Batch-specific scratch dir (PNGs are copied here for the contact sheet)
  const batchScratchDir = path.join(batchesDir(sdkRoot), kind + '_' + batch.batch_id + '_thumbs');
  await fsp.mkdir(batchScratchDir, { recursive: true });

  const artSourceDir = path.join(sdkRoot, 'art_source', kind);
  await fsp.mkdir(artSourceDir, { recursive: true });

  const items = batch.items || [];
  let bytesTotal = 0;
  const generatedIds = [];

  for (const item of items) {
    if (job && job.cancelled) break;
    if (!item || !item.id) continue;

    const destPng = path.join(kindOutputDir, item.id + '.png');

    if (fs.existsSync(destPng)) {
      ev('asset', { kind, id: item.id, skipped: 'exists', batch_id: batch.batch_id });
      // Still copy to batch scratch for the contact sheet.
      try {
        await fsp.copyFile(destPng, path.join(batchScratchDir, item.id + '.png'));
      } catch (_e) { /* best-effort */ }
      generatedIds.push(item.id);
      bytesTotal += (await fsp.stat(destPng).catch(() => ({ size: 0 }))).size;
      continue;
    }

    try {
      const prompt = promptFn ? promptFn(item) : (item.prompt || item.description || item.id);

      let r;
      if (kind === 'portrait') {
        r = await pulpAi.generatePortrait({
          prompt, dim: 64,
          projectId, sceneId: item.id, stage: 'portrait_bursts'
        });
      } else {
        // scene, launcher, item — generateScene handles arbitrary dims
        const dim = item._dim || (kind === 'portrait' ? [64, 64] : [400, 240]);
        r = await pulpAi.generateScene({
          prompt, dim,
          projectId, sceneId: item.id, stage: 'scene_bursts'
        });
      }

      if (!r || !r.pngBuffer) throw new Error('no png returned');

      await fsp.writeFile(destPng, r.pngBuffer);
      bytesTotal += r.pngBuffer.length;
      generatedIds.push(item.id);

      // Mirror source (pre-dither) under art_source/<kind>/
      if (r.sourceBuffer) {
        await fsp.writeFile(path.join(artSourceDir, item.id + '.png'), r.sourceBuffer);
      }

      // Copy to batch scratch dir for contact sheet compositing
      await fsp.copyFile(destPng, path.join(batchScratchDir, item.id + '.png'));

      ev('asset', { kind, id: item.id, bytes: r.pngBuffer.length, batch_id: batch.batch_id });
    } catch (e) {
      ev('log', { text: `[batch ${batch.batch_id}] ${kind} ${item.id} failed: ${e.message}` });
    }
  }

  // Build contact sheet
  const contactSheetPath = path.join(
    batchesDir(sdkRoot),
    `${kind}_${batch.batch_id}_contact_sheet.png`
  );
  const csPath = await buildContactSheet(batchScratchDir, kind, contactSheetPath);

  // Write manifest JSON
  const manifest = {
    batch_id: batch.batch_id,
    kind,
    items: generatedIds,
    generated_at: new Date().toISOString(),
    bytes_total: bytesTotal,
    contact_sheet_path: csPath || null
  };
  const manifestPath = path.join(
    batchesDir(sdkRoot),
    `${kind}_${batch.batch_id}_manifest.json`
  );
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  ev('batch_done', { batch_id: batch.batch_id, kind, items: generatedIds, contact_sheet_path: csPath });

  return { ...manifest, manifest_path: manifestPath };
}

// ---------------------------------------------------------------------------
// gateForBatch — write a gate file the autopilot polls before the next batch
// ---------------------------------------------------------------------------

/**
 * gateForBatch(projectId, sdkRoot, batch_id, manifestInfo)
 *
 * Writes <sdkRoot>/sdk_data/gates/batch_<batch_id>.json with status
 * 'awaiting_review'. The autopilot polls this file; when chosen === 'approved'
 * it continues, when chosen === 'revise' it emits a revise event and halts.
 *
 * Returns the gate object as written.
 */
async function gateForBatch(projectId, sdkRoot, batch_id, manifestInfo = {}) {
  await ensureBatchDirs(sdkRoot);

  const gate = {
    status: 'awaiting_review',
    batch_id,
    project_id: projectId,
    manifest_path: manifestInfo.manifest_path || null,
    contact_sheet_path: manifestInfo.contact_sheet_path || null,
    created_at: new Date().toISOString(),
    chosen: null,
    revise_notes: null
  };

  const gatePath = path.join(gatesDir(sdkRoot), `batch_${batch_id}.json`);
  await fsp.writeFile(gatePath, JSON.stringify(gate, null, 2));
  return gate;
}

/**
 * readBatchGate(sdkRoot, batch_id) — read the gate file for a batch.
 * Returns null if not found.
 */
async function readBatchGate(sdkRoot, batch_id) {
  const gatePath = path.join(gatesDir(sdkRoot), `batch_${batch_id}.json`);
  try {
    const raw = await fsp.readFile(gatePath, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

/**
 * updateBatchGate(sdkRoot, batch_id, patch) — atomic patch of gate file.
 */
async function updateBatchGate(sdkRoot, batch_id, patch) {
  const gatePath = path.join(gatesDir(sdkRoot), `batch_${batch_id}.json`);
  let existing = {};
  try {
    existing = JSON.parse(await fsp.readFile(gatePath, 'utf8'));
  } catch (_e) { /* create fresh if missing */ }
  const updated = { ...existing, ...patch, updated_at: new Date().toISOString() };
  await fsp.writeFile(gatePath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * listBatchGates(sdkRoot) — return all batch_*.json gate objects sorted by batch_id.
 */
async function listBatchGates(sdkRoot) {
  const dir = gatesDir(sdkRoot);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (_e) {
    return [];
  }
  const gates = [];
  for (const e of entries.filter((f) => f.startsWith('batch_') && f.endsWith('.json'))) {
    try {
      const raw = await fsp.readFile(path.join(dir, e), 'utf8');
      gates.push(JSON.parse(raw));
    } catch (_e) { /* skip corrupt gate */ }
  }
  return gates.sort((a, b) => (a.batch_id < b.batch_id ? -1 : 1));
}

/**
 * readBatchManifest(sdkRoot, batch_id, kind) — load the manifest JSON for a
 * specific batch+kind. Returns null if not found.
 */
async function readBatchManifest(sdkRoot, batch_id, kind) {
  const p = path.join(batchesDir(sdkRoot), `${kind}_${batch_id}_manifest.json`);
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch (_e) {
    return null;
  }
}

module.exports = {
  planBatches,
  runBatch,
  buildContactSheet,
  gateForBatch,
  readBatchGate,
  updateBatchGate,
  listBatchGates,
  readBatchManifest
};
