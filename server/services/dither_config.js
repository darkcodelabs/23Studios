'use strict';

// Phase 4.8 Patch D — global dither config defaults.
//
// Per-asset-class defaults for the line-art pivot. These are the FALLBACK
// values used when the per-project <local_path>/sdk_data/dither_config.json
// has no override for the asset class and no env override is set.
//
// Resolution order (highest priority first):
//   1. Env var (e.g. PULP_AI_SCENE_DITHER) — emergency override, no restart
//   2. Per-project picks in <local_path>/sdk_data/dither_config.json
//   3. The defaults in this file (global, version-controlled)
//   4. Hardcoded 'atkinson' fallback (legacy behaviour)
//
// Shape per asset class:
//   width      — target output width in px (null = caller-provided)
//   height     — target output height in px (null = caller-provided)
//   algo       — dither algorithm name (matches dither.js + dither_variants.js)
//   contrast   — pre-dither contrast multiplier (1.0 = no change)
//   brightness — pre-dither brightness multiplier (1.0 = no change)
//
// Line-art pivot rationale: scenes + portraits use 'threshold' (hard cutoff)
// so dither doesn't fight the line work. Cards + launch_image use 'atkinson'
// because they cover larger framed areas where containment of dither inside
// shape boundaries reads well. Sprite frames + UI chrome inherit caller dims
// since those are produced by the gen pipeline at the right size already.

module.exports = {
  scene_bg:     { width: 400,  height: 240,  algo: 'threshold', contrast: 1.0,  brightness: 1.0  },
  portrait:     { width: 64,   height: 64,   algo: 'threshold', contrast: 1.0,  brightness: 1.05 },
  sprite_frame: { width: null, height: null, algo: 'bayer4x4',  contrast: 1.0,  brightness: 1.0  },
  ui_chrome:    { width: null, height: null, algo: 'threshold', contrast: 1.0,  brightness: 1.0  },
  card:         { width: 350,  height: 155,  algo: 'atkinson',  contrast: 1.10, brightness: 1.05 },
  launch_image: { width: 400,  height: 240,  algo: 'atkinson',  contrast: 1.10, brightness: 1.0  },
  icon:         { width: 32,   height: 32,   algo: 'threshold', contrast: 1.30, brightness: 1.0  }
};

// Phase 4.8 Patch E — reference image weighting per asset class.
//
// `count` caps the number of references attached to the OpenRouter call for
// each asset class. `emphasis` is a soft signal consumed by the prompt
// assembly to dial in 'precisely match the references' wording strength.
//
// Note: per-call hard cap MAX_REFERENCES_PER_CALL in pulp_ai.js still wins —
// these counts express intent and may be clamped if a model can't accept
// that many image_url parts in a single message.

module.exports.REFERENCE_WEIGHTING = {
  scene_bg:     { count: 4, emphasis: 'high'   },
  portrait:     { count: 2, emphasis: 'medium' },
  card:         { count: 6, emphasis: 'high'   },
  launch_image: { count: 4, emphasis: 'high'   }
};
