'use strict';

// Reference Grounding Enforcement (Phase 6 C4).
//
// Hard check at pre-send of any image-gen call: the prompt object MUST cite
// at least one anchor image path, OR explicitly carry { no_anchor: true,
// rationale: "..." } so the operator's intent is recorded.
//
// Why an object check instead of just substring-grepping the prompt body for
// a path: an anchor cite in the prompt body alone is brittle (any image
// filename mentioned anywhere counts). Forcing a structured field makes the
// scene's grounding state queryable for the B5 reference library — that's
// what surfaces the red "unanchored" badge in the gallery.
//
// Backward-compat shim: if a caller only has a flat string prompt, they can
// pass { prompt_body: "...", anchor_refs: ["..."] } and we'll validate the
// structured fields. assertGrounded NEVER inspects the body for cites; the
// fields are the contract.
//
// Schema accepted by assertGrounded:
//   {
//     prompt_body:  string,
//     anchor_refs?: string[]   // anchor image paths (project-relative or absolute)
//     no_anchor?:   boolean    // explicit "no anchor exists" tag
//     rationale?:   string     // required when no_anchor is true, >=8 chars
//     scene_id?:    string     // optional, surfaced in error for context
//     stage?:       string     // optional, surfaced in error for context
//   }
//
// Throws an Error with .code = 'ungrounded' and .status = 409 when neither
// branch is satisfied.

const path = require('path');

const MIN_RATIONALE_CHARS = 8;
const MAX_RATIONALE_CHARS = 1024;
const MAX_REFS = 32;

function ensureObject(obj) {
  if (!obj || typeof obj !== 'object') {
    const e = new Error('grounding_guard: prompt object required');
    e.code = 'bad_request'; e.status = 400;
    throw e;
  }
  return obj;
}

function validRef(r) {
  if (typeof r !== 'string') return false;
  const s = r.trim();
  if (!s) return false;
  if (s.length > 512) return false;
  // Reject obvious shell metachars; refs are paths only.
  if (/[\0\n\r]/.test(s)) return false;
  return true;
}

function normalizeRefs(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const r of input) {
    if (!validRef(r)) continue;
    const s = r.trim();
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

function describeContext(obj) {
  const bits = [];
  if (obj.stage) bits.push(`stage=${obj.stage}`);
  if (obj.scene_id) bits.push(`scene=${obj.scene_id}`);
  return bits.length > 0 ? ` (${bits.join(' ')})` : '';
}

// Throws unless the prompt object satisfies the grounding rule.
// Returns a normalized object on success: { anchor_refs, no_anchor, rationale }.
function assertGrounded(prompt_obj) {
  const obj = ensureObject(prompt_obj);

  const anchor_refs = normalizeRefs(obj.anchor_refs);
  const no_anchor = obj.no_anchor === true;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';

  if (no_anchor) {
    if (rationale.length < MIN_RATIONALE_CHARS) {
      const e = new Error(`grounding_guard: no_anchor requires rationale (>=${MIN_RATIONALE_CHARS} chars)${describeContext(obj)}`);
      e.code = 'ungrounded_no_rationale';
      e.status = 409;
      e.detail = { reason: 'no_anchor requires rationale', min_chars: MIN_RATIONALE_CHARS };
      throw e;
    }
    return {
      anchor_refs: [],
      no_anchor: true,
      rationale: rationale.slice(0, MAX_RATIONALE_CHARS)
    };
  }

  if (anchor_refs.length === 0) {
    const e = new Error(`grounding_guard: prompt must cite at least one anchor_refs path OR set no_anchor:true with rationale${describeContext(obj)}`);
    e.code = 'ungrounded';
    e.status = 409;
    e.detail = {
      reason: 'no anchor cited and no_anchor override not set',
      hint: 'pass { anchor_refs: ["assets/foo.png"] } OR { no_anchor: true, rationale: "..." }'
    };
    throw e;
  }

  return {
    anchor_refs,
    no_anchor: false,
    rationale: rationale ? rationale.slice(0, MAX_RATIONALE_CHARS) : ''
  };
}

// Convenience helper: returns { ok, error } instead of throwing. Same call
// contract as assertGrounded, but for sites that want to log + continue.
function checkGrounded(prompt_obj) {
  try {
    const norm = assertGrounded(prompt_obj);
    return { ok: true, ...norm };
  } catch (e) {
    return {
      ok: false,
      error_code: e.code || 'ungrounded',
      error: e.message,
      detail: e.detail || null
    };
  }
}

// Render the structured anchor refs into a stable text suffix that the
// downstream image-gen prompt can include verbatim. This is what makes the
// drift-detector's `require_anchor_citation` check pass naturally — once
// grounding is enforced, the body also carries the cite.
function renderAnchorPreamble(anchor_refs) {
  if (!Array.isArray(anchor_refs) || anchor_refs.length === 0) return '';
  const lines = anchor_refs.map((r) => `  - anchor: ${r}`);
  return `\n\nAnchor references (visual grounding):\n${lines.join('\n')}\n`;
}

function renderNoAnchorPreamble(rationale) {
  if (!rationale) return '';
  return `\n\nNo anchor available. Rationale: ${rationale}\n`;
}

// Compose a grounded prompt body: original prompt_body + the rendered anchor
// preamble (or the explicit no-anchor rationale). Idempotent — callers can
// pre-render manually and assertGrounded still passes if anchor_refs holds.
function composeGroundedPromptBody(prompt_obj) {
  const obj = ensureObject(prompt_obj);
  const norm = assertGrounded(obj);
  const base = typeof obj.prompt_body === 'string' ? obj.prompt_body : '';
  if (norm.no_anchor) {
    return base + renderNoAnchorPreamble(norm.rationale);
  }
  return base + renderAnchorPreamble(norm.anchor_refs);
}

// Heuristic helper used by other surfaces (B1 storyboard, B2 scene manager)
// to mark scenes as "needs anchor" without throwing. A scene is unanchored
// when its work-graph entry has neither anchor_refs nor no_anchor:true.
function isSceneUnanchored(scene_obj) {
  if (!scene_obj || typeof scene_obj !== 'object') return true;
  if (scene_obj.no_anchor === true) return false;
  const refs = scene_obj.anchor_refs;
  if (Array.isArray(refs) && refs.some(validRef)) return false;
  return true;
}

module.exports = {
  assertGrounded,
  checkGrounded,
  composeGroundedPromptBody,
  renderAnchorPreamble,
  renderNoAnchorPreamble,
  isSceneUnanchored,
  // Constants exposed for callers (UI badges, tests)
  MIN_RATIONALE_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_REFS
};
