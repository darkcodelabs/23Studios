'use strict';

// Reference-image default manifest (Phase 4.5 Patch A scaffold).
//
// This file is the in-memory placeholder for what Phase 4 Patch A would have
// shipped as a global file on disk. The merged manifest endpoint
// (GET /api/projects/:id/references/manifest) layers per-project overrides
// on top of these defaults and tags each entry's origin via a _source map.
//
// Default set sourced from the user's hakcd_pixel_collection. Six images,
// all confirmed present at
// /home/hakcer/projects/personal/hakcd/hakcd_pixel_collection/ :
//   seckc.png, bbs_chat_close.png, bedroom.png, title.png,
//   powerglove_asset0.png, coins_inventory.png
//
// parking_garage_clone.png is deliberately omitted — not in the collection.
// The user will upload one through the new gallery UI when they need it
// (so scene_references.exterior stays empty).

function getDefaultManifest() {
  return {
    default_set: [
      // Phase 4.8 calibration targets — line-art with contained dither.
      // These carry the visual style for every image gen call.
      'topdown_suburbia.png',
      'isometric_garage_ghosts.png',
      'isometric_dialogue_scene.png',
      'pnwglove.png'
    ],
    scene_references: {
      title: ['pnwglove.png'],
      interior: ['isometric_garage_ghosts.png', 'isometric_dialogue_scene.png'],
      exterior: ['topdown_suburbia.png'],
      ui: ['isometric_dialogue_scene.png']
    },
    portrait_references: {
      default: ['isometric_dialogue_scene.png']
    },
    card_references: {
      default: ['pnwglove.png']
    }
  };
}

module.exports = {
  getDefaultManifest
};
