# Playdate / Pulp Asset Spec Matrix (as of 2026-05-17)

Definitive sizing + fidelity reference for the 23 Studios pipeline. Compiled
from primary Panic SDK docs, Pulp docs, the playdate-reverse-engineering
project, and first-party postmortems (Mars After Midnight, Donald Hays).

The Studio MUST conform to these specs to hit Nintendo first-party GBA-tier
polish. Anything that drifts goes in the fix backlog (Section 6).

## 1. Hardware + Display

**Display Specifications** (https://sdk.play.date/inside-playdate/):
- Native resolution: **400 × 240 pixels**
- Colour depth: **1-bit (monochromatic)** — each pixel is either on (white/1) or off (black/0)
- Refresh rate: **30 fps default, up to 50 fps maximum**
- Display type: Sharp Memory LCD (reflective, no backlight)
- Pixel density: **173 PPI** (https://help.play.date/developer/designing-for-playdate/)
- Physical screen size: ~6 cm × 4 cm (2.4" diagonal)

**Implications for Legibility & Art** (Donald Hays scale guide, Panic dev portal):
- Minimum sprite size: **~32 × 32 pixels recommended** (anything smaller is hard to distinguish)
- Minimum tile size: **16 × 16 pixels or larger for SDK tilemaps** (8×8 causes eye strain on raw SDK; Pulp opts for 8×8 because it auto-2× upscales)
- Minimum text height: **8 pixels minimum; 10+ pixels preferred for body text**
- Font stroke thickness: **minimum 2 pixels** for legibility
- Scaling factor vs Game Boy: art appears ~50% smaller due to higher pixel density; a 32px Playdate sprite ≈ 16px Game Boy sprite in apparent size
- Character sprite scale: **24–32 pixels** comfort zone; **48–96 pixels** preferred for protagonist
- Physical dithering impact: fine dithering (<2px patterns) becomes invisible on the small screen; bold sparse patterns work better

---

## 2. SDK Asset Specs (Lua + C Projects)

### 2.1 Images (Single Frame)
- Source PNG → compiled `.pdi`
- Full-screen background: **400 × 240**
- Sprite single frame: 16–96 pixels typical
- 1-bit + optional 1-bit alpha
- Optional zlib compression
- pdc auto-dithers colour PNGs; recommend pre-dithering in greyscale editor for best results

### 2.2 Sprite Tables (Animated)
- Filename pattern: **`[name]-table-[W]-[H].png`** (MANDATORY for pdc to recognize)
- Cell W × H extracted from filename; image width must be multiple of W, height multiple of H
- Cell layout: **left-to-right, top-to-bottom**
- Compiled to `.pdt`
- Cells with transparent borders auto-cropped by pdc

### 2.3 Backgrounds / Scenes
- **400 × 240**
- 1-bit + optional alpha
- Floyd-Steinberg or Atkinson dither recommended for tonal range

### 2.4 Tile Maps (SDK)
- **16 × 16 minimum** (32 × 32 also common)
- NOT 8×8 for the main playfield (Donald Hays + Panic dev portal — eye strain)
- Power-of-2 sizes easiest
- Filename pattern: `[name]-table-[tileW]-[tileH].png`
- Typical room: 20×15 tiles at 16px = 320×240; 12×8 at 32px = 384×256

### 2.5 Fonts
- `.fnt` plaintext + `[fontname]-table-[W]-[H].png` bitmap
- Glyph height all identical; widths vary, listed in `.fnt` metadata
- Body text min **10px tall**; HUD **10px** preferred; absolute min 8px
- Stroke ≥2px
- 1-bit on transparent
- Falls back to system font if load fails

### 2.6 Launcher Assets
- **`card.png` → 350 × 155** (main card view, 1-bit)
- **`icon.png` → 32 × 32** (list view)
- `icon-pressed.png` → 32 × 32 (selected state)
- `card-highlighted/1.png 2.png …` (animated card, same 350×155, optional `animation.txt` controls `loopCount`/`frames`/`introFrames`)
- `icon-highlighted/*.png` (animated icon, 32×32)
- `launchImage.png` → 400 × 240 (loading screen, no alpha)
- `launchImages/*.png` (animated launch sequence)
- `wrapping-pattern.png` → 400 × 240 (optional gift-wrap cosmetic)

### 2.7 Audio
- **44,100 Hz** sample rate
- 16-bit PCM native; 8-bit PCM ok; **IMA ADPCM .wav recommended** (4:1 compression, good quality)
- Mono for SFX; stereo for music
- MP3 supported but CPU-intensive (avoid for real-time SFX)
- ADPCM → 4× memory expansion on load
- ~88 KB per second mono 16-bit PCM; ~22 KB per second IMA ADPCM
- Keep total game ≤ 20–40 MB

### 2.8 pdxinfo
```
name=Game Name
author=Author Name
description=Tagline
imagePath=Images          # folder with card.png/icon.png/launchImage.png
buildNumber=1
launchSoundPath=sounds/launch   # optional
```

### 2.9 Compiled Formats
- **`.pdi`** — single image (1-bit ± alpha); 16-byte header + per-image header + cell pixel data (cells with transparent edges cropped, clip offsets stored)
- **`.pdt`** — image table; container for multiple cells; parsed from `[name]-table-[W]-[H].png`; same cell structure as `.pdi`
- **`.pdv`** — video; rare; produced by external `1bitvideo.app` not pdc
- **`.pdz`** — Playdate Data (zlib-compressed binary); used for compiled scripts + sound

---

## 3. Pulp (Web Editor) Asset Specs

### 3.1 Tiles
- **8 × 8 pixels** (FIXED, not configurable)
- Multiple frames per tile for simple animation (cycled via `[` and `]`)
- Types: world, sprite, item, exit, player (exactly one player per game/room max)

### 3.2 Rooms
- **25 × 15 tiles** (FIXED)
- Renders at **200 × 120** in the editor; upscales to 400×240 at runtime (2×)

### 3.3 Tile Animation
- Per-tile FPS configurable (typical 6–12 fps)
- Import via `tilename-table-8-8.png`

### 3.4 Fonts (Pulp)
- Full-width + half-width glyphs
- Customizable per-glyph in the editor
- Dimensions inferred 8×8 or 6×8 (Pulp docs don't make this explicit)

### 3.5 Sound / Music (Pulp)
- Voices: **sine, square, sawtooth, triangle, noise**
- Song length: up to **32 bars**
- SFX length: up to **4 bars**, single voice
- BPM range + track count: not explicitly documented in Pulp docs

### 3.6 Launcher Card (Pulp)
- Auto-generated from designated card tile or composite (built-in)
- Card dim inferred 350 × 155 (matches SDK)
- Animated card support in Pulp exports: not documented

### 3.7 Export Format
- `.pdx` bundle: pdxinfo, card.pdi, chars.pdt, frames.pdt, pipe.pdt, main.pdz, data.pdz, optional data.json.zip

---

## 4. HAKCD Inventory (Real Shipping Game — Reference)

Project type: SDK (Lua + C).

Known asset conventions from `tools/generate_character_portraits.py` + `source/data/character/character_pools.lua`:
- Body table: **64 × 96 per frame** (5-frame `body-table-64-96.png`)
- Origin overlay: **32 × 32 per frame**
- Specialty overlay: **32 × 32 per frame**
- Composite character: body + origin overlay + specialty overlay

Other observed sizes (from earlier AGENT-IMG inventory + INV agent):
- UI icons: **16 × 16** (btn_a, btn_b, dpad, crank, skull)
- Coin glyph: **8 × 8**
- Coin faces: **80 × 80** (animation frames)
- Coin locked: **48 × 48**
- Player portrait: **24 × 24**
- Audio: WAV files <20 KB each, in source/sounds/

---

## 5. 23 Studios Current Behavior (Audit)

| Surface | Studio does | Canonical | Verdict |
|---|---|---|---|
| Pulp tile size | 16×16 | **8×8** | ✗ DRIFT (Pulp pipeline; SDK ok at 16×16) |
| Pulp room dim | 25 × 15 (✓) | 25 × 15 | ✓ matches |
| Tile dither default | atkinson | **Bayer ordered** for tiles | ✗ DRIFT |
| Scene dim | 400 × 240 | 400 × 240 | ✓ matches |
| Scene dither default | atkinson | atkinson / floyd ok | ✓ acceptable |
| Portrait dim | 64 × 64 (just landed) | 64 × 96 (HAKCD) or 32×32–128×128 | ✓ acceptable, could allow 64×96 |
| Portrait dither | atkinson | **Bayer 4×4 or sparse Floyd** | ✗ DRIFT (use Bayer) |
| Launcher card dim | 350 × 155 | 350 × 155 | ✓ matches |
| Launcher icon | not yet supported | 32 × 32 | ✗ MISSING |
| Launch image | not yet supported | 400 × 240 | ✗ MISSING |
| Sprite-table naming on export | not enforced | `[name]-table-[W]-[H].png` | ✗ MISSING |
| Audio sample rate | not enforced | **44.1 kHz** | ✗ DRIFT (no validation) |
| Audio compression | none | IMA ADPCM preferred | ✗ MISSING |
| Font glyph dim | not generated | `[name]-table-[W]-[H].png`, min 10px tall | ✗ MISSING |
| Sound waveforms | sine/square/triangle/sawtooth/noise (✓) | matches Pulp voices | ✓ matches |

Net: **8 drift / missing items**; 5 acceptable / matches.

---

## 6. Gap Analysis + Fix Backlog (prioritized)

### MUST FIX
1. **Tile size by game_type** — `server/services/pulp_ai.js` + `server/services/pulp_assets.js` + `server/data/schema/pulp_project.schema.json`. Pulp projects → 8×8 (256 chars/frame becomes 64 chars). SDK projects → 16×16. Schema field validates against game_type. Source: https://play.date/pulp/docs/
2. **Sprite-table naming on export** — `server/services/pulp_export.js`. When emitting multi-frame tiles/portraits, save as `<id>-table-<W>-<H>.png`. Source: https://sdk.play.date/inside-playdate/
3. **Audio sample rate enforcement** — `server/services/pulp_assets.js`. Convert all sound uploads to 44,100 Hz via ffmpeg/sox during import. Source: https://devforum.play.date/t/what-is-playdate-sound-sampleplayer-setrate-for/14458
4. **Dither algorithm defaults per asset type** — `server/services/pulp_scenes.js` + `server/services/pulp_portraits.js` + new dither default in `pulp_assets.js`. Tiles → Bayer 4×4; portraits → Bayer 4×4; scenes → keep atkinson; fonts → none. Source: Mars After Midnight postmortem.
5. **Launcher icon + launch image support** — server endpoints + UI controls mirroring `pulp_assets.js` launcher-card path. 32×32 icon, 400×240 launch image. Source: https://sdk.play.date/inside-playdate/

### SHOULD FIX
6. **Body sprite table 64×96 option** — `pulp_portraits.js`. Add a "body sprite" variant alongside the 64×64 portrait; matches HAKCD's 5-frame body-table-64-96 convention.
7. **Min sprite size enforcement** — reject sprite uploads <32px on either axis (warning, not hard fail).
8. **Font glyph generation** — new endpoint for `[name]-table-[W]-[H].png` font import + glyph editor. Min 10px tall.
9. **IMA ADPCM conversion** — pipe wav → IMA ADPCM via `ffmpeg -acodec adpcm_ima_wav` for size savings.
10. **Animation cell layout enforcement** — when exporting tables, lay out cells left-to-right top-to-bottom; reject malformed grids.

### NICE TO HAVE
11. Wrapping-pattern.png generation for the gift-wrap launcher view.
12. animation.txt support for animated launcher cards (loopCount/frames/introFrames).
13. Per-tile multi-frame animation imports following Pulp `tilename-table-8-8.png` convention.
14. Build-size budget warnings (≤ 40 MB total).

---

## 7. Dithering Algorithm Guidance Per Asset Type

| Asset type | Default | Rationale |
|---|---|---|
| Pulp tile (8×8) | **Bayer 2×2 or 4×4** | Preserves crisp edges; doesn't bleed across tile boundaries. Floyd-Steinberg destroys 8×8 readability. |
| SDK tile (16×16) | **Bayer 4×4** | Same reasoning at larger scale. |
| Scene background (400×240) | **Floyd-Steinberg or Atkinson** | Large canvas; error diffusion creates natural tonal range. Matches Mars After Midnight. |
| Character portrait (64×64+) | **Bayer 4×4 or sparse Floyd** | Face legibility critical; heavy dither obscures features. |
| Launcher card (350×155) | **Bayer 4×4 (or none)** | Card viewed at rest; readability of title matters; avoid grainy texture. |
| Font glyph | **NONE** | Thin strokes (≤2px) destroyed by any dither. Use solid 1-bit with hand-tuned outlines. |
| Icon (32×32) | **Bayer 4×4** | Must be recognizable at tiny size. |

---

## 8. Animation / Sprite-Table Format

**Pattern:** `[name]-table-[W]-[H].png` (mandatory; pdc parses by regex)

**Examples:**
- `player-right-table-64-32.png` — 64×32 per cell
- `enemy-walk-table-32-48.png` — 32×48 per cell
- `tileset-table-16-16.png` — 16×16 per cell (SDK tilemap)
- `body-table-64-96.png` — 64×96 per cell (HAKCD's body sprite)

**Parser:**
1. regex `([a-zA-Z0-9_-]+)-table-(\d+)-(\d+)\.png`
2. W and H from filename
3. PNG total dims measured; frame count = `ceil(image_w / W) × ceil(image_h / H)`
4. Frames read **left-to-right, top-to-bottom**
5. If image dims don't align: pdc silent failure (returns nil)

**Padding:** none required; transparent borders auto-cropped by pdc.

**Lua API:**
```lua
local table = gfx.imagetable.new("images/player-right-table-64-32")  -- no extension
local count = table:getSize()
local frame3 = table[3]
```

---

## 9. Sources

**Panic SDK:**
- https://sdk.play.date/ — SDK index
- https://sdk.play.date/inside-playdate/ — asset types, APIs
- https://sdk.play.date/inside-playdate-with-c — C graphics + sound
- https://help.play.date/developer/designing-for-playdate/ — sprite/tile sizing, legibility minimums
- https://help.play.date/developer/editing-pulp-metadata/ — pdxinfo fields, launcher assets

**Pulp:**
- https://play.date/pulp/docs/ — Pulp editor + PulpScript
- https://play.date/pulp/help/ — user guide
- https://play.date/pulp/changelog/

**Reverse Engineering:**
- https://github.com/cranksters/playdate-reverse-engineering — pdi/pdt/pdv/fnt format specs
- https://github.com/cranksters/playdate-reverse-engineering/blob/main/formats/pdi.md
- https://github.com/cranksters/playdate-reverse-engineering/blob/main/formats/pdt.md
- https://github.com/cranksters/playdate-reverse-engineering/blob/main/formats/fnt.md

**Community + Art Postmortems:**
- https://dukope.itch.io/mars-after-midnight/devlog/285964/working-in-one-bit — dither strategies (Lucas Pope)
- https://blog.gingerbeardman.com/2021/07/30/playdate-1-bit-illustration-postmortem/
- https://donaldhays.com/2019/12/30/playdate-art-scale/ — sprite scale vs Game Boy
- https://furnacecreek.org/blog/2024-01-28-pixen-and-playdate
- https://devforum.play.date/t/playdither-a-web-tool-for-1-bit-image-dithering/5339/
- https://devforum.play.date/t/imagetable-from-sequential-frames/1256
- https://devforum.play.date/t/animated-sprite-helpful-class/1884
- https://devforum.play.date/t/has-anyone-posted-a-good-tutorial-for-tilemaps/4529
- https://devforum.play.date/t/what-is-playdate-sound-sampleplayer-setrate-for/14458
- https://gist.github.com/jaames/664dffb7574baaf36d056a866d4210ea — perf tips
- https://github.com/sayhiben/awesome-playdate
- https://playdate-wiki.com/

Fetched 2026-05-17.
