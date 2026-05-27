# Powerglove Arcade Hub — Composition Spec

Pack: `powerglove_arcade_room_pack`
Type: `room_pack`
Target dimensions: 400×240 (Playdate full screen)
Project: HAKCD vertical slice

## Vibe

Late-night underground arcade workshop. DEF CON hacker carnival meets retro
RF laboratory meets cyberpunk science fair. Not generic cyberpunk. Not "AI
gen cyberpunk junk." Authored, staged, cinematic. Every pixel earns its
place.

## Composition

The 400×240 frame is divided into three readable bands and a hero focal:

```
+---------------------- 400px -----------------------+
|   ceiling rig: cable bundles + monitor banks        |  ~50px
+----------------------------------------------------+
|                                                    |
|   [RF Bench]   ★ [POWERGLOVE STATION] ★   [CRT BBS] |  ~140px (play area)
|                                                    |
|                  [Calibration Pod]                  |
+----------------------------------------------------+
|     floor: grated panels, cable runs, shadow      |  ~50px
+----------------------------------------------------+
```

### Primary focal: Powerglove Testing Station

- Roughly centred horizontally, raised platform, ~80–100px tall
- Massive silhouette: glove on rig + monitor stack + cable bundle
- Reads first from 24-inch viewing distance
- Highest black-mass density of any object in the room
- This is the hero. Every other element supports it via contrast and
  negative space.

### Secondary stations (three, distinct silhouettes)

1. **RF Analysis Bench** — left side
   - Spectrum waterfall display, antenna fan, oscilloscope, knobs
   - Tall vertical silhouette, dominant black mass at top (instruments)
   - Animation: spectrum waterfall scrolls 4 frames

2. **CRT BBS Terminal** — right side
   - Hulking CRT monitor, mechanical keyboard, dot-matrix printer
   - Horizontal lower-heavy silhouette
   - Animation: scanline jitter, blinking cursor

3. **Powerglove Calibration Pod** — front-centre (between RF and CRT)
   - Smaller, closer to camera, glowing inside
   - Compact dense silhouette
   - Animation: pulse light cycle 6 frames

## Visual rules

### Black-mass discipline

Each station has a clear silhouette test: render at 1-bit pure black on
white, occlude everything else, must still read as "RF bench" vs "CRT" vs
"calibration pod." If silhouette ambiguous, reject.

### Negative space

The space *between* stations is composition, not empty floor. Use it for:
- shadows pooling under the Powerglove platform
- a single light cone from the ceiling onto the focal
- bare floor reading as silence around the hero

### Layered density

- Foreground: floor cables, debris, prop scatter near base of each station
- Midground: the stations themselves
- Background: monitor banks, cable bundles, vent grates
- Foreground/midground/background must have distinguishable black-mass density

### Lighting hierarchy

- Hero light: cone on Powerglove station (highest contrast)
- Station lights: monitor glow on each secondary station
- Ambient: ceiling rig has a few warm dots (CRT power LEDs)
- Floor: shadow gradients in pure 1-bit (dither hatching OK, no greys)

### Focal point hierarchy

One hero per frame. Eye traces:
1. Powerglove station (centred, brightest, biggest)
2. CRT BBS (right, blinking cursor draws eye)
3. RF bench (left, scrolling waterfall)
4. Calibration pod (front-centre, pulse light)
5. Floor / ceiling detail

## Forbidden

- Procedurally scattered props ("object soup")
- Repeated/tiled carpet floor
- Generic cyberpunk neon signs
- Anti-aliased gradients or grey ramps
- Lens flares, bloom, atmospheric blur
- Off-the-shelf AI cyberpunk assets
- Anything that reads "tilemap test"

## Animation slots

| ID | Where | Frames | Tempo |
|---|---|---|---|
| `powerglove_glow_cycle` | Powerglove station | 6 | 200ms |
| `crt_scanline_jitter` | CRT BBS | 4 | 120ms |
| `rf_waterfall_scroll` | RF Analysis Bench | 4 | 80ms |
| `calibration_pod_pulse` | Calibration Pod | 6 | 180ms |
| `ceiling_led_blink` | Ceiling rig | 2 | 500ms (out of phase) |

## Audio slots

| ID | Source | Loop |
|---|---|---|
| `crt_hum_loop` | CRT BBS | yes |
| `rf_chatter_loop` | RF Analysis Bench | yes (low gain) |
| `modem_noise_burst` | RF Analysis Bench | one-shot, random 8–20s |
| `arcade_ambience` | room bed | yes (very low gain) |
| `powerglove_synth_loop` | Powerglove station | yes |
| `machine_click_random` | room scatter | one-shot, random 4–12s |

## Hardware-review criteria

- Powerglove station readable from 24 inches under fluorescent light
- Each secondary station's silhouette identifiable independently
- No grey-ramp / anti-aliased pixels (1-bit colour check)
- Total black-mass density 38–48% of frame (eyeball + histogram)
- Eye traces the focal hierarchy in <1.5s on first view
