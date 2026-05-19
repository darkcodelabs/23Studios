'use strict';

// mvp_autopilot.js — vibe-lock MVP driver.
//
// Goal: generate ONE scene + ONE character + ONE asset prompt for human
// approval BEFORE the full 25-scene autopilot burns budget. The user
// approves/edits each prompt, the system dispatches to OpenRouter, the user
// reviews each output, then writes <project>/sdk_data/mvp/locked.json with
// the chosen anchor paths. Full autopilot reads that file and prepends the
// anchors to every scene prompt to keep style locked.
//
// Files written under <project>/sdk_data/mvp/:
//   pending_prompts.json  — array of prompt records (status lifecycle)
//   outputs/<id>.png      — generated PNG per approved prompt
//   locked.json           — final anchor manifest after Cory clicks "Lock"

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const pulpAi = require('./pulp_ai');
const assembly = require('./sdk_prompt_assembly');
const assetLibrary = require('./asset_library');

const MVP_REL = path.join('sdk_data', 'mvp');
const PENDING_FILE = 'pending_prompts.json';
const LOCKED_FILE = 'locked.json';
const OUTPUTS_DIR = 'outputs';
const SDK_PROJECT_REL = path.join('sdk_data', 'project.json');
const EXTRACTED_REL = path.join('sdk_data', 'requirements', 'extracted.json');

// Crude USD estimate per image — image-mini ~$0.04, conservative bound.
const EST_COST_PER_IMAGE = 0.05;

function mvpDir(localPath) {
  return path.join(localPath, MVP_REL);
}

async function ensureMvpDir(localPath) {
  const dir = mvpDir(localPath);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(dir, OUTPUTS_DIR), { recursive: true, mode: 0o700 });
  return dir;
}

async function readJsonOrNull(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (_e) { return null; }
}

async function readSdkProject(localPath) {
  return (await readJsonOrNull(path.join(localPath, SDK_PROJECT_REL))) || {};
}

async function readExtracted(localPath) {
  return (await readJsonOrNull(path.join(localPath, EXTRACTED_REL))) || {};
}

async function readStoryBible(localPath) {
  try {
    const raw = await fsp.readFile(path.join(localPath, 'sdk_data', 'story_bible.md'), 'utf8');
    return raw.length > 16000
      ? raw.slice(0, 16000) + '\n\n[... bible truncated to 16k chars ...]'
      : raw;
  } catch (_e) { return null; }
}

// pickMvpScope — choose ONE scene + ONE character + ONE asset to vibe-lock.
//
// Strategy (no required intake — all defaulted):
//   scene:     first scene from sdk_data/project.json scenes[] (title scene)
//              if present; else first scene from extracted.scenes; else a
//              synthetic 'act1_opener' fallback record.
//   character: protagonist from extracted.characters (or first if none flagged
//              protagonist); else synthetic 'protagonist' fallback.
//   asset:     'title' launcher card (350x155 launcher card.png) — high
//              signal for vibe lock since it composites scene + character +
//              title type.
//
// Returns: { scenes:[sceneRecord], characters:[charRecord], assets:[assetRecord] }
async function pickMvpScope(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('project not found'); e.status = 404; throw e; }
  if (project.game_type !== 'sdk') {
    const e = new Error('not_sdk'); e.status = 400; throw e;
  }
  const sdk = await readSdkProject(project.local_path);
  const extracted = await readExtracted(project.local_path);

  // Pick scene.
  let scene = null;
  if (Array.isArray(sdk.scenes) && sdk.scenes.length > 0) {
    scene = sdk.scenes[0];
  } else if (Array.isArray(extracted.scenes) && extracted.scenes.length > 0) {
    const s = extracted.scenes[0];
    scene = {
      id: s.id || 'act1_opener',
      name: s.name || 'Act 1 Opener',
      type: 'cutscene',
      description: s.description || s.summary || 'opening scene',
      mood: s.mood || 'expectant',
      mechanic_kit: null,
      style_reference: null,
      exits: []
    };
  } else {
    scene = {
      id: 'act1_opener',
      name: 'Act 1 Opener',
      type: 'cutscene',
      description: 'opening title scene — establish setting + tone',
      mood: 'expectant',
      mechanic_kit: null,
      style_reference: null,
      exits: []
    };
  }

  // Pick character.
  let character = null;
  const charList = Array.isArray(extracted.characters) ? extracted.characters
                 : Array.isArray(sdk.characters)       ? sdk.characters
                 : [];
  if (charList.length > 0) {
    const protag = charList.find((c) => (c.role || '').toLowerCase() === 'protagonist')
                || charList[0];
    character = {
      id: protag.id || 'protagonist',
      name: protag.name || 'Protagonist',
      role: protag.role || 'protagonist',
      bio: protag.bio || protag.description || '',
      visual_anchor: protag.visual_anchor || `${protag.role || 'protagonist'} silhouette anchor`,
      portrait_prompt: protag.portrait_prompt || ''
    };
  } else {
    character = {
      id: 'protagonist',
      name: 'Protagonist',
      role: 'protagonist',
      bio: '',
      visual_anchor: 'protagonist silhouette anchor',
      portrait_prompt: ''
    };
  }

  // Pick asset — launcher title card by default (most vibe-loaded asset).
  const asset = {
    id: 'launcher_card',
    kind: 'launcher',
    target_file: 'card.png',
    dim: [350, 155],
    description: 'launcher shelf card — title legible + primary visual hook'
  };

  return { scenes: [scene], characters: [character], assets: [asset] };
}

