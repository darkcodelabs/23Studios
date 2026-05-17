'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const OpenAI = require('openai');
const sharp = require('sharp');

const claude = require('./claude');
const projects = require('./projects');
const pulp = require('./pulp_project');

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const API_KEY = process.env.OPENROUTER_API_KEY || '';

const DATA_DIR = process.env.PROJECTS_DATA_DIR
  ? path.resolve(process.env.PROJECTS_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const DOCS_PATH = path.join(__dirname, '..', 'data', 'pulpscript_docs.md');

const DEFAULT_IMAGE_MODEL = 'openai/dall-e-3';

const PROMPT_MAX = 4000;
const PROJECT_STATE_MAX = 4 * 1024;
const DOCS_MAX = 8 * 1024;

const GRID_ROWS = 15;
const GRID_COLS = 25;

let _client = null;
function client() {
  if (_client) return _client;
  if (!API_KEY) {
    const e = new Error('openrouter_unavailable');
    e.code = 'openrouter_unavailable';
    throw e;
  }
  _client = new OpenAI({
    baseURL: BASE_URL,
    apiKey: API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'http://127.0.0.1',
      'X-Title': '23 Studios'
    }
  });
  return _client;
}

function aiErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

function sanitizePrompt(s) {
  if (typeof s !== 'string') return '';
  // Strip control chars except whitespace; cap length.
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return clean.slice(0, PROMPT_MAX).trim();
}

function sanitizeModel(s) {
  if (typeof s !== 'string') return '';
  if (s.length === 0 || s.length > 200) return '';
  // Allow OpenAI/OpenRouter model id pattern: alnum, dot, dash, underscore, slash, colon.
  if (!/^[A-Za-z0-9._\-/:]+$/.test(s)) return '';
  return s;
}

async function loadProjectOrThrow(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) throw aiErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw aiErr(400, 'not_pulp_project');
  return project;
}

async function pulpDirFor(project) {
  // Mirror pulp_project semantics without re-importing internals.
  const baseReal = await fsp.realpath(project.local_path).catch(() => null);
  if (!baseReal) throw aiErr(400, 'local_path_missing');
  const dir = path.join(baseReal, 'pulp_data');
  try { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); }
  catch (_e) { /* best-effort */ }
  return dir;
}

async function logGeneration(project, entry) {
  try {
    const dir = await pulpDirFor(project);
    const file = path.join(dir, 'ai_generations.jsonl');
    const safe = {
      ts: Date.now(),
      kind: entry.kind,
      prompt: typeof entry.prompt === 'string' ? entry.prompt.slice(0, 4000) : '',
      model: entry.model || null,
      cost: typeof entry.cost === 'number' ? entry.cost : null
    };
    if (entry.fallback === true) safe.fallback = true;
    await fsp.appendFile(file, JSON.stringify(safe) + '\n', { mode: 0o600 });
  } catch (_e) {
    // logging is best-effort; never fail the request on log write
  }
}

async function readLog(project, limit = 500) {
  const dir = await pulpDirFor(project);
  const file = path.join(dir, 'ai_generations.jsonl');
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const lines = raw.split('\n').filter(Boolean);
  const out = [];
  for (const ln of lines) {
    try { out.push(JSON.parse(ln)); } catch (_e) { /* skip bad line */ }
  }
  return limit > 0 ? out.slice(-limit) : out;
}

// ---------- Tile art ----------

function deterministicBitsFromPrompt(prompt) {
  // 16x16 = 256 bits = 32 bytes. sha256 = 32 bytes -> exact fit.
  const hash = crypto.createHash('sha256').update(prompt || '').digest();
  // Use one byte per pixel (0 or 255) for a 1-channel raster.
  const px = Buffer.alloc(16 * 16, 255);
  // Carve a 14x14 inner region; outermost ring stays white for "frame".
  for (let y = 1; y < 15; y++) {
    for (let x = 1; x < 15; x++) {
      const bitIndex = ((y - 1) * 14 + (x - 1)) % 256;
      const byte = hash[bitIndex >> 3];
      const bit = (byte >> (bitIndex & 7)) & 1;
      // Mirror horizontally to feel sprite-like.
      const mx = x < 8 ? x : 15 - x;
      const mirrorBitIndex = ((y - 1) * 14 + (mx - 1)) % 256;
      const mByte = hash[mirrorBitIndex >> 3];
      const mBit = (mByte >> (mirrorBitIndex & 7)) & 1;
      const on = bit | mBit;
      px[y * 16 + x] = on ? 0 : 255;
    }
  }
  return px;
}

