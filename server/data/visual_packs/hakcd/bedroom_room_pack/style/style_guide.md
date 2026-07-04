# Style Guide

> Edit this file. The factory will not overwrite it once it exists.

## Perspective
Pick ONE. Do not mix.

- [ ] three-quarter top-down  (recommended)
- [ ] side-view
- [ ] top-down
- [ ] pseudo-isometric

## Character scale
- Player: 48x48 min / 64x64 preferred
- NPC: 48x48
- Props: 16x16 - 64x64
- Tiles: 24x24 or 32x32

## Silhouette rules
- Sprites must read in black mass first.
- Outline weight: TBD px, consistent across the pack.
- Heads oversized. Hands and feet legible at hardware scale.

## Black mass rules
- Shape > detail.
- Outline > texture.
- Black mass > noise.

## Dither language
- Allowed for: fog, CRT glow, shadows, atmospheric gradients, rough materials.
- Forbidden: global ordered dither at export; auto-dither detail replacement.

## Lighting
- Single dominant key. Optional rim. No painterly gradients.

## Composition (rooms)
- Focal point per room.
- Grouped interactables.
- No carpet-field repetition.
- No debug-tilemap energy.

## Negative prompts
- anti-aliased edges
- grayscale midtones
- soft painterly rendering
- modern UI chrome
- copyrighted characters / logos
