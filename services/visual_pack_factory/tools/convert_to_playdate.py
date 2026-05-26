"""Convert an approved candidate image to Playdate-safe 1-bit PNG.

Two modes:
  --dither none        hard threshold at 128 (default, preserves silhouette)
  --dither bayer4      ordered 4x4 Bayer (use only for textured materials)

NEVER applies Floyd-Steinberg by default — its noise destroys silhouette
readability on the Playdate's reflective screen. Output is monochrome PNG
ready for `playdate.graphics.image.new`.

Writes alongside source: <input>.1bit.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402

from tools._common import emit, fail  # noqa: E402


BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Convert to Playdate 1-bit PNG.")
    p.add_argument("--input", required=True)
    p.add_argument("--output", default=None)
    p.add_argument("--dither", choices=["none", "bayer4"], default="none")
    p.add_argument("--threshold", type=int, default=128)
    p.add_argument("--invert", action="store_true",
                   help="invert output (black <-> white)")
    return p


def bayer_threshold(g: Image.Image) -> Image.Image:
    w, h = g.size
    out = Image.new("1", (w, h))
    px_in = g.load()
    px_out = out.load()
    for y in range(h):
        row = BAYER4[y & 3]
        for x in range(w):
            t = row[x & 3] * (256 // 16)
            px_out[x, y] = 1 if px_in[x, y] > t else 0
    return out


def main(args: argparse.Namespace) -> None:
    src = Path(args.input).resolve()
    if not src.exists():
        fail("input_not_found", {"path": str(src)})
    dst = Path(args.output).resolve() if args.output else src.with_suffix(".1bit.png")

    with Image.open(src) as im:
        g = im.convert("L")
        if args.dither == "bayer4":
            bw = bayer_threshold(g)
        else:
            t = int(args.threshold)
            bw = g.point(lambda p, t=t: 255 if p > t else 0).convert("1")
        if args.invert:
            bw = bw.point(lambda p: 0 if p else 255).convert("1")
        dst.parent.mkdir(parents=True, exist_ok=True)
        bw.save(dst, "PNG")

    emit({"input": str(src), "output": str(dst), "dither": args.dither,
          "size": list(bw.size)})


if __name__ == "__main__":
    p = build_parser()
    main(p.parse_args())
