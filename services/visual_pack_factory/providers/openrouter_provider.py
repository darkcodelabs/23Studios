"""OpenRouter candidate provider.

Drives image generation via OpenRouter's chat-completions multimodal API
(modalities=['image','text']). The recommended model is openai/gpt-image-1
which returns base64-encoded PNGs in message.images[0].image_url.url.

Configuration (env):
    OPENROUTER_API_KEY      required
    OPENROUTER_MODEL        default: openai/gpt-image-1
    OPENROUTER_BASE_URL     default: https://openrouter.ai/api/v1
    OPENROUTER_TIMEOUT_S    default: 120
    OPENROUTER_RETRIES      default: 2 (on transient 429 / 5xx / timeout)

Why a Python client and not 23studios/server/services/pulp_ai.js:
    pulp_ai.js is coupled to project-context lookup, pulp_dir logging,
    spend tracking, and Pulp-specific reference picking. The factory is
    project-agnostic and intake-only; a small Python client keeps the
    factory self-contained and avoids spinning the Node service up for
    every CLI invocation. Both clients hit the same OpenRouter endpoint
    with the same prompt discipline.

Constraint:
    - Every returned image is `status=generated`, `human_reviewed=false`,
      `approved=false`. The factory's downstream review pipeline is the
      only path to final.
    - References are inspiration-only. The prompt MUST embed the
      copyright-firewall directive.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional

from .base_provider import BaseProvider, GeneratedImage, GenerationRequest, ProviderError


DEFAULT_MODEL = "openai/gpt-image-1"
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
COPYRIGHT_FIREWALL = (
    "References are inspiration-only. Do not reproduce copyrighted "
    "characters, scenes, logos, or trademarks. Borrow silhouette, "
    "composition, contrast, density, atmosphere only."
)

# v3.1 Playdate Asset Generation Standard — aggressively constrained
# directive framing. Pushes the model to behave like vintage 1998 hardware
# instead of a modern smoothing engine.
#
# Note on the "pure white background" rule below: it applies to isolated
# asset sheets (character / prop / UI / portrait / animation). Room and
# tile packs include their own background imagery — see PACK_TYPE_OPENERS
# for the per-type background contract. The opener overrides the global
# default for those types.
PLAYDATE_VISUAL_RULES = (
    "CRITICAL SYSTEM DIRECTIVE: You are an image generation engine "
    "hardwired to a 1-bit memory LCD display matrix. You must strictly "
    "adhere to the following visual constraints:\n"
    "\n"
    "1. STRICT MONOCHROME: Output must be 100 percent pure black and "
    "white only. Absolutely no grayscale, no anti-aliasing, and no "
    "color.\n"
    "\n"
    "2. SHADING PROTOCOL: You are forbidden from using smooth gradients. "
    "All shading, depth, and texture must be simulated using heavy, "
    "localized pixel dithering (checkerboard / Bayer / clustered-dot "
    "patterns).\n"
    "\n"
    "3. STRUCTURAL CLARITY: Maintain stark, high contrast outlines. "
    "Visual elements must remain highly readable when scaled down to a "
    "32x32 pixel constraint.\n"
    "\n"
    "4. ASSET FORMATTING: Render the request as a flat, structural game "
    "developer asset sheet on a pure white background — UNLESS the "
    "per-pack-type opener above specifies a room layout or tileset, in "
    "which case the background imagery is part of the asset and the "
    "opener's framing wins. Do not add environmental lighting or "
    "perspective skew that contradicts the opener.\n"
    "\n"
    "5. CONSEQUENCE: Output that contains greyscale, anti-aliased edges, "
    "smooth gradients, or smoothing artefacts will be rejected at the "
    "factory ingest gate by `_image_integrity.validate()` and "
    "`validate_pack.py::_check_1bit`. Rejected candidates do not enter "
    "the review queue."
)

# Per-pack-type opening line — sets the model's mental frame to "production
# asset" not "concept piece". Prepended to every prompt.
PACK_TYPE_OPENERS = {
    "character_pack": (
        "Produce a SPRITE SHEET in strict 1-bit pixel art style, designed "
        "for the Playdate console. Neatly organised for game development. "
        "Include front view, back view, left view, and right view. "
        "Animations: idle, walk, run, interact, use item, reaction. "
        "Each pose has a strong silhouette and reads at 32x32. "
        "Production-ready, not concept art."
    ),
    "room_pack": (
        "Produce a ROOM DEVELOPMENT KIT in strict 1-bit pixel art style, "
        "designed for the Playdate console. This is NOT a hero illustration "
        "or a poster. Output the room as a playable gameplay space: "
        "navigation flow, interaction density, readable floor / wall / "
        "ceiling boundaries, isolated interactable stations. No giant "
        "central illustration. No splash composition. Production-ready "
        "gameplay layout."
    ),
    "tile_pack": (
        "Produce a TILESET in strict 1-bit pixel art style, designed for "
        "the Playdate console. Modular, grid-aligned, edge-matched tiles "
        "for walls / floors / trim / doors / vents / cables / workbenches "
        "/ storage / terminals. Use dithering to differentiate materials. "
        "Developer-ready, drops straight into a tilemap."
    ),
    "ui_pack": (
        "Produce a UI COLLECTION in strict 1-bit pixel art style for the "
        "Playdate console. Icons and buttons for inventory, map, settings, "
        "dialogue, health, upgrades, interaction prompts, menu buttons. "
        "Clean lines, dithered fills for readability on hardware. "
        "Production-ready interface assets."
    ),
    "prop_pack": (
        "Produce isolated GAME PROPS in strict 1-bit pixel art style for "
        "the Playdate console. Each prop on a neutral / empty background, "
        "ready to composite into a scene. Strong silhouette, chunky "
        "shapes, dithering for material. Not concept sketches — "
        "production sprites."
    ),
    "animation_pack": (
        "Produce an ANIMATION SHEET in strict 1-bit pixel art style for "
        "the Playdate console. Frame-by-frame poses laid out in a grid, "
        "consistent silhouette across frames, anti-pop transitions. "
        "Production-ready animation strip."
    ),
    "portrait_pack": (
        "Produce a DIALOGUE PORTRAIT SHEET in strict 1-bit pixel art style "
        "for the Playdate console. Expressions: neutral, happy, confused, "
        "nervous, excited, angry. Each portrait reads at small sizes. "
        "Dithering for depth and facial detail. Production-ready dialogue "
        "assets."
    ),
}


class OpenRouterProvider(BaseProvider):
    name = "openrouter"

    def __init__(self):
        self.api_key = os.environ.get("OPENROUTER_API_KEY", "")
        self.model = os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)
        self.base_url = os.environ.get("OPENROUTER_BASE_URL", DEFAULT_BASE_URL)
        self.timeout = int(os.environ.get("OPENROUTER_TIMEOUT_S", "120"))
        self.retries = int(os.environ.get("OPENROUTER_RETRIES", "2"))

    def is_available(self) -> bool:
        return bool(self.api_key)

    def generate(self, req: GenerationRequest) -> List[GeneratedImage]:
        if not self.is_available():
            raise ProviderError("openrouter_unavailable", {
                "hint": "set OPENROUTER_API_KEY in env (see .env.example)",
            })

        dims = req.target_dims[0] if req.target_dims else [400, 240]
        w, h = int(dims[0]), int(dims[1])

        prompt_text = self._compose_prompt(req, w, h)
        messages = self._build_messages(prompt_text, req.references)
        results: List[GeneratedImage] = []
        for i in range(req.count):
            payload = {
                "model": self.model,
                "modalities": ["image", "text"],
                "messages": messages,
                "metadata": {
                    "pack_id": req.pack_id,
                    "index": i,
                    "factory": "visual_pack_factory",
                },
            }
            data = self._post(payload)
            img_bytes = self._extract_image(data)
            results.append(GeneratedImage(
                image_bytes=img_bytes,
                provider_name=f"openrouter:{self.model}",
                prompt=prompt_text,
                metadata={
                    "openrouter_model": self.model,
                    "index": i,
                    "target_dims": [w, h],
                    "references": [str(p) for p in req.references],
                    "correction_notes_attached": bool(req.correction_notes),
                    "parent_candidate_id": req.parent_candidate_id,
                },
            ))
        return results

    # ----- internals -----------------------------------------------------
    def _compose_prompt(self, req: GenerationRequest, w: int, h: int) -> str:
        opener = PACK_TYPE_OPENERS.get(
            req.pack_type,
            "Produce a GAME ASSET in strict 1-bit pixel art style for the "
            "Playdate console. Production-ready, not concept art.",
        )
        parts: List[str] = [
            opener,
            "",
            f"Pack: {req.pack_id} ({req.pack_type}).",
            f"Target dimensions: {w}x{h} pixels — 1-bit Playdate-ready PNG.",
            "",
            PLAYDATE_VISUAL_RULES,
            "",
            COPYRIGHT_FIREWALL,
            "",
            "## Authoring intent",
            req.prompt.strip(),
        ]
        if req.correction_notes:
            parts += [
                "",
                "## Correction notes (revise per these — keep what worked, change what failed)",
                req.correction_notes.strip(),
            ]
        if req.parent_candidate_id:
            parts.append(
                f"\n(This iteration follows {req.parent_candidate_id}. "
                "Preserve identity, refine per correction notes.)"
            )
        return "\n".join(parts)

    def _build_messages(self, prompt_text: str, references: list[Path]) -> list:
        content: list = [{"type": "text", "text": prompt_text}]
        for ref in references[:8]:  # cap reference attachments
            try:
                with open(ref, "rb") as f:
                    raw = f.read()
            except OSError:
                continue
            b64 = base64.b64encode(raw).decode("ascii")
            mime = "image/png" if ref.suffix.lower() == ".png" else "image/jpeg"
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            })
        return [{"role": "user", "content": content}]

    def _post(self, payload: dict) -> dict:
        url = f"{self.base_url}/chat/completions"
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/darkcodelabs/23Studios",
            "X-Title": "23studios visual_pack_factory",
        }
        last_err: Optional[Exception] = None
        for attempt in range(self.retries + 1):
            req = urllib.request.Request(url, data=body, headers=headers,
                                         method="POST")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as e:
                txt = e.read().decode("utf-8", errors="replace")[:400]
                code = f"openrouter_{e.code}"
                # Retry on 429 / 5xx; surface 4xx (except 429) immediately.
                if e.code == 429 or 500 <= e.code < 600:
                    last_err = ProviderError(code, {"body": txt,
                                                   "attempt": attempt + 1})
                    if attempt < self.retries:
                        time.sleep(min(2 ** attempt, 30))
                        continue
                raise ProviderError(code, {"body": txt})
            except urllib.error.URLError as e:
                last_err = ProviderError("openrouter_network", {"reason": str(e.reason)})
                if attempt < self.retries:
                    time.sleep(min(2 ** attempt, 10))
                    continue
                raise last_err
        if last_err:
            raise last_err
        raise ProviderError("openrouter_unknown", {})

    def _extract_image(self, data: dict) -> bytes:
        """Pull base64 PNG out of OpenRouter chat-completions response.

        Shape: choices[0].message.images[0].image_url.url = "data:image/png;base64,..."
        """
        try:
            choices = data["choices"]
            msg = choices[0]["message"]
            images = msg.get("images") or []
            if not images:
                # Some models put it under message.content with type=image_url.
                content = msg.get("content")
                if isinstance(content, list):
                    for part in content:
                        if part.get("type") in {"image_url", "output_image"}:
                            url = (part.get("image_url") or {}).get("url") \
                                or part.get("url")
                            if url and "base64," in url:
                                return base64.b64decode(url.split("base64,", 1)[1])
                raise ProviderError("openrouter_no_image", {
                    "model": self.model,
                    "raw_message": str(msg)[:500],
                })
            url = images[0]["image_url"]["url"]
            if "base64," not in url:
                raise ProviderError("openrouter_not_base64", {"url_prefix": url[:80]})
            return base64.b64decode(url.split("base64,", 1)[1])
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderError("openrouter_unexpected_shape", {
                "error": str(e),
                "raw": str(data)[:500],
            })
