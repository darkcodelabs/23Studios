"""Reject a candidate. Optionally attach correction notes for regeneration."""

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
    p = argparse.ArgumentParser(description="Reject a candidate.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--reason", required=True)
    p.add_argument("--reviewer", default="")
    p.add_argument("--correction", action="store_true",
                   help="mark needs_correction instead of rejected (regen target)")
    p.add_argument("--correction-md", default=None,
                   help="path to a markdown file with Keep/Change/Reject notes")
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

    target_status = "needs_correction" if args.correction else "rejected"
    meta["status"] = target_status
    meta["art_status"] = target_status
    meta["human_reviewed"] = True
    meta["approved"] = False
    meta.setdefault("rejection_log", []).append({
        "reason": args.reason, "reviewer": args.reviewer, "at": now_iso(),
        "correction": args.correction,
    })

    if args.correction_md:
        src = Path(args.correction_md).resolve()
        if not src.exists():
            fail("correction_md_not_found", {"path": str(src)})
        note_dst = pr / "reviews" / "correction_notes" / f"{args.candidate}.md"
        note_dst.parent.mkdir(parents=True, exist_ok=True)
        note_dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        meta.setdefault("correction_notes", []).append(str(note_dst))

    dump_json(mp, meta)

    if not args.correction:
        append_yaml_list(pr / "reviews" / "rejections.yaml", {
            "candidate_id": meta["candidate_id"],
            "pack_id": meta["pack_id"],
            "reason": args.reason,
            "reviewer": args.reviewer,
            "at": now_iso(),
        })

    emit({"candidate": meta})


if __name__ == "__main__":
    run(main)