async function placeholderTilePng(prompt) {
  const raw = deterministicBitsFromPrompt(prompt);
  // sharp.create doesn't take a raw buffer; use the constructor form.
  const buf = await sharp(raw, { raw: { width: 16, height: 16, channels: 1 } })
    .png()
    .toBuffer();
  return buf;
}

async function decodeImageFromGenResult(item) {
  // OpenAI/OpenRouter image gen may return either b64_json or url.
  if (item && typeof item.b64_json === 'string' && item.b64_json.length > 0) {
    return Buffer.from(item.b64_json, 'base64');
  }
  if (item && typeof item.url === 'string' && item.url.length > 0) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`image fetch failed ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  throw new Error('no image data in response');
}

async function to1bit16x16Png(buf) {
  return await sharp(buf)
    .resize(16, 16, { kernel: 'nearest' })
    .threshold(128)
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

async function generateTileArt({ projectId, prompt, model, style }) {
  const project = await loadProjectOrThrow(projectId);
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) throw aiErr(400, 'bad_request', 'prompt required');
  const requestedModel = sanitizeModel(model) || DEFAULT_IMAGE_MODEL;
  const cleanStyle = sanitizePrompt(style);

  const augmented = '1-bit pixel art, 16x16 pixels, pure black on pure white background, '
    + 'thick black outlines, suitable for a Playdate game tile. '
    + (cleanStyle ? `Style: ${cleanStyle}. ` : '')
    + `Subject: ${cleanPrompt}`;

  let fallback = false;
  let imgBuf = null;
  let usedModel = requestedModel;

  if (!API_KEY) {
    fallback = true;
  } else {
    try {
      const result = await client().images.generate({
        model: requestedModel,
        prompt: augmented,
        size: '1024x1024',
        n: 1,
        response_format: 'b64_json'
      });
      const item = result && result.data && result.data[0];
      if (!item) throw new Error('empty image gen response');
      imgBuf = await decodeImageFromGenResult(item);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[pulp_ai] image gen failed, falling back:', e && (e.code || e.message));
      fallback = true;
    }
  }

  if (fallback) {
    imgBuf = await placeholderTilePng(augmented);
    usedModel = 'local-placeholder';
  }

  const finalPng = await to1bit16x16Png(imgBuf);
  const b64 = finalPng.toString('base64');

  await logGeneration(project, {
    kind: 'tile-art',
    prompt: cleanPrompt,
    model: usedModel,
    fallback
  });

  return {
    image_base64: b64,
    model: usedModel,
    prompt: cleanPrompt,
    fallback
  };
}

// ---------- Claude prompt helpers ----------

function awaitClaude({ projectId, cwd, text }) {
  return new Promise((resolve, reject) => {
    let buf = '';
    claude.sendMessage({
      projectId,
      cwd,
      text,
      onChunk: (chunk) => { buf += chunk; },
      onDone: () => resolve(buf),
      onError: (err) => reject(err)
    });
  });
}

function summarizeState(state, cap = PROJECT_STATE_MAX) {
  try {
    const slim = {
      name: state.name,
      tiles: (state.tiles || []).map((t) => ({ id: t.id, name: t.name, type: t.type })),
      rooms: (state.rooms || []).map((r) => ({ id: r.id, name: r.name })),
      sounds: (state.sounds || []).map((s) => ({ id: s.id, name: s.name })),
      songs: (state.songs || []).map((s) => ({ id: s.id, name: s.name })),
      player: state.player
    };
    const s = JSON.stringify(slim);
    return s.length > cap ? s.slice(0, cap) + '…' : s;
  } catch (_e) {
    return '{}';
  }
}

async function loadDocs(cap = DOCS_MAX) {
  try {
    const raw = await fsp.readFile(DOCS_PATH, 'utf8');
    return raw.length > cap ? raw.slice(0, cap) : raw;
  } catch (_e) {
    return '';
  }
}

// ---------- Script generation ----------

const SCOPES = new Set(['tile', 'room', 'game']);

function parseScriptResponse(text) {
  const m = /```(?:pulpscript|pulp)?\s*\n([\s\S]*?)```/i.exec(text || '');
  if (m) {
    const script = m[1].replace(/\s+$/, '');
    const explanation = (text.slice(0, m.index) + text.slice(m.index + m[0].length))
      .replace(/\s+/g, ' ')
      .trim();
    return { script, explanation };
  }
  return { script: '', explanation: (text || '').trim() };
}

async function generateScript({ projectId, context, prompt }) {
  const project = await loadProjectOrThrow(projectId);
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) throw aiErr(400, 'bad_request', 'prompt required');
  const ctx = context && typeof context === 'object' ? context : {};
  const scope = SCOPES.has(ctx.scope) ? ctx.scope : 'game';
  const tileId = sanitizePrompt(ctx.tile_id || '').slice(0, 64);
  const roomId = sanitizePrompt(ctx.room_id || '').slice(0, 64);

  const { project: state } = await pulp.readPulp(projectId);
  const stateSummary = summarizeState(state);
  const docs = await loadDocs();

  const idLabel = scope === 'tile' ? tileId : (scope === 'room' ? roomId : '');
  const composed =
    `You are writing PulpScript for a Playdate game. ` +
    `Project context: ${stateSummary}. ` +
    `Scope: ${scope} id=${idLabel}. ` +
    `PulpScript reference (truncated): ${docs}. ` +
    `User request: ${cleanPrompt}. ` +
    `Respond with PulpScript ONLY in a fenced \`\`\`pulpscript code block, ` +
    `followed by one short paragraph of plain text explanation outside the fence.`;

  let raw;
  try {
    raw = await awaitClaude({ projectId, cwd: project.local_path, text: composed });
  } catch (e) {
    throw aiErr(502, 'claude_failed', String(e && e.message || e).slice(0, 200));
  }

  const { script, explanation } = parseScriptResponse(raw);

  await logGeneration(project, {
    kind: 'script',
    prompt: cleanPrompt,
    model: 'claude-code'
  });

  return { script, explanation };
}

