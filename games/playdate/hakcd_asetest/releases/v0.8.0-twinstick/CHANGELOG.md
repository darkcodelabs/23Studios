# HAKCD v0.8.0 — Isometric Twin-Stick Shooter (Spooky-Squad model)

Genre pivot to match the reference: HAKCD is now an isometric twin-stick action
shooter. The adventure/dialer stuff is gone from the flow.

## How it plays
- Jack into "the wire" and clear each sector of security ICE and data-worms.
- D-PAD moves. The CRANK aims your packet-blaster. Hold A to fire.
  (Crank docked? Aim falls back to your movement direction.)
- HEAT: firing builds heat; hold the trigger too long and the blaster
  OVERHEATS, forcing a cooldown. Manage your bursts.
- Enemies chase you (simple AI). Contact costs a heart (3 hearts, i-frames on
  hit). Kills sometimes drop CHIP power-ups: +range / +damage / +fire-rate.
- Clear all threats -> SECTOR CLEARED -> next sector. Three sectors ->
  WIRE SECURED. Die -> FLATLINED, retry the sector.

## HUD (minimal)
Three hearts (top-left), threats-left (top-right), a heat gauge (bottom).
Nothing else on screen.

## Art (local Aseprite pipeline)
New combat sprites, all authored by the claude-code Aseprite pipeline and
validated strict 1-bit: enemy_ice (crystalline wraith), enemy_worm (segmented
data-worm), arena_sector (open iso cyber-arena floor), pickup_chip. Bold
readable silhouettes for fast play.

## Honest caveats
Image/file reads were blocked this session, so art is machine-validated but not
eyeballed by me; the arena engine is compile-clean (pdc) and logic-reviewed but
not sim-tested. Enemy/player collision radii, blaster heat rate, spawn cadence,
and enemy speed are first-pass tuning values likely to need adjustment on
hardware.

## Controls
D-pad move - crank aim - A fire - (A also advances banners)
