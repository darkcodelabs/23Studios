'use strict';

// intake_form.js — section 1 + 2 of the master intake prompt.
//
// inferMissingFields  -> single Claude call that fills BLANK intake fields
// renderStoryBible    -> section-2 markdown template substitution
// writeIntake         -> hand-serialized yaml to <local_path>/sdk_data/intake.yaml
// writeStoryBible     -> markdown to <local_path>/sdk_data/story_bible.md

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const claude = require('./claude');

const SDK_DATA_REL = 'sdk_data';

const GENRES = ['adventure', 'puzzle', 'action', 'narrative', 'sim', 'sports', 'life-sim', 'rhythm', 'toy', 'horror', 'other'];
const FORMATS = ['scene_based', 'hub_world', 'linear', 'roguelike', 'endless'];
const ARCHETYPES = ['drifter', 'fixer', 'kid', 'exile', 'agent', 'courier', 'archivist', 'ghost', 'other'];
const CRANK = ['central', 'secondary', 'decorative', 'none'];
const AUDIO = ['synth', 'tracker_chiptune', 'ambient_drone', 'jazz', 'textural', 'found_sound'];
const SAVE_STATE = ['none', 'light', 'full'];

const DEFAULTS = Object.freeze({
  genre: 'adventure',
  format: 'scene_based',
  setting_era: '',
  setting_location: '',
  setting_vibe: '',
  protagonist_name: '',
  protagonist_archetype: '',
  antagonist_or_obstacle: '',
  mentor_or_ally: '',
  visual_refs: [],
  visual_keywords: [],
  tone_refs: [],
  tone_keywords: [],
  gameplay_refs: [],
  crank_usage: 'central',
  accelerometer: false,
  audio_direction: 'synth',
  scene_count: 8,
  minigame_count: 2,
  playtime_target_min: 30,
  save_state: 'light',
  localization: ['en']
});

const FIELD_GUIDANCE = {
  setting_era: 'short phrase, e.g. "near-future 2049" or "1980s small town"',
  setting_location: 'short phrase, e.g. "abandoned subway station" or "coastal Maine"',
  setting_vibe: '3-6 words capturing the mood of the place',
  protagonist_name: 'first name only, fits setting',
  protagonist_archetype: 'pick ONE of: ' + ARCHETYPES.join(', '),
  antagonist_or_obstacle: 'one sentence, force or person',
  mentor_or_ally: 'one sentence or empty string',
  visual_refs: '2-3 game/film references with strong 1-bit pixel art appeal',
  visual_keywords: '5-10 short keywords for vibe',
  tone_refs: '1-2 film/game references for tone',
  tone_keywords: '3-5 mood adjectives',
  gameplay_refs: '1-2 game references for mechanics inspiration'
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Returns intake object with all DEFAULTS applied and any missing keys filled
// with the default value. Leaves user-provided non-empty values alone, but
// substitutes the default for empty enum strings + zero numbers so the
// pipeline never sees an invalid value.
function normalizeIntake(input) {
  const out = clone(DEFAULTS);
  if (!input || typeof input !== 'object') return out;
  const enumKeys = new Set(['genre', 'format', 'crank_usage', 'audio_direction', 'save_state']);
  const numberKeys = new Set(['scene_count', 'minigame_count', 'playtime_target_min']);
  for (const k of Object.keys(DEFAULTS)) {
    if (input[k] === undefined || input[k] === null) continue;
    if (enumKeys.has(k) && (typeof input[k] !== 'string' || input[k].trim() === '')) continue;
    if (numberKeys.has(k)) {
      const n = Number(input[k]);
      if (!Number.isFinite(n) || n <= 0) continue;
      out[k] = n;
      continue;
    }
    out[k] = input[k];
  }
  // pitch is required; carry through verbatim.
  out.pitch = typeof input.pitch === 'string' ? input.pitch : '';
  return out;
}

function isBlankString(v) { return typeof v !== 'string' || v.trim() === ''; }
function isBlankArray(v) { return !Array.isArray(v) || v.length === 0 || v.every((x) => isBlankString(x)); }

// Identify which fields the LLM should fill. Enums + numbers are NOT inferred:
// they always have a sensible default.
function listBlankFields(intake) {
  const blanks = [];
  const stringFields = ['setting_era', 'setting_location', 'setting_vibe',
    'protagonist_name', 'protagonist_archetype', 'antagonist_or_obstacle', 'mentor_or_ally'];
  for (const k of stringFields) {
    if (isBlankString(intake[k])) blanks.push(k);
  }
  const listFields = ['visual_refs', 'visual_keywords', 'tone_refs', 'tone_keywords', 'gameplay_refs'];
  for (const k of listFields) {
    if (isBlankArray(intake[k])) blanks.push(k);
  }
  return blanks;
}

function safeParseJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = m ? m[1] : text;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++;
    else if (candidate[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(candidate.slice(start, i + 1)); } catch (_e) { return null; }
      }
    }
  }
  return null;
}

