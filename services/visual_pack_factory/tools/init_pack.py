"""Bootstrap a new visual pack for a project.

Creates the directory skeleton, writes pack_config.yaml, seeds an empty
style_guide.md and a per-pack-type base prompt placeholder, and initializes
the review/approval/rejection logs.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    PACK_TYPES,
    assert_slug,
    dump_yaml,
    ensure_pack_skeleton,
    now_iso,
    pack_root,
    save_pack_config,
)
from tools._common import emit, fail, run  # noqa: E402


TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Initialize a new visual pack.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True, help="pack id (slug)")
    p.add_argument("--type", required=True, choices=sorted(PACK_TYPES))
    p.add_argument("--target-dim", required=True,
                   help="WxH e.g. 48x48 (or comma list 48x48,64x64 for animation_pack)")
    p.add_argument("--description", default="")
    p.add_argument("--export-target", default="source/images",
                   help="relative export path inside project repo (e.g. source/images)")
    p.add_argument("--asset-type", default=None,
                   choices=["image", "imagetable", "tileset", "sfx", "music"],
                   help="V3 visual_spec.lua `type` enum for assets exported from this pack. "
                        "Defaults derive from --type: character/room/prop/ui_pack→image, "
                        "tile_pack→tileset, animation_pack→imagetable.")
    p.add_argument("--packs-root", default=None)
    return p


def parse_dims(s: str):
    out = []
    for tok in s.split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            w, h = tok.lower().split("x")
            out.append([int(w), int(h)])
        except Exception as e:
            raise ValueError(f"bad target-dim token {tok!r}: {e}")
    if not out:
        raise ValueError("at least one target-dim required")
    return out


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    dims = parse_dims(args.target_dim)

    pr = pack_root(args.project, args.pack, args.packs_root)
    if (pr / "pack_config.yaml").exists():
        fail("pack_exists", {"path": str(pr)})

    ensure_pack_skeleton(args.project, args.pack, args.packs_root)

    cfg = {
        "pack_id": args.pack,
        "project_id": args.project,
        "type": args.type,
        "description": args.description,
        "target_dimensions": dims,
        "export_target": args.export_target,
        "asset_type": args.asset_type,
        "created_at": now_iso(),
        "schema_version": 2,
    }
    save_pack_config(args.project, args.pack, cfg, args.packs_root)

    # Seed empty registries.
    dump_yaml(pr / "sources" / "source_registry.yaml", [])
    dump_yaml(pr / "reviews" / "review_queue.yaml", [])
    dump_yaml(pr / "reviews" / "approvals.yaml", [])
    dump_yaml(pr / "reviews" / "rejections.yaml", [])

    # Seed style guide if missing.
    style_guide = pr / "style" / "style_guide.md"
    if not style_guide.exists():
        tmpl = TEMPLATES_DIR / "style_guide.md"
        if tmpl.exists():
            style_guide.write_text(tmpl.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            style_guide.write_text(f"# {args.pack} Style Guide\n\nTBD.\n", encoding="utf-8")

    # Seed base prompt per type if template exists.
    base_prompt = pr / "prompts" / f"{args.type}_base.md"
    if not base_prompt.exists():
        tmpl = TEMPLATES_DIR / f"prompt_{args.type}.md"
        if tmpl.exists():
            base_prompt.write_text(tmpl.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            base_prompt.write_text(f"# {args.type} base prompt\n\nTBD.\n", encoding="utf-8")

    emit({"pack": cfg, "root": str(pr)})


if __name__ == "__main__":
    run(main)
