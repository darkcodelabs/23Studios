# HAKCD v0.0.1-from-bible

First sideload-candidate build of HAKCD shipped from the 23 Studios bible-driven autopilot.

## What landed

- 27 scene backgrounds generated from bible SCENE LIST
- 16 character portraits including cory_k anchored to real-person photo refs (mustache + flat-brim cap + scruff confirmed)
- 88 dialogue JSON files generated against SecKC community voice corpus + bible-derived speaker profile
- 25 keygen tracker music tracks from keygenmusic.tk, rendered openmpt123 → ffmpeg IMA ADPCM mono 44.1kHz
- 6 procedural SFX baseline + 3 launcher images
- Full Playdate runtime layer with scene_manager push/pop, audio_manager fades, save_state hooks

## Patches that shipped this build

- Phase 4.7.2 Patch A — flat-first dither directive + pre-dither contrast stomp
- Phase 4.7.2 Patch B — dialogue generator + SecKC corpus + new autopilot stage
- Phase 4.7.2 Patch C — keygenmusic_scraper vendor + Node wrapper + autopilot auto-fetch
- Phase 4.7.4 — cory_k real-person anchor (per-character override + photo refs at portrait gen)
- Wrapper fix (74316c7) — openmpt123 --render output naming + ffmpeg IMA ADPCM
- wireSourceTree fix (3bd6ac3) — music filter no longer drops keygen tracks

## Known issues

- `concepts/dialog_tree.lua` runtime not yet wired to display dialogue JSON sidecars
- Portrait dither still smears the background (Patch A directive applies to scenes cleanly, portraits need a stricter pass)
- Music plays per-scene by deterministic index, not mood-matched (assignment layer fell through when keygen DNS was blocked during the run; tracks renamed manually post-pipeline)

## Cost

$16.81 USD across 191 OpenRouter calls (scene_bursts $9.07, portrait_bursts $3.55, dialogue $3.75, launcher $0.44).

## Build inputs

- Story bible: `HAKCD_story_bible_v0.1.md` (28KB, 427 lines)
- Reference images: 4 calibration targets in `hakcd_pixel_collection/` (3 phone screenshots + pnwglove)
- cory_k photo refs: 2 photos (closeup + full-body blazer)