function askClaude({ projectId, cwd }, prompt, system = '') {
  return new Promise((resolve, reject) => {
    let acc = '';
    const text = (system ? system + '\n\n' : '') + prompt;
    claude.sendMessage({
      projectId, cwd, text,
      onChunk: (c) => { acc += c; },
      onDone: () => resolve(acc),
      onError: reject
    });
  });
}

// Patches the intake in-place with LLM inferences for blank fields.
//
// Supports two calling conventions:
//   inferMissingFields(intake, { claudeFn, claudeCtx, returnSummary })
//   inferMissingFields({ intake, claudeFn, claudeCtx })
//
// claudeFn(prompt, opts) -> string is the preferred injection point for tests.
// claudeCtx is the production path (spawns claude.sendMessage subprocess).
//
// Returns the filled intake object by default. If `returnSummary` is true (or
// the kwarg form is used), returns { intake, fields_inferred, fields_provided }.
async function inferMissingFields(arg1, arg2) {
  let intake; let claudeFn = null; let claudeCtx = null; let returnSummary = false;
  if (arg1 && typeof arg1 === 'object' && ('intake' in arg1)) {
    intake = arg1.intake;
    claudeFn = arg1.claudeFn || null;
    claudeCtx = arg1.claudeCtx || null;
    returnSummary = true;
  } else {
    intake = arg1;
    const opts = arg2 || {};
    claudeFn = opts.claudeFn || null;
    claudeCtx = opts.claudeCtx || null;
    returnSummary = !!opts.returnSummary;
  }

  const normalized = normalizeIntake(intake);
  const blanks = listBlankFields(normalized);
  const totalUserFields = Object.keys(DEFAULTS).length + 1; // +pitch
  // "provided" = anything not blank AND not equal to its default for that field.
  let providedCount = 1; // pitch is required
  for (const k of Object.keys(DEFAULTS)) {
    if (isBlankString(normalized[k]) || isBlankArray(normalized[k])) continue;
    if (JSON.stringify(normalized[k]) === JSON.stringify(DEFAULTS[k])) continue;
    providedCount += 1;
  }

  if (blanks.length === 0) {
    return returnSummary
      ? { intake: normalized, fields_inferred: 0, fields_provided: providedCount, totalUserFields }
      : normalized;
  }

  const fieldDocs = blanks.map((k) => `  - ${k}: ${FIELD_GUIDANCE[k] || ''}`).join('\n');
  const provided = {};
  for (const k of Object.keys(normalized)) {
    if (k === 'generated') continue;
    if (!isBlankString(normalized[k]) && !isBlankArray(normalized[k])) {
      provided[k] = normalized[k];
    }
  }

  const sys = [
    'You are filling in blank fields of a Playdate game intake form.',
    'Return STRICT JSON only, no markdown fences, no prose.',
    'Use only the constraints supplied. Stay tightly in-world with the pitch.',
    'Do NOT invent fields. Do NOT echo provided fields.',
    'NO em dashes, NO en dashes, NO emoji.'
  ].join('\n');

  const prompt = [
    'Pitch:',
    normalized.pitch,
    '',
    'Provided fields (do not change these):',
    JSON.stringify(provided, null, 2),
    '',
    'Fill THESE blank fields. Each value must follow its constraint:',
    fieldDocs,
    '',
    'Output JSON of exactly this shape (only the keys listed above):',
    '{ ' + blanks.map((k) => `"${k}": <value>`).join(', ') + ' }',
    '',
    'Array-valued fields (visual_refs, visual_keywords, tone_refs, tone_keywords, gameplay_refs) MUST be arrays of strings.'
  ].join('\n');

  let inferred = null;
  try {
    let raw;
    if (typeof claudeFn === 'function') {
      raw = await claudeFn(prompt, { system: sys });
    } else if (claudeCtx) {
      raw = await askClaude(claudeCtx, prompt, sys);
    } else {
      raw = null;
    }
    inferred = raw ? safeParseJson(raw) : null;
  } catch (e) {
    // Inference failure is non-fatal: defaults already in place.
    inferred = null;
  }

  let inferredCount = 0;
  if (inferred && typeof inferred === 'object') {
    for (const k of blanks) {
      if (!(k in inferred)) continue;
      const v = inferred[k];
      if (k === 'protagonist_archetype' && !ARCHETYPES.includes(v)) continue;
      const isList = ['visual_refs', 'visual_keywords', 'tone_refs', 'tone_keywords', 'gameplay_refs'].includes(k);
      if (isList) {
        if (!Array.isArray(v)) continue;
        const cleaned = v.map((x) => String(x).trim()).filter(Boolean);
        if (cleaned.length === 0) continue;
        normalized[k] = cleaned;
      } else {
        if (typeof v !== 'string' || v.trim() === '') continue;
        normalized[k] = v.trim();
      }
      inferredCount += 1;
    }
  }

  return returnSummary
    ? { intake: normalized, fields_inferred: inferredCount, fields_provided: providedCount, totalUserFields }
    : normalized;
}

