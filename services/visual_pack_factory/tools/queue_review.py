"""Move generated candidates into the review queue.

A generated candidate sits at status=generated until a human starts the
review loop. queue_review moves every status=generated candidate in a
pack (or a single candidate, if --candidate is given) to
status=queued_for_review and writes them into reviews/review_queue.yaml.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    assert_slug,
    candidate_meta_path,
    dump_yaml,
    iter_candidates,
    load_json,
    load_pack_config,
    load_yaml,
    now_iso,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Queue candidates for human review.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--candidate", default=None,
                   help="single candidate id; default: all status=generated in pack")
    p.add_argument("--packs-root", default=None)
    return p


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)
    queue_path = pr / "reviews" / "review_queue.yaml"
    queue = load_yaml(queue_path) or []

    targets: list[dict] = []
    if args.candidate:
        mp = candidate_meta_path(args.project, args.pack, args.candidate, args.packs_root)
        meta = load_json(mp)
        if not meta:
            fail("candidate_not_found", {"candidate": args.candidate})
        targets.append(meta)
    else:
        targets = [m for m in iter_candidates(args.project, args.pack, args.packs_root)
                   if m.get("status") == "generated"]

    moved = []
    for meta in targets:
        if meta["status"] != "generated":
            continue
        meta["status"] = "queued_for_review"
        meta["queued_at"] = now_iso()
        dump_yaml_path = candidate_meta_path(
            args.project, args.pack, meta["candidate_id"], args.packs_root
        )
        from pack_config import dump_json
        dump_json(dump_yaml_path, meta)
        queue.append({
            "candidate_id": meta["candidate_id"],
            "pack_id": meta["pack_id"],
            "queued_at": meta["queued_at"],
            "image_path": meta.get("image_path"),
        })
        moved.append(meta["candidate_id"])

    dump_yaml(queue_path, queue)
    emit({"queued": moved, "queue_size": len(queue)})


if __name__ == "__main__":
    run(main)
