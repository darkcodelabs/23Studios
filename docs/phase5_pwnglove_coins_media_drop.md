# FOLLOWUP — PWNGLOVE + 23 C0iNS media drop required

Phase 5 addendum (`docs/phase5_pwnglove_coins_priority.md`) names PWNGLOVE + 23 C0iNS as the top-priority mechanics. The bible binding in `personal/hakcd/sdk_data/story_bible.md` references the media listed below.

## Already on disk (copied from public repos)

These were pulled from the cloned `NoDataFound/23Coins` repo and placed under `bible_media/art/`:

- `23coins_logo_real.jpeg` — official 23 Coins logo (from `23Coins/Art/23.logo.only.jpeg`)
- `23coins_coin0_real.png` — Coin 0 face render (from `23Coins/Coins/Coin0/Coin0.png`)

These can serve as primary refs for the coin grid recipe's art passes until the user supplies higher-fidelity assets.

## MagPi Issue 33 scans — DELIVERED 2026-05-23

User dropped three slideshare screenshots from Cory Kennedy's own MagPi 33 upload (`slideshare.net/slideshow/magpi33powergl…`). Copied with canonical names to `/home/hakcer/projects/personal/hakcd/bible_media/art/`:

| Filename | Source screenshot | Content |
|---|---|---|
| `pwnglove_real_magpi_hero.jpg` | `Screenshot_2026-05-23-15-11-26-66…` | PWNGLOVE title spread — hero shot of full buildup glowing + Cory Kennedy headshot + opening paragraph |
| `pwnglove_real_magpi_disassembly.jpg` | `Screenshot_2026-05-23-15-11-31-47…` | Build-process page — disassembled Power Glove with parts on a table + assembled NeoPixel-lit final + "START PLAYING WITH POWER" STEP-01/02/03 callout |
| `pwnglove_real_magpi_feature.jpg` | `Screenshot_2026-05-23-15-11-40-78…` | Slideshare landing page — "MagPi33_PowerGlove" by Cory Kennedy + AI-enhanced description text + hero thumbnail |

Bible `art:` block in `personal/hakcd/sdk_data/story_bible.md` already references these filenames; the **MISSING** annotations on the PWNGLOVE section are now stale and should be removed in a follow-up bible pass.

## Still optional

Optional but recommended:

| Filename | Source |
|---|---|
| `trikc0x01_hardware.png` | Real physical coin from `NoDataFound/TriKC0x01` repo, if a render exists |
| `coins_inventory_screen.png` | Canonical in-game coin grid mockup (referenced by `ui_reference` in bible) — may need to be drawn fresh |

## Why this blocks (a little)

Team Bible's PWNGLOVE rewrite during Phase 5 Wave A wires the bible `art:` block to actual filenames. Until the three MagPi scans exist, only `pwnglove_device_pixel.png` is bound and the asset library cannot offer the magazine references to image-gen prompts. The rewrite can ship without them; image fidelity for the SecKC acquisition scene drops accordingly.

## Repos cloned for reference

```
/tmp/coin-refs/23Coins/      # NoDataFound/23Coins — software/protocol
/tmp/coin-refs/TriKC0x01/    # NoDataFound/TriKC0x01 — hardware coin + PWNGLOVE firmware
```

`PwnGlove.ino` in the second repo is the source of truth for: bend sensor layout, NeoPixel matrix (16×16, FastLED palette cycle every 5s), Konami button bitmask order, and the serial protocol.
