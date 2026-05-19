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
const playdateSpec = require('./playdate_spec');
const playdateValidator = require('./playdate_validator');
const groundingGuard = require('./grounding_guard');

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const API_KEY = process.env.OPENROUTER_API_KEY || '';

// Image generation goes through OpenRouter's chat-completions surface with
// multimodal output (modalities: ['image','text']). OpenRouter's /images
// proxy doesn't reliably pass DALL-E 3 through; the chat-completions path
// returns images in message.images[0].image_url.url as base64 data URLs.
// The right OpenAI model on OpenRouter for this is `openai/gpt-image-1`.
async function generateImageViaOpenRouter({ prompt, model, sizeHint, grounding }) {
  if (!API_KEY) {
    const e = new Error('openrouter_unavailable');
    e.code = 'openrouter_unavailable';
    throw e;
  }

  // Phase 6 C4: reference grounding. If the caller passes a grounding object,
  // it must either cite anchor_refs OR set { no_anchor:true, rationale }.
  // assertGrounded throws (code='ungrounded' or 'ungrounded_no_rationale',
  // status=409) when neither is satisfied. The composed preamble is appended
  // to the prompt body so the model also sees the anchor cite verbatim.
  // Enforcement is opt-in per call site via the grounding arg; missing means
  // "legacy caller, don't enforce". Set STUDIO_GROUNDING=required to force
  // every image-gen call to provide grounding.
  let groundedPrompt = prompt;
  if (grounding != null) {
    const norm = groundingGuard.assertGrounded(grounding);
    if (norm.no_anchor) {
      groundedPrompt = prompt + groundingGuard.renderNoAnchorPreamble(norm.rationale);
    } else {
      groundedPrompt = prompt + groundingGuard.renderAnchorPreamble(norm.anchor_refs);
    }
  } else if (String(process.env.STUDIO_GROUNDING || '').toLowerCase() === 'required') {
    const e = new Error('grounding_guard: STUDIO_GROUNDING=required — caller must pass { grounding: { anchor_refs:[...] } } or { grounding: { no_anchor:true, rationale } }');
    e.code = 'ungrounded';
    e.status = 409;
    throw e;
  }

  const sizeLine = sizeHint ? `\n\nRender at ${sizeHint}.` : '';
  const payload = {
    model,
    messages: [{ role: 'user', content: groundedPrompt + sizeLine }],
    modalities: ['image', 'text']
  };
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://127.0.0.1',
      'X-Title': '23 Studios'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const e = new Error(`openrouter_${res.status}: ${txt.slice(0, 200)}`);
    e.code = `openrouter_${res.status}`;
    throw e;
  }
  const body = await res.json();
  const msg = body && body.choices && body.choices[0] && body.choices[0].message;
  if (!msg) throw new Error('no_choices');
  const imgs = Array.isArray(msg.images) ? msg.images : [];
  for (const item of imgs) {
    const url = (item && item.image_url && item.image_url.url) || (typeof item === 'string' ? item : null);
    if (typeof url === 'string' && url.startsWith('data:')) {
      const comma = url.indexOf(',');
      if (comma > 0) return Buffer.from(url.slice(comma + 1), 'base64');
    }
    if (typeof url === 'string' && /^https?:/.test(url)) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`image fetch ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }
  }
  if (typeof msg.content === 'string') {
    const m = msg.content.match(/data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/);
    if (m) return Buffer.from(m[1], 'base64');
  }
  throw new Error('no_image_in_response');
}

const DATA_DIR = process.env.PROJECTS_DATA_DIR
  ? path.resolve(process.env.PROJECTS_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const DOCS_PATH = path.join(__dirname, '..', 'data', 'pulpscript_docs.md');

// Verified against `GET /api/v1/models` on 2026-05-17. Image-output capable
// models exposed on OpenRouter: openai/gpt-5-image, openai/gpt-5-image-mini,
// openai/gpt-5.4-image-2, google/gemini-2.5-flash-image,
// google/gemini-3.1-flash-image-preview, google/gemini-3-pro-image-preview.
// Default to the cheapest reliable OpenAI image model; callers can override.
const DEFAULT_IMAGE_MODEL = 'openai/gpt-5-image-mini';

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
  // Pipeline: normalize histogram (stretch contrast to full 0..255) → linear
  // brighten (push mid-tones up so dark subjects don't collapse to black) →
  // lanczos3 downscale (area-averaging) → greyscale raw → Bayer-4 dither.
  // Why each step:
  //  - normalize: AI outputs often have crushed blacks; stretching restores
  //    detail before the 64×→tile downsample washes it out.
  //  - linear(1.0, 25): adds +25 luma so a coin silhouette that's 80% black
  //    becomes ~60% black → Bayer-4 produces a recognizable icon instead of
  //    saturating to all-black after threshold.
  //  - lanczos3 cover: nearest picks one source pixel, lanczos averages a
  //    receptive field → preserves silhouette legibility at tiny sizes.
  //  - bayer4: ordered dither retains mid-tones at 16x16 where threshold(128)
  //    would saturate to all-black on dense subjects.
  const ditherMod = require('./dither');
  const greyRaw = await sharp(buf)
    .normalize()
    .linear(1.0, 25)
    .resize(d, d, { kernel: 'lanczos3', fit: 'cover', position: 'centre' })
    .greyscale()
    .raw()
    .toBuffer();
  const out = ditherMod.bayer4(greyRaw, d, d, 128);
  return await sharp(Buffer.from(out), { raw: { width: d, height: d, channels: 1 } })
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
  // Pulp tiles are canonically 8x8 (spec Section 3.1). SDK callers can pass
  // tileDim:16. Anything else falls back to 8.
  const dim = (tileDim === 16) ? 16 : 8;

  if (!API_KEY) {
    throw aiErr(503, 'openrouter_unavailable',
      'OPENROUTER_API_KEY missing — refusing to ship procedural placeholder art');
  }

  // Always funnel through playdate_spec so STRICT_1BIT_PROMPT_SUFFIX is
  // appended. Callers can still pass raw subject text via `prompt`; we wrap
  // it as a single-name asset.
  const buildPrompt = (retry) => playdateSpec.promptForAsset({
    kind: 'tile',
    name: cleanPrompt,
    type: '',
    projectContext: { tile_dim: dim, description: sanitizePrompt(style) },
    retry
  });

  const expected = { w: dim, h: dim };
  let lastErr = null;
  let imgBuf = null;
  let usedModel = requestedModel;
  let finalPng = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const augmented = buildPrompt(attempt > 0);
    try {
      imgBuf = await generateImageViaOpenRouter({
        prompt: augmented,
        model: requestedModel,
        sizeHint: 'square 1024x1024, sharp 1-bit pixel art'
      });
      usedModel = `openrouter:${requestedModel}`;
      finalPng = await to1bitTilePng(imgBuf, dim);
      const v = await playdateValidator.validate1bitPng(finalPng, expected);
      if (v.ok) { lastErr = null; break; }
      lastErr = aiErr(502, 'validation_failed_1bit', v.reason);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    // eslint-disable-next-line no-console
    console.error('[pulp_ai] tile art failed validation after retry:',
      lastErr && (lastErr.code || lastErr.message));
    throw lastErr;
  }

  const b64 = finalPng.toString('base64');

  await logGeneration(project, {
    kind: 'tile-art',
    prompt: cleanPrompt,
    model: usedModel,
    fallback: false
  });

  return {
    image_base64: b64,
    model: usedModel,
    prompt: cleanPrompt,
    fallback: false
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

  if (!API_KEY) {
    throw aiErr(503, 'openrouter_unavailable',
      'OPENROUTER_API_KEY missing — refusing to ship procedural placeholder art');
  }

  // If the caller already passed a spec-built prompt (it'll contain the
  // STRICT_1BIT_PROMPT_SUFFIX marker), use it as-is. Otherwise wrap it
  // through promptForAsset so the suffix is guaranteed.
  const looksFullyBuilt = cleanPrompt.includes('STRICT 1-BIT RULES');
  const buildPrompt = (retry) => looksFullyBuilt
    ? (retry ? cleanPrompt + '\n' + playdateSpec.RETRY_1BIT_SUFFIX : cleanPrompt)
    : playdateSpec.promptForAsset({
        kind: 'scene',
        name: cleanPrompt,
        type: 'background',
        retry
      });

  let imgBuf = null;
  let usedModel = requestedModel;
  let pngBuffer = null;
  let lastErr = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const augmented = buildPrompt(attempt > 0);
    try {
      imgBuf = await generateImageViaOpenRouter({
        prompt: augmented,
        model: requestedModel,
        sizeHint: 'landscape 1792x1024 (5:3 aspect), Playdate 400x240 native target'
      });
      usedModel = `openrouter:${requestedModel}`;
      pngBuffer = await toScenePng(imgBuf, dw, dh);
      const v = await playdateValidator.validate1bitPng(pngBuffer, { w: dw, h: dh });
      if (v.ok) { lastErr = null; break; }
      lastErr = aiErr(502, 'validation_failed_1bit', v.reason);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    // eslint-disable-next-line no-console
    console.error('[pulp_ai] scene failed validation after retry:',
      lastErr && (lastErr.code || lastErr.message));
    throw lastErr;
  }

  return {
    pngBuffer,
    model: usedModel,
    prompt: cleanPrompt,
    fallback: false,
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

  if (!API_KEY) {
    throw aiErr(503, 'openrouter_unavailable',
      'OPENROUTER_API_KEY missing — refusing to ship procedural placeholder art');
  }

  const looksFullyBuilt = cleanPrompt.includes('STRICT 1-BIT RULES');
  const buildPrompt = (retry) => looksFullyBuilt
    ? (retry ? cleanPrompt + '\n' + playdateSpec.RETRY_1BIT_SUFFIX : cleanPrompt)
    : playdateSpec.promptForAsset({
        kind: 'portrait',
        name: cleanPrompt,
        type: '',
        retry
      });

  let imgBuf = null;
  let usedModel = requestedModel;
  let pngBuffer = null;
  let lastErr = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const augmented = buildPrompt(attempt > 0);
    try {
      imgBuf = await generateImageViaOpenRouter({
        prompt: augmented,
        model: requestedModel,
        sizeHint: 'square 1024x1024, head-and-shoulders portrait, 1-bit dithered'
      });
      usedModel = `openrouter:${requestedModel}`;
      pngBuffer = await toPortraitPng(imgBuf, dw, dh);
      const v = await playdateValidator.validate1bitPng(pngBuffer, { w: dw, h: dh });
      if (v.ok) { lastErr = null; break; }
      lastErr = aiErr(502, 'validation_failed_1bit', v.reason);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    // eslint-disable-next-line no-console
    console.error('[pulp_ai] portrait failed validation after retry:',
      lastErr && (lastErr.code || lastErr.message));
    throw lastErr;
  }

  return {
    pngBuffer,
    model: usedModel,
    prompt: cleanPrompt,
    fallback: false,
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
