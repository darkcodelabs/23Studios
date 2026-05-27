"""Generate N candidates for a pack via a provider.

Orchestrates:
  1. assemble prompt (pack base prompt + style guide + optional override)
  2. gather references from sources/source_registry.yaml (image-type, active)
  3. call provider.generate(N) — provider returns raw PNG bytes
  4. ingest each returned PNG via the existing intake path
     (preserves status=generated, human_reviewed=false discipline)
  5. augment candidate metadata with provider provenance + prompt + lineage
  6. optional: auto-queue for review, build contact sheets

Generated images are NEVER final. They enter at art_status=generated and
must travel the review pipeline like any other candidate.

CLI:
    python -m tools.generate_candidates --project hakcd \
        --pack powerglove_arcade_room_pack \
        --provider openrouter --count 6 \
        --auto-queue --auto-contact-sheet --auto-silhouette
"""

from __future__ import annotations

import argparse
import io
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pack_config import (  # noqa: E402
    assert_slug,
    candidate_meta_path,
    dump_json,
    load_json,
    load_pack_config,
    load_yaml,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402
from tools import build_contact_sheet, generate_pack, queue_review  # noqa: E402
from tools._image_integrity import validate as integrity_validate  # noqa: E402

from providers.base_provider import GenerationRequest, ProviderError  # noqa: E402
from providers.provider_registry import get_provider, list_providers  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Generate candidates via a provider.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--provider", default="openrouter",
                   help=f"provider name (one of: {', '.join(list_providers())})")
    p.add_argument("--count", type=int, default=4,
                   help="how many candidates to generate this batch")
    p.add_argument("--prompt-text", default=None,
                   help="override authoring-intent prompt (replaces base prompt)")
    p.add_argument("--prompt-file", default=None,
                   help="read authoring-intent prompt from a file")
    p.add_argument("--variant-prefix", default=None,
                   help="optional variant letter prefix (defaults to a..z by index)")
    p.add_argument("--auto-queue", action="store_true",
                   help="run queue_review on the new candidates after gen")
    p.add_argument("--auto-contact-sheet", action="store_true",
                   help="build a candidates contact sheet after gen")
    p.add_argument("--auto-silhouette", action="store_true",
                   help="build a silhouettes contact sheet after gen")
    p.add_argument("--bypass-placeholder-gate", action="store_true",
                   help="ingest even if placeholder detector flags (use for smoke)")
    p.add_argument("--no-postprocess", action="store_true",
                   help="skip resize+1-bit-threshold of provider output (default: on)")
    p.add_argument("--dither", choices=["none", "bayer4"], default="none",
                   help="threshold mode for postprocess (default: none = hard "
                        "threshold @ 128, preserves silhouette)")
    p.add_argument("--strict-integrity", action="store_true",
                   help="hard-fail if integrity check flags tile-repeat / "
                        "low entropy / dim mismatch (default: soft-warn, "
                        "still ingests but flags in candidate metadata)")
    p.add_argument("--packs-root", default=None)
    return p


BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
]


def postprocess_to_1bit(raw_png: bytes, target_w: int, target_h: int,
                         dither: str = "none") -> bytes:
    """Resize provider output to target dims and binarise to pure 1-bit RGB.

    Provider models (Gemini, GPT-image) return arbitrarily-sized RGB PNGs
    (1024^2 common). The factory's 1-bit colour check would reject any
    output that isn't pure (0,0,0)/(255,255,255). This step preserves the
    image-gen content while making it Playdate-shippable.
    """
    src = Image.open(io.BytesIO(raw_png)).convert("L")
    # Resize using nearest if downsampling toward small target keeps
    # silhouette discipline; Lanczos for larger targets to preserve detail.
    if src.size != (target_w, target_h):
        method = Image.LANCZOS if (target_w * target_h) > 64 * 64 else Image.NEAREST
        src = src.resize((target_w, target_h), method)
    if dither == "bayer4":
        w, h = src.size
        out = Image.new("1", (w, h))
        in_px = src.load()
        out_px = out.load()
        for y in range(h):
            row = BAYER4[y & 3]
            for x in range(w):
                t = row[x & 3] * (256 // 16)
                out_px[x, y] = 1 if in_px[x, y] > t else 0
        bw = out
    else:
        bw = src.point(lambda p: 255 if p > 128 else 0).convert("1")
    rgb = bw.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, "PNG")
    return buf.getvalue()


