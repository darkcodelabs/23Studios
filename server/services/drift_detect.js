'use strict';

// Drift Detector (Phase 6 C3).
//
// Two checks:
//
//   PRE-SEND  — checkPromptDrift({ projectId, prompt_body, canon_path? })
//     Compare a prompt about to leave the server (typically an image-gen
//     prompt assembled in pulp_ai / sdk_autopilot) against canon §3 preamble
//     + canon-derived required vocabulary + a hardcoded forbidden-token list.
//
//     Returns { passes, required_missing, forbidden_present, drift_score, canon_path_used }
//     Never throws on a missing canon — the canon may not exist yet for a
//     fresh project; we degrade to required_missing = [] and drift_score = 0.
//     The hardcoded forbidden list ALWAYS runs (those phrases should never
//     leak regardless of canon presence — they're the corporate-safety reflex
//     contamination from the C3 origin story).
//
//   POST-GENERATE — recordPostGenDrift({ projectId, anchor_path, generated_path, ... })
//     Compare a generated image against its anchor via 8x8 average perceptual
//     hash. Hamming distance > threshold flags for B3 approver review by
//     appending to <project>/sdk_data/drift_flags.jsonl.
//
// Storage:
//   <project>/sdk_data/drift_flags.jsonl  (append-only, mode 0600)
//
// Forbidden tokens are the literal phrases that triggered the canon-
// contamination incident referenced in spec §C3. Plus a few near-variants.
// Project-specific filter-trip-words can be supplied via the optional
// `filter_trip_words` param so a project can extend the list without us
// shipping a config file.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

let sharp;
try { sharp = require('sharp'); }
catch (_e) { sharp = null; }

// --------------------------------------------------------------------------
// Forbidden tokens — corporate-safety reflex contamination, project-extended
// --------------------------------------------------------------------------
//
// These are the phrases we've seen leak into image-gen prompts unprompted.
// Match is case-insensitive substring. Phrasing variants kept verbose on
// purpose — substring matching means "any harmful content" catches its own
// near-variants, but the long forms below also catch the assembled sentences.
const FORBIDDEN_TOKENS = Object.freeze([
  'do not include: any imagery that could be interpreted as instructional',
  'could be interpreted as instructional',
  'any harmful content',
  'no harmful content',
  'avoid any content that could be',
  'must not depict any',
  'absolutely no depictions of',
  'safe-for-work',
  'sfw only',
  'family-friendly',
  'avoid sensitive subject matter',
  'no real-world weapons',
  'no instructions for',
  'avoid any imagery that resembles instructions',
  // Common AI-assistant reflex disclaimers
  "i can't help with",
  'as an ai',
  'as a language model'
]);

// --------------------------------------------------------------------------
// Required tokens, canon-derived
// --------------------------------------------------------------------------
//
// Per spec: canon §3 preamble + required canon vocabulary. We parse §3 out
// of the canon markdown (`# Canon`, `## §3 ...` style or `## 3. ...`) and
// fall back to a hardcoded Playdate-style baseline if §3 doesn't surface.
//
// Required vocabulary is whatever §3 marks as MUST appear in image-gen
// prompts. Heuristics:
//   - Lines starting with `- MUST:` or `- REQUIRED:` (case-insensitive)
//   - Lines under a `### required tokens` heading inside §3
//   - Backtick-wrapped tokens inside §3 (treated as required vocab)
// If none of those parse, we fall back to the Playdate baseline:
//   ['1-bit', '400×240', '400x240', 'dither']
//
// At least one anchor-citation token (matches "anchor", "ref:" or "ref ",
// or a known image-extension path) is checked separately as an OR clause —
// satisfying any one of them is enough.

const PLAYDATE_BASELINE_REQUIRED = Object.freeze(['1-bit', 'dither']);
const PLAYDATE_BASELINE_REQUIRED_ANY = Object.freeze(['400×240', '400x240']);

const ANCHOR_OR_TOKENS = Object.freeze([
  'anchor:', 'anchor ',
  'ref:', 'ref ',
  '.png', '.jpg', '.jpeg', '.webp', '.gif'
]);

// --------------------------------------------------------------------------
// Path helpers
// --------------------------------------------------------------------------

function driftFlagsPath(localPath) {
  return path.join(localPath, 'sdk_data', 'drift_flags.jsonl');
}

function defaultCanonPath(localPath) {
  return path.join(localPath, 'sdk_data', 'source', 'canon.md');
}

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) {
    const e = new Error(`project not found: ${projectId}`);
    e.status = 404; e.code = 'not_found';
    throw e;
  }
  if (!proj.local_path) {
    const e = new Error(`project ${projectId} has no local_path`);
    e.status = 400; e.code = 'no_local_path';
    throw e;
  }
  return proj;
}

// --------------------------------------------------------------------------
// Canon parsing
// --------------------------------------------------------------------------

