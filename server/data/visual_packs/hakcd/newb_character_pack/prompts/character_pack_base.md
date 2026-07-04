# character_pack base prompt

## Identity
- project: {{project_id}}
- pack: {{pack_id}}
- character: TBD (replace before use)

## Required output
- native target dimensions: {{target_dimensions}}
- 1-bit black and white only
- no anti-aliasing
- strong silhouette readable at hardware scale
- oversized readable head; chunky readable hands + feet
- stable animation anchors (foot, hand, eye)

## Style hooks
- perspective: three-quarter top-down
- outline: consistent weight across pack
- dither: NONE on character body; allowed only on attached shadow

## Negative
- thin limbs
- detail noise replacing form
- copyrighted character likeness

## Source-usage clause
Sources listed in `sources/source_registry.yaml` are INSPIRATION ONLY. Do not
trace; do not recreate identifying features. Borrow silhouette language,
contrast, scale, line weight only.