// --- YAML serialization (hand-rolled, scoped to this schema) --------------

function yamlScalar(v) {
  if (v === null || v === undefined) return '""';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return '""';
  // Multi-line strings use block scalar.
  if (s.includes('\n')) {
    const indented = s.split('\n').map((ln) => '  ' + ln).join('\n');
    return '|\n' + indented;
  }
  // Always quote to avoid YAML's type inference (yes/no, numbers in strings, etc).
  return JSON.stringify(s);
}

function yamlList(arr, indent) {
  if (!arr || arr.length === 0) return ' []';
  const pad = ' '.repeat(indent);
  return '\n' + arr.map((v) => `${pad}- ${yamlScalar(v)}`).join('\n');
}

function renderIntakeYaml(intake) {
  const i = intake;
  const lines = [];
  lines.push('# 23 Studios intake — generated by /api/projects/intake');
  lines.push('# Section 1 of docs/23studios_intake_prompt.md');
  lines.push('');
  lines.push('pitch: ' + yamlScalar(i.pitch || ''));
  lines.push('');
  lines.push('genre: ' + yamlScalar(i.genre));
  lines.push('format: ' + yamlScalar(i.format));
  lines.push('');
  lines.push('setting_era: ' + yamlScalar(i.setting_era));
  lines.push('setting_location: ' + yamlScalar(i.setting_location));
  lines.push('setting_vibe: ' + yamlScalar(i.setting_vibe));
  lines.push('');
  lines.push('protagonist_name: ' + yamlScalar(i.protagonist_name));
  lines.push('protagonist_archetype: ' + yamlScalar(i.protagonist_archetype));
  lines.push('antagonist_or_obstacle: ' + yamlScalar(i.antagonist_or_obstacle));
  lines.push('mentor_or_ally: ' + yamlScalar(i.mentor_or_ally));
  lines.push('');
  lines.push('visual_refs:' + yamlList(i.visual_refs, 2));
  lines.push('visual_keywords: ' + (i.visual_keywords && i.visual_keywords.length
    ? '[' + i.visual_keywords.map(yamlScalar).join(', ') + ']'
    : '[]'));
  lines.push('');
  lines.push('tone_refs:' + yamlList(i.tone_refs, 2));
  lines.push('tone_keywords: ' + (i.tone_keywords && i.tone_keywords.length
    ? '[' + i.tone_keywords.map(yamlScalar).join(', ') + ']'
    : '[]'));
  lines.push('');
  lines.push('gameplay_refs:' + yamlList(i.gameplay_refs, 2));
  lines.push('');
  lines.push('crank_usage: ' + yamlScalar(i.crank_usage));
  lines.push('accelerometer: ' + yamlScalar(!!i.accelerometer));
  lines.push('audio_direction: ' + yamlScalar(i.audio_direction));
  lines.push('');
  lines.push('scene_count: ' + yamlScalar(i.scene_count));
  lines.push('minigame_count: ' + yamlScalar(i.minigame_count));
  lines.push('playtime_target_min: ' + yamlScalar(i.playtime_target_min));
  lines.push('save_state: ' + yamlScalar(i.save_state));
  lines.push('localization: ' + (i.localization && i.localization.length
    ? '[' + i.localization.map(yamlScalar).join(', ') + ']'
    : '["en"]'));
  lines.push('');
  lines.push('generated:');
  lines.push('  scene_types: []');
  lines.push('  mechanic_assignments: {}');
  lines.push('  feature_inventory: []');
  return lines.join('\n') + '\n';
}

