'use strict';

// openrouter_spend.js — Phase 6 B8 (Cost Panel)
//
// Per-project OpenRouter cost telemetry. Every OpenRouter call (chat-stream
// from services/openrouter.js + image-gen from services/pulp_ai.js) lands
// here via recordCall(); we append a structured row to
//   <local_path>/sdk_data/openrouter_spend.jsonl
//
// We also expose:
//   summarize(projectId)        -> { total_spend_usd, by_stage, by_scene,
//                                    by_model, recent_calls, cap_usd,
//                                    cap_remaining, cap_pct, call_count }
//   assertCapNotExceeded(id)    -> throws {status:402, code:'cost_cap_exceeded'}
//                                  when total_spend_usd >= cap_usd
//   getCap(projectId)           -> resolves cap from project sdk_data/project.json
//                                  then env OPENROUTER_CAP_USD then null
//
// Cost source-of-truth:
//   1. caller-supplied total_cost_usd                (preferred)
//   2. usage tokens × per-token rate from listModels (fallback chat)
//   3. flat IMAGE_FLAT_COST_USD                       (fallback image, no usage)
//
// The file is append-only JSONL — never rewritten — so concurrent autopilot
// workers can record without locking. Reads slurp the whole file (it's small
// in practice; one row per OpenRouter call).

const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const openrouter = require('./openrouter');

const SDK_DATA_REL = 'sdk_data';
const SPEND_REL = path.join(SDK_DATA_REL, 'openrouter_spend.jsonl');
const PROJECT_JSON_REL = path.join(SDK_DATA_REL, 'project.json');

// Backstop when the upstream response has no usage object and the caller did
// not pass total_cost_usd. Most modern image models on OpenRouter cost
// $0.02–$0.08 per generated image; 0.04 lands in the middle as a stand-in so
// the panel never shows $0.00 just because usage was absent.
const IMAGE_FLAT_COST_USD = 0.04;

// Per-call upper bound (cents) we'll accept from caller / pricing math. Pure
// defensive: if a mis-parsed pricing string returns $1e9 we don't want it to
// blow up the cap meter.
const PER_CALL_CAP_USD = 50;

const VALID_STAGES = new Set([
  'chat', 'tile-art', 'scene', 'portrait', 'sound', 'music',
  'brainstorm', 'story', 'characters', 'scene_bursts', 'portrait_bursts',
  'scene_lua', 'sfx', 'launcher', 'npc_dialog_tool', 'late_add', 'unknown'
]);

function clampStage(s) {
  if (typeof s !== 'string') return 'unknown';
  return VALID_STAGES.has(s) ? s : 'unknown';
}

function clampStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

