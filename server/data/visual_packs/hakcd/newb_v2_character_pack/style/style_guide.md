# Newb v2 — Character Sprite Sheet Spec (v3)

Pack: `newb_v2_character_pack`
Type: `character_pack`
Target dimensions: 64×64 per pose (sheet laid out in a grid; each cell
treated as one sprite)
Project: HAKCD vertical slice

## Why v2 was rejected (Newb v1 + the early v2 candidates)

- Blob silhouette. No identifiable profile.
- Placeholder quality. Reads as "generic round figure" not "Newb."
- No visible face. No hands. No feet. No torso definition.
- No personality. Could be any character in any 1-bit game.
- No animation readability — same blob in every pose.

## What v3 must deliver

A SPRITE SHEET, not a portrait. Production-ready for direct import into
the Playdate game. Organised grid, one pose per cell.

### Required views (cardinal-only, Playdate dpad is 4-way)

| View | Why |
|---|---|
| front | default standing / interacting toward camera |
| back | walking away / inspecting a station |
| left | walk cycle (mirror for right) |
| right | walk cycle (or flip left in code) |

### Required animations

| Animation | Frame count | Tempo |
|---|---|---|
| idle | 4 | 200ms (slow breathing micro-loop) |
| walk | 4 | 120ms |
| run | 4 | 80ms (Newb sprinting between stations) |
| interact | 3 | 140ms (two-handed prop grab) |
| use item | 3 | 160ms (raising glove / holding tool) |
| reaction | 2 | 220ms (surprise: shoulders up, head back) |

Sheet layout: one row per animation, columns are frames. 4 views ×
6 animations × ~4 frames average = roughly 6 rows × 16 columns of
64×64 cells. Provider can ship as a single sheet or per-view sheets.

## Character identity

Newb is:
- a hacker
- curious
- scrappy
- inventive
- memorable from silhouette alone

Visual hooks that MUST be readable in the silhouette:
- Hoodie with one cowlick / hair lock sticking up through the hood
- Mismatched chunky sneakers
- One hand wearing the PWNGLOVE (early-game stand-in, becomes the real
  PWNGLOVE later)
- Tool slot on belt (screwdriver / multi-tool silhouette)

## Anatomy (64×64)

- Head: ~18px tall, with visible face features (eyes + mouth in
  expression frames; eyes only in static idle).
- Torso: ~22px tall, hoodie silhouette, dithered fabric texture.
- Arms: ~20px long, visible fingers in interact / use-item frames;
  mitten-stumps in walk frames is acceptable but the PWNGLOVE arm
  must have a discernible glove shape.
- Legs: ~22px tall, sturdy. Feet read as wedges with visible sneaker
  outline.
- Total black mass per pose: ~50–60% of the 64×64 cell.

## Personality through pose

- `idle` cycle: subtle weight shift, head tilts, one hand fiddles with
  a wire on the belt every 4th cycle.
- `walk` cycle: confident, slightly forward-leaning gait.
- `run` cycle: full sprint, arms pumping, scarf / hoodie tail trailing.
- `interact`: leans in, both hands engaged with target.
- `use item`: raises the PWNGLOVE arm, other hand braces it.
- `reaction`: shoulders up, eyes wide, mouth open in a small "o".

## Dithering discipline

- Hoodie fabric: 4×4 Bayer dither for grey-tone fabric.
- Hair: solid black mass, no internal dither.
- Sneakers: tight crosshatch for sole tread; solid black uppers.
- PWNGLOVE: stipple-clustered dither (mirror the master reference).

## Reference

PWNGLOVE master: `/home/hakcer/projects/pnwglove.png`. Borrow:
- stipple shading language
- cable routing
- button cluster motif
- mini-display rectangle

Do NOT copy the glove illustration verbatim. Reduce + simplify for 64×64
sprite scale.

## Anti-patterns (auto-reject)

- Blob silhouette / no anatomy.
- Single portrait / no animation.
- Concept art / hero render.
- Greyscale fabric instead of dithered.
- Anti-aliased outlines.
- Same pose repeated across animation rows.

## Approve criteria

- Sheet identifiable as Newb (cowlick + PWNGLOVE arm) at 32×32 cell.
- Each animation row reads as that animation (eyeball test).
- Silhouette test passes per view.
- Production-ready: drops into the Playdate engine as an imagetable
  without retouching.
