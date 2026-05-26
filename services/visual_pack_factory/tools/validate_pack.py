"""Validate a single pack or every pack in a project.

Checks:
  - pack_config.yaml present
  - style/style_guide.md present + non-empty
  - every candidate JSON references an existing image
  - no asset is approved_final without human_reviewed
  - no asset is exported without dimensions matching target_dimensions
  - any approved_final/exported PNG is pure 1-bit (only RGB 0,0,0 / 255,255,255)
  - (after --enforce-hardware) every approved_final has hardware_reviewed
  - no source has usage other than inspiration_only

Exit code 0 = pass, 2 = warnings only, 3 = errors (build-blocking).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402

from pack_config import (  # noqa: E402
    assert_slug,
    iter_candidates,
    list_packs,
    load_pack_config,
    load_yaml,
    pack_root,
)
from tools._common import emit  # noqa: E402


PURE_1BIT_COLORS = {(0, 0, 0), (255, 255, 255)}


def _check_1bit(im: "Image.Image") -> list[tuple]:
    """Return any RGB colors present in the image that are NOT pure 1-bit.

    Playdate ships 1-bit only. Greys, ditherless anti-aliased edges, and any
    non-(0,0,0) / non-(255,255,255) pixel must be caught before export. This
    is a hard error — neither the V3 hakcd-side validator nor the legacy
    factory validator checked it, which is how grey-ramp art slipped through
    in the past.
    """
    converted = im.convert("RGB")
    # getcolors caps at maxcolors; bump high enough to surface anything weird.
    colors = converted.getcolors(maxcolors=1 << 16) or []
    bad = [c for _count, c in colors if tuple(c) not in PURE_1BIT_COLORS]
    return bad[:8]  # cap report so emit payload stays sane


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Validate visual pack(s).")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", default=None, help="single pack id; default: all packs")
    p.add_argument("--enforce-hardware", action="store_true",
                   help="require hardware_reviewed for every approved_final")
    p.add_argument("--packs-root", default=None)
    return p


def validate_one(project: str, pack_id: str, enforce_hw: bool,
                 packs_root_override: str | None):
    errors: list[dict] = []
    warnings: list[dict] = []
    cfg = load_pack_config(project, pack_id, packs_root_override)
    pr = pack_root(project, pack_id, packs_root_override)

    style = pr / "style" / "style_guide.md"
    if not style.exists() or style.stat().st_size < 16:
        warnings.append({"code": "style_guide_thin", "pack": pack_id})

    registry = load_yaml(pr / "sources" / "source_registry.yaml") or []
    for s in registry:
        if s.get("usage") != "inspiration_only":
            errors.append({"code": "non_inspiration_usage", "source": s.get("source_id")})

    target_dims = [list(d) for d in (cfg.get("target_dimensions") or [])]

    for meta in iter_candidates(project, pack_id, packs_root_override):
        cid = meta.get("candidate_id")
        img = meta.get("image_path")
        if not img or not Path(img).exists():
            errors.append({"code": "image_missing", "candidate": cid})
            continue

        if meta.get("status") == "approved_final" and not meta.get("human_reviewed"):
            errors.append({"code": "final_not_reviewed", "candidate": cid})

        if meta.get("status") in {"approved_final", "exported"}:
            with Image.open(img) as im:
                size = list(im.size)
                if Path(img).suffix.lower() == ".png":
                    rgb_violation = _check_1bit(im)
                    if rgb_violation:
                        errors.append({
                            "code": "not_1bit_color",
                            "candidate": cid,
                            "offending_colors": rgb_violation,
                        })
            if size not in target_dims:
                errors.append({"code": "dim_mismatch", "candidate": cid,
                               "expected": target_dims, "actual": size})

        if enforce_hw and meta.get("status") == "approved_final" \
                and not meta.get("hardware_reviewed"):
            errors.append({"code": "missing_hardware_review", "candidate": cid})

    return {"pack_id": pack_id, "errors": errors, "warnings": warnings}


def main(args: argparse.Namespace):
    assert_slug(args.project, "project")
    reports = []
    if args.pack:
        assert_slug(args.pack, "pack")
        reports.append(validate_one(args.project, args.pack, args.enforce_hardware,
                                    args.packs_root))
    else:
        for cfg in list_packs(args.project, args.packs_root):
            reports.append(validate_one(args.project, cfg["pack_id"],
                                        args.enforce_hardware, args.packs_root))

    n_err = sum(len(r["errors"]) for r in reports)
    n_warn = sum(len(r["warnings"]) for r in reports)
    emit({"reports": reports, "errors": n_err, "warnings": n_warn})
    if n_err:
        sys.exit(3)
    if n_warn:
        sys.exit(2)


if __name__ == "__main__":
    parser = build_parser()
    main(parser.parse_args())
