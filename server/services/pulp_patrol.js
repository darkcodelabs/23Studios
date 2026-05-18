'use strict';

// pulp_patrol.js — scan a pulp project for placeholder / missing assets,
// produce a punch list, and (optionally) regenerate everything via the
// AI pipeline. Single entry point per concern:
//
//   patrolProject(projectId)            -> { summary, issues }
//   regenAll(projectId, { kinds, ... }) -> { summary, fixed, failed }
//
// No procedural fallback. If the AI pipeline can't produce a passing
// asset after retries, the patrol logs it as failed and moves on; the
// user gets a real failure rather than a wireframe box masquerading as
// "art".

const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const pulp = require('./pulp_project');
const pulpAi = require('./pulp_ai');
const scenes = require('./pulp_scenes');
const portraits = require('./pulp_portraits');
const validator = require('./playdate_validator');
const spec = require('./playdate_spec');

function patrolErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

async function loadProjectOrThrow(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) throw patrolErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw patrolErr(400, 'not_pulp_project');
  return project;
}

// ----- Scene background existence check (on-disk) ------------------------

async function sceneFileExists(project, room) {
  if (!room || typeof room.background_image !== 'string'
      || room.background_image.length === 0) return false;
  // background_image is a path relative to pulp_data/, e.g. "scenes/foo.png".
  try {
    const scenesDir = await scenes.scenesDirFor(project);
    // Force-resolve via the scene helper to keep the path-traversal guard.
    const file = path.join(scenesDir, path.basename(room.background_image));
    const st = await fsp.stat(file);
    return st.isFile() && st.size > 0;
  } catch (_e) {
    return false;
  }
}

// ----- Project context for prompts --------------------------------------

function buildProjectContext(project, projectFile) {
  return {
    project_name: (projectFile && projectFile.name) || project.name || '',
    theme: project.description || '',
    tile_dim: pulp.resolveTileDim(projectFile)
  };
}

// ----- patrolProject ----------------------------------------------------

/**
 * patrolProject(projectId) -> { summary, issues }
 *
 * issues[].kind: 'tile' | 'scene' | 'character'
 * issues[].id: pulp id of the offending entity
 * issues[].problem: short reason
 * issues[].suggested_prompt: ready-to-use prompt (already includes
 *   STRICT_1BIT_PROMPT_SUFFIX)
 */
async function patrolProject(projectId) {
  const project = await loadProjectOrThrow(projectId);
  const { project: projectFile } = await pulp.readPulp(projectId);

  const tiles = Array.isArray(projectFile.tiles) ? projectFile.tiles : [];
  const rooms = Array.isArray(projectFile.rooms) ? projectFile.rooms : [];
  const characters = Array.isArray(projectFile.characters) ? projectFile.characters : [];

  const ctx = buildProjectContext(project, projectFile);
  const issues = [];

  // -- tiles --
  let tilesMissing = 0;
  let tilesPlaceholder = 0;
  for (const t of tiles) {
    const f = Array.isArray(t.frames) && t.frames.length > 0 ? t.frames[0] : null;
    if (!f || typeof f.pixels !== 'string') {
      tilesMissing++;
      issues.push({
        kind: 'tile',
        id: t.id,
        problem: 'no_pixels',
        suggested_prompt: spec.promptForAsset({
          kind: 'tile',
          name: t.name || t.id,
          type: t.type,
          projectContext: { ...ctx, id: t.id }
        })
      });
      continue;
    }
    const ph = validator.isPlaceholderPixels(f.pixels);
    if (ph.placeholder) {
      tilesPlaceholder++;
      issues.push({
        kind: 'tile',
        id: t.id,
        problem: 'placeholder:' + ph.reason,
        suggested_prompt: spec.promptForAsset({
          kind: 'tile',
          name: t.name || t.id,
          type: t.type,
          projectContext: { ...ctx, id: t.id }
        })
      });
    }
  }

  // -- scenes --
  let scenesMissingBg = 0;
  for (const r of rooms) {
    const exists = await sceneFileExists(project, r);
    if (!exists) {
      scenesMissingBg++;
      issues.push({
        kind: 'scene',
        id: r.id,
        problem: r.background_image ? 'bg_file_missing' : 'no_background_image',
        suggested_prompt: spec.promptForAsset({
          kind: 'scene',
          name: r.name || r.id,
          type: 'background',
          projectContext: {
            ...ctx,
            description: (r.scene_meta && r.scene_meta.description) || ''
          }
        })
      });
    }
  }

  // -- characters --
  let charactersMissingPortrait = 0;
  for (const c of characters) {
    if (!c || typeof c.portrait_image !== 'string' || c.portrait_image.length === 0) {
      charactersMissingPortrait++;
      issues.push({
        kind: 'character',
        id: c && c.id,
        problem: 'no_portrait',
        suggested_prompt: spec.promptForAsset({
          kind: 'portrait',
          name: (c && c.name) || (c && c.id),
          type: c && c.role,
          projectContext: { ...ctx, role: c && c.role, bio: c && c.bio }
        })
      });
    }
  }

  const summary = {
    tiles_total: tiles.length,
    tiles_missing: tilesMissing,
    tiles_placeholder: tilesPlaceholder,
    scenes_total: rooms.length,
    scenes_missing_bg: scenesMissingBg,
    characters_total: characters.length,
    characters_missing_portrait: charactersMissingPortrait
  };

  return { summary, issues };
}

