"""Deterministic mock provider for smoke-testing the pipeline offline.

Generates pure 1-bit PNGs at the requested dimensions. Patterns derive from
a hash of (pack_id, prompt, index) so output is repeatable. The factory's
1-bit colour check will pass on these. The factory's placeholder detector
WILL reject them at ingest (they trip `playdate_validator.isPlaceholder*`),
which is exactly what we want during smoke — proves the placeholder gate
fires.
"""

from __future__ import annotations

import hashlib
import io
from typing import List

from PIL import Image, ImageDraw

from .base_provider import BaseProvider, GeneratedImage, GenerationRequest


class MockProvider(BaseProvider):
    name = "mock"

    def is_available(self) -> bool:
        return True

    def generate(self, req: GenerationRequest) -> List[GeneratedImage]:
        dims = req.target_dims[0] if req.target_dims else [48, 48]
        w, h = int(dims[0]), int(dims[1])
        out: List[GeneratedImage] = []
        for i in range(req.count):
            seed = f"{req.pack_id}|{req.prompt[:80]}|{i}".encode("utf-8")
            digest = hashlib.sha256(seed).digest()
            im = Image.new("RGB", (w, h), (255, 255, 255))
            draw = ImageDraw.Draw(im)
            # Speckle pattern derived from hash bits.
            for y in range(h):
                row_byte = digest[(y % len(digest))]
                for x in range(w):
                    bit_index = (x + y * 3) % 8
                    if (row_byte >> bit_index) & 1:
                        im.putpixel((x, y), (0, 0, 0))
            # Frame: solid 2-px border so silhouette has structure.
            draw.rectangle([(0, 0), (w - 1, h - 1)], outline=(0, 0, 0), width=2)
            buf = io.BytesIO()
            im.save(buf, "PNG")
            out.append(GeneratedImage(
                image_bytes=buf.getvalue(),
                provider_name="mock",
                prompt=req.prompt,
                metadata={"index": i, "dims": [w, h], "deterministic": True},
            ))
        return out