// ---------- Room layout ----------

function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  // Prefer fenced JSON block
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  candidates.push(text);

  for (const c of candidates) {
    // Find first '{' and try to parse from there with balanced braces.
    const start = c.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const slice = c.slice(start, i + 1);
          try { return JSON.parse(slice); } catch (_e) { break; }
        }
      }
    }
  }
  return null;
}

async function generateRoomLayout({ projectId, prompt, available_tile_ids }) {
  const project = await loadProjectOrThrow(projectId);
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) throw aiErr(400, 'bad_request', 'prompt required');
  if (!Array.isArray(available_tile_ids) || available_tile_ids.length === 0) {
    throw aiErr(400, 'bad_request', 'available_tile_ids required');
  }
  const ids = [];
  const idSet = new Set();
  for (const raw of available_tile_ids) {
    if (typeof raw !== 'string') continue;
    const t = raw.slice(0, 64);
    if (!t) continue;
    if (idSet.has(t)) continue;
    idSet.add(t);
    ids.push(t);
    if (ids.length >= 256) break;
  }
  if (ids.length === 0) throw aiErr(400, 'bad_request', 'no valid tile ids');

  const composed =
    `Generate a ${GRID_COLS}-column-by-${GRID_ROWS}-row tile grid as a JSON array of arrays. ` +
    `Each cell is one of these tile ids OR empty string: ${ids.join(',')}. ` +
    `Theme: ${cleanPrompt}. ` +
    `Output ONLY a JSON object: {"grid":[[...]],"explanation":"..."}`;

  let raw;
  try {
    raw = await awaitClaude({ projectId, cwd: project.local_path, text: composed });
  } catch (e) {
    throw aiErr(502, 'claude_failed', String(e && e.message || e).slice(0, 200));
  }

  const parsed = extractJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.grid)) {
    throw aiErr(502, 'invalid_response', 'no grid in model output');
  }

  // Normalize dims: 15 rows x 25 cols, replace unknowns with "".
  const grid = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    const srcRow = Array.isArray(parsed.grid[y]) ? parsed.grid[y] : [];
    const row = [];
    for (let x = 0; x < GRID_COLS; x++) {
      const cell = srcRow[x];
      if (typeof cell === 'string' && idSet.has(cell)) row.push(cell);
      else row.push('');
    }
    grid.push(row);
  }

  const explanation = typeof parsed.explanation === 'string'
    ? parsed.explanation.slice(0, 1000)
    : '';

  await logGeneration(project, {
    kind: 'room-layout',
    prompt: cleanPrompt,
    model: 'claude-code'
  });

  return { grid, explanation };
}