// ----- regenAll ---------------------------------------------------------

const DEFAULT_CONCURRENCY = 4;

/**
 * regenAll(projectId, { kinds?, concurrency?, onProgress? })
 *
 * - Fixes every issue patrolProject() returns.
 * - kinds: optional array filter, e.g. ['tile'] to only fix tiles.
 * - concurrency: parallelism cap (default 4). OpenRouter rate-limits +
 *   sharp memory both rule out aggressive parallelism.
 * - onProgress({ stage, current, total, item }): optional callback for
 *   SSE / CLI progress.
 *
 * Returns { summary, fixed: [...], failed: [...] }
 *   fixed[].kind/id/took_ms
 *   failed[].kind/id/error
 */
async function regenAll(projectId, opts = {}) {
  const project = await loadProjectOrThrow(projectId);
  const { project: projectFile } = await pulp.readPulp(projectId);
  const ctx = buildProjectContext(project, projectFile);
  const kindsFilter = Array.isArray(opts.kinds) && opts.kinds.length > 0
    ? new Set(opts.kinds) : null;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency || DEFAULT_CONCURRENCY));
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  // Re-patrol to get the live punch list.
  const { summary: beforeSummary, issues } = await patrolProject(projectId);
  const work = kindsFilter ? issues.filter((i) => kindsFilter.has(i.kind)) : issues;

  onProgress({ stage: 'plan', current: 0, total: work.length, summary: beforeSummary });

  const fixed = [];
  const failed = [];
  let cursor = 0;
  let inFlight = 0;
  let completed = 0;

  // Index original entities so workers can look them up cheaply.
  const tileById = new Map();
  for (const t of (projectFile.tiles || [])) tileById.set(t.id, t);
  const roomById = new Map();
  for (const r of (projectFile.rooms || [])) roomById.set(r.id, r);
  const charById = new Map();
  for (const c of (projectFile.characters || [])) charById.set(c && c.id, c);

  await new Promise((resolve) => {
    function next() {
      if (cursor >= work.length && inFlight === 0) return resolve();
      while (inFlight < concurrency && cursor < work.length) {
        const issue = work[cursor++];
        inFlight++;
        runOne(issue)
          .then((r) => {
            completed++;
            const isOk = !!(r && r.ok);
            if (isOk) fixed.push(r);
            else failed.push(r || { kind: issue.kind, id: issue.id, error: 'unknown' });
            onProgress({
              stage: isOk ? 'fixed' : 'failed',
              current: completed,
              total: work.length,
              item: r
            });
          })
          .catch((e) => {
            completed++;
            failed.push({ kind: issue.kind, id: issue.id, error: String(e && e.message || e) });
            onProgress({
              stage: 'failed',
              current: completed,
              total: work.length,
              item: { kind: issue.kind, id: issue.id, error: String(e && e.message || e) }
            });
          })
          .finally(() => { inFlight--; next(); });
      }
    }
    next();
  });

  // Re-patrol for the after-summary.
  const { summary: afterSummary } = await patrolProject(projectId);

  return {
    summary: { before: beforeSummary, after: afterSummary },
    fixed,
    failed
  };

  // ----- Worker -----

  async function runOne(issue) {
    const t0 = Date.now();
    try {
      if (issue.kind === 'tile') {
        const tile = tileById.get(issue.id);
        if (!tile) return { ok: false, kind: 'tile', id: issue.id, error: 'tile_gone' };
        const result = await regenTile(projectId, projectFile, tile, ctx);
        return { ok: true, kind: 'tile', id: issue.id,
                 took_ms: Date.now() - t0, ...result };
      }
      if (issue.kind === 'scene') {
        const room = roomById.get(issue.id);
        if (!room) return { ok: false, kind: 'scene', id: issue.id, error: 'room_gone' };
        const result = await regenScene(projectId, projectFile, room, ctx);
        return { ok: true, kind: 'scene', id: issue.id,
                 took_ms: Date.now() - t0, ...result };
      }
      if (issue.kind === 'character') {
        const c = charById.get(issue.id);
        if (!c) return { ok: false, kind: 'character', id: issue.id, error: 'character_gone' };
        const result = await regenPortrait(projectId, projectFile, c, ctx);
        return { ok: true, kind: 'character', id: issue.id,
                 took_ms: Date.now() - t0, ...result };
      }
      return { ok: false, kind: issue.kind, id: issue.id, error: 'unknown_kind' };
    } catch (e) {
      return { ok: false, kind: issue.kind, id: issue.id,
               took_ms: Date.now() - t0, error: String(e && e.message || e) };
    }
  }
}

