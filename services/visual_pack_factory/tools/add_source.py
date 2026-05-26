"""Register an inspiration source (image, screenshot, sketch, URL, note).

Copyright firewall: every source is tagged usage=inspiration_only by default
and copy_risk_reviewed=false. Tracing or 1:1 copy is forbidden; review tools
flag any candidate whose source list mixes copyrighted material with a
usage other than inspiration_only.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    append_yaml_list,
    assert_slug,
    load_pack_config,
    now_iso,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Register an inspiration source.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--type", choices=["image", "screenshot", "sketch", "url", "note"],
                   default="image")
    p.add_argument("--file", help="local file to ingest (image/screenshot/sketch)")
    p.add_argument("--url", help="URL reference")
    p.add_argument("--text", help="inline note body")
    p.add_argument("--usage", default="inspiration_only",
                   choices=["inspiration_only"],
                   help="usage classification (only inspiration_only allowed in v1)")
    p.add_argument("--notes", default="")
    p.add_argument("--packs-root", default=None)
    return p


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    load_pack_config(args.project, args.pack, args.packs_root)  # raises if missing
    pr = pack_root(args.project, args.pack, args.packs_root)

    src_id_seed = []
    stored_path: Path | None = None

    if args.type in {"image", "screenshot", "sketch"}:
        if not args.file:
            fail("file_required", {"type": args.type})
        src = Path(args.file).resolve()
        if not src.exists() or not src.is_file():
            fail("file_not_found", {"path": str(src)})
        digest = hashlib.sha256(src.read_bytes()).hexdigest()[:12]
        bucket = {
            "image": "images",
            "screenshot": "screenshots",
            "sketch": "sketches",
        }[args.type]
        ext = src.suffix.lower() or ".png"
        stored_path = pr / "inbox" / bucket / f"{digest}{ext}"
        stored_path.parent.mkdir(parents=True, exist_ok=True)
        if not stored_path.exists():
            shutil.copy2(src, stored_path)
        src_id_seed = [args.type, digest]
    elif args.type == "url":
        if not args.url:
            fail("url_required", {})
        digest = hashlib.sha256(args.url.encode("utf-8")).hexdigest()[:12]
        urls_path = pr / "inbox" / "urls" / f"{digest}.txt"
        urls_path.parent.mkdir(parents=True, exist_ok=True)
        urls_path.write_text(args.url, encoding="utf-8")
        stored_path = urls_path
        src_id_seed = ["url", digest]
    elif args.type == "note":
        if not args.text:
            fail("text_required", {})
        digest = hashlib.sha256(args.text.encode("utf-8")).hexdigest()[:12]
        notes_path = pr / "inbox" / "notes" / f"{digest}.md"
        notes_path.parent.mkdir(parents=True, exist_ok=True)
        notes_path.write_text(args.text, encoding="utf-8")
        stored_path = notes_path
        src_id_seed = ["note", digest]

    source_id = "ref_" + "_".join(src_id_seed)
    entry = {
        "source_id": source_id,
        "type": args.type,
        "path": str(stored_path) if stored_path else None,
        "url": args.url if args.type == "url" else None,
        "pack_id": args.pack,
        "usage": args.usage,
        "status": "active",
        "notes": args.notes,
        "copy_risk_reviewed": False,
        "added_at": now_iso(),
    }

    registry = pr / "sources" / "source_registry.yaml"
    append_yaml_list(registry, entry)
    emit({"source": entry, "registry": str(registry)})


if __name__ == "__main__":
    run(main)
