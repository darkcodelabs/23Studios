'use strict';

// Style preview rendering — one renderer per preview_kind.
//
// Each axis JSON declares preview_kind in:
//   text         — formatted spec for inline display (no image gen)
//   image        — calls pulp_ai.generateScene with option.preview_prompt
//   lua_snippet  — captures the Lua snippet into a markdown code fence
//   mockup       — alias for image with a different prompt prefix
//   video_loop   — pre-rendered .pdi frames + animation.txt (deferred — falls back to lua_snippet)
//
// renderPreview(option) is the entrypoint. It mutates option.preview and
// persists the option to disk under the project's asset library.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const styleAxis = require('./style_axis');
const pulpAi = require('./pulp_ai');

const { paths: SP } = styleAxis;

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) throw new Error(`project not found: ${projectId}`);
  if (!proj.local_path) throw new Error(`project ${projectId} has no local_path`);
  return proj;
}

// ----------------------------------------------------------------------------
// Renderers
// ----------------------------------------------------------------------------

function renderText(option, _axis) {
  const spec = option.spec || {};
  const lines = [];
  lines.push(`**${option.name}**`);
  lines.push('');
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'preview_prompt' || k === 'preview_lua_template' || k === 'name') continue;
    if (typeof v === 'object') lines.push(`- ${k}: ${JSON.stringify(v)}`);
    else lines.push(`- ${k}: ${v}`);
  }
  return {
    kind: 'text',
    body: lines.join('\n'),
    path: null
  };
}

function renderLuaSnippet(option, _axis) {
  const spec = option.spec || {};
  const snippet = spec.preview_lua_template || spec.lua_implementation || '-- no snippet provided';
  const text = '```lua\n' + snippet + '\n```';
  return {
    kind: 'lua_snippet',
    body: text,
    path: null
  };
}

async function renderImage(option, axis, projectLocalPath) {
  const spec = option.spec || {};
  const prompt = spec.preview_prompt;
  if (!prompt) {
    return {
      kind: 'image',
      body: '(no preview_prompt in option spec)',
      path: null
    };
  }

  // Output path mirrors option file
  const dir = path.join(SP.projectAssetLibDir(projectLocalPath), 'styles', axis.id, 'previews');
  await fsp.mkdir(dir, { recursive: true });
  const outFile = path.join(dir, `${option.id}.png`);

  try {
    // Re-use pulp_ai.generateScene since scene is 400x240 1-bit — appropriate for axis mockups.
    // For axes that should be smaller (e.g. character_style portrait), wire in different
    // generators later; for now scene-sized mockups cover all image kinds.
    const result = await pulpAi.generateScene({
      prompt,
      outPath: outFile
    });
    return {
      kind: 'image',
      body: prompt,
      path: outFile,
      gen_log: (result && result.log) || null
    };
  } catch (e) {
    // Image gen can fail (no API key, rate limit). Persist a placeholder marker
    // so the option is still usable — the picker UI shows the text fallback.
    return {
      kind: 'image',
      body: `(image generation failed: ${e.message})\n\n${prompt}`,
      path: null,
      error: e.message
    };
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Render the preview for a single option, mutate option.preview, persist.
 * Returns the persisted option.
 */
async function renderPreview({ projectId, axisId, optionId }) {
  const proj = await resolveProject(projectId);
  const axis = await styleAxis.loadAxis(axisId);
  const optFile = path.join(SP.axisOptionsDir(proj.local_path, axisId), `${optionId}.json`);
  const option = JSON.parse(await fsp.readFile(optFile, 'utf8'));

  const kind = axis.preview_kind || 'text';
  let preview;
  switch (kind) {
    case 'text':
      preview = renderText(option, axis);
      break;
    case 'lua_snippet':
      preview = renderLuaSnippet(option, axis);
      break;
    case 'image':
    case 'mockup':
      preview = await renderImage(option, axis, proj.local_path);
      break;
    case 'video_loop':
      // Deferred — fall back to lua_snippet for now
      preview = renderLuaSnippet(option, axis);
      preview.kind = 'video_loop_fallback';
      break;
    default:
      preview = renderText(option, axis);
  }

  option.preview = preview;
  await fsp.writeFile(optFile, JSON.stringify(option, null, 2));
  return option;
}

/**
 * Render previews for every option in an axis. Returns array of options.
 */
async function renderAllPreviewsForAxis({ projectId, axisId }) {
  const opts = await styleAxis.listLibrary({ axisId, scope: 'project', projectId });
  const out = [];
  for (const o of opts) {
    try {
      out.push(await renderPreview({ projectId, axisId, optionId: o.id }));
    } catch (e) {
      out.push({ id: o.id, error: e.message });
    }
  }
  return out;
}

module.exports = {
  renderPreview,
  renderAllPreviewsForAxis,
  _renderers: {
    renderText,
    renderLuaSnippet,
    renderImage
  }
};
