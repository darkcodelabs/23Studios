"""Build a contact sheet for fast visual review.

Modes:
  --mode candidates    grid of every non-rejected candidate in a pack
  --mode silhouettes   same grid but each tile flattened to a 1-bit silhouette
  --mode hardware      grid of hardware-review photos for approved_final

Output: exports/contact_sheets/<pack>_<mode>_<timestamp>.png
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from pack_config import (  # noqa: E402
    assert_slug,
    iter_candidates,
    load_pack_config,
    pack_root,
)
from tools._common import emit, fail, run  # noqa: E402


TILE_PAD = 8
LABEL_H = 14


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Build a contact sheet for a pack.")
    p.add_argument("--project", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--mode", choices=["candidates", "silhouettes", "hardware"],
                   default="candidates")
    p.add_argument("--tile-size", type=int, default=128,
                   help="contact-sheet tile size (longest side)")
    p.add_argument("--cols", type=int, default=6)
    p.add_argument("--packs-root", default=None)
    return p


def silhouette(img: Image.Image) -> Image.Image:
    gray = img.convert("L")
    bw = gray.point(lambda p: 0 if p < 128 else 255)
    return bw.convert("RGB")


def hardware_images(pr: Path):
    hw = pr / "exports" / "hardware_review"
    if not hw.exists():
        return []
    return sorted([f for f in hw.iterdir() if f.suffix.lower() in {".png", ".jpg", ".jpeg"}])


def main(args: argparse.Namespace) -> None:
    assert_slug(args.project, "project")
    assert_slug(args.pack, "pack")
    load_pack_config(args.project, args.pack, args.packs_root)
    pr = pack_root(args.project, args.pack, args.packs_root)

    items: list[tuple[str, Path]] = []
    if args.mode in {"candidates", "silhouettes"}:
        for meta in iter_candidates(args.project, args.pack, args.packs_root):
            if meta.get("status") in {"rejected"}:
                continue
            ip = Path(meta.get("image_path", ""))
            if ip.exists():
                items.append((meta["candidate_id"], ip))
    else:
        for f in hardware_images(pr):
            items.append((f.stem, f))

    if not items:
        fail("no_items", {"mode": args.mode})

    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    tile = args.tile_size
    cols = max(1, args.cols)
    rows = (len(items) + cols - 1) // cols
    cell_w = tile + TILE_PAD * 2
    cell_h = tile + TILE_PAD * 2 + LABEL_H
    sheet_w = cell_w * cols
    sheet_h = cell_h * rows
    sheet = Image.new("RGB", (sheet_w, sheet_h), (30, 30, 30))
    draw = ImageDraw.Draw(sheet)

    for idx, (label, ip) in enumerate(items):
        r = idx // cols
        c = idx % cols
        x0 = c * cell_w + TILE_PAD
        y0 = r * cell_h + TILE_PAD

        with Image.open(ip) as im:
            im = im.convert("RGB")
            im.thumbnail((tile, tile), Image.NEAREST)
            if args.mode == "silhouettes":
                im = silhouette(im)
            ox = x0 + (tile - im.width) // 2
            oy = y0 + (tile - im.height) // 2
            sheet.paste(im, (ox, oy))

        ly = y0 + tile + 2
        draw.text((x0, ly), label[:24], fill=(220, 220, 220), font=font)

    ts = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_dir = pr / "exports" / "contact_sheets"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{args.pack}_{args.mode}_{ts}.png"
    sheet.save(out, "PNG")
    emit({"contact_sheet": str(out), "items": len(items),
          "grid": [cols, rows], "tile_size": tile})


if __name__ == "__main__":
    run(main)