function clampNum(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

async function resolveLocalPath(projectId) {
  const p = await projects.getProject(projectId);
  if (!p) return null;
  return p.local_path || null;
}

async function ensureSpendDir(localPath) {
  await fsp.mkdir(path.join(localPath, SDK_DATA_REL), { recursive: true, mode: 0o700 });
}

function spendFile(localPath) {
  return path.join(localPath, SPEND_REL);
}

function projectJsonFile(localPath) {
  return path.join(localPath, PROJECT_JSON_REL);
}

async function readProjectJson(localPath) {
  try {
    const raw = await fsp.readFile(projectJsonFile(localPath), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_e) {
    return {};
  }
}

// Get the spend cap (USD). Resolution order:
//   1. project.json `openrouter_cap_usd`
//   2. env OPENROUTER_CAP_USD
//   3. null (no cap)
async function getCap(projectId) {
  const localPath = await resolveLocalPath(projectId);
  if (localPath) {
    const meta = await readProjectJson(localPath);
    const v = Number(meta.openrouter_cap_usd);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const envV = Number(process.env.OPENROUTER_CAP_USD);
  if (Number.isFinite(envV) && envV > 0) return envV;
  return null;
}

// Set / overwrite the cap on disk in sdk_data/project.json. Used by the
// route layer when the operator wants to set/raise/lower a project-specific
// cap; intentionally permissive (Number > 0 only).
async function setCap(projectId, capUsd) {
  const localPath = await resolveLocalPath(projectId);
  if (!localPath) throw Object.assign(new Error('project not found'), { status: 404, code: 'project_not_found' });
  const v = Number(capUsd);
  if (!Number.isFinite(v) || v <= 0) {
    throw Object.assign(new Error('cap must be a positive number'), { status: 400, code: 'bad_cap' });
  }
  await ensureSpendDir(localPath);
  const meta = await readProjectJson(localPath);
  meta.openrouter_cap_usd = v;
  const tmp = projectJsonFile(localPath) + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(meta, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, projectJsonFile(localPath));
  return v;
}

// Pricing-from-models is a best-effort fallback when the caller didn't pass
// total_cost_usd. listModels() is cached so this is cheap when warm.
let pricingMap = null;
let pricingMapTs = 0;
const PRICING_TTL = 60 * 60 * 1000;

async function pricingFor(modelId) {
  if (!modelId) return null;
  if (!pricingMap || (Date.now() - pricingMapTs) > PRICING_TTL) {
    try {
      const list = await openrouter.listModels();
      pricingMap = new Map(list.map((m) => [m.id, m.pricing || null]));
      pricingMapTs = Date.now();
    } catch (_e) {
      // If model listing is unavailable we lose pricing fallback but
      // recording continues to work with whatever the caller supplied.
      pricingMap = pricingMap || new Map();
    }
  }
  return pricingMap.get(modelId) || null;
}

function computeCostFromUsage(pricing, usage) {
  if (!pricing || !usage) return null;
  const pIn = Number(pricing.prompt);
  const pOut = Number(pricing.completion);
  const tIn = Number(usage.prompt_tokens) || 0;
  const tOut = Number(usage.completion_tokens) || 0;
  if (!Number.isFinite(pIn) && !Number.isFinite(pOut)) return null;
  const inCost = Number.isFinite(pIn) ? pIn * tIn : 0;
  const outCost = Number.isFinite(pOut) ? pOut * tOut : 0;
  const total = inCost + outCost;
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.min(total, PER_CALL_CAP_USD);
}

// recordCall — single entrypoint. Returns the row that was logged so
// callers can include the cost in their response if useful.
//
// Required: projectId, model, stage. Everything else is optional.
async function recordCall(input) {
  const projectId = input && input.projectId;
  if (!projectId) return null;
  const localPath = await resolveLocalPath(projectId);
  if (!localPath) return null;

  const stage = clampStage(input.stage);
  const kind = clampStr(input.kind || '', 64);
  const model = clampStr(input.model || '', 200);
  const scene_id = clampStr(input.scene_id || '', 200);
  const prompt_tokens = clampNum(input.prompt_tokens, 0);
  const completion_tokens = clampNum(input.completion_tokens, 0);

  let total_cost_usd = clampNum(input.total_cost_usd, null);
  if (total_cost_usd == null) {
    const pricing = await pricingFor(model);
    const fromUsage = computeCostFromUsage(pricing, { prompt_tokens, completion_tokens });
    if (fromUsage != null) {
      total_cost_usd = fromUsage;
    } else if (kind === 'image' || kind === 'tile-art' || kind === 'scene' || kind === 'portrait') {
      total_cost_usd = IMAGE_FLAT_COST_USD;
    } else {
      total_cost_usd = 0;
    }
  } else {
    total_cost_usd = Math.min(total_cost_usd, PER_CALL_CAP_USD);
  }

  const row = {
    ts: Date.now(),
    project_id: projectId,
    stage,
    scene_id: scene_id || null,
    kind: kind || null,
    model,
    prompt_tokens,
    completion_tokens,
    total_cost_usd,
    fallback: !!input.fallback
  };

  try {
    await ensureSpendDir(localPath);
    await fsp.appendFile(spendFile(localPath), JSON.stringify(row) + '\n', { mode: 0o600 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[openrouter_spend] record failed:', e && e.message);
  }
  return row;
}

async function readAllRows(localPath) {
  let raw;
  try { raw = await fsp.readFile(spendFile(localPath), 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const lines = raw.split('\n');
  const out = [];
  for (const ln of lines) {
    if (!ln) continue;
    try { out.push(JSON.parse(ln)); } catch (_e) { /* skip bad line */ }
  }
  return out;
}

// summarize — single read pass over the JSONL; we group by stage + scene +
// model, sum total_spend, and surface the last 50 calls (newest first).
async function summarize(projectId, opts) {
  const localPath = await resolveLocalPath(projectId);
  if (!localPath) {
    return {
      total_spend_usd: 0, call_count: 0,
      by_stage: {}, by_scene: {}, by_model: {},
      recent_calls: [],
      cap_usd: null, cap_remaining: null, cap_pct: 0
    };
  }
  const limit = opts && Number.isFinite(opts.recentLimit) ? opts.recentLimit : 50;
  const rows = await readAllRows(localPath);
  let total = 0;
  const by_stage = {};
  const by_scene = {};
  const by_model = {};
  for (const r of rows) {
    const c = Number(r.total_cost_usd) || 0;
    total += c;
    by_stage[r.stage || 'unknown'] = (by_stage[r.stage || 'unknown'] || 0) + c;
    if (r.scene_id) by_scene[r.scene_id] = (by_scene[r.scene_id] || 0) + c;
    if (r.model) by_model[r.model] = (by_model[r.model] || 0) + c;
  }
  const recent = rows.slice(-limit).reverse();
  const cap = await getCap(projectId);
  const cap_remaining = cap != null ? Math.max(0, cap - total) : null;
  const cap_pct = cap != null && cap > 0 ? Math.min(100, (total / cap) * 100) : 0;

  return {
    total_spend_usd: total,
    call_count: rows.length,
    by_stage,
    by_scene,
    by_model,
    recent_calls: recent,
    cap_usd: cap,
    cap_remaining,
    cap_pct
  };
}

// Throwable cap-check used by the Express middleware + autopilot loops. We
// re-summarize on every call which is fine at our throughput; if it ever
// becomes hot we cache by projectId+ts.
async function assertCapNotExceeded(projectId) {
  const s = await summarize(projectId, { recentLimit: 0 });
  if (s.cap_usd != null && s.total_spend_usd >= s.cap_usd) {
    const e = new Error(`OpenRouter cap reached for project ${projectId}: $${s.total_spend_usd.toFixed(4)} >= $${s.cap_usd.toFixed(2)}`);
    e.status = 402;
    e.code = 'cost_cap_exceeded';
    throw e;
  }
}

module.exports = {
  recordCall,
  summarize,
  assertCapNotExceeded,
  getCap,
  setCap,
  // exported for tests
  _internal: { computeCostFromUsage, IMAGE_FLAT_COST_USD, PER_CALL_CAP_USD }
};
