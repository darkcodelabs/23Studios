"""Register externally-produced candidate art into the pack.

v1 is intake-only: the factory does NOT itself call any image-gen API. It
accepts files dropped into candidates/ (manually or by the Node service
after an OpenRouter image call) and writes the sidecar metadata required
by review tools. This keeps the generator pluggable and the audit trail
clean.

Two modes:
  --file <path>            ingest a single file as one candidate
  --batch <dir>            ingest every supported file from a directory
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    ALLOWED_STATES,
    assert_slug,
    candidate_image_path,
    candidate_meta_path,
    dump_json,
    iter_candidates,
    load_pack_config,
    now_iso,
)
from tools._common import emit, fail, run  # noqa: E402


SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".gif"}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Intake candidate art into a pack.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--file", help="single candidate file to ingest")
    p.add_argument("--batch", help="directory of candidate files to ingest")
    p.add_argument("--variant", default="a", help="variant letter for single ingest")
    p.add_argument("--source-ids", default="",
                   help="comma-separated source_ids that inspired this candidate")
    p.add_argument("--provider", default="manual",
                   help="provider tag (manual / openrouter:<model> / human-artist)")
    p.add_argument("--prompt-hash", default=None,
                   help="hash of the prompt used (provided by the caller, if any)")
    p.add_argument("--packs-root", default=None)
    return p


def next_version(pack_cfg: dict, existing: list[dict]) -> int:
    versions = [m.get("version", 0) for m in existing if isinstance(m.get("version"), int)]
    return (max(versions) + 1) if versions else 1


def ingest_file(args: argparse.Namespace, pack_cfg: dict, src_path: Path,
                forced_variant: str | None = None) -> dict:
    if src_path.suffix.lower() not in SUPPORTED_EXTS:
        raise ValueError(f"unsupported ext: {src_path.suffix}")
    existing = list(iter_candidates(args.project, args.pack, args.packs_root))
    version = next_version(pack_cfg, existing)
    variant = (forced_variant or args.variant or "a").lower()
    if len(variant) != 1 or not variant.isalpha():
        raise ValueError(f"variant must be single letter: {variant!r}")
    candidate_id = f"{args.pack}_v{version:03d}_{variant}"

    img_target = candidate_image_path(
        args.project, args.pack, candidate_id, src_path.suffix.lstrip(".").lower(),
        args.packs_root,
    )
    img_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_path, img_target)

    meta = {
        "candidate_id": candidate_id,
        "pack_id": args.pack,
        "asset_type": pack_cfg.get("type"),
        "version": version,
        "variant": variant,
        "status": "generated",
        "art_status": "generated",
        "human_reviewed": False,
        "approved": False,
        "target_dimensions": pack_cfg.get("target_dimensions"),
        "playdate_ready": False,
        "source_ids": [s.strip() for s in args.source_ids.split(",") if s.strip()],
        "source_usage": "inspiration_only",
        "copy_risk_reviewed": False,
        "correction_notes": [],
        "style_score": None,
        "readability_score": None,
        "silhouette_score": None,
        "hardware_reviewed": False,
        "exported_to": None,
        "provider": args.provider,
        "prompt_hash": args.prompt_hash,
        "image_path": str(img_target),
        "created_at": now_iso(),
    }
    dump_json(candidate_meta_path(args.project, args.pack, candidate_id, args.packs_root), meta)
    return meta


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    pack_cfg = load_pack_config(args.project, args.pack, args.packs_root)

    if bool(args.file) == bool(args.batch):
        fail("file_xor_batch", {"detail": "supply exactly one of --file or --batch"})

    created: list[dict] = []
    if args.file:
        src = Path(args.file).resolve()
        if not src.exists():
            fail("file_not_found", {"path": str(src)})
        created.append(ingest_file(args, pack_cfg, src))
    else:
        batch_dir = Path(args.batch).resolve()
        if not batch_dir.is_dir():
            fail("batch_not_a_dir", {"path": str(batch_dir)})
        files = sorted([f for f in batch_dir.iterdir()
                        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTS])
        if not files:
            fail("batch_empty", {"path": str(batch_dir)})
        for i, f in enumerate(files):
            variant = chr(ord("a") + i) if i < 26 else "z"
            created.append(ingest_file(args, pack_cfg, f, forced_variant=variant))

    # Make sure they showed up in an allowed state.
    for m in created:
        assert m["status"] in ALLOWED_STATES, m["status"]

    emit({"candidates": created})


if __name__ == "__main__":
    run(main)
