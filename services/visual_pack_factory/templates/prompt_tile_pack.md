# tile_pack base prompt

## Identity
- project: {{project_id}}
- pack: {{pack_id}}

## Required output
- tile size: {{target_dimensions}} (24x24 or 32x32 recommended)
- 1-bit black and white only
- edges tile cleanly N/S/E/W without seams
- silhouette reads at 1x and 2x zoom

## Style hooks
- dither: bayer4 ONLY (Floyd-Steinberg destroys tile readability)
- outline: sufficient contrast against adjacent tiles

## Negative
- noise that breaks tiling
- thin lines that disappear at hardware