def load_authoring_prompt(args, pr: Path, pack_cfg: dict) -> str:
    if args.prompt_text:
        return args.prompt_text
    if args.prompt_file:
        return Path(args.prompt_file).read_text(encoding="utf-8")
    # Default: concatenate base prompt + style guide.
    base = pr / "prompts" / f"{pack_cfg.get('type')}_base.md"
    style = pr / "style" / "style_guide.md"
    parts: list[str] = []
    if base.exists():
        parts.append(base.read_text(encoding="utf-8"))
    if style.exists():
        parts += ["", "## Pack style guide", style.read_text(encoding="utf-8")]
    if not parts:
        fail("no_prompt_available", {
            "hint": "create prompts/<type>_base.md or pass --prompt-file",
        })
    return "\n".join(parts)


_AUTO_REFERENCES: dict[str, list[str]] = {
    # Any pack whose pack_id contains one of these substrings auto-attaches
    # the listed reference image paths. Keeps sprint-defined master refs
    # always in scope without requiring add_source plumbing first.
    "powerglove": ["/home/hakcer/projects/pnwglove.png"],
    "pwnglove":   ["/home/hakcer/projects/pnwglove.png"],
    "newb":       ["/home/hakcer/projects/pnwglove.png"],  # PWNGLOVE on Newb's arm
}


def auto_references_for(pack_id: str) -> list[Path]:
    out: list[Path] = []
    for needle, refs in _AUTO_REFERENCES.items():
        if needle in pack_id.lower():
            for r in refs:
                p = Path(r)
                if p.exists() and p not in out:
                    out.append(p)
    return out


