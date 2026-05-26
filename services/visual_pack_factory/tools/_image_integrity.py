"""Image integrity checks for candidate PNGs.

Built to catch:
  - corrupted base64 decode (PNG header invalid)
  - wrong-buffer exports (dither matrix / scratch canvas leaked)
  - entropy-collapsed output (uniform fill, single tile repeat)
  - mock-provider noise reaching a real-pack export
  - dimension mismatch vs pack target

Each check returns a structured dict so the caller can decide whether to
warn or hard-fail. Used by:
  - tools/debug_candidate.py    (read-only forensic dump)
  - tools/trace_generation.py   (per-stage dump during gen)
  - tools/generate_candidates.py (soft-warn at ingest; --strict hard-fails)
"""

from __future__ import annotations

import io
import math
import struct
from collections import Counter
from pathlib import Path
from typing import Optional

from PIL import Image


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

# Heuristic thresholds. Tuned for 1-bit Playdate art, not natural photos.
DEFAULT_THRESHOLDS = {
    # Shannon entropy of the binarised image. Pure uniform fill ~0.0,
    # alternating noise ~1.0. Real authored 1-bit art tends to land in
    # 0.55 .. 0.99. Mock provider noise lands near 0.99 — high entropy
    # also fails the tile-repeat check.
    "min_entropy_bits": 0.20,    # below this is uniform fill / near-empty
    "max_entropy_bits": 0.999999,  # 1.0 sharp is suspicious — pure 50/50 random
    # Black mass fraction (fraction of black pixels in the 1-bit image).
    # Useful sanity bounds: <2% is empty-canvas, >98% is solid-fill.
    "min_black_fraction": 0.02,
    "max_black_fraction": 0.98,
    # Tile-repeat detection: if the image is a tiling of a small period,
    # consecutive rows / columns match exactly. Real art does not.
    "tile_period_max_match_fraction": 0.85,
}


def check_png_magic(raw: bytes) -> dict:
    ok = raw[:8] == PNG_MAGIC
    return {
        "code": "png_magic",
        "ok": ok,
        "head_hex": raw[:16].hex(),
    }


def parse_png_ihdr(raw: bytes) -> Optional[dict]:
    """Pull width/height/bit-depth/colour-type out of the IHDR chunk.

    Reads bytes only — does NOT decode the image. Used to catch cases where
    PIL would accept a malformed payload and silently produce a wrong-size
    output.
    """
    if raw[:8] != PNG_MAGIC:
        return None
    if raw[12:16] != b"IHDR":
        return None
    try:
        w, h, depth, color_type = struct.unpack(">IIBB", raw[16:26])
    except struct.error:
        return None
    return {"width": w, "height": h, "bit_depth": depth, "color_type": color_type}


def check_decodable(raw: bytes) -> dict:
    """Verify PIL can open + load the image."""
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        return {"code": "decodable", "ok": True, "mode": im.mode,
                "size": list(im.size), "format": im.format}
    except Exception as e:  # noqa: BLE001
        return {"code": "decodable", "ok": False, "error": str(e)}


def shannon_entropy_1bit(im: Image.Image) -> float:
    """Compute entropy of the binarised version of the image.

    For a 1-bit-style image this is in [0, 1]: ~0 means a near-uniform
    fill, 1.0 means perfectly 50/50 — the latter is suspicious (real art
    isn't a perfect coin flip).

    Uses point(lambda p: 0 if p > 127 else 255) to map the binarised
    image back into 8-bit space so .histogram() lands counts at index 0
    (white) and index 255 (black). PIL note: a previous version mapped
    to 0/1 and looked up histogram[255], which was always 0 — entropy
    came back 0.0 for every image, masking the actual content.
    """
    g = im.convert("L")
    bw = g.point(lambda p: 0 if p > 127 else 255)
    counts = bw.histogram()
    total = counts[0] + counts[255]
    if total == 0:
        return 0.0
    p0 = counts[0] / total
    p1 = counts[255] / total
    e = 0.0
    for p in (p0, p1):
        if p > 0:
            e -= p * math.log2(p)
    return e


