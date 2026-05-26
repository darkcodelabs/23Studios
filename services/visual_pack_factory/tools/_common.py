"""Tool-level helpers: arg parsing and JSON result printing."""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from typing import Any, Callable, Dict


def base_parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--project", required=True, help="project id (slug)")
    p.add_argument("--packs-root", default=None,
                   help="override packs root (else VISUAL_PACKS_ROOT or default)")
    return p


def emit(result: Dict[str, Any]) -> None:
    """Print a JSON line to stdout. Node service parses last JSON line."""
    out = {"ok": True, **result}
    sys.stdout.write(json.dumps(out, default=str) + "\n")
    sys.stdout.flush()


def fail(code: str, detail: Any = None, status: int = 1) -> None:
    sys.stdout.write(json.dumps({"ok": False, "code": code, "detail": detail}) + "\n")
    sys.stdout.flush()
    sys.exit(status)


def run(main_fn: Callable[[argparse.Namespace], None]) -> None:
    try:
        parser = main_fn.__globals__["build_parser"]()
        args = parser.parse_args()
        main_fn(args)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        fail("tool_exception", {"error": str(e), "traceback": traceback.format_exc()})