// ----- Per-kind regen helpers -------------------------------------------

const sharp = require('sharp');

async function regenTile(projectId, projectFile, tile, ctx) {
  const tileDim = pulp.resolveTileDim(projectFile);
  const prompt = spec.promptForAsset({
    kind: 'tile',
    name: tile.name || tile.id,
    type: tile.type,
    projectContext: { ...ctx, id: tile.id, tile_dim: tileDim }
  });
  // generateTileArt routes through pulp_ai's strict 1-bit pipeline + retry.
  const out = await pulpAi.generateTileArt({
    projectId,
    prompt,
    style: '',
    tileDim
  });
  // Decode to pixel string at the project's tile_dim.
  const pngBuf = Buffer.from(out.image_base64, 'base64');
  const raw = await sharp(pngBuf).resize(tileDim, tileDim, { kernel: 'nearest' })
    .greyscale().raw().toBuffer();
  let pixels = '';
  for (let i = 0; i < raw.length; i++) pixels += raw[i] < 128 ? '1' : '0';
  // Validate pixel string is not itself a placeholder.
  const ph = validator.isPlaceholderPixels(pixels);
  if (ph.placeholder) {
    const e = new Error('regen_still_placeholder:' + ph.reason);
    e.code = 'still_placeholder';
    throw e;
  }
  await pulp.patchCollectionItem(projectId, 'tiles', tile.id,
    { frames: [{ pixels }] });
  return { model: out.model, dim: tileDim };
}

async function regenScene(projectId, projectFile, room, ctx) {
  const prompt = spec.promptForAsset({
    kind: 'scene',
    name: room.name || room.id,
    type: 'background',
    projectContext: { ...ctx,
      description: (room.scene_meta && room.scene_meta.description) || '' }
  });
  const out = await scenes.generateAndSaveScene({
    projectId,
    safeRid: room.id,
    prompt,
    model: undefined, // pulp_ai picks default openai/gpt-5-image-mini
    opts: { dither: 'atkinson', threshold: 128, contrast: 1.0,
            brightness: 0, fit: 'cover' }
  });
  return { model: out.model, rel: out.rel, dim: out.dim };
}

async function regenPortrait(projectId, projectFile, character, ctx) {
  const prompt = spec.promptForAsset({
    kind: 'portrait',
    name: character.name || character.id,
    type: character.role,
    projectContext: { ...ctx, role: character.role, bio: character.bio }
  });
  // Mirror pulp_scenes.generateAndSaveScene shape: pulp_portraits has
  // generate+persist helpers, but we go via pulp_ai.generatePortrait + the
  // public portrait save path to keep the contract uniform.
  const out = await pulpAi.generatePortrait({
    prompt,
    model: undefined,
    dim: [64, 64]
  });
  // Reuse pulp_portraits' save helper if exposed; otherwise persist via
  // patchCharacter referencing a relative path. We use the public service
  // surface to stay schema-correct.
  if (typeof portraits.savePortraitAndPatchCharacter === 'function') {
    const persisted = await portraits.savePortraitAndPatchCharacter(
      projectId, character.id, out.pngBuffer,
      { dim: [64, 64], dither: 'bayer4', processed_at_ts: Date.now() },
      { buffer: out.pngBuffer, ext: '.png' }
    );
    return { model: out.model, rel: persisted.rel };
  }
  // Best-effort fallback: persist the portrait file directly under
  // pulp_data/portraits/<id>.png and patch the character.
  const baseReal = await fsp.realpath(
    (await loadProjectOrThrow(projectId)).local_path);
  const dir = path.join(baseReal, 'pulp_data', 'portraits');
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${character.id}.png`);
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, out.pngBuffer, { mode: 0o600 });
  await fsp.rename(tmp, file);
  const rel = `portraits/${character.id}.png`;
  await pulp.patchCharacter(projectId, character.id, { portrait_image: rel });
  return { model: out.model, rel };
}

module.exports = {
  patrolProject,
  regenAll,
  patrolErr,
  // for testing
  _internals: {
    sceneFileExists,
    buildProjectContext
  }
};
