"""Forensic inspection for an existing candidate.

Dumps the candidate's metadata + image integrity report. Read-only.

Usage:
    python -m tools.debug_candidate --project hakcd \
        --pack powerglove_arcade_room_pack \
        --candidate powerglove_arcade_room_pack_v007_a

Output (stdout JSON):
    {
      "candidate_id": ...,
      "meta": {provider, prompt-length, parent, ...},
      "image_path": ...,
      "image_bytes": N,
      "integrity": {magic, ihdr, decode, entropy_bits, black_fraction,
                    tile_repeat, ok, fatal[], warn[]},
      "verdict": "ok" | "warn" | "fatal"
    }
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    assert_slug,
    candidate_meta_path,
    load_json,
    load_pack_config,
)
from tools._common import emit, fail, run  # noqa: E402
from tools._image_integrity import validate  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Forensic dump of a candidate.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--packs-root", default=None)
    return p


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    pack_cfg = load_pack_config(args.project, args.pack, args.packs_root)
    mp = candidate_meta_path(args.project, args.pack, args.candidate, args.packs_root)
    meta = load_json(mp)
    if not meta:
        fail("candidate_not_found", {"candidate": args.candidate})

    image_path = Path(meta.get("image_path", ""))
    if not image_path.exists():
        fail("image_missing", {"path": str(image_path)})

    raw = image_path.read_bytes()
    target_dims = pack_cfg.get("target_dimensions") or []
    expected_size = tuple(target_dims[0]) if target_dims else None
    report = validate(raw, expected_size=expected_size)

    verdict = "ok"
    if report.get("fatal"):
        verdict = "fatal"
    elif report.get("warn"):
        verdict = "warn"

    summary = {
        "candidate_id": args.candidate,
        "image_path": str(image_path),
        "image_bytes": len(raw),
        "meta": {
            "status": meta.get("status"),
            "art_status": meta.get("art_status"),
            "provider": meta.get("provider"),
            "human_reviewed": meta.get("human_reviewed"),
            "parent_candidate_id": meta.get("parent_candidate_id"),
            "provider_prompt_length": len(meta.get("provider_prompt") or ""),
            "source_references_count": len(meta.get("source_references") or []),
            "exported_to": meta.get("exported_to"),
        },
        "integrity": report,
        "verdict": verdict,
    }
    emit(summary)


if __name__ == "__main__":
    run(main)
