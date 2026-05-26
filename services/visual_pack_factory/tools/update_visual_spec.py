"""Regenerate <project_repo>/source/data/visual_spec.lua from exported candidates.

Walks every pack for the project, finds candidates with status in
{approved_final, exported}, and emits a Lua table entry per asset using the
V3 schema that hakcd-v4's tools/canon/validate_visuals.sh consumes:

    local visual_spec = {
        <bareword_id> = {
            art_status = "final",
            type = "image" | "imagetable" | "sfx" | "music" | "tileset",
            path = "images/<basename>",          -- relative, no extension
            sheet_dimensions = { w = ..., h = ... },
            target_dimensions = { w = ..., h = ... },
            human_reviewed = true,
            reviewer = "...",
            reviewed_at = "...",
            meets_readability_min = true,
            frame_count = 1,
            target_replacement_version = nil,
            notes = "Authored via visual_pack_factory pack '<pack_id>'.",
            id = "<id>",
            -- factory ownership markers (V3 parser ignores unknown fields):
            source_pack = "<pack_id>",
            approved_candidate = "<candidate_id>",
            hardware_reviewed = true | false,
            exported_to = "/abs/path/to/asset.png",
        },
        ...
    }

Hand-authored entries (no `source_pack` field) are preserved verbatim across
regenerations. An id collision between a factory candidate and a
hand-authored entry is treated as an error unless --allow-overwrite-unmanaged
is passed.

This file is what hakcd-v4's tools/canon/validate_visuals.sh inspects.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    assert_slug,
    iter_candidates,
    list_packs,
)
from tools._common import emit, fail, run  # noqa: E402
from tools._spec_merge import merge, parse_spec, render, render_entry  # noqa: E402


# pack.type → V3 `type` enum. Pack configs may override via pack_config.asset_type.
PACK_TYPE_TO_V3_TYPE = {
    "character_pack": "image",
    "room_pack": "image",
    "prop_pack": "image",
    "ui_pack": "image",
    "tile_pack": "tileset",
    "animation_pack": "imagetable",
}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Regenerate visual_spec.lua.")
    p.add_argument("--project", required=True)
    p.add_argument("--project-local-path", required=True)
    p.add_argument("--spec-relpath", default="source/data/visual_spec.lua")
    p.add_argument("--packs-root", default=None)
    p.add_argument(
        "--allow-overwrite-unmanaged",
        action="store_true",
        help="overwrite hand-authored entries when ids collide (default: fail)",
    )
    return p


def derive_v3_type(pack_cfg: dict) -> str:
    explicit = pack_cfg.get("asset_type")
    if explicit:
        return explicit
    return PACK_TYPE_TO_V3_TYPE.get(pack_cfg.get("type"), "image")


def derive_relative_path(exported_to: str, repo: Path) -> str:
    """Strip <repo>/source/ prefix and file extension.

    /home/.../hakcd-v4/source/images/newb-table-48-48.png
        → images/newb-table-48-48
    """
    p = Path(exported_to).resolve()
    try:
        rel = p.relative_to(repo / "source")
    except ValueError:
        # Not under <repo>/source — fall back to path stem under last 2 segs.
        rel = Path(*p.parts[-2:])
    # Strip extension.
    parent = rel.parent
    stem = rel.stem
    if str(parent) == ".":
        return stem
    return f"{parent}/{stem}".replace("\\", "/")


def dims_to_wh(dims) -> dict:
    """[[48,48]] or [48,48] → {"w": 48, "h": 48}. First entry wins."""
    if not dims:
        return {}
    first = dims[0] if isinstance(dims[0], (list, tuple)) else dims
    return {"w": int(first[0]), "h": int(first[1])}


def build_entry_block(
    candidate_meta: dict,
    pack_cfg: dict,
    repo: Path,
) -> tuple[str, str]:
    """Return (entry_id, lua_block_text) for one exported candidate."""
    asset_id = candidate_meta["candidate_id"]
    v3_type = derive_v3_type(pack_cfg)
    exported_to = candidate_meta.get("exported_to") or ""
    rel_path = derive_relative_path(exported_to, repo) if exported_to else ""
    wh = dims_to_wh(candidate_meta.get("target_dimensions") or pack_cfg.get("target_dimensions"))
    frame_count = 1 if v3_type == "image" else None

    fields = {
        "id": asset_id,
        "type": v3_type,
        "path": rel_path,
        "art_status": "final",
        "human_reviewed": True,
        "reviewer": candidate_meta.get("approved_by") or "",
        "reviewed_at": candidate_meta.get("approved_at") or "",
        "meets_readability_min": True,
        "readability_min_pct_screen": 0,
        "reference_image": None,
        "target_replacement_version": None,
        "frame_count": frame_count,
        "notes": (
            f"Authored via visual_pack_factory pack '{pack_cfg.get('pack_id')}'."
        ),
        "sheet_dimensions": wh,
        "target_dimensions": wh,
        # Ownership markers — V3 parser ignores unknown fields.
        "source_pack": pack_cfg.get("pack_id"),
        "approved_candidate": asset_id,
        "hardware_reviewed": bool(candidate_meta.get("hardware_reviewed")),
        "exported_to": exported_to or None,
    }
    return asset_id, render_entry(asset_id, fields)


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    repo = Path(args.project_local_path).resolve()
    if not repo.is_dir():
        fail("repo_not_found", {"path": str(repo)})

    # Build new (factory-owned) entries from approved/exported candidates.
    new_entries: dict[str, str] = {}
    candidate_count = 0
    for cfg in list_packs(args.project, args.packs_root):
        pid = cfg["pack_id"]
        for meta in iter_candidates(args.project, pid, args.packs_root):
            if meta.get("status") not in {"approved_final", "exported"}:
                continue
            eid, block = build_entry_block(meta, cfg, repo)
            new_entries[eid] = block
            candidate_count += 1

    spec_path = repo / args.spec_relpath
    spec_path.parent.mkdir(parents=True, exist_ok=True)

    parsed = parse_spec(spec_path)
    merged, conflicts = merge(
        parsed,
        new_entries,
        allow_overwrite_unmanaged=args.allow_overwrite_unmanaged,
    )

    if conflicts:
        fail(
            "id_collision_with_unmanaged_entry",
            {
                "ids": conflicts,
                "hint": (
                    "Factory candidate ids collide with hand-authored entries in "
                    "visual_spec.lua. Rename the candidates or pass "
                    "--allow-overwrite-unmanaged to replace the hand-authored "
                    "entries."
                ),
            },
        )

    spec_path.write_text(render(merged), encoding="utf-8")
    emit({
        "spec_path": str(spec_path),
        "entry_count": len(merged.entries),
        "factory_owned": sum(1 for e in merged.entries.values() if e.factory_owned),
        "preserved": sum(1 for e in merged.entries.values() if not e.factory_owned),
        "candidates_seen": candidate_count,
    })


if __name__ == "__main__":
    run(main)
