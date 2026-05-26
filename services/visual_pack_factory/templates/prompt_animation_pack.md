# animation_pack base prompt

## Identity
- project: {{project_id}}
- pack: {{pack_id}}

## Required output
- frame sheet, native size {{target_dimensions}}
- consistent anchor across frames (same foot/hand pivot)
- timing metadata documented in pack notes
- silhouette reads in every frame, not just key poses

## Style hooks
- single key-light direction
- dither only on attached shadow, not body

## Negative
- frame-to-frame anchor jitter
- detail noise replacing motion