def black_fraction(im: Image.Image) -> float:
    g = im.convert("L")
    bw = g.point(lambda p: 0 if p > 127 else 255)
    counts = bw.histogram()
    black = counts[255]
    total = counts[0] + counts[255]
    return black / total if total else 0.0


def detect_tile_repeat(im: Image.Image, max_period: int = 64) -> dict:
    """Detect single-tile repetition.

    For each candidate period p in [2..max_period], compute the fraction
    of rows where row[y] == row[y - p]. If that fraction exceeds the
    threshold for any p, the image is likely a tile pattern leaked from a
    dither matrix or scratch buffer.
    """
    g = im.convert("L")
    w, h = g.size
    px = list(g.getdata())
    rows = [px[y * w:(y + 1) * w] for y in range(h)]
    best_p = 0
    best_frac = 0.0
    cap = min(max_period, h // 2)
    for p in range(2, cap + 1):
        matches = sum(1 for y in range(p, h) if rows[y] == rows[y - p])
        frac = matches / max(1, h - p)
        if frac > best_frac:
            best_frac = frac
            best_p = p
    return {"best_period": best_p, "best_match_fraction": best_frac}


def validate(raw: bytes,
             expected_size: Optional[tuple[int, int]] = None,
             thresholds: Optional[dict] = None) -> dict:
    """Run every check. Returns a structured report.

    `report["ok"]` is True iff every check passed.
    `report["fatal"]` is a list of failures that should hard-block a real
    candidate (decode failure, magic-byte mismatch, dim mismatch).
    `report["warn"]` is a list of soft failures (entropy, tile-repeat,
    black-fraction) — caller decides whether to fail or proceed.
    """
    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    fatal: list[dict] = []
    warn: list[dict] = []
    out: dict = {}

    magic = check_png_magic(raw)
    out["magic"] = magic
    if not magic["ok"]:
        fatal.append(magic)
        return {"ok": False, "fatal": fatal, "warn": warn, **out}

    ihdr = parse_png_ihdr(raw) or {}
    out["ihdr"] = ihdr

    decode = check_decodable(raw)
    out["decode"] = decode
    if not decode["ok"]:
        fatal.append(decode)
        return {"ok": False, "fatal": fatal, "warn": warn, **out}

    im = Image.open(io.BytesIO(raw))
    im.load()

    if expected_size and list(im.size) != list(expected_size):
        fatal.append({"code": "dim_mismatch",
                      "expected": list(expected_size),
                      "actual": list(im.size)})

    entropy = shannon_entropy_1bit(im)
    out["entropy_bits"] = entropy
    if entropy < t["min_entropy_bits"]:
        warn.append({"code": "low_entropy", "value": entropy,
                     "threshold": t["min_entropy_bits"]})

    blackfrac = black_fraction(im)
    out["black_fraction"] = blackfrac
    if blackfrac < t["min_black_fraction"]:
        warn.append({"code": "near_empty_canvas",
                     "black_fraction": blackfrac})
    if blackfrac > t["max_black_fraction"]:
        warn.append({"code": "near_full_canvas",
                     "black_fraction": blackfrac})

    tile = detect_tile_repeat(im)
    out["tile_repeat"] = tile
    if tile["best_match_fraction"] > t["tile_period_max_match_fraction"]:
        warn.append({"code": "tile_repeat_detected",
                     "period": tile["best_period"],
                     "match_fraction": tile["best_match_fraction"],
                     "hint": ("image rows repeat with a short period — "
                              "likely dither matrix / mock noise / "
                              "scratch buffer rather than authored art")})

    out["ok"] = not fatal and not warn
    out["fatal"] = fatal
    out["warn"] = warn
    return out