// --- Story bible template ------------------------------------------------

function commaJoin(arr, fallback = '') {
  if (!Array.isArray(arr) || arr.length === 0) return fallback;
  return arr.filter(Boolean).join(', ');
}

function refsBlock(arr, fallback = 'to be discovered') {
  if (!Array.isArray(arr) || arr.length === 0) return fallback;
  return arr.filter(Boolean).join('; ');
}

function renderStoryBible(intake, projectNameOrOpts) {
  const projectName = (projectNameOrOpts && typeof projectNameOrOpts === 'object')
    ? (projectNameOrOpts.projectName || '')
    : (projectNameOrOpts || '');
  const i = intake;
  const visualAnchor = [
    i.protagonist_archetype || 'unnamed archetype',
    'in',
    i.setting_location || 'an unspecified location'
  ].join(' ');

  return [
    `# ${projectName || 'Untitled'}`,
    '',
    '## Pitch',
    i.pitch || '',
    '',
    '## Setting',
    `- Era: ${i.setting_era || 'unspecified'}`,
    `- Location: ${i.setting_location || 'unspecified'}`,
    `- Vibe: ${i.setting_vibe || 'unspecified'}`,
    `- Keywords: ${commaJoin(i.visual_keywords, 'none')}`,
    '',
    '## Cast',
    '### Protagonist',
    `- Name: ${i.protagonist_name || 'unnamed'}`,
    `- Archetype: ${i.protagonist_archetype || 'other'}`,
    `- Visual anchor: ${visualAnchor}`,
    '',
    '### Antagonist / Core obstacle',
    i.antagonist_or_obstacle || 'to be defined in the story stage',
    '',
    '### Mentor / Ally',
    i.mentor_or_ally || 'optional',
    '',
    '## Three-act outline',
    'Act 1: to be filled by the brainstorm stage',
    'Act 2: to be filled by the brainstorm stage',
    'Act 3: to be filled by the brainstorm stage',
    '',
    '## Tone',
    `- References: ${refsBlock(i.tone_refs)}`,
    `- Keywords: ${commaJoin(i.tone_keywords, 'none')}`,
    '',
    '## Visual style lock',
    '- Aesthetic: 1-bit (pure black, pure white, dither only)',
    '- Primary dither: Atkinson (for portraits and detailed scenes)',
    '- Secondary dither: Bayer 8x8 (for skies, fog, large flat regions)',
    '- Tertiary: Floyd-Steinberg (only for high-detail textures)',
    `- References: ${refsBlock(i.visual_refs)}`,
    '- Things to avoid: realistic photography, grayscale gradients, anti-aliased curves, any color, anything that reads as a real-world technical diagram',
    '',
    '## Gameplay',
    `- Crank: ${i.crank_usage || 'central'}`,
    `- Accelerometer: ${i.accelerometer ? 'true' : 'false'}`,
    `- Save state: ${i.save_state || 'light'}`,
    `- Scene budget: ${i.scene_count}`,
    `- Minigames: ${i.minigame_count}`,
    `- Gameplay references: ${refsBlock(i.gameplay_refs)}`,
    '',
    '## Audio direction',
    `${i.audio_direction || 'synth'}, with per-scene moods to be assigned at the scene_lua stage.`,
    ''
  ].join('\n');
}

