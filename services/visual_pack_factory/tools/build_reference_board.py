"""Compose a mood board from every active source in a pack.

Reads sources/source_registry.yaml, tiles every image-type source into a
single board PNG with captions. URL + note sources are appended as a
text legend below the image grid.

Output: exports/contact_sheets/<pack>_reference_board_<ts>.png
"""

from __future__ import annotations

import argparse
import datetime as dt
import textwrap
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from pack_config import (  # noqa: E402
    assert_slug,
    load_pack_config,
    load_yaml,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Build a reference mood board.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--tile-size", type=int, default=180)
    p.add_argument("--cols", type=int, default=5)
    p.add_argument("--packs-root", default=None)
    return p


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    registry = load_yaml(pr / "sources" / "source_registry.yaml") or []
    if not registry:
        fail("no_sources", {})

    img_sources = [s for s in registry
                   if s.get("type") in {"image", "screenshot", "sketch"}
                   and s.get("status") == "active"]
    text_sources = [s for s in registry
                    if s.get("type") in {"url", "note"}
                    and s.get("status") == "active"]

    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    tile = args.tile_size
    cols = max(1, args.cols)
    rows = max(1, (len(img_sources) + cols - 1) // cols)
    pad = 10
    cell_w = tile + pad * 2
    cell_h = tile + pad * 2 + 16
    img_h = cell_h * rows

    legend_lines: list[str] = []
    for s in text_sources:
        if s["type"] == "url":
            legend_lines.append(f"[{s['source_id']}] URL: {s.get('url', '')}")
        else:
            body = (Path(s["path"]).read_text(encoding="utf-8")
                    if s.get("path") and Path(s["path"]).exists() else "")
            legend_lines.append(f"[{s['source_id']}] NOTE: {body[:140]}")

    legend_h = 16 + 14 * max(1, len(legend_lines)) + 16 if legend_lines else 0
    board = Image.new("RGB", (cell_w * cols, img_h + legend_h), (24, 24, 28))
    draw = ImageDraw.Draw(board)

    for i, s in enumerate(img_sources):
        ip = Path(s.get("path") or "")
        if not ip.exists():
            continue
        r = i // cols
        c = i % cols
        x0 = c * cell_w + pad
        y0 = r * cell_h + pad
        try:
            with Image.open(ip) as im:
                im = im.convert("RGB")
                im.thumbnail((tile, tile), Image.NEAREST)
                board.paste(im, (x0 + (tile - im.width) // 2,
                                 y0 + (tile - im.height) // 2))
        except Exception as e:
            draw.rectangle((x0, y0, x0 + tile, y0 + tile), fill=(60, 30, 30))
            draw.text((x0 + 4, y0 + 4), f"err: {e}"[:24], fill=(255, 100, 100), font=font)
        draw.text((x0, y0 + tile + 2), s["source_id"][:24],
                  fill=(220, 220, 220), font=font)

    if legend_lines:
        ly = img_h + 8
        draw.text((10, ly), "References:", fill=(255, 220, 120), font=font)
        for i, line in enumerate(legend_lines):
            for j, sub in enumerate(textwrap.wrap(line, width=120)[:1]):
                draw.text((10, ly + 16 + i * 14 + j * 14), sub,
                          fill=(200, 200, 200), font=font)

    ts = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out = pr / "exports" / "contact_sheets" / f"{args.pack}_reference_board_{ts}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    board.save(out, "PNG")
    emit({"board": str(out),
          "image_count": len(img_sources),
          "text_count": len(text_sources)})


if __name__ == "__main__":
    run(main)