// Build a prompt record for each scope item. Each record carries the
// system prompt (from sdk_prompt_assembly) + user prompt + estimated cost.
async function buildPromptsForScope({ project, scope, storyBible }) {
  const sdk = await readSdkProject(project.local_path);
  const intake = (sdk && sdk.intake) || {};
  let activePicks = {};
  try { activePicks = await assetLibrary.getActivePicksWithSpecs(project.id) || {}; }
  catch (_e) { activePicks = {}; }

  const records = [];

  // Scene burst record.
  for (const s of scope.scenes) {
    const sys = assembly.assembleSystemPrompt({
      stageId: 'scene_bursts',
      activePicks, storyBible,
      vars: { intake, bible: {}, scene: s }
    });
    const styleRefHint = s.style_reference
      ? ` Match the silhouette + dither density of HAKCD's ${s.style_reference} reference scene.`
      : '';
    const userPrompt = `${s.name}. ${s.description || ''} ` +
      `EMPTY scene background — NO human figure, NO player, NO NPC, NO character visible. ` +
      `Architecture, props, lighting, dither textures only. The sprite layer composites on top.${styleRefHint}`;
    records.push({
      id: `scene_${s.id}`,
      kind: 'scene',
      target_id: s.id,
      target_label: s.name,
      target_file: `sdk_data/scenes/${s.id}.png`,
      dim: [400, 240],
      model: 'openai/gpt-5-image-mini',
      system_prompt: sys,
      user_prompt: userPrompt,
      anchor_inputs: [],
      est_cost_usd: EST_COST_PER_IMAGE,
      status: 'pending_approval',
      output_path: null,
      error: null,
      created_at: new Date().toISOString(),
      approved_at: null,
      completed_at: null
    });
  }

  // Portrait burst record.
  for (const c of scope.characters) {
    const sys = assembly.assembleSystemPrompt({
      stageId: 'portrait_bursts',
      activePicks, storyBible,
      vars: { intake, bible: {} }
    });
    const anchor = c.visual_anchor || `${c.role || 'character'} anchor`;
    const userPrompt = (c.portrait_prompt && c.portrait_prompt.includes(anchor))
      ? c.portrait_prompt
      : `${anchor}. ${c.portrait_prompt || `${c.name} - ${c.role}`}`;
    records.push({
      id: `character_${c.id}`,
      kind: 'portrait',
      target_id: c.id,
      target_label: c.name,
      target_file: `sdk_data/characters/${c.id}.png`,
      dim: 64,
      model: 'openai/gpt-5-image-mini',
      system_prompt: sys,
      user_prompt: userPrompt,
      anchor_inputs: [],
      est_cost_usd: EST_COST_PER_IMAGE,
      status: 'pending_approval',
      output_path: null,
      error: null,
      created_at: new Date().toISOString(),
      approved_at: null,
      completed_at: null
    });
  }

  // Launcher asset record.
  for (const a of scope.assets) {
    const sys = assembly.assembleSystemPrompt({
      stageId: 'launcher',
      activePicks, storyBible,
      vars: { intake, bible: {} }
    });
    const titleScene = scope.scenes[0] || {};
    const userPrompt = `${titleScene.name || 'Title'} launcher card. ` +
      `${titleScene.description || ''} ` +
      `Wide framed marquee, title legible, primary character or icon visible. ` +
      `Atkinson dither. End: 350x155, 1-bit pixel art, pure black and pure white only, ` +
      `launcher card, no anti-aliasing.`;
    records.push({
      id: `asset_${a.id}`,
      kind: 'launcher',
      target_id: a.id,
      target_label: a.target_file,
      target_file: `sdk_data/launcher/${a.target_file}`,
      dim: a.dim || [350, 155],
      model: 'openai/gpt-5-image-mini',
      system_prompt: sys,
      user_prompt: userPrompt,
      anchor_inputs: [],
      est_cost_usd: EST_COST_PER_IMAGE,
      status: 'pending_approval',
      output_path: null,
      error: null,
      created_at: new Date().toISOString(),
      approved_at: null,
      completed_at: null
    });
  }

  return records;
}

