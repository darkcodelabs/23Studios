# Visual Pack Factory

Authored-feeling Playdate visual production pipeline. Shared service for any
23 Studios project. Drives V4 (sprite replacement), V5 (tiles), V6 (room art),
V7 (room art), and V8 (UI refactor) in HAKCD; reusable for every other game on
the platform.

## Why this exists

Old pipeline shipped technically-valid garbage:
- placeholder sprites became canonical
- procedural debug visuals masqueraded as art
- validator gated IDs but not readability / silhouette / composition

This factory gates **art status** behind human review. Generated assets cannot
become `approved_final` without a recorded human signoff and a hardware review.

## Architecture

```
┌──────────────────────────────────────────────┐
│ 23 Studios server (Node)                     │
│   routes/visual_pack.js                      │
│   services/visual_pack.js                    │
│      └─ spawn() ───────────┐                 │
└────────────────────────────┼─────────────────┘
                             ▼
            ┌──────────────────────────────────┐
            │ visual_pack_factory (Python)     │
            │   tools/add_source.py            │
            │   tools/init_pack.py             │
            │   tools/queue_review.py          │
            │   tools/approve_candidate.py     │
            │   tools/reject_candidate.py      │
            │   tools/export_candidate.py      │
            │   tools/build_contact_sheet.py   │
            │   tools/validate_pack.py         │
            │   tools/update_visual_spec.py    │
            │   tools/convert_to_playdate.py   │
            │   tools/hardware_review.py       │
            │   tools/build_reference_board.py │
            │   tools/extract_style_notes.py   │
            └──────────────────────────────────┘
```

## Per-project state

Pack state lives outside any game repo:

```
server/data/visual_packs/<projectId>/
  pack_config.yaml
  style/style_guide.md
  references/
  inbox/
  sources/source_registry.yaml
  prompts/
  candidates/<packId>/
  reviews/
    review_queue.yaml
    approvals.yaml
    rejections.yaml
    correction_notes/
  exports/approved/
```

Approved assets are written into the *game repo* at export time:

```
<project.local_path>/source/images/<asset>.png
<project.local_path>/source/data/visual_spec.lua
```

## States

```
generated → queued_for_review → approved_for_iteration ↘
                              ↘ rejected                 → approved_final
                              ↘ needs_correction              ↓
                                                        hardware_reviewed
                                                              ↓
                                                          exported
```

Generated → final is **forbidden** without human signoff.

## Install

```bash
cd /home/hakcer/projects/23studios/services/visual_pack_factory
./installer.sh
```

Creates `.venv-visual-pack`, installs deps. ImageMagick used only for the
Playdate 1-bit conversion step — never for generation.

## CLI examples

```bash
# Bootstrap a new pack for HAKCD
python -m tools.init_pack --project hakcd --pack newb_character_pack \
    --type character_pack --target-dim 48x48

# Add inspiration reference
python -m tools.add_source --project hakcd --pack newb_character_pack \
    --file ./ref.png --usage inspiration_only \
    --notes "chunky silhouette"

# Queue for human review
python -m tools.queue_review --project hakcd --pack newb_character_pack

# Approve a candidate
python -m tools.approve_candidate --project hakcd \
    --candidate newb_character_v003_b

# Export approved candidate to game repo
python -m tools.export_candidate --project hakcd \
    --candidate newb_character_v003_b

# Validate the whole pack
python -m tools.validate_pack --project hakcd
```

## REST API

All routes mounted at `/api/projects/:id/visual-pack`:

```
GET    /packs
POST   /packs/:packId/init
POST   /packs/:packId/sources
GET    /packs/:packId/candidates
POST   /packs/:packId/candidates                     (multipart upload)
POST   /packs/:packId/candidates/:cid/approve
POST   /packs/:packId/candidates/:cid/reject
POST   /packs/:packId/candidates/:cid/correction
POST   /packs/:packId/candidates/:cid/export
POST   /packs/:packId/contact-sheet
POST   /packs/:packId/validate
POST   /packs/:packId/hardware-review
```

## Hardware-first rule

Simulator screenshots do not count. `tools/hardware_review.py` records device
photos + reviewer notes against a candidate. `validate_pack.py` flags any
asset flagged `art_status=approved_final` without a matching
`hardware_reviewed=true`.

## Anti-patterns (validator-enforced)

- candidate file present with `art_status=approved_final` and `human_reviewed=false`
- approved asset without `hardware_reviewed=true` (after v0.2.0)
- tracing or 1:1 recreation of any copyrighted reference
- procedural debug visuals exported as final
- global ordered dithering applied during export
- asset dimension mismatch vs `target_dimensions`
- exported PNG containing any colour other than pure black (0,0,0) or pure white (255,255,255) — Playdate is 1-bit; greys and anti-aliased edges fail `not_1bit_color`

## visual_spec.lua emission (V3 schema, hakcd-side compatible)

`tools/update_visual_spec.py` regenerates the consuming game repo's
`source/data/visual_spec.lua` after every export. It emits entries shaped
the way HAKCD's `tools/canon/validate_visuals.sh` reads them:

```lua
local visual_spec = {
    newb_character_pack_v003_b = {
        art_status = "final",
        type = "image",
        path = "images/newb-table-48-48",     -- relative, no extension
        sheet_dimensions = { w = 48, h = 48 },
        target_dimensions = { w = 48, h = 48 },
        human_reviewed = true,
        reviewer = "cory",
        reviewed_at = "2026-05-26T12:00:00+00:00",
        meets_readability_min = true,
        frame_count = 1,
        notes = "Authored via visual_pack_factory pack 'newb_character_pack'.",
        id = "newb_character_pack_v003_b",
        -- factory ownership markers — V3 ignores unknown fields:
        source_pack = "newb_character_pack",
        approved_candidate = "newb_character_pack_v003_b",
        hardware_reviewed = true,
        exported_to = "/abs/path/to/newb-table-48-48.png",
    },
}
```

Ownership: an entry is factory-owned iff its block contains
`source_pack = "..."`. Hand-authored entries (audio, debug fixtures,
hand-finalized art) without that marker are preserved verbatim across
regenerations. An id collision between a factory candidate and a
hand-authored entry is a hard `id_collision_with_unmanaged_entry` error
unless `--allow-overwrite-unmanaged` is passed.

Pack-type → V3 `type` mapping (override per-pack with `--asset-type`):

| pack `type` | default V3 `type` |
|---|---|
| `character_pack`, `room_pack`, `prop_pack`, `ui_pack` | `image` |
| `tile_pack` | `tileset` |
| `animation_pack` | `imagetable` |
