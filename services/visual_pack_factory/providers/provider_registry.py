"""Registry of swappable candidate-generation providers."""

from __future__ import annotations

from typing import Dict, Type

from .base_provider import BaseProvider, ProviderError
from .mock_provider import MockProvider
from .openrouter_provider import OpenRouterProvider


_PROVIDERS: Dict[str, Type[BaseProvider]] = {
    "mock": MockProvider,
    "openrouter": OpenRouterProvider,
}


def get_provider(name: str) -> BaseProvider:
    """Return an instance of the named provider.

    Raises ProviderError(code="unknown_provider") for unrecognised names.
    """
    cls = _PROVIDERS.get(name)
    if cls is None:
        raise ProviderError("unknown_provider",
                            {"available": sorted(_PROVIDERS.keys())})
    return cls()


def list_providers() -> list[str]:
    return sorted(_PROVIDERS.keys())