async function readPending(localPath) {
  return (await readJsonOrNull(path.join(mvpDir(localPath), PENDING_FILE))) || [];
}

async function writePending(localPath, records) {
  const file = path.join(mvpDir(localPath), PENDING_FILE);
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

// startMvp(projectId, scopeOverride?) — pick scope, build prompts, persist.
// Returns { mvp_id, pending_prompts }.
async function startMvp(projectId, scopeOverride) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('project not found'); e.status = 404; throw e; }
  if (project.game_type !== 'sdk') {
    const e = new Error('not_sdk'); e.status = 400; throw e;
  }
  await ensureMvpDir(project.local_path);

  const scope = scopeOverride || await pickMvpScope(projectId);
  const storyBible = await readStoryBible(project.local_path);
  const records = await buildPromptsForScope({ project, scope, storyBible });
  await writePending(project.local_path, records);

  return {
    mvp_id: `mvp_${Date.now()}`,
    pending_prompts: records.map(redactRecord)
  };
}

// Redact long system_prompt down to a preview length for list views.
function redactRecord(r) {
  return {
    id: r.id,
    kind: r.kind,
    target_id: r.target_id,
    target_label: r.target_label,
    target_file: r.target_file,
    dim: r.dim,
    model: r.model,
    system_prompt: r.system_prompt,
    user_prompt: r.user_prompt,
    anchor_inputs: r.anchor_inputs || [],
    est_cost_usd: r.est_cost_usd,
    status: r.status,
    output_path: r.output_path,
    error: r.error,
    created_at: r.created_at,
    approved_at: r.approved_at,
    completed_at: r.completed_at
  };
}

async function listPrompts(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('project not found'); e.status = 404; throw e; }
  const records = await readPending(project.local_path);
  return records.map(redactRecord);
}

