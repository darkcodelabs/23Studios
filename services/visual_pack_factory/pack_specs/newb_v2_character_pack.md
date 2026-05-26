# Newb v2 — Character Spec

Pack: `newb_v2_character_pack`
Type: `character_pack`
Target dimensions: 64×64 (bumped from 32 / 48 — readable on hardware)
Project: HAKCD vertical slice

## Why v2

Newb v1 (32×32 imagetable) lost its silhouette on hardware. Hands and feet
disappeared under fluorescent light. v2 trades resolution for readability:
chunkier proportions, fewer tiny details, stronger black mass.

## Anatomy rules

- **Head:** ~16px tall, ~14px wide. Round-ish, with a single clear feature
  (cowlick hair lock or hat brim). No eyes/mouth at static rest — those
  appear only in expression frames.
- **Torso:** ~22px tall, ~18px wide. Chunky, no waist taper. Hoodie
  silhouette reads from the back.
- **Arms:** ~20px long, ~6px wide. Read as mitten-stumps in 1-bit, fingers
  only in held-pose frames.
- **Legs:** ~22px tall, ~9px wide each. Sturdy. Feet read as wedges, not
  points.
- **Total black mass:** ~55–65% of the 64×64 frame in idle pose.

## Pose set (v2 minimum)

| Pose | Use | Frames |
|---|---|---|
| `idle_front` | default standing, breathing micro-loop | 4 |
| `idle_back` | inspecting station, used when interacting with focal | 4 |
| `walk_left` | flip horizontally for walk_right | 4 |
| `walk_back` | up-screen walk cycle | 4 |
| `walk_front` | down-screen walk cycle | 4 |
| `interact` | hands raised, two-handed prop-grab | 3 |
| `surprise` | eyes-open, shoulders up, ❗-ready | 1 |

## Silhouette test

Render filled pure black, place on pure white 400×240 background, view from
24 inches. Pose must be identifiable without internal detail.

## Forbidden

- Eyes/mouth in idle frames (only expression poses)
- Fingers in non-interact poses (mitten silhouette only)
- Anti-aliased outlines / grey ramps
- Pointy feet that lose to fluorescent glare
- Three-quarter "turnaround" poses (Playdate dpad is cardinal-only)

## Hardware-review criteria

- Silhouette identifiable from 24in under fluorescent
- Hands legible in `interact` frame
- Feet legible in all walk cycles
- Pose reads instantly (no "what is the character doing" confusion)
- 1-bit colour check passes