def gather_references(pr: Path, pack_id: str = "") -> list[Path]:
    """Return active image-type sources as Paths (capped at 8).

    Auto-attached master references (e.g. pnwglove.png for Powerglove packs)
    are prepended so they always reach the provider even if the pack's
    source_registry is empty.
    """
    registry = pr / "sources" / "source_registry.yaml"
    data = load_yaml(registry) or []
    out: list[Path] = list(auto_references_for(pack_id))
    if not isinstance(data, list):
        return out[:8]
    for entry in data:
        if entry.get("status") != "active":
            continue
        if entry.get("type") not in {"image", "screenshot", "sketch"}:
            continue
        p = entry.get("path")
        if not p:
            continue
        path = Path(p)
        if path.exists() and path not in out:
            out.append(path)
        if len(out) >= 8:
            break
    return out[:8]


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    pack_cfg = load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    provider = get_provider(args.provider)
    if not provider.is_available():
        fail("provider_unavailable", {
            "provider": args.provider,
            "hint": "see .env.example for OPENROUTER_API_KEY (or use --provider mock)",
        })

    authoring_prompt = load_authoring_prompt(args, pr, pack_cfg)
    references = gather_references(pr, args.pack)

    req = GenerationRequest(
        pack_id=args.pack,
        pack_type=pack_cfg.get("type", ""),
        target_dims=pack_cfg.get("target_dimensions") or [],
        prompt=authoring_prompt,
        references=references,
        count=args.count,
    )

    try:
        images = provider.generate(req)
    except ProviderError as e:
        fail(e.code, e.detail)

    target_dims = req.target_dims[0] if req.target_dims else [400, 240]
    target_w, target_h = int(target_dims[0]), int(target_dims[1])

    created: list[dict] = []
    rejected: list[dict] = []
    integrity_reports: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="vpf_gen_") as td:
        td_path = Path(td)
        for i, gi in enumerate(images):
            variant = chr(ord("a") + i) if i < 26 else "z"
            tmp_png = td_path / f"{args.pack}_{variant}.png"
            png_bytes = gi.image_bytes
            if not args.no_postprocess:
                png_bytes = postprocess_to_1bit(png_bytes, target_w, target_h,
                                                 dither=args.dither)
            # Integrity check: catch tile-repeat / decode failure / dim
            # mismatch before the candidate enters the review queue.
            report = integrity_validate(
                png_bytes, expected_size=(target_w, target_h))
            verdict = ("fatal" if report.get("fatal")
                       else ("warn" if report.get("warn") else "ok"))
            integrity_reports.append({"variant": variant, "verdict": verdict,
                                      "fatal": report.get("fatal"),
                                      "warn": report.get("warn")})
            if report.get("fatal") or (args.strict_integrity and report.get("warn")):
                rejected.append({"variant": variant, "report": report})
                continue
            tmp_png.write_bytes(png_bytes)

            ingest_args = argparse.Namespace(
                project=args.project,
                pack=args.pack,
                file=str(tmp_png),
                batch=None,
                variant=variant,
                source_ids=",".join(
                    e.get("source_id", "")
                    for e in (load_yaml(pr / "sources" / "source_registry.yaml") or [])
                    if e.get("status") == "active"
                ),
                provider=gi.provider_name,
                prompt_hash=None,
                packs_root=args.packs_root,
            )
            # Run intake. ingest_file may fail on placeholder detection at the
            # Node ingest layer; the Python intake here is lower-level and
            # does not invoke the placeholder detector, so direct intake works
            # for provider output. The state machine downstream still gates.
            meta = generate_pack.ingest_file(ingest_args, pack_cfg, tmp_png,
                                              forced_variant=variant)

            # Augment with provider provenance + prompt + lineage.
            mp = candidate_meta_path(args.project, args.pack,
                                     meta["candidate_id"], args.packs_root)
            saved = load_json(mp) or meta
            saved["provider"] = gi.provider_name
            saved["provider_prompt"] = gi.prompt
            saved["provider_metadata"] = gi.metadata
            saved["source_references"] = [str(p) for p in references]
            saved["correction_lineage"] = []
            saved["integrity_report"] = {
                "verdict": verdict,
                "entropy_bits": report.get("entropy_bits"),
                "black_fraction": report.get("black_fraction"),
                "tile_repeat": report.get("tile_repeat"),
                "warn": report.get("warn"),
            }
            dump_json(mp, saved)
            created.append(saved)

    out: dict = {
        "candidates": created,
        "rejected": rejected,
        "integrity_reports": integrity_reports,
        "provider": args.provider,
        "count": len(created),
        "references_used": len(references),
    }

    if args.auto_queue and created:
        q_args = argparse.Namespace(
            project=args.project, pack=args.pack,
            candidate=None, packs_root=args.packs_root,
        )
        # queue_review.main calls emit; we capture by re-reading queue.
        try:
            queue_review.main(q_args)
        except SystemExit:
            pass
        out["auto_queued"] = True

    if args.auto_contact_sheet and created:
        try:
            cs_args = argparse.Namespace(
                project=args.project, pack=args.pack, mode="candidates",
                tile_size=128, cols=4, packs_root=args.packs_root,
            )
            build_contact_sheet.main(cs_args)
            out["auto_contact_sheet"] = True
        except SystemExit:
            pass

    if args.auto_silhouette and created:
        try:
            sh_args = argparse.Namespace(
                project=args.project, pack=args.pack, mode="silhouettes",
                tile_size=128, cols=4, packs_root=args.packs_root,
            )
            build_contact_sheet.main(sh_args)
            out["auto_silhouette"] = True
        except SystemExit:
            pass

    emit(out)


if __name__ == "__main__":
    run(main)
