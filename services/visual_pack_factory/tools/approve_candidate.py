"""Approve a candidate for either iteration or final use.

Two levels of approval:
  --level iteration   approved_for_iteration (still working it)
  --level final       approved_final         (locked; eligible for export)

Final approval REQUIRES --reviewer (recorded in approvals.yaml). Hardware
review is enforced later by validate_pack at v0.2.0 — see the rule in
README.md.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    append_yaml_list,
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
    p = argparse.ArgumentParser(description="Approve a candidate.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--level", choices=["iteration", "final"], default="iteration")
    p.add_argument("--reviewer", required=False,
                   help="reviewer handle / email — REQUIRED for --level final")
    p.add_argument("--notes", default="")
    p.add_argument("--packs-root", default=None)
    return p


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    if args.level == "final" and not args.reviewer:
        fail("reviewer_required_for_final", {})

    mp = candidate_meta_path(args.project, args.pack, args.candidate, args.packs_root)
    meta = load_json(mp)
    if not meta:
        fail("candidate_not_found", {"candidate": args.candidate})

    if meta.get("status") == "rejected":
        fail("candidate_already_rejected", {"candidate": args.candidate})

    if args.level == "iteration":
        meta["status"] = "approved_for_iteration"
        meta["art_status"] = "iteration"
        meta["human_reviewed"] = True
        meta["approved"] = False
    else:
        meta["status"] = "approved_final"
        meta["art_status"] = "approved_final"
        meta["human_reviewed"] = True
        meta["approved"] = True
        meta["approved_by"] = args.reviewer
        meta["approved_at"] = now_iso()

    if args.notes:
        meta.setdefault("approval_notes", []).append({
            "level": args.level, "reviewer": args.reviewer,
            "notes": args.notes, "at": now_iso(),
        })

    dump_json(mp, meta)

    if args.level == "final":
        append_yaml_list(pr / "reviews" / "approvals.yaml", {
            "candidate_id": meta["candidate_id"],
            "pack_id": meta["pack_id"],
            "approved_by": args.reviewer,
            "approved_at": meta["approved_at"],
            "notes": args.notes,
        })

    emit({"candidate": meta})


if __name__ == "__main__":
    run(main)
