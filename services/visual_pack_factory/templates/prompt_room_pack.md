# room_pack base prompt

## Identity
- project: {{project_id}}
- pack: {{pack_id}}
- room: TBD

## Required output
- background dimensions: {{target_dimensions}}
- 1-bit black and white only
- focal point obvious in first glance
- grouped interactables
- collision-friendly silhouettes (no ambiguous floor / wall transitions)
- environmental storytelling (no empty rooms)

## Style hooks
- perspective: three-quarter top-down (match style_guide.md)
- dither: allowed on fog, CRT glow, rough materials; FORBIDDEN as global texture
- lighting: single dominant key

## Negative
- repeating carpet fields
- debug-tilemap energy
- modern UI chrome
- detail noise replacing composition
