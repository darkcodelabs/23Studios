"""Idempotently initialize the 5 HAKCD packs required by the visual sprint.

Runs init_pack for each:
  - newb_character_pack         48x48 character
  - bedroom_room_pack           400x240 room
  - playground_room_pack        400x240 room
  - hacker_arcade_props_pack    32x32 props
  - bbs_ui_pack                 400x240 ui

Safe to re-run: an existing pack_config.yaml is treated as already-seeded
and skipped (not an error). Other init failures surface as exceptions.

Usage:
    python -m tools.seed_hakcd_packs
    VISUAL_PACKS_ROOT=/custom python -m tools.seed_hakcd_packs
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import pack_root  # noqa: E402
from tools._common import emit, run  # noqa: E402
from tools import init_pack as init_pack_tool  # noqa: E402

PACK_SPECS_DIR = Path(__file__).resolve().parents[1] / "pack_specs"

# Packs whose style guide + base prompt should be installed from pack_specs/.
# Other packs get the generic template scaffold from init_pack.
SPEC_OVERRIDES = {
    "powerglove_arcade_room_pack": "powerglove_arcade_room_pack.md",
    "newb_v2_character_pack": "newb_v2_character_pack.md",
}


HAKCD_PACKS = [
    {
        "pack": "newb_character_pack",
        "type": "character_pack",
        "target_dim": "48x48",
        "description": "Newb protagonist sprite (V4 replacement).",
        "asset_type": "image",
    },
    {
        "pack": "newb_v2_character_pack",
        "type": "character_pack",
        "target_dim": "64x64",
        "description": "Newb v2: larger silhouette, chunkier proportions, readable hands/feet.",
        "asset_type": "image",
    },
    {
        "pack": "bedroom_room_pack",
        "type": "room_pack",
        "target_dim": "400x240",
        "description": "Bedroom scene background (V6 rebuild).",
        "asset_type": "image",
    },
    {
        "pack": "playground_room_pack",
        "type": "room_pack",
        "target_dim": "400x240",
        "description": "Playground scene background (V7 rebuild).",
        "asset_type": "image",
    },
    {
        "pack": "powerglove_arcade_room_pack",
        "type": "room_pack",
        "target_dim": "400x240",
        "description": "Powerglove Arcade Hub — atmospheric vertical-slice benchmark room.",
        "asset_type": "image",
    },
    {
        "pack": "hacker_arcade_props_pack",
        "type": "prop_pack",
        "target_dim": "32x32",
        "description": "Arcade-era prop sprites (terminals, cassettes, CRTs).",
        "asset_type": "image",
    },
    {
        "pack": "bbs_ui_pack",
        "type": "ui_pack",
        "target_dim": "400x240",
        "description": "BBS-style UI chrome elements (V8 refactor).",
        "asset_type": "image",
    },
]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Seed the 5 HAKCD visual packs.")
    p.add_argument("--project", default="hakcd")
    p.add_argument("--packs-root", default=None)
    return p


def install_spec(pack_id: str, pack_type: str, pr) -> bool:
    """Install authored composition spec into the pack if pack_specs/ carries one.

    Writes the spec as the base prompt (LLMs read this) AND symlinks it as the
    style guide so the two stay in sync. Idempotent — overwrites existing
    template scaffold but does not touch handwritten content because the
    spec files are version-controlled in pack_specs/.
    """
    src_name = SPEC_OVERRIDES.get(pack_id)
    if not src_name:
        return False
    src = PACK_SPECS_DIR / src_name
    if not src.exists():
        return False
    base_prompt = pr / "prompts" / f"{pack_type}_base.md"
    style_guide = pr / "style" / "style_guide.md"
    base_prompt.parent.mkdir(parents=True, exist_ok=True)
    style_guide.parent.mkdir(parents=True, exist_ok=True)
    text = src.read_text(encoding="utf-8")
    base_prompt.write_text(text, encoding="utf-8")
    style_guide.write_text(text, encoding="utf-8")
    return True


def main(args: argparse.Namespace) -> None:
    seeded: list[str] = []
    skipped: list[str] = []
    specs_installed: list[str] = []
    for spec in HAKCD_PACKS:
        pr = pack_root(args.project, spec["pack"], args.packs_root)
        if (pr / "pack_config.yaml").exists():
            skipped.append(spec["pack"])
        else:
            init_args = argparse.Namespace(
                project=args.project,
                pack=spec["pack"],
                type=spec["type"],
                target_dim=spec["target_dim"],
                description=spec["description"],
                export_target="source/images",
                asset_type=spec["asset_type"],
                packs_root=args.packs_root,
            )
            init_pack_tool.main(init_args)
            seeded.append(spec["pack"])
        if install_spec(spec["pack"], spec["type"], pr):
            specs_installed.append(spec["pack"])
    emit({
        "seeded": seeded,
        "skipped": skipped,
        "specs_installed": specs_installed,
        "total": len(HAKCD_PACKS),
    })


if __name__ == "__main__":
    run(main)
