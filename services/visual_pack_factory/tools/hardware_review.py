"""Attach a hardware review record (device photo + notes) to a candidate.

This is the ONLY path to set hardware_reviewed=true. Simulator screenshots
do not count. validate_pack at --enforce-hardware will flag any
approved_final without a hardware record.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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
    p = argparse.ArgumentParser(description="Record a hardware review.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--photo", required=True,
                   help="path to device photo (NOT a simulator screenshot)")
    p.add_argument("--reviewer", required=True)
    p.add_argument("--verdict", choices=["pass", "fail"], default="pass")
    p.add_argument("--notes", default="")
    p.add_argument("--packs-root", default=None)
    return p


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    mp = candidate_meta_path(args.project, args.pack, args.candidate, args.packs_root)
    meta = load_json(mp)
    if not meta:
        fail("candidate_not_found", {"candidate": args.candidate})
    if meta.get("status") not in {"approved_final", "exported"}:
        fail("hardware_review_only_for_final", {"status": meta.get("status")})

    src = Path(args.photo).resolve()
    if not src.exists():
        fail("photo_not_found", {"path": str(src)})

    digest = hashlib.sha256(src.read_bytes()).hexdigest()[:12]
    ext = src.suffix.lower() or ".png"
    dst = pr / "exports" / "hardware_review" / f"{args.candidate}_{digest}{ext}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

    record = {
        "photo": str(dst),
        "reviewer": args.reviewer,
        "verdict": args.verdict,
        "notes": args.notes,
        "at": now_iso(),
    }
    meta.setdefault("hardware_reviews", []).append(record)
    meta["hardware_reviewed"] = args.verdict == "pass"
    dump_json(mp, meta)

    emit({"candidate": meta, "record": record})


if __name__ == "__main__":
    run(main)
