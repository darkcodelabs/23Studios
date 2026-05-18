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

// Image generation: prefer a direct OpenAI API key (OPENAI_API_KEY) because
// OpenRouter's /images proxy is unreliable for DALL-E 3. Fall back to the
// OpenRouter client (chat works fine there); fall back to placeholder last.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

let _imageClient = null;
function imageClient() {
  if (_imageClient) return _imageClient;
  if (OPENAI_API_KEY) {
    _imageClient = { kind: 'openai', oai: new OpenAI({ baseURL: OPENAI_BASE_URL, apiKey: OPENAI_API_KEY }) };
  } else if (API_KEY) {
    _imageClient = { kind: 'openrouter', oai: client() };
  } else {
    const e = new Error('no_image_provider');
    e.code = 'no_image_provider';
    throw e;
  }
  return _imageClient;
}

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

async function to1bitTilePng(buf, dim) {
  const d = (dim === 8 || dim === 16) ? dim : 8;
  // Pre-blur slightly before downscale so the threshold isn't dominated by
  // a single source pixel — that's the Bayer-style intent for small tiles.
  return await sharp(buf)
    .resize(d, d, { kernel: 'nearest' })
    .threshold(128)
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

// Legacy alias retained in case external callers/tests still want a fixed
// 16x16 output. Not currently used internally.
async function to1bit16x16Png(buf) {
  return to1bitTilePng(buf, 16);
}

async function generateTileArt({ projectId, prompt, model, style, tileDim }) {
  const project = await loadProjectOrThrow(projectId);
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) throw aiErr(400, 'bad_request', 'prompt required');
  const requestedModel = sanitizeModel(model) || DEFAULT_IMAGE_MODEL;
  const cleanStyle = sanitizePrompt(style);
  // Pulp tiles are canonically 8x8 (spec Section 3.1). SDK callers can pass
  // tileDim:16. Anything else falls back to 8.
  const dim = (tileDim === 16) ? 16 : 8;

  const augmented = `1-bit pixel art, ${dim}x${dim} pixels, pure black on pure white background, `
    + 'thick black outlines, suitable for a Playdate game tile. '
    + 'Use Bayer 4x4 ordered dithering for any shading (NO Floyd-Steinberg, NO grayscale, NO color). '
    + (cleanStyle ? `Style: ${cleanStyle}. ` : '')
    + `Subject: ${cleanPrompt}`;

  let fallback = false;
  let imgBuf = null;
  let usedModel = requestedModel;

  if (!OPENAI_API_KEY && !API_KEY) {
    fallback = true;
  } else {
    try {
      const ic = imageClient();
      // When using OpenAI directly, swap the OpenRouter-prefixed model id
      // ("openai/dall-e-3" -> "dall-e-3"). OpenAI rejects the prefix.
      const sendModel = ic.kind === 'openai' && requestedModel.startsWith('openai/')
        ? requestedModel.slice('openai/'.length)
        : requestedModel;
      const result = await ic.oai.images.generate({
        model: sendModel,
        prompt: augmented,
        size: '1024x1024',
        n: 1,
        response_format: 'b64_json'
      });
      const item = result && result.data && result.data[0];
      if (!item) throw new Error('empty image gen response');
      imgBuf = await decodeImageFromGenResult(item);
      usedModel = `${ic.kind}:${sendModel}`;
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

  const finalPng = await to1bitTilePng(imgBuf, dim);
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

// ---------- Scene art (full-room background) ----------

const SCENE_DIM_DEFAULT = [400, 240];

// Deterministic 1-bit dithered placeholder. Mirrors the spirit of
// placeholderTilePng but for landscape scenes. Renders a soft ~25% black dot
// pattern over a white field, with a 30-char prompt label burned in via simple
// pixel font when present. Pure sharp + raw buffer — no font deps.
async function placeholderScenePng(prompt, width = 400, height = 240) {
  const w = Math.max(8, Math.min(2048, width | 0));
  const h = Math.max(8, Math.min(2048, height | 0));
  const hash = crypto.createHash('sha256').update(prompt || '').digest();
  const raw = Buffer.alloc(w * h, 255);
  // ~25% black dot dither using hashed offsets per row.
  for (let y = 0; y < h; y++) {
    const rowSeed = hash[y % hash.length];
    for (let x = 0; x < w; x++) {
      // Bayer-ish 4x4 threshold mask + hash perturbation.
      const bx = x & 3;
      const by = y & 3;
      const bayer = [
        0, 8, 2, 10,
        12, 4, 14, 6,
        3, 11, 1, 9,
        15, 7, 13, 5
      ][by * 4 + bx];
      // Aim for ~25% black -> threshold near 4/16.
      const perturb = ((rowSeed + x * 31) & 0xf);
      if (((bayer ^ perturb) & 0xf) < 4) {
        raw[y * w + x] = 0;
      }
    }
  }
  // 2px black border for "frame".
  for (let x = 0; x < w; x++) {
    raw[x] = 0;
    raw[w + x] = 0;
    raw[(h - 1) * w + x] = 0;
    raw[(h - 2) * w + x] = 0;
  }
  for (let y = 0; y < h; y++) {
    raw[y * w] = 0;
    raw[y * w + 1] = 0;
    raw[y * w + w - 1] = 0;
    raw[y * w + w - 2] = 0;
  }
  // Render a tiny "prompt[:30]" caption as a hash-derived 3x5 pseudo-font
  // bar pattern across the top so the placeholder is content-bearing without
  // shipping a real font. We avoid burning unsafe text in.
  const label = String(prompt || '').slice(0, 30);
  if (label.length > 0) {
    const labelHash = crypto.createHash('sha256').update(label).digest();
    const stripeH = 5;
    const stripeY = 4;
    for (let i = 0; i < Math.min(label.length, 30); i++) {
      const byte = labelHash[i % labelHash.length];
      for (let dy = 0; dy < stripeH; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const xx = 4 + i * 4 + dx;
          const yy = stripeY + dy;
          if (xx >= 2 && xx < w - 2 && yy < h) {
            const bit = (byte >> ((dy * 3 + dx) % 8)) & 1;
            raw[yy * w + xx] = bit ? 0 : 255;
          }
        }
      }
    }
  }
  return await sharp(raw, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

async function toScenePng(buf, width, height) {
  const w = Math.max(8, Math.min(2048, (width || SCENE_DIM_DEFAULT[0]) | 0));
  const h = Math.max(8, Math.min(2048, (height || SCENE_DIM_DEFAULT[1]) | 0));
  return await sharp(buf)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .greyscale()
    .threshold(128)
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

const SCENE_STYLE_LOCK =
  '1-bit black-and-white isometric pixel art, Atkinson or Bayer dithering ' +
  'for shading, NO grayscale gradients, NO color, classic dimetric ' +
  'projection at 30 degrees, thick 2-px black outlines, Mars After Midnight ' +
  '/ Whitewater Wipeout / International Synapse aesthetic, 5:3 horizontal ' +
  'aspect ratio for a Playdate (400x240 native, render at higher detail), ' +
  'background uses light dot-pattern dither (~25% black) for surface ' +
  'texture. Scene: ';

/**
 * generateScene({prompt, model, dim})
 * Returns { pngBuffer, model, prompt, fallback?, dim }
 * - pngBuffer is a 1-bit (b-w colourspace) PNG already sized to dim.
 * - Mirrors generateTileArt shape but for landscape scenes.
 * - Falls back to a deterministic dithered placeholder if OPENROUTER_API_KEY
 *   is unset or the image call fails.
 */
async function generateScene({ prompt, model, dim }) {
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) throw aiErr(400, 'bad_request', 'prompt required');
  const requestedModel = sanitizeModel(model) || DEFAULT_IMAGE_MODEL;
  const [dw, dh] = Array.isArray(dim) && dim.length === 2
    ? [parseInt(dim[0], 10) || SCENE_DIM_DEFAULT[0],
       parseInt(dim[1], 10) || SCENE_DIM_DEFAULT[1]]
    : SCENE_DIM_DEFAULT;

  const augmented = SCENE_STYLE_LOCK + cleanPrompt;

  let fallback = false;
  let imgBuf = null;
  let usedModel = requestedModel;

  if (!OPENAI_API_KEY && !API_KEY) {
    fallback = true;
  } else {
    try {
      const ic = imageClient();
      const sendModel = ic.kind === 'openai' && requestedModel.startsWith('openai/')
        ? requestedModel.slice('openai/'.length)
        : requestedModel;
      let size = '1792x1024';
      try {
        const result = await ic.oai.images.generate({
          model: sendModel, prompt: augmented, size, n: 1, response_format: 'b64_json'
        });
        const item = result && result.data && result.data[0];
        if (!item) throw new Error('empty image gen response');
        imgBuf = await decodeImageFromGenResult(item);
      } catch (_e1) {
        size = '1024x1024';
        const result = await ic.oai.images.generate({
          model: sendModel, prompt: augmented, size, n: 1, response_format: 'b64_json'
        });
        const item = result && result.data && result.data[0];
        if (!item) throw new Error('empty image gen response');
        imgBuf = await decodeImageFromGenResult(item);
      }
      usedModel = `${ic.kind}:${sendModel}`;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[pulp_ai] scene gen failed, falling back:', e && (e.code || e.message));
      fallback = true;
    }
  }

  if (fallback) {
    imgBuf = await placeholderScenePng(augmented, dw, dh);
    usedModel = 'local-placeholder';
  }

  const pngBuffer = await toScenePng(imgBuf, dw, dh);

  return {
    pngBuffer,
    model: usedModel,
    prompt: augmented,
    fallback,
    dim: [dw, dh]
  };
}

// ---------- Portrait art (character bust, default 64x64) ----------

const PORTRAIT_DIM_DEFAULT = [64, 64];
const PORTRAIT_DIM_MIN = 32;
// Bumped from 128 to 256 to accommodate the body-sprite preset (64x96) and
// other multi-frame character sheets; kept in sync with pulp_portraits.
const PORTRAIT_DIM_MAX = 256;

const PORTRAIT_STYLE_LOCK =
  '1-bit pure black-and-white pixel art portrait, head-and-shoulders or bust ' +
  'composition, Bayer 4x4 ordered dither shading only (NO Floyd-Steinberg, ' +
  'NO Atkinson — faces need crisp legibility at 64x64). NO grayscale, NO ' +
  'color, NO anti-aliasing. Thick 2-px black outlines. Mars After Midnight ' +
  '/ Whitewater Wipeout aesthetic. Square aspect, fills the frame. Subject ' +
  'reads at small resolution. Subject: ';

function clampPortraitDim(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(PORTRAIT_DIM_MIN, Math.min(PORTRAIT_DIM_MAX, n));
}

async function toPortraitPng(buf, width, height) {
  const w = clampPortraitDim(width, PORTRAIT_DIM_DEFAULT[0]);
  const h = clampPortraitDim(height, PORTRAIT_DIM_DEFAULT[1]);
  // Square-ish bust: use cover-fit so the AI's full image is cropped to the
  // tight character canvas without letterboxing.
  return await sharp(buf)
    .resize(w, h, { fit: 'cover', position: 'centre', kernel: 'nearest' })
    .greyscale()
    .threshold(128)
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

/**
 * generatePortrait({prompt, model, dim, dither, threshold, contrast, brightness})
 * Returns { pngBuffer, model, prompt, fallback?, dim }
 * - pngBuffer is a 1-bit (b-w) PNG sized to dim (default 64x64).
 * - Mirrors generateScene's shape; downstream re-dither happens in
 *   pulp_portraits.runDitherPipeline so the dither/threshold/contrast/
 *   brightness knobs actually apply with our local algorithms.
 * - Falls back to a deterministic placeholder if no image provider is
 *   configured or the upstream call fails.
 *
 * Note: dither/threshold/contrast/brightness are accepted for parity with
 * generateScene's call-site, but are NOT applied here — the caller passes
 * them through runDitherPipeline on the returned pngBuffer. They're part of
 * the signature so the service surface stays uniform.
 */
// eslint-disable-next-line no-unused-vars
async function generatePortrait({ prompt, model, dim, dither, threshold, contrast, brightness }) {
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) throw aiErr(400, 'bad_request', 'prompt required');
  const requestedModel = sanitizeModel(model) || DEFAULT_IMAGE_MODEL;
  const [dw, dh] = Array.isArray(dim) && dim.length === 2
    ? [clampPortraitDim(dim[0], PORTRAIT_DIM_DEFAULT[0]),
       clampPortraitDim(dim[1], PORTRAIT_DIM_DEFAULT[1])]
    : PORTRAIT_DIM_DEFAULT;

  const augmented = PORTRAIT_STYLE_LOCK + cleanPrompt;

  let fallback = false;
  let imgBuf = null;
  let usedModel = requestedModel;

  if (!OPENAI_API_KEY && !API_KEY) {
    fallback = true;
  } else {
    try {
      const ic = imageClient();
      const sendModel = ic.kind === 'openai' && requestedModel.startsWith('openai/')
        ? requestedModel.slice('openai/'.length)
        : requestedModel;
      // DALL-E 3 only supports a fixed set of sizes; portraits are square so
      // 1024x1024 fits cleanly and downsamples well to our 64x64 target.
      const result = await ic.oai.images.generate({
        model: sendModel,
        prompt: augmented,
        size: '1024x1024',
        n: 1,
        response_format: 'b64_json'
      });
      const item = result && result.data && result.data[0];
      if (!item) throw new Error('empty image gen response');
      imgBuf = await decodeImageFromGenResult(item);
      usedModel = `${ic.kind}:${sendModel}`;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[pulp_ai] portrait gen failed, falling back:', e && (e.code || e.message));
      fallback = true;
    }
  }

  if (fallback) {
    // Re-use the scene placeholder; it produces a deterministic 1-bit
    // dithered field that the downstream pipeline will re-dither to spec.
    imgBuf = await placeholderScenePng(augmented, Math.max(64, dw), Math.max(64, dh));
    usedModel = 'local-placeholder';
  }

  const pngBuffer = await toPortraitPng(imgBuf, dw, dh);

  return {
    pngBuffer,
    model: usedModel,
    prompt: augmented,
    fallback,
    dim: [dw, dh]
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
  generateScene,
  generatePortrait,
  generateScript,
  generateRoomLayout,
  generateSound,
  getLog,
  aiErr,
  PORTRAIT_DIM_DEFAULT,
  PORTRAIT_DIM_MIN,
  PORTRAIT_DIM_MAX,
  PORTRAIT_STYLE_LOCK,
  // exported for testing
  _internals: {
    sanitizePrompt,
    sanitizeModel,
    parseScriptResponse,
    extractJsonObject,
    placeholderTilePng,
    placeholderScenePng,
    toScenePng,
    toPortraitPng,
    to1bitTilePng,
    to1bit16x16Png,
    deterministicBitsFromPrompt,
    SCENE_STYLE_LOCK,
    PORTRAIT_STYLE_LOCK
  }
};
