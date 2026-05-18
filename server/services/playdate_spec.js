'use strict';

// playdate_spec.js — single source of truth for Playdate asset sizes +
// 1-bit prompt phrasing. Every prompt that goes to OpenRouter MUST flow
// through promptForAsset() so the STRICT_1BIT_PROMPT_SUFFIX is always
// appended. Anything that bypasses this risks shipping grayscale/AA art
// the validator will reject.
//
// References (verbatim Panic guidance, mirrored in
// ~/.claude/skills/playdate-dev):
//   * Screen: 400x240, 1-bit Sharp Memory LCD
//   * Tiles: 16x16 minimum, 32x32 recommended (new projects)
//   * Sprites: 32x32 minimum interactive; hero hardware 80x40
//   * Boss: 64x64
//   * Portrait: 64x64
//   * Launcher card: 350x155 (name baked in)

const CANONICAL_SIZES = Object.freeze({
  scene_background: Object.freeze({ w: 400, h: 240 }),
  tile:             Object.freeze({ w: 32,  h: 32  }),  // NEW pulp projects
  tile_legacy:      Object.freeze({ w: 16,  h: 16  }),  // pulp tile_dim=16
  tile_min:         Object.freeze({ w: 8,   h: 8   }),  // pulp tile_dim=8 floor
  portrait:         Object.freeze({ w: 64,  h: 64  }),
  sprite_small:     Object.freeze({ w: 16,  h: 16  }),
  sprite_npc:       Object.freeze({ w: 32,  h: 32  }),
  sprite_hero:      Object.freeze({ w: 80,  h: 40  }),
  boss:             Object.freeze({ w: 64,  h: 64  }),
  launcher_card:    Object.freeze({ w: 350, h: 155 })
});

// Appended verbatim to EVERY image prompt. Do not soften this. The validator
// will reject any pixel that isn't pure 0,0,0 or 255,255,255 so the model
// has to be told in plain language not to produce intermediates.
const STRICT_1BIT_PROMPT_SUFFIX = [
  '',
  'STRICT 1-BIT RULES (non-negotiable):',
  '- ONLY pure black (#000000) and pure white (#FFFFFF) pixels.',
  '- NO grayscale. NO color. NO anti-aliasing. NO soft edges.',
  '- Use Atkinson dither for any shading; never solid gray fills.',
  '- Thick 2-pixel black outlines on every shape.',
  '- Subject fills the frame, reads clearly at thumbnail size.',
  '- Mars After Midnight / Whitewater Wipeout / Lucas Pope Playdate aesthetic.',
  '- Native target: Playdate Sharp Memory LCD (400x240, 1-bit).',
  '- Render at 1024x1024 for crisp downsampling; subject silhouette readable at 32x32.'
].join('\n');

// Sterner retry suffix used when first attempt failed 1-bit validation.
const RETRY_1BIT_SUFFIX = [
  '',
  'YOU FAILED THE 1-BIT CHECK ON THE PREVIOUS ATTEMPT.',
  'Only pure black 0,0,0 and pure white 255,255,255 are allowed.',
  'NO INTERMEDIATE VALUES. NO GRAY. NO ANTI-ALIASING.',
  'Replace any soft edges or gradients with Atkinson dither dots.',
  'If you cannot render hard-edge 1-bit, stop and return high-contrast B/W only.'
].join('\n');

/**
 * sizeFor(kind) -> { w, h }
 * Throws on unknown kind so callers can never silently ship a wrong size.
 */
function sizeFor(kind) {
  const s = CANONICAL_SIZES[kind];
  if (!s) {
    const e = new Error('unknown_playdate_size_kind');
    e.code = 'unknown_playdate_size_kind';
    e.detail = { kind, known: Object.keys(CANONICAL_SIZES) };
    throw e;
  }
  return { w: s.w, h: s.h };
}

// ----- Per-kind prompt prefixes -----
//
// Kept tight + specific so the model knows what kind of asset it's making
// before we tack on STRICT_1BIT_PROMPT_SUFFIX.

function scenePrefix(name, type, ctx) {
  const room = name || 'scene';
  const themeBits = [];
  if (ctx && ctx.project_name) themeBits.push(`Game: ${ctx.project_name}.`);
  if (ctx && ctx.theme) themeBits.push(`Theme: ${ctx.theme}.`);
  const theme = themeBits.join(' ');
  return [
    '1-bit black-and-white pixel-art scene background for a Playdate game.',
    'Isometric or 3/4 perspective, ~30 degree dimetric projection where applicable.',
    'Full 400x240 landscape composition. Background uses light dot-pattern dither',
    '(~25% black) for surface texture; foreground silhouettes are crisp.',
    theme,
    `Scene: ${room}.`,
    ctx && ctx.description ? `Description: ${ctx.description}` : ''
  ].filter(Boolean).join(' ');
}

