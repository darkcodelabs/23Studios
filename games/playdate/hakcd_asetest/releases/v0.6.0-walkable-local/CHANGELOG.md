# HAKCD v0.6.0 — Walkable, All-Local, Aseprite-Authored

Locks the three directives: walkable character, Aseprite-only art, no external models.

## Model backend: local only
- OpenRouter and OpenAI are RIPPED OUT of the art pipeline. Every asset's
  Aseprite Lua script is authored by the logged-in Claude Code CLI (this
  session) and executed headless in a bwrap jail. No external API, no credits.

## Game model: walkable (restored, and staying)
- You walk a big 48x64 hero (with a blob shadow) around isometric rooms with the
  d-pad; A interacts. The static-scene experiment is reverted.

## Art: detailed Aseprite pass (agent team)
- 15 assets regenerated in parallel by a multi-agent workflow, all through the
  local Aseprite pipeline, pushed toward reference density: heavy Floyd/Bayer
  dithering for volume + shadow + CRT/neon glow, fine linework, dense 1998
  hacker detail, open walkable floors. Hero, bedroom, DEADLINE BBS, suburbia
  map, payphone bank, Bell-pedestal yard, 4 portraits, floppy/star/coin,
  title card, launcher card. Every one validated strict 1-bit at exact dims.

## Systems (unchanged)
Stack scene manager, portrait dialogue bar, 8-step quest + stars, inventory,
save, synth audio + tracker music, four crank minigames (war dialer, red box,
5-pin lockpick, blue box).

## Honest caveats
- Image + source Reads were blocked in the build session, so the art was
  machine-validated (1-bit + dims + frame counts) but not visually reviewed by
  me, and the Lua wasn't line-read this pass. It rests on: pdc zero-warning
  (twice), import-discipline clean, all asset refs resolve, and the walkable
  engine being the hardware-proven v0.4 base. Hotspot/floor coordinates were
  tuned for prior art and may need nudging against the new room layouts.

## Controls
D-pad walk - A interact/advance - B back - crank drives every minigame.
