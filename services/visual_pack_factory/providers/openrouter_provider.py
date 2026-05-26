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
PLAYDATE_VISUAL_RULES = (
    "Playdate-native 1-bit visual rules:\n"
    "- Only pure black (#000000) and pure white (#FFFFFF). No grey, no "
    "anti-aliasing, no Floyd-Steinberg dither ramp.\n"
    "- Large readable silhouettes. Chunky shapes. Strong black mass "
    "discipline.\n"
    "- Negative space is composition, not empty floor.\n"
    "- Layered density: foreground reads first, midground supports, "
    "background recedes.\n"
    "- Focal point hierarchy: one hero element per frame.\n"
    "- No noisy detail spam. No anti-aliased sludge. No object soup."
)


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
        parts: List[str] = [
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