function tilePrefix(name, type, ctx) {
  const dim = (ctx && ctx.tile_dim) || 16;
  // Mirror the tile-type heuristic from /tmp/hakcd2_regen_tiles.js.
  const lower = String(name || '').toLowerCase();
  const id = String((ctx && ctx.id) || '').toLowerCase();
  let context;
  if (id.startsWith('coin_') || lower.includes('coin')) {
    // CRITICAL: previous prompts produced dense-black silhouette discs that
    // collapse to all-black at 16x16. Demand WHITE background + thin black
    // outline of a small simple icon, subject covering AT MOST 60% of frame.
    context = 'tile is a single SMALL ICON on a pure WHITE background. ' +
              'Subject occupies AT MOST 60% of the frame, centered. ' +
              'Style: thin 1-2 pixel black outline of a coin/token/badge shape with ' +
              'a tiny symbol or word inside. NOT a solid black disc. NOT engraved metal. ' +
              'Think arcade token outline drawing on a white field';
  } else if (id.startsWith('nfo_') || lower.includes('nfo')) {
    context = 'tile is a single SMALL ICON of a text file / document / floppy disk / scroll, ' +
              'drawn as a thin black OUTLINE on a pure WHITE background. ' +
              'Subject occupies AT MOST 60% of the frame, centered. ' +
              'NOT solid black. NOT a screenshot of dense text. Simple line-art icon only';
  } else if (id.startsWith('tool_') || lower.includes('tool')) {
    context = 'tile is a single SMALL ICON of a hacker tool (key, wrench, USB stick, ' +
              'phreak box, glove) drawn as a thin black outline on a pure WHITE background. ' +
              'Subject occupies AT MOST 60% of the frame. Detailed silhouette OK but not solid black';
  } else if (type === 'sprite') {
    context = 'tile is a portrait icon, head-and-shoulders silhouette';
  } else if (type === 'item') {
    context = 'tile is a discrete object icon, clear silhouette';
  } else if (type === 'exit') {
    context = 'tile is a doorway / exit icon';
  } else if (type === 'player') {
    context = 'tile is a player avatar, hooded hacker figure';
  } else {
    context = 'tile is a world / floor / wall tile';
  }
  return [
    `1-bit pixel-art Playdate tile, ${dim}x${dim} native (render at 1024x1024 for downsample).`,
    `${context}. Subject: ${name || 'tile'}.`,
    ctx && ctx.description ? `Description: ${ctx.description}.` : ''
  ].filter(Boolean).join(' ');
}

function portraitPrefix(name, type, ctx) {
  return [
    '1-bit pixel-art character portrait for a Playdate game.',
    'Head-and-shoulders bust composition, 64x64 native (render at 1024x1024).',
    'Bayer 4x4 ordered dither for face shading (faces need crisp legibility).',
    `Character: ${name || 'unknown'}.`,
    ctx && ctx.role ? `Role: ${ctx.role}.` : '',
    ctx && ctx.bio ? `Bio: ${ctx.bio}.` : ''
  ].filter(Boolean).join(' ');
}

function spritePrefix(name, type, ctx) {
  const w = (ctx && ctx.w) || 32;
  const h = (ctx && ctx.h) || 32;
  return [
    `1-bit pixel-art Playdate sprite, ${w}x${h} native.`,
    `Subject: ${name || 'sprite'}.`,
    ctx && ctx.action ? `Action: ${ctx.action}.` : ''
  ].filter(Boolean).join(' ');
}

function launcherPrefix(name, type, ctx) {
  return [
    '1-bit pixel-art Playdate launcher card, 350x155 landscape.',
    `The game name "${(ctx && ctx.project_name) || name}" MUST be baked into the art.`,
    'Bold, readable at thumbnail; reserve right third for title plate.'
  ].filter(Boolean).join(' ');
}

const PREFIX_FNS = Object.freeze({
  scene:    scenePrefix,
  tile:     tilePrefix,
  portrait: portraitPrefix,
  sprite:   spritePrefix,
  launcher: launcherPrefix
});

/**
 * promptForAsset({ kind, name, type, projectContext })
 *   kind: 'scene' | 'tile' | 'portrait' | 'sprite' | 'launcher'
 *   name: human asset name (room name, tile name, character name)
 *   type: optional asset sub-type (tile type, character role, sprite action)
 *   projectContext: optional bag — { project_name, theme, description,
 *                                    tile_dim, id, role, bio, w, h }
 *
 * Returns the full prompt string with STRICT_1BIT_PROMPT_SUFFIX appended.
 */
function promptForAsset({ kind, name, type, projectContext, retry } = {}) {
  const fn = PREFIX_FNS[kind];
  if (!fn) {
    const e = new Error('unknown_prompt_kind');
    e.code = 'unknown_prompt_kind';
    e.detail = { kind, known: Object.keys(PREFIX_FNS) };
    throw e;
  }
  const prefix = fn(name || '', type || '', projectContext || {});
  const suffix = retry ? STRICT_1BIT_PROMPT_SUFFIX + '\n' + RETRY_1BIT_SUFFIX
                       : STRICT_1BIT_PROMPT_SUFFIX;
  return `${prefix}\n${suffix}`;
}

module.exports = {
  CANONICAL_SIZES,
  STRICT_1BIT_PROMPT_SUFFIX,
  RETRY_1BIT_SUFFIX,
  sizeFor,
  promptForAsset,
  // for testing
  _internals: {
    scenePrefix,
    tilePrefix,
    portraitPrefix,
    spritePrefix,
    launcherPrefix
  }
};