async function writeIntake(localPath, intake) {
  const root = path.join(localPath, SDK_DATA_REL);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const fp = path.join(root, 'intake.yaml');
  await fsp.writeFile(fp, renderIntakeYaml(intake), { mode: 0o600 });
  return fp;
}

async function writeStoryBible(localPath, md) {
  const root = path.join(localPath, SDK_DATA_REL);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const fp = path.join(root, 'story_bible.md');
  await fsp.writeFile(fp, md, { mode: 0o600 });
  return fp;
}

// ----------------------------------------------------------------------------
// Phase 3: map intake fields → seed defaults for the 14 style axes
// ----------------------------------------------------------------------------
//
// IntakeForm.jsx stays as the front door. Composer v2 walks the 14 axes for
// refinement *after* intake completes. mapIntakeToAxisDefaults seeds the
// per-axis defaults so users who only fill the intake form get sane picks
// without ever opening the picker. Plays nice with the preset pack
// importer — these defaults override pack defaults when both are present.
//
// Mapping (per CLAUDE.md):
//   intake.genre      → gameplay_style, pacing_style, audio_style defaults
//   intake.format     → gameplay_style.camera + scale
//   intake.protagonist_archetype → character_style
//   intake.crank_usage → crank_required flag on relevant axes
//   intake.audio_direction → audio_style.music_palette
//   intake.save_state → save_style.trigger

function mapGenreToAudio(genre) {
  switch (genre) {
    case 'rhythm': return 'tracker';
    case 'horror': return 'ambient_drone';
    case 'narrative': return 'jazz';
    case 'sim':
    case 'life-sim': return 'textural';
    case 'sports':
    case 'action': return 'chiptune';
    case 'puzzle':
    case 'adventure':
    case 'toy':
    case 'other':
    default: return 'chiptune';
  }
}

function mapGenreToTensionCurve(genre) {
  switch (genre) {
    case 'horror':
    case 'action': return 'rising';
    case 'rhythm': return 'episodic_waves';
    case 'narrative':
    case 'adventure': return 'episodic_waves';
    case 'sim':
    case 'life-sim':
    case 'toy': return 'flat';
    default: return 'episodic_waves';
  }
}

function mapFormatToCamera(format) {
  switch (format) {
    case 'scene_based': return 'top_down';
    case 'hub_world': return 'top_down';
    case 'linear': return 'side_scroll';
    case 'roguelike': return 'top_down';
    case 'endless': return 'fixed_screen';
    default: return 'top_down';
  }
}

function mapFormatToScale(format) {
  switch (format) {
    case 'scene_based': return 'room';
    case 'hub_world': return 'world_map';
    case 'linear': return 'single_screen';
    case 'roguelike': return 'world_map';
    case 'endless': return 'single_screen';
    default: return 'single_screen';
  }
}

function mapArchetypeToSilhouette(archetype) {
  switch (archetype) {
    case 'drifter':
    case 'agent': return 'slim';
    case 'kid':
    case 'courier': return 'chunky';
    case 'exile':
    case 'ghost': return 'organic';
    case 'fixer':
    case 'archivist': return 'slim';
    default: return 'slim';
  }
}

function mapSaveStateToTrigger(saveState) {
  switch (saveState) {
    case 'none': return 'gameWillTerminate_only';
    case 'light': return 'every_scene_change';
    case 'full': return 'hybrid';
    case 'slots': return 'manual_save_points';
    default: return 'every_scene_change';
  }
}

function mapAudioDirectionToPalette(audioDirection) {
  switch (audioDirection) {
    case 'synth': return 'chiptune';
    case 'tracker': return 'tracker';
    case 'samples': return 'sample_only';
    case 'ambient': return 'ambient_drone';
    case 'silent': return 'silence_with_sfx_only';
    default: return 'chiptune';
  }
}

/**
 * Convert a normalized intake form into seed Option specs for each axis.
 * Returns { axisId: { name, spec } } — callers can hand this to
 * asset_library.importPresetPackAndPick-like flow or write directly via
 * style_axis.pickOption after persisting.
 *
 * Note: this only seeds axes where intake provides clear signal. Axes not
 * present must be picked through the normal generate/pick flow.
 */
