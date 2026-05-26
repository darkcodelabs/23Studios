"""Generate one candidate with every intermediate stage dumped to disk.

Use to forensically inspect the provider -> decode -> resize -> threshold
-> export pipeline byte-by-byte. Writes:

    <pack_root>/debug_pipeline/<timestamp>/
        raw_provider_response.json       (response shell + meta)
        step_00_raw_decoded.png          (provider bytes verbatim)
        step_01_grayscale.png            (after convert('L'))
        step_02_resized.png              (after resize to target dims)
        step_03_threshold.png            (after hard 1-bit threshold)
        final_export.png                 (what ingest would write)
        metadata_trace.json              (per-stage size + entropy + hash)
        integrity_report.json            (integrity check on final)

Usage:
    python -m tools.trace_generation --project hakcd \
        --pack powerglove_arcade_room_pack \
        --provider openrouter
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402

from pack_config import (  # noqa: E402
    assert_slug,
    load_pack_config,
    load_yaml,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402
from tools._image_integrity import validate  # noqa: E402

from providers.base_provider import GenerationRequest, ProviderError  # noqa: E402
from providers.provider_registry import get_provider  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Trace one candidate gen.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--provider", default="openrouter")
    p.add_argument("--prompt-file", default=None)
    p.add_argument("--prompt-text", default=None)
    p.add_argument("--packs-root", default=None)
    return p


def stage_dump(out_dir: Path, idx: int, name: str, im_or_bytes,
               trace: list, fmt: str = "PNG") -> None:
    p = out_dir / f"step_{idx:02d}_{name}.png"
    if isinstance(im_or_bytes, (bytes, bytearray)):
        p.write_bytes(im_or_bytes)
        sz = len(im_or_bytes)
        try:
            im = Image.open(io.BytesIO(im_or_bytes))
            im.load()
            dims = list(im.size)
            mode = im.mode
        except Exception as e:  # noqa: BLE001
            dims = None
            mode = f"<decode-failed: {e}>"
    else:
        im = im_or_bytes
        # Save in a mode PIL can serialise (mode '1' -> 'P' for safety).
        save_mode = "L" if im.mode == "1" else im.mode
        im.convert(save_mode).save(p, fmt)
        sz = p.stat().st_size
        dims = list(im.size)
        mode = im.mode
    digest = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
    trace.append({
        "step": idx, "name": name, "path": str(p),
        "size_bytes": sz, "image_dims": dims, "mode": mode,
        "sha256_16": digest,
    })


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    pack_cfg = load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    provider = get_provider(args.provider)
    if not provider.is_available():
        fail("provider_unavailable", {"provider": args.provider})

    # Pull authoring prompt from pack base prompt / style guide.
    if args.prompt_text:
        authoring_prompt = args.prompt_text
    elif args.prompt_file:
        authoring_prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    else:
        base = pr / "prompts" / f"{pack_cfg.get('type')}_base.md"
        authoring_prompt = base.read_text(encoding="utf-8") if base.exists() else ""

    target_dims = pack_cfg.get("target_dimensions") or [[400, 240]]
    target_w, target_h = int(target_dims[0][0]), int(target_dims[0][1])

    # Gather refs.
    registry = load_yaml(pr / "sources" / "source_registry.yaml") or []
    refs = [Path(e["path"]) for e in registry
            if e.get("status") == "active" and e.get("type") in
            {"image", "screenshot", "sketch"} and e.get("path")
            and Path(e["path"]).exists()][:8]

    ts = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    debug_dir = pr / "debug_pipeline" / ts
    debug_dir.mkdir(parents=True, exist_ok=True)

    trace: list = []

    req = GenerationRequest(
        pack_id=args.pack,
        pack_type=pack_cfg.get("type", ""),
        target_dims=target_dims,
        prompt=authoring_prompt,
        references=refs,
        count=1,
    )

    try:
        images = provider.generate(req)
    except ProviderError as e:
        fail(e.code, e.detail)

    gi = images[0]

    # Stage 0: provider response (raw PNG bytes from provider).
    stage_dump(debug_dir, 0, "raw_decoded", gi.image_bytes, trace)
    (debug_dir / "raw_provider_response.json").write_text(json.dumps({
        "provider_name": gi.provider_name,
        "prompt_length": len(gi.prompt),
        "metadata": gi.metadata,
        "raw_bytes": len(gi.image_bytes),
        "head_hex": gi.image_bytes[:16].hex(),
    }, indent=2), encoding="utf-8")

    # Stage 1: grayscale convert.
    im = Image.open(io.BytesIO(gi.image_bytes))
    g = im.convert("L")
    stage_dump(debug_dir, 1, "grayscale", g, trace)

    # Stage 2: resize to target dims (Lanczos if downsampling toward large
    # target, Nearest if tiny target).
    if g.size != (target_w, target_h):
        method = Image.LANCZOS if (target_w * target_h) > 64 * 64 else Image.NEAREST
        rs = g.resize((target_w, target_h), method)
    else:
        rs = g
    stage_dump(debug_dir, 2, "resized", rs, trace)

    # Stage 3: hard threshold to 1-bit.
    th = rs.point(lambda p: 255 if p > 128 else 0).convert("1")
    stage_dump(debug_dir, 3, "threshold", th, trace)

    # Final: RGB pure-1bit (what generate_candidates ingests).
    rgb = th.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, "PNG")
    final_bytes = buf.getvalue()
    stage_dump(debug_dir, 99, "final_export", final_bytes, trace)

    # Integrity report on final.
    integrity = validate(final_bytes, expected_size=(target_w, target_h))
    (debug_dir / "integrity_report.json").write_text(
        json.dumps(integrity, indent=2, default=str), encoding="utf-8")

    (debug_dir / "metadata_trace.json").write_text(
        json.dumps({
            "pack_id": args.pack,
            "provider": gi.provider_name,
            "target_dims": [target_w, target_h],
            "references_attached": [str(r) for r in refs],
            "stages": trace,
            "integrity_verdict": (
                "fatal" if integrity.get("fatal") else
                ("warn" if integrity.get("warn") else "ok")
            ),
        }, indent=2, default=str),
        encoding="utf-8",
    )

    emit({
        "debug_dir": str(debug_dir),
        "stages": len(trace),
        "integrity": integrity,
        "verdict": "fatal" if integrity.get("fatal") else
                   ("warn" if integrity.get("warn") else "ok"),
    })


if __name__ == "__main__":
    run(main)
