# Powerglove Arcade Hub — Room Kit Spec (v3)

Pack: `powerglove_arcade_room_pack`
Type: `room_pack` (room KIT, not hero illustration)
Target dimensions: 400×240 (Playdate full screen) for the room layout;
per-asset dimensions specified per station below.
Project: HAKCD vertical slice
Reference: `/home/hakcer/projects/pnwglove.png` (PWNGLOVE master) — borrow
silhouette language, industrial cable routing, button cluster motifs,
mini-display geometry. Inspiration only, no copy.

## What this pack outputs

A ROOM DEVELOPMENT KIT for the Powerglove Arcade Hub. The factory does
NOT generate a poster, a splash screen, or a marketing illustration of
the room. It generates:

1. The room as a navigable gameplay layout (background plate + floor +
   ceiling + walls, with interactable slots reserved but empty).
2. Each interactable station as an isolated asset on neutral background,
   ready to composite into the room at runtime.

The room background plate and the station sprites composite together
in-engine. They are produced separately so the same stations can be
re-used in other rooms.

## Vibe

DEF CON village + retro RF laboratory + underground hacker maker-space.
Late-night maker bench. Strong industrial language. Not generic
cyberpunk. Not splash art.

## Room layout (background plate)

Asset id: `powerglove_arcade_room_bg`
Dimensions: 400×240
Contents:
- Ceiling rig (cable bundles, monitor mount points — NO monitors yet)
- Wall (dark, dithered, with mounting points for instruments)
- Floor (grated panel, perspective-correct from player viewing angle)
- Interaction-slot footprints (empty rectangles where stations go)
- Light cone from ceiling onto the centre slot (the Powerglove
  testing-station slot)

Composition rules:
- Negative space dominates. Stations slot in later.
- Floor grating uses dithering for depth, NOT to fill space.
- One hero light cone — centre. Nowhere else.
- Black mass 30–40% on the plate (stations will add another 15–25% on
  top at composite time).

## Stations (isolated game assets)

Each station ships on a neutral / empty background, ready to composite.
Each must read at 32×32 (silhouette test). All stations carry
PWNGLOVE-derived industrial language: cable spirals, button clusters,
mini-display rectangles, stipple-shaded chrome.

### 1. Powerglove Testing Bench
Asset id: `powerglove_testing_bench`
Dimensions: 96×96
Components: glove armature on rig, monitor stack, cable bundle, base
platform. Hero element of the room. Highest black-mass density.

### 2. Powerglove Calibration Station
Asset id: `powerglove_calibration_station`
Dimensions: 64×64
Components: enclosed pod with internal glow (dithered hatching), control
panel on the front, status LED row.

### 3. Powerglove Charging Dock
Asset id: `powerglove_charging_dock`
Dimensions: 48×48
Components: wall-mounted bracket with hanging cables, indicator LED,
glove cradle.

### 4. Powerglove Repair Table
Asset id: `powerglove_repair_table`
Dimensions: 64×48
Components: workbench surface, scattered tools (vice, soldering iron,
spool of wire), open glove with exposed circuits.

### 5. Powerglove Display Pedestal
Asset id: `powerglove_display_pedestal`
Dimensions: 48×64
Components: glass case on plinth (case rendered as outline + dither),
glove inside, descriptive plaque on the front.

### 6. RF Scanner
Asset id: `powerglove_rf_scanner`
Dimensions: 64×64
Components: spectrum waterfall display, antenna fan array, oscilloscope
screen, knob row.

### 7. CRT Workstation
Asset id: `powerglove_crt_workstation`
Dimensions: 64×64
Components: hulking CRT monitor (scanline texture via dithering),
mechanical keyboard, mug.

### 8. Hacker Workbench
Asset id: `powerglove_hacker_workbench`
Dimensions: 80×48
Components: cluttered bench surface, open laptop, soldering station,
dev board with LEDs, coffee mug.

## Anti-patterns (auto-reject)

- A single big hero illustration filling 400×240.
- Poster composition. Splash composition. Marketing composition.
- Centre-weighted concept art.
- Excessive texture noise without dithering structure.
- Solid grey fills instead of dithering.
- Anti-aliased edges. Smooth gradients. Painterly rendering.
- Photoreal CRT or RF gear.
- Lens flares, bloom, atmospheric blur.

## Approve criteria

- Room background plate reads as a navigable space without stations
  composited in.
- Each station reads independently at 32×32 silhouette.
- Stations slot into the room plate at intended positions without
  visual collision.
- Total composited frame: 38–48% black mass, single hero light cone,
  3-band reading (ceiling / play area / floor).
- Hardware-readable at 24in under fluorescent.
