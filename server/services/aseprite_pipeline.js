'use strict';

// Bridge: prompt→Aseprite generation → Visual Pack Factory candidate.
// Replaces the "generate raster with OpenRouter, upload by hand" flow.
// The winning Lua script is stored beside the candidate PNG as
// candidates/<candidate_id>.lua — it is the canonical, re-runnable source.

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const visualPack = require('./visual_pack');
const scriptGen = require('./aseprite_script_gen');
const runner = require('./aseprite_runner');

async function readStyleGuide(projectId, packId) {
  const p = path.join(visualPack.PACKS_ROOT, projectId, packId, 'style', 'style_guide.md');
  try {
    return await fsp.readFile(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

// Generate an asset for a pack and ingest every exported PNG as a candidate.
// Returns { ok, attempts, candidates, script, history }.
async function generateCandidate({ projectId, packId, prompt, spec, model, signal }) {
  const styleGuide = await readStyleGuide(projectId, packId);

  const gen = await scriptGen.generateAsset({ prompt, spec, styleGuide, model, projectId, signal });
  if (!gen.ok) {
    const e = new Error('generation_failed');
    e.status = 502;
    e.code = 'generation_failed';
    e.detail = { attempts: gen.attempts, history: gen.history };
    throw e;
  }

  const promptHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  const provider = `aseprite:${model || scriptGen.DEFAULT_MODEL}`;
  const candidates = [];
  try {
    for (const art of gen.artifacts) {
      if (!art.name.endsWith('.png')) continue;
      const buffer = await fsp.readFile(art.path);
      const res = await visualPack.ingestCandidate(
        projectId,
        packId,
        { provider, prompt_hash: promptHash },
        { buffer, originalname: art.name }
      );
      for (const cand of (res && res.candidates) || []) {
        // canonical source: script lives next to the candidate metadata
        const luaPath = path.join(
          visualPack.PACKS_ROOT, projectId, packId, 'candidates', `${cand.candidate_id}.lua`
        );
        await fsp.writeFile(luaPath, gen.script, 'utf8');
        candidates.push({ ...cand, script_path: luaPath });
      }
    }
  } finally {
    try { await runner.cleanupJob(gen.jobId); } catch (_e) { /* best effort */ }
  }

  return {
    ok: true,
    attempts: gen.attempts,
    validation: gen.validation,
    candidates,
    script: gen.script,
    history: gen.history,
  };
}

module.exports = { generateCandidate };
