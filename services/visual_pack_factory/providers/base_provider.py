"""Provider abstraction. Every candidate generation backend conforms to this."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Sequence


@dataclass
class GenerationRequest:
    pack_id: str
    pack_type: str                          # character_pack / room_pack / ...
    target_dims: Sequence[Sequence[int]]    # [[w, h], ...]
    prompt: str                             # base prompt text (style guide + intent)
    references: List[Path] = field(default_factory=list)
    count: int = 1
    metadata: dict = field(default_factory=dict)
    correction_notes: Optional[str] = None  # set for regen requests
    parent_candidate_id: Optional[str] = None
    seed: Optional[int] = None


@dataclass
class GeneratedImage:
    image_bytes: bytes              # raw PNG bytes
    provider_name: str              # e.g. "openrouter:openai/gpt-image-1"
    prompt: str                     # final prompt sent (after augmentation)
    metadata: dict = field(default_factory=dict)


class BaseProvider(ABC):
    """Provider interface.

    Implementations must:
      - never auto-approve or auto-finalize
      - preserve provenance (prompt, references, provider name)
      - raise ProviderError on hard failures (rate limit, auth, timeout)
    """

    name: str = "base"

    @abstractmethod
    def is_available(self) -> bool:
        """Return True iff this provider can generate now (creds/network)."""

    @abstractmethod
    def generate(self, req: GenerationRequest) -> List[GeneratedImage]:
        """Return req.count generated images. Raises on failure."""


class ProviderError(Exception):
    """Raised on provider hard failure (auth, rate, timeout, payload shape)."""

    def __init__(self, code: str, detail: dict | None = None):
        super().__init__(code)
        self.code = code
        self.detail = detail or {}
