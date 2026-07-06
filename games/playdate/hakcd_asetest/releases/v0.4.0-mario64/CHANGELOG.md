# HAKCD v0.4.0 — Mario-64 Style Pass

The whole game reimagined in a Mario-64 aesthetic, rendered in strict 1-bit.

## Visual overhaul
- Every asset regenerated with a Mario-64 art direction: rounded, VOLUMETRIC,
  N64-model-looking forms. Dither GRADIENT RAMPS fake soft 3D shading, curved
  surfaces, and ambient occlusion — objects read round and solid, key light
  upper-left. 14 assets, all first-attempt, zero retries.
- BIG hero: the player is now a chunky 48x64 sprite (Mario-64 contextual size,
  ~1/4 screen height) with a dark blob shadow grounding it on the floor.

## Collectathon layer
- Power Stars: every objective now awards a spinning Power Star with a
  "STAR GET!" celebration overlay.
- Star HUD: a live star count rides the top-right of every room.

## Fixes
- Fixed a dialogue crash (nil node when advancing past the last line): draw now
  guards the terminal frame and the last node finishes cleanly.

## Unchanged from v0.3.0
Full Act-1 story spine (BBS -> war dialer -> payphone -> pedestal), portrait
dialogue, 8-step quest chain, and four crank minigames (war dialer, red box,
5-pin lockpick, blue box). 20-module engine, import-discipline clean, pdc zero-warning.

## Controls
D-pad move - A confirm/interact - B back - crank drives every minigame.
