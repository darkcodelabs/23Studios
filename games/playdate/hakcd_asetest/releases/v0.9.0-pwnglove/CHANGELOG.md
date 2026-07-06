# HAKCD v0.9.0 — The PWNGLOVE Sandbox

Refocused on what the game is actually about: the PWNGLOVE hacker multitool.
The twin-stick combat is gone. No enemies, no shooting, no aim-beam.

## What it is now
- Walk a clean room (the fun part, kept).
- The CRANK aims the glove: a targeting reticle you rotate that snaps onto
  devices. A dotted laser-sight, not a beam or projectiles.
- B cycles your POWERS (shown in a corner chip): LOCKPICK / RFID CLONE /
  SUB-GHZ / IR BLASTER -- the canon phreak tools.
- A fires the current power at the locked device. Right tool -> hack:
    MAG-LOCK DOOR  -> LOCKPICK  (full crank-tension minigame)
    BADGE READER   -> RFID CLONE (channel: hold while it clones)
    SERVICE GATE   -> SUB-GHZ    (channel: tuning)
    CCTV SCREEN    -> IR BLASTER (channel: blast)
  Wrong tool on a device -> WRONG TOOL, no effect.
- Hack all four -> MASTER HAKCER.

## Art
Room regenerated via the local Aseprite pipeline in a cleaner, chunkier
"Mario-64 level" style with only LIGHT dither -- not the busy Obra-Dinn noise,
not a literal remake. Interactive devices are drawn crisply in code so aim
always lines up with what you see.

## Honest caveats
Image/file reads blocked this session: art machine-validated (1-bit + dims) but
not eyeballed; logic reviewed + pdc-clean but not sim-tested. Feel values --
reticle radius (64px), snap distance (44px), crank sensitivity, walk speed,
device positions -- are first-pass and will want tuning on hardware.

## Controls
D-pad walk - crank aim the glove - B cycle power - A fire power
