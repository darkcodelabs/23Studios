#!/usr/bin/env bash
# tools/build_launcher_assets.sh
# Generates Playdate launcher assets from the canonical docs/hakcd_title.png.
# Replaces source/launcher/{card,icon,launchImage}.png in the HAKCD project.
#
# Why this exists:
#   v0.0.3 shipped with autopilot-generated DEADLINE BBS art on the launcher
#   tile (Playdate home-screen box art). The canonical hakcd_title.png was
#   only wired into the IN-GAME title scene, not the launcher tile. This
#   script derives all three launcher assets from the canonical source so
#   the home-screen tile matches the in-game title.
#
# Sizes per https://sdk.play.date/3.0.6/Inside%20Playdate.html#f-launcherImages:
#   card.png        350x155 (game card on system home)
#   icon.png        32x32   (small icon)
#   launchImage.png 400x240 (full-screen during boot)

set -euo pipefail

SRC="${1:-/home/hakcer/projects/23studios/docs/hakcd_title.png}"
LAUNCHER_DIR="${2:-/home/hakcer/projects/personal/hakcd/source/launcher}"

mkdir -p "$LAUNCHER_DIR"

convert "$SRC" -resize 350x155^ -gravity center -extent 350x155 \
  -ordered-dither o4x4 -monochrome -define png:bit-depth=1 -define png:color-type=0 \
  "$LAUNCHER_DIR/card.png"

convert "$SRC" -resize 32x32^ -gravity center -extent 32x32 \
  -ordered-dither o4x4 -monochrome -define png:bit-depth=1 -define png:color-type=0 \
  "$LAUNCHER_DIR/icon.png"

convert "$SRC" -resize 400x240^ -gravity center -extent 400x240 \
  -ordered-dither o4x4 -monochrome -define png:bit-depth=1 -define png:color-type=0 \
  "$LAUNCHER_DIR/launchImage.png"

echo "Launcher assets rebuilt from canonical:"
file "$LAUNCHER_DIR/card.png" "$LAUNCHER_DIR/icon.png" "$LAUNCHER_DIR/launchImage.png"
