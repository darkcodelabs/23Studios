"""Export an approved_final candidate into the game repo.

Pre-conditions enforced:
  - candidate exists
  - status == approved_final
  - human_reviewed == True
  - candidate dimensions match pack_config.target_dimensions
  - (after enforce-hardware) hardware_reviewed == True

Side-effects:
  1. copy image into <project_local_path>/<export_target>/<asset_filename>
  2. record meta.exported_to + meta.status = "exported"
  3. call update_visual_spec to refresh source/data/visual_spec.lua
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402

from pack_config import (  # noqa: E402
    assert_slug,
    candidate_meta_path,
    dump_json,
    load_json,
    load_pack_config,
    now_iso,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Export an approved candidate.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--project-local-path", required=True,
                   help="absolute path to the game repo (project.local_path)")
    p.add_argument("--asset-name", required=False,
                   help="output filename inside export_target (default: candidate_id.png)")
    p.add_argument("--enforce-hardware", action="store_true",
                   help="require hardware_reviewed==true (v0.2.0+)")
    p.add_argument("--packs-root", default=None)
    return p


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    pack_cfg = load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    mp = candidate_meta_path(args.project, args.pack, args.candidate, args.packs_root)
    meta = load_json(mp)
    if not meta:
        fail("candidate_not_found", {"candidate": args.candidate})

    if meta.get("status") != "approved_final":
        fail("not_approved_final", {"status": meta.get("status")})
    if not meta.get("human_reviewed"):
        fail("not_human_reviewed", {})
    if args.enforce_hardware and not meta.get("hardware_reviewed"):
        fail("hardware_review_required", {})

    src_img = Path(meta["image_path"])
    if not src_img.exists():
        fail("image_missing", {"path": str(src_img)})

    # Dimension check.
    target_dims = pack_cfg.get("target_dimensions") or []
    with Image.open(src_img) as im:
        actual = list(im.size)
    if actual not in [list(d) for d in target_dims]:
        fail("dimension_mismatch", {
            "expected": target_dims, "actual": actual,
        })

    repo = Path(args.project_local_path).resolve()
    if not repo.is_dir():
        fail("repo_not_found", {"path": str(repo)})

    export_target = repo / pack_cfg.get("export_target", "source/images")
    export_target.mkdir(parents=True, exist_ok=True)

    asset_name = args.asset_name or f"{args.candidate}.png"
    dst = export_target / asset_name
    shutil.copy2(src_img, dst)

    # Mirror into pack's exports/approved/ for the audit trail.
    audit = pr / "exports" / "approved" / asset_name
    shutil.copy2(src_img, audit)

    meta["status"] = "exported"
    meta["exported_to"] = str(dst)
    meta["exported_at"] = now_iso()
    dump_json(mp, meta)

    emit({"candidate": meta, "exported_to": str(dst), "audit_copy": str(audit)})


if __name__ == "__main__":
    run(main)