// patchPrompt(projectId, promptId, body) — edit + optionally approve.
// If body.approved === true, dispatch to OpenRouter via pulp_ai.generateScene
// (or generatePortrait for 64x64 portraits), write the PNG under outputs/,
// flip status to 'complete'. Otherwise just persist edits.
async function patchPrompt(projectId, promptId, body) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('project not found'); e.status = 404; throw e; }
  const records = await readPending(project.local_path);
  const idx = records.findIndex((r) => r.id === promptId);
  if (idx === -1) { const e = new Error('prompt not found'); e.status = 404; throw e; }
  const rec = records[idx];

  if (typeof body.system_prompt === 'string') rec.system_prompt = body.system_prompt;
  if (typeof body.user_prompt === 'string') rec.user_prompt = body.user_prompt;
  if (typeof body.model === 'string' && body.model.trim()) rec.model = body.model.trim();
  if (body.approved === false) {
    rec.status = 'rejected';
    records[idx] = rec;
    await writePending(project.local_path, records);
    return redactRecord(rec);
  }

  if (body.approved === true) {
    rec.status = 'dispatched';
    rec.approved_at = new Date().toISOString();
    records[idx] = rec;
    await writePending(project.local_path, records);

    try {
      // Image dispatch: assembleSystemPrompt was already baked into rec.system_prompt;
      // pulp_ai.generateScene takes a single prompt string. We concatenate the
      // (edited) system prompt as a style brief PREAMBLE to the user prompt, so
      // any edits land in the final image call.
      const combined = `${rec.system_prompt}\n\n--- IMAGE TARGET ---\n${rec.user_prompt}`;
      let result;
      if (rec.kind === 'portrait') {
        result = await pulpAi.generatePortrait({
          prompt: combined,
          model: rec.model,
          dim: typeof rec.dim === 'number' ? rec.dim : 64,
          projectId: project.id,
          sceneId: rec.target_id,
          stage: 'mvp_first'
        });
      } else {
        const dim = Array.isArray(rec.dim) ? rec.dim : [400, 240];
        result = await pulpAi.generateScene({
          prompt: combined,
          model: rec.model,
          dim,
          projectId: project.id,
          sceneId: rec.target_id,
          stage: 'mvp_first'
        });
      }
      if (!result || !result.pngBuffer) throw new Error('no png returned');

      const outName = `${rec.id}.png`;
      const outDir = path.join(mvpDir(project.local_path), OUTPUTS_DIR);
      await fsp.mkdir(outDir, { recursive: true });
      const outAbs = path.join(outDir, outName);
      await fsp.writeFile(outAbs, result.pngBuffer);
      rec.output_path = path.join(MVP_REL, OUTPUTS_DIR, outName);
      rec.status = 'complete';
      rec.completed_at = new Date().toISOString();
      rec.error = null;
    } catch (e) {
      rec.status = 'failed';
      rec.error = e && e.message || String(e);
    }

    records[idx] = rec;
    await writePending(project.local_path, records);
    return redactRecord(rec);
  }

  // No approval flag — just persist edits.
  records[idx] = rec;
  await writePending(project.local_path, records);
  return redactRecord(rec);
}

// lockMvp(projectId) — write locked.json with anchor paths from the complete
// records. Downstream sdk_autopilot reads this file at scene_burst stage.
async function lockMvp(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('project not found'); e.status = 404; throw e; }
  const records = await readPending(project.local_path);
  const completed = records.filter((r) => r.status === 'complete' && r.output_path);
  if (completed.length === 0) {
    const e = new Error('no completed prompts to lock');
    e.status = 409; e.code = 'no_completed';
    throw e;
  }

  const locked = {
    locked_at: new Date().toISOString(),
    anchors: completed.map((r) => ({
      id: r.id,
      kind: r.kind,
      target_id: r.target_id,
      target_label: r.target_label,
      output_path: r.output_path,
      user_prompt: r.user_prompt,
      model: r.model,
      dim: r.dim
    })),
    directive: 'Style locked to MVP — match dither density, character proportions, ' +
               'and composition of the reference anchors below. Do not deviate.'
  };

  const file = path.join(mvpDir(project.local_path), LOCKED_FILE);
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(locked, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
  return locked;
}

// readLocked(localPath) — used by sdk_autopilot to inject anchors into
// downstream scene prompts. Returns null if no lock has been set.
async function readLocked(localPath) {
  return await readJsonOrNull(path.join(localPath, MVP_REL, LOCKED_FILE));
}

module.exports = {
  pickMvpScope,
  startMvp,
  listPrompts,
  patchPrompt,
  lockMvp,
  readLocked,
  _internals: { redactRecord, buildPromptsForScope, ensureMvpDir, readPending, writePending }
};
