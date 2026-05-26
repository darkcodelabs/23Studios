"""Regenerate a candidate from a parent + correction notes.

Lineage rules:
  - The new candidate's metadata carries parent_candidate_id and a copy of
    the correction notes used.
  - The parent's metadata gains a correction_lineage entry pointing forward
    at the new candidate.
  - All gathered source references travel forward with the new candidate.

CLI:
    python -m tools.regenerate_candidate --project hakcd \
        --pack newb_character_pack \
        --candidate newb_character_pack_v001_a \
        --notes correction_notes/newb_character_pack_v001_a.md \
        --count 3
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    assert_slug,
    candidate_meta_path,
    dump_json,
    iter_candidates,
    load_json,
    load_pack_config,
    now_iso,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402
from tools import generate_pack  # noqa: E402

from providers.base_provider import GenerationRequest, ProviderError  # noqa: E402
from providers.provider_registry import get_provider  # noqa: E402
from tools import generate_candidates as gc  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Regenerate from a parent candidate.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--candidate", required=True, help="parent candidate id")
    p.add_argument("--notes", required=True,
                   help="path to correction-notes markdown (Keep/Change/Reject)")
    p.add_argument("--provider", default="openrouter")
    p.add_argument("--count", type=int, default=3)
    p.add_argument("--no-postprocess", action="store_true",
                   help="skip resize+1-bit-threshold of provider output")
    p.add_argument("--dither", choices=["none", "bayer4"], default="none")
    p.add_argument("--packs-root", default=None)
    return p


def next_variant(parent_id: str, existing_variants: set[str]) -> str:
    # Variants are single letters a..z. Pick the next unused.
    for ch in "abcdefghijklmnopqrstuvwxyz":
        if ch not in existing_variants:
            return ch
    return "z"


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    pack_cfg = load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    parent_mp = candidate_meta_path(args.project, args.pack, args.candidate,
                                    args.packs_root)
    parent = load_json(parent_mp)
    if not parent:
        fail("parent_not_found", {"candidate": args.candidate})

    notes_path = Path(args.notes).resolve()
    if not notes_path.exists():
        fail("notes_not_found", {"path": str(notes_path)})
    correction_notes_text = notes_path.read_text(encoding="utf-8")

    # Persist a copy of the correction notes under the pack so the audit
    # trail is preserved even if the original file moves.
    archived_notes = pr / "reviews" / "correction_notes" / f"{args.candidate}.md"
    archived_notes.parent.mkdir(parents=True, exist_ok=True)
    archived_notes.write_text(correction_notes_text, encoding="utf-8")

    provider = get_provider(args.provider)
    if not provider.is_available():
        fail("provider_unavailable", {"provider": args.provider})

    parent_prompt = parent.get("provider_prompt") or ""
    parent_refs = [Path(p) for p in (parent.get("source_references") or [])
                   if Path(p).exists()]

    req = GenerationRequest(
        pack_id=args.pack,
        pack_type=pack_cfg.get("type", ""),
        target_dims=pack_cfg.get("target_dimensions") or [],
        prompt=parent_prompt or gc.load_authoring_prompt(
            argparse.Namespace(prompt_text=None, prompt_file=None), pr, pack_cfg,
        ),
        references=parent_refs,
        count=args.count,
        correction_notes=correction_notes_text,
        parent_candidate_id=args.candidate,
    )

    try:
        images = provider.generate(req)
    except ProviderError as e:
        fail(e.code, e.detail)

    # Find next unused variant letters across the pack.
    used_variants = {m.get("variant") for m in iter_candidates(
        args.project, args.pack, args.packs_root) if m.get("variant")}

    target_dims = req.target_dims[0] if req.target_dims else [400, 240]
    target_w, target_h = int(target_dims[0]), int(target_dims[1])

    created: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="vpf_regen_") as td:
        td_path = Path(td)
        for i, gi in enumerate(images):
            variant = next_variant(args.candidate, used_variants)
            used_variants.add(variant)
            tmp_png = td_path / f"{args.pack}_{variant}.png"
            png_bytes = gi.image_bytes
            if not args.no_postprocess:
                png_bytes = gc.postprocess_to_1bit(png_bytes, target_w, target_h,
                                                    dither=args.dither)
            tmp_png.write_bytes(png_bytes)
            ingest_args = argparse.Namespace(
                project=args.project, pack=args.pack, file=str(tmp_png),
                batch=None, variant=variant,
                source_ids=",".join(s for s in (parent.get("source_ids") or [])),
                provider=gi.provider_name, prompt_hash=None,
                packs_root=args.packs_root,
            )
            meta = generate_pack.ingest_file(ingest_args, pack_cfg, tmp_png,
                                              forced_variant=variant)
            mp = candidate_meta_path(args.project, args.pack,
                                     meta["candidate_id"], args.packs_root)
            saved = load_json(mp) or meta
            saved["provider"] = gi.provider_name
            saved["provider_prompt"] = gi.prompt
            saved["provider_metadata"] = gi.metadata
            saved["source_references"] = [str(p) for p in parent_refs]
            saved["parent_candidate_id"] = args.candidate
            saved["correction_notes_path"] = str(archived_notes)
            saved["correction_lineage"] = (parent.get("correction_lineage") or []) + [{
                "parent_id": args.candidate,
                "notes_path": str(archived_notes),
                "at": now_iso(),
            }]
            dump_json(mp, saved)
            created.append(saved)

    # Forward-link the parent so lineage is navigable from either direction.
    parent.setdefault("regenerations", []).extend(
        [{"child_id": c["candidate_id"], "at": now_iso()} for c in created]
    )
    dump_json(parent_mp, parent)

    emit({
        "regenerated_from": args.candidate,
        "count": len(created),
        "candidates": created,
    })


if __name__ == "__main__":
    run(main)