function mapIntakeToAxisDefaults(intake) {
  const i = normalizeIntake(intake || {});
  const out = {};

  out.pacing_style = {
    name: `${i.playtime_target_min}min ${i.format}`,
    spec: {
      name: `${i.playtime_target_min}min ${i.format}`,
      session_target_min: i.playtime_target_min,
      scene_density: i.scene_count >= 8 ? 'balanced' : 'sparse_exploration',
      tension_curve: mapGenreToTensionCurve(i.genre),
      time_pressure: i.genre === 'horror' || i.genre === 'rhythm' ? 'contextual' : 'never',
      recommended_minigame_count: i.minigame_count,
      recommended_dialog_scene_count: Math.max(2, Math.floor(i.scene_count / 2)),
      preview_prompt: `${i.playtime_target_min}-minute ${i.genre} session in ${i.format} format`
    }
  };

  out.gameplay_style = {
    name: `${i.format} ${mapFormatToCamera(i.format)}`,
    spec: {
      name: `${i.format} ${mapFormatToCamera(i.format)}`,
      camera: mapFormatToCamera(i.format),
      movement: i.format === 'roguelike' ? 'grid' : 'free_2d',
      scale: mapFormatToScale(i.format),
      rationale: `Seeded from intake: ${i.genre} / ${i.format}`,
      references: i.gameplay_refs || [],
      sprite_size_recommendation: { w: 16, h: 24 },
      tile_size_recommendation: { w: 16, h: 16 },
      preview_prompt: `1-bit Playdate ${mapFormatToCamera(i.format)} ${i.format} scene, ${i.setting_vibe || i.genre}`
    }
  };

  if (i.protagonist_archetype) {
    out.character_style = {
      name: `${i.protagonist_archetype} hero`,
      spec: {
        name: i.protagonist_name ? `${i.protagonist_name} (${i.protagonist_archetype})` : `${i.protagonist_archetype} hero`,
        silhouette: mapArchetypeToSilhouette(i.protagonist_archetype),
        portrait_treatment: 'half_body',
        walk_cycle_frames: 4,
        detail_level: 'moderate',
        face_dither: 'atkinson',
        sprite_dimensions: { w: 16, h: 24 },
        portrait_dimensions: { w: 64, h: 64 },
        preview_prompt: `1-bit ${mapArchetypeToSilhouette(i.protagonist_archetype)} ${i.protagonist_archetype} sprite, ${i.setting_vibe || ''}`
      }
    };
  }

  out.audio_style = {
    name: `${mapAudioDirectionToPalette(i.audio_direction)}`,
    spec: {
      name: `${mapAudioDirectionToPalette(i.audio_direction)}`,
      music_palette: mapAudioDirectionToPalette(i.audio_direction),
      sfx_palette: i.audio_direction === 'samples' ? 'sample_only' : (i.audio_direction === 'silent' ? 'synth_only' : 'mixed'),
      mix_philosophy: i.genre === 'horror' ? 'atmospheric' : 'music_driven',
      reactive_intensity: 'moderate',
      effects_chain: i.genre === 'horror' ? 'heavy_processing' : 'light_reverb',
      default_synth_shapes: ['kWaveSquare', 'kWaveTriangle'],
      preview_prompt: `${mapAudioDirectionToPalette(i.audio_direction)} palette for ${i.genre}`
    }
  };

  out.save_style = {
    name: `${i.save_state} save`,
    spec: {
      name: `${i.save_state} save`,
      trigger: mapSaveStateToTrigger(i.save_state),
      slot_count: i.save_state === 'slots' ? 3 : 1,
      saves_screenshot: i.save_state === 'slots' || i.save_state === 'full',
      indicator: i.save_state === 'none' ? 'none' : 'brief_text',
      scenes_with_save_points: [],
      lua_implementation: i.save_state === 'slots'
        ? "playdate.datastore.write(state, 'slot_'..slot)"
        : "playdate.datastore.write(state, 'save')"
    }
  };

  return out;
}

module.exports = {
  DEFAULTS,
  GENRES,
  FORMATS,
  ARCHETYPES,
  CRANK,
  AUDIO,
  SAVE_STATE,
  normalizeIntake,
  listBlankFields,
  inferMissingFields,
  renderIntakeYaml,
  renderStoryBible,
  writeIntake,
  writeStoryBible,
  mapIntakeToAxisDefaults
};