// ---------- Sound design ----------

const VALID_WAVES = new Set(['sine', 'square', 'triangle', 'sawtooth', 'noise']);

function clampNum(v, lo, hi, fallback) {
  const n = typeof v === 'number' && isFinite(v) ? v : parseFloat(v);
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

async function generateSound({ projectId, prompt }) {
  const project = await loadProjectOrThrow(projectId);
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) throw aiErr(400, 'bad_request', 'prompt required');

  const composed =
    `Design a Playdate sound effect for: ${cleanPrompt}. ` +
    `Output JSON: {"waveform":"sine|square|triangle|sawtooth|noise",` +
    `"freq_start":Hz,"freq_end":Hz,"duration_ms":int,` +
    `"envelope":{"attack":ms,"decay":ms,"sustain":0..1,"release":ms},` +
    `"explanation":string}`;

  let raw;
  try {
    raw = await awaitClaude({ projectId, cwd: project.local_path, text: composed });
  } catch (e) {
    throw aiErr(502, 'claude_failed', String(e && e.message || e).slice(0, 200));
  }

  const parsed = extractJsonObject(raw);
  if (!parsed) throw aiErr(502, 'invalid_response', 'no JSON in model output');

  const waveform = VALID_WAVES.has(parsed.waveform) ? parsed.waveform : 'square';
  const freq_start = Math.round(clampNum(parsed.freq_start, 20, 20000, 440));
  const freq_end = Math.round(clampNum(parsed.freq_end, 20, 20000, freq_start));
  const duration_ms = Math.round(clampNum(parsed.duration_ms, 1, 10000, 250));
  const env = parsed.envelope && typeof parsed.envelope === 'object' ? parsed.envelope : {};
  const envelope = {
    attack: Math.round(clampNum(env.attack, 0, 10000, 5)),
    decay: Math.round(clampNum(env.decay, 0, 10000, 50)),
    sustain: clampNum(env.sustain, 0, 1, 0.5),
    release: Math.round(clampNum(env.release, 0, 10000, 100))
  };
  const explanation = typeof parsed.explanation === 'string'
    ? parsed.explanation.slice(0, 1000)
    : '';

  await logGeneration(project, {
    kind: 'sound',
    prompt: cleanPrompt,
    model: 'claude-code'
  });

  return {
    waveform,
    freq_start,
    freq_end,
    duration_ms,
    envelope,
    explanation
  };
}

// ---------- Log endpoint ----------

async function getLog(projectId) {
  const project = await loadProjectOrThrow(projectId);
  const entries = await readLog(project);
  return { entries };
}

module.exports = {
  generateTileArt,
  generateScript,
  generateRoomLayout,
  generateSound,
  getLog,
  aiErr,
  // exported for testing
  _internals: {
    sanitizePrompt,
    sanitizeModel,
    parseScriptResponse,
    extractJsonObject,
    placeholderTilePng,
    deterministicBitsFromPrompt
  }
};