function extractSection3(canonText) {
  if (!canonText || typeof canonText !== 'string') return '';
  // Match a markdown heading that names §3 or section 3.
  // Accepts variants like:
  //   ## §3 Preamble
  //   ## 3. Preamble
  //   ### Section 3 — Preamble
  //   ## §3. Image-gen preamble
  const lines = canonText.split('\n');
  let start = -1;
  let endHeadingLevel = -1;
  const headingRe = /^(#+)\s*(?:Section\s+)?(?:§\s*)?3(?:[.\s)]|$)/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) { start = i; endHeadingLevel = m[1].length; break; }
  }
  if (start === -1) return '';
  // Stop at next heading of same or higher level (fewer or equal #'s).
  const stopRe = new RegExp(`^#{1,${endHeadingLevel}}\\s`);
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (stopRe.test(lines[j])) { end = j; break; }
  }
  return lines.slice(start, end).join('\n');
}

function parseRequiredFromSection3(section3) {
  if (!section3) return [];
  const out = new Set();

  // `- MUST: foo` / `- REQUIRED: foo`
  const mustRe = /^\s*[-*]\s*(?:MUST|REQUIRED)\s*:\s*(.+?)\s*$/gim;
  let m;
  while ((m = mustRe.exec(section3))) {
    const phrase = m[1].replace(/[`*_]/g, '').trim();
    if (phrase) out.add(phrase);
  }

  // Section-scoped `### required tokens` block
  const reqBlockRe = /^#+\s*required(?:\s+tokens)?\b[^\n]*\n([\s\S]*?)(?=^#+\s|\Z)/gim;
  while ((m = reqBlockRe.exec(section3))) {
    const block = m[1];
    const itemRe = /^\s*[-*]\s*(.+?)\s*$/gm;
    let it;
    while ((it = itemRe.exec(block))) {
      const phrase = it[1].replace(/[`*_]/g, '').trim();
      if (phrase) out.add(phrase);
    }
  }

  // Backticked tokens anywhere inside §3
  const tickRe = /`([^`\n]{1,80})`/g;
  while ((m = tickRe.exec(section3))) {
    const phrase = m[1].trim();
    if (phrase) out.add(phrase);
  }

  // Cap to a sane size so a runaway canon doesn't make every prompt fail.
  return Array.from(out).slice(0, 64);
}

async function loadCanonRequired(canonPath) {
  if (!canonPath) return { required: [], required_any: [], section3: '' };
  let raw;
  try { raw = await fsp.readFile(canonPath, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { required: [], required_any: [], section3: '' };
    throw e;
  }
  const section3 = extractSection3(raw);
  const parsed = parseRequiredFromSection3(section3);
  if (parsed.length === 0) {
    // Fall back to Playdate baseline if §3 didn't yield anything actionable.
    return {
      required: Array.from(PLAYDATE_BASELINE_REQUIRED),
      required_any: Array.from(PLAYDATE_BASELINE_REQUIRED_ANY),
      section3
    };
  }
  return { required: parsed, required_any: [], section3 };
}

// --------------------------------------------------------------------------
// Pre-send check
// --------------------------------------------------------------------------

function containsCI(haystack, needle) {
  if (!needle) return false;
  return haystack.indexOf(needle.toLowerCase()) !== -1;
}

function checkAnchorCitation(promptLower) {
  for (const tok of ANCHOR_OR_TOKENS) {
    if (containsCI(promptLower, tok)) return true;
  }
  return false;
}

async function checkPromptDrift({
  projectId,
  prompt_body,
  canon_path,
  filter_trip_words = [],
  require_anchor_citation = false
}) {
  const body = String(prompt_body == null ? '' : prompt_body);
  const lower = body.toLowerCase();

  let canonPathUsed = canon_path || null;
  if (!canonPathUsed && projectId) {
    try {
      const proj = await resolveProject(projectId);
      canonPathUsed = defaultCanonPath(proj.local_path);
    } catch (_e) {
      canonPathUsed = null;
    }
  }

  const { required, required_any } = await loadCanonRequired(canonPathUsed);

  const required_missing = [];
  for (const r of required) {
    if (!containsCI(lower, r)) required_missing.push(r);
  }
  if (required_any.length > 0) {
    const anyHit = required_any.some((r) => containsCI(lower, r));
    if (!anyHit) {
      // Flag the whole alternation as a single missing entry to keep the
      // surface small.
      required_missing.push(required_any.join(' | '));
    }
  }

  const forbidden_present = [];
  for (const f of FORBIDDEN_TOKENS) {
    if (containsCI(lower, f)) forbidden_present.push(f);
  }
  const extraTrip = Array.isArray(filter_trip_words) ? filter_trip_words : [];
  for (const w of extraTrip) {
    if (typeof w !== 'string' || !w) continue;
    if (containsCI(lower, w.toLowerCase())) forbidden_present.push(w);
  }

  let anchor_missing = false;
  if (require_anchor_citation && !checkAnchorCitation(lower)) {
    anchor_missing = true;
  }

  // Drift score: 1 per missing required + 2 per forbidden present + 1 for
  // missing anchor. Bigger is worse. Useful for a yellow-halo threshold in B6.
  const drift_score =
    required_missing.length +
    forbidden_present.length * 2 +
    (anchor_missing ? 1 : 0);

  const passes = required_missing.length === 0
    && forbidden_present.length === 0
    && !anchor_missing;

  return {
    passes,
    required_missing,
    forbidden_present,
    anchor_missing,
    drift_score,
    canon_path_used: canonPathUsed
  };
}

// --------------------------------------------------------------------------
// Drift flags storage (post-generate + optional pre-send blocks)
// --------------------------------------------------------------------------

const _flagChains = new Map();
function withProjectLock(projectId, fn) {
  const prev = _flagChains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  _flagChains.set(projectId, next.catch(() => {}));
  return next;
}

const MAX_FLAG_LINE = 32 * 1024;

async function appendDriftFlag(projectId, flag) {
  const proj = await resolveProject(projectId);
  const entry = { ts: new Date().toISOString(), ...flag };
  const line = JSON.stringify(entry) + '\n';
  if (Buffer.byteLength(line, 'utf8') > MAX_FLAG_LINE) {
    const e = new Error(`drift flag exceeds ${MAX_FLAG_LINE} bytes`);
    e.status = 413; e.code = 'flag_too_large';
    throw e;
  }
  return withProjectLock(projectId, async () => {
    const file = driftFlagsPath(proj.local_path);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, line, { mode: 0o600 });
    return entry;
  });
}

async function readDriftFlags(projectId, filters = {}) {
  const proj = await resolveProject(projectId);
  const file = driftFlagsPath(proj.local_path);
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { items: [], count: 0 };
    throw e;
  }
  const stage = filters.stage ? String(filters.stage) : '';
  const kind = filters.kind ? String(filters.kind) : '';
  const items = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); }
    catch (_e) { continue; }
    if (stage && obj.stage !== stage) continue;
    if (kind && obj.kind !== kind) continue;
    items.push(obj);
  }
  return { items, count: items.length };
}

// --------------------------------------------------------------------------
// Perceptual-hash post-generate compare
// --------------------------------------------------------------------------

async function computePHash(absPath) {
  if (!sharp) return null;
  try {
    const buf = await sharp(absPath)
      .resize(8, 8, { fit: 'fill', kernel: 'cubic' })
      .grayscale()
      .raw()
      .toBuffer();
    if (buf.length !== 64) return null;
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += buf[i];
    const avg = sum / 64;
    const bits = new Uint8Array(8);
    for (let byteI = 0; byteI < 8; byteI++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (buf[byteI * 8 + bit] >= avg) b |= (1 << (7 - bit));
      }
      bits[byteI] = b;
    }
    return bits;
  } catch (_e) { return null; }
}

function hammingHashes(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) { d++; x &= x - 1; }
  }
  return d;
}

// Default threshold: 64-bit hash, Hamming distance > 22 (≈34% of bits) flags.
// Caller can override per-call.
const DEFAULT_HAMMING_THRESHOLD = 22;

async function comparePerceptual({ anchor_path, generated_path, threshold = DEFAULT_HAMMING_THRESHOLD }) {
  const [a, g] = await Promise.all([computePHash(anchor_path), computePHash(generated_path)]);
  if (!a || !g) return { available: false, distance: null, threshold, flagged: false };
  const distance = hammingHashes(a, g);
  return {
    available: true,
    distance,
    threshold,
    flagged: distance != null && distance > threshold
  };
}

async function recordPostGenDrift({
  projectId,
  stage,
  scene_id,
  anchor_path,
  generated_path,
  threshold,
  agent
}) {
  const cmp = await comparePerceptual({ anchor_path, generated_path, threshold });
  if (!cmp.flagged) return { ...cmp, recorded: false };
  const flag = await appendDriftFlag(projectId, {
    kind: 'post_generate',
    stage: stage || null,
    scene_id: scene_id || null,
    anchor_path: anchor_path || null,
    generated_path: generated_path || null,
    perceptual_distance: cmp.distance,
    threshold: cmp.threshold,
    agent: agent || null
  });
  return { ...cmp, recorded: true, entry: flag };
}

module.exports = {
  checkPromptDrift,
  readDriftFlags,
  appendDriftFlag,
  recordPostGenDrift,
  comparePerceptual,
  FORBIDDEN_TOKENS,
  _internals: { extractSection3, parseRequiredFromSection3, computePHash, hammingHashes }
};
