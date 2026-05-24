#!/usr/bin/env bash
# tools/build_playground_bg.sh
# Builds the PWNGLOVE MODE playground background (9-station 1-bit dithered
# 400x180 PNG) using ImageMagick primitives. No AI generation — pure draw
# commands so the output is deterministic and reproducible.
#
# Output: personal/hakcd/source/images/scenes/pwnglove_playground.png

set -euo pipefail

OUT="${1:-/home/hakcer/projects/personal/hakcd/source/images/scenes/pwnglove_playground.png}"
mkdir -p "$(dirname "$OUT")"

convert -size 400x180 xc:white \
  -fill white -stroke black -strokewidth 1 \
  -draw "rectangle 6,6 394,174" \
  \
  `# 1. LOCKPICK STATION (top-left)` \
  -fill "#ddd" -draw "rectangle 12,40 100,75" \
  -fill black -strokewidth 0 -draw "rectangle 14,44 18,72 rectangle 22,44 26,72 rectangle 30,44 34,72 rectangle 38,44 42,72 rectangle 46,44 50,72 rectangle 54,44 58,72 rectangle 62,44 66,72 rectangle 70,44 74,72 rectangle 78,44 82,72 rectangle 86,44 90,72 rectangle 94,44 98,72" \
  -strokewidth 1 -stroke black -fill white \
  -draw "circle 56,58 56,46" \
  -draw "line 56,58 56,52" \
  \
  `# 2. RFID PEDESTAL (row 1, col 2)` \
  -draw "rectangle 130,38 200,80" \
  -fill black -stroke none -draw "circle 165,52 165,46 rectangle 160,55 170,72" \
  -fill white -stroke black -draw "circle 165,52 168,49" \
  -draw "rectangle 178,60 196,76" \
  -fill black -strokewidth 0 -draw "circle 187,68 191,68" \
  \
  `# 3. PAYPHONE (row 1, col 3)` \
  -fill white -stroke black -strokewidth 1 -draw "rectangle 230,38 300,80" \
  -fill "#ccc" -draw "rectangle 232,40 298,52" \
  -fill black -draw "rectangle 245,42 285,50" \
  -fill white -stroke black -draw "rectangle 240,55 255,75" \
  -draw "circle 247,62 252,62" -draw "circle 247,67 252,67" -draw "circle 247,72 252,72" \
  -draw "line 290,55 290,40 line 290,40 280,40 line 280,40 280,55" \
  \
  `# 4. IR WALL (row 1, col 4)` \
  -draw "rectangle 330,40 392,80" \
  -fill "#bbb" -draw "rectangle 336,46 365,68" \
  -fill black -draw "rectangle 338,48 363,64" \
  -fill white -draw "rectangle 340,50 361,62" \
  -fill black -strokewidth 1 -draw "rectangle 345,52 357,60" \
  -draw "rectangle 370,46 388,76" \
  -fill white -draw "circle 379,55 382,55" -draw "circle 379,62 382,62" \
  -draw "line 379,69 379,73" \
  \
  `# 5. GRAVITY ARENA (row 2, col 1)` \
  -fill white -draw "rectangle 12,100 100,140" \
  -fill black -draw "circle 30,118 33,118" \
  -draw "rectangle 50,115 65,122" \
  -draw "rectangle 78,108 92,126" \
  -fill white -stroke "#666" -strokewidth 2 -draw "circle 56,135 75,135" \
  -strokewidth 1 -stroke black \
  \
  `# 6. SUBGHZ TUNER (row 2, col 2)` \
  -fill white -draw "rectangle 130,100 200,140" \
  -fill "#999" -draw "rectangle 134,104 196,130" \
  -fill black -draw "line 134,108 196,108 line 134,114 196,114 line 134,120 196,120 line 134,126 196,126" \
  -fill white -stroke black -draw "circle 185,134 188,134" \
  -draw "line 178,134 178,138 line 180,138 175,140" \
  \
  `# 7. PORTAL PEDESTAL (row 2, col 3)` \
  -fill white -draw "rectangle 230,100 300,140" \
  -fill "#222" -draw "ellipse 265,121 18,16 0,360" \
  -fill white -draw "ellipse 265,121 14,12 0,360" \
  -fill black -draw "text 254,124 'WARP'" \
  -fill white -stroke "#999" -draw "rectangle 240,103 290,108" \
  \
  `# 8. COIN VAULT (row 2, col 4) - 4x3 mini coin grid` \
  -fill white -stroke black -draw "rectangle 330,100 392,140" \
  -fill black -draw "rectangle 335,107 388,135" \
  -fill white -draw "rectangle 337,109 386,133" \
  -fill black -draw "rectangle 339,111 348,116 rectangle 350,111 359,116 rectangle 361,111 370,116 rectangle 372,111 381,116 rectangle 339,118 348,123 rectangle 350,118 359,123 rectangle 361,118 370,123 rectangle 372,118 381,123 rectangle 339,125 348,130 rectangle 350,125 359,130 rectangle 361,125 370,130 rectangle 372,125 381,130" \
  \
  `# 9. TYSON ARCADE CABINET (bottom center)` \
  -fill white -stroke black -draw "rectangle 175,148 285,176" \
  -fill black -draw "rectangle 178,150 282,158" \
  -fill white -draw "text 187,156 'MIKE TYSON'" \
  -fill black -draw "rectangle 180,160 280,172" \
  -fill white -draw "text 198,168 'INSERT COIN'" \
  \
  `# Title banner` \
  -fill black -stroke none -draw "text 30,12 'PWNGLOVE  MODE  PLAYGROUND'" \
  \
  -ordered-dither o4x4 -monochrome \
  -define png:bit-depth=1 -define png:color-type=0 \
  "$OUT"

echo "Wrote $OUT"
file "$OUT"
