"""Extract usable style cues from a pack's image sources.

For each active image source: silhouette ratio, dominant tone (light/dark),
mean luminance, edge density (a cheap silhouette readability proxy). Writes
sources/extracted_style_notes.yaml. Output is NOT a creative judgment; it's
raw signal to inform the human-authored style_guide.md.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageFilter  # noqa: E402

from pack_config import (  # noqa: E402
    assert_slug,
    dump_yaml,
    load_pack_config,
    load_yaml,
    now_iso,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Extract style cues from sources.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--packs-root", default=None)
    return p


def analyse(path: Path) -> dict:
    with Image.open(path) as im:
        im = im.convert("L")
        w, h = im.size
        pixels = list(im.getdata())
        n = len(pixels)
        mean_lum = sum(pixels) / n if n else 0
        dark_px = sum(1 for p in pixels if p < 96)
        light_px = sum(1 for p in pixels if p > 160)
        dark_ratio = dark_px / n if n else 0
        light_ratio = light_px / n if n else 0
        edges = im.filter(ImageFilter.FIND_EDGES)
        epx = list(edges.getdata())
        edge_density = (sum(1 for p in epx if p > 64) / n) if n else 0
        if mean_lum < 96:
            tone = "dark_dominant"
        elif mean_lum > 160:
            tone = "light_dominant"
        else:
            tone = "balanced"
    return {
        "size": [w, h],
        "mean_luminance": round(mean_lum, 1),
        "dark_ratio": round(dark_ratio, 3),
        "light_ratio": round(light_ratio, 3),
        "edge_density": round(edge_density, 3),
        "dominant_tone": tone,
    }


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)
    registry = load_yaml(pr / "sources" / "source_registry.yaml") or []
    if not registry:
        fail("no_sources", {})

    notes: list[dict] = []
    for s in registry:
        if s.get("type") not in {"image", "screenshot", "sketch"}:
            continue
        path = Path(s.get("path") or "")
        if not path.exists():
            continue
        try:
            metrics = analyse(path)
        except Exception as e:
            notes.append({"source_id": s["source_id"], "error": str(e)})
            continue
        notes.append({"source_id": s["source_id"], **metrics})

    out = pr / "sources" / "extracted_style_notes.yaml"
    dump_yaml(out, {"updated_at": now_iso(), "notes": notes})
    emit({"notes_path": str(out), "analyzed": len(notes)})


if __name__ == "__main__":
    run(main)
