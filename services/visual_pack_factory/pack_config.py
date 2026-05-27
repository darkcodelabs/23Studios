"""Shared helpers for visual-pack on-disk state.

State root:
    <packs_root>/<project_id>/                         project root
    <packs_root>/<project_id>/<pack_id>/               per-pack root
    <packs_root>/<project_id>/<pack_id>/pack_config.yaml
    <packs_root>/<project_id>/<pack_id>/style/style_guide.md
    <packs_root>/<project_id>/<pack_id>/references/
    <packs_root>/<project_id>/<pack_id>/inbox/
    <packs_root>/<project_id>/<pack_id>/sources/source_registry.yaml
    <packs_root>/<project_id>/<pack_id>/candidates/<candidate_id>.png
    <packs_root>/<project_id>/<pack_id>/candidates/<candidate_id>.json
    <packs_root>/<project_id>/<pack_id>/reviews/review_queue.yaml
    <packs_root>/<project_id>/<pack_id>/reviews/approvals.yaml
    <packs_root>/<project_id>/<pack_id>/reviews/rejections.yaml
    <packs_root>/<project_id>/<pack_id>/reviews/correction_notes/<candidate_id>.md
    <packs_root>/<project_id>/<pack_id>/exports/approved/<candidate_id>.png
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import yaml

# Resolution order:
#   1. --packs-root CLI flag (highest)
#   2. VISUAL_PACKS_ROOT env (set by Node service)
#   3. <repo>/server/data/visual_packs              (dev default)
DEFAULT_PACKS_ROOT = (
    Path(__file__).resolve().parent.parent.parent
    / "server" / "data" / "visual_packs"
)

PACK_TYPES = {
    "character_pack",
    "room_pack",
    "prop_pack",
    "ui_pack",
    "animation_pack",
    "tile_pack",
    "portrait_pack",
}

ALLOWED_STATES = {
    "generated",
    "queued_for_review",
    "approved_for_iteration",
    "approved_final",
    "rejected",
    "needs_correction",
    "exported",
    "hardware_reviewed",
}

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def assert_slug(s: str, field: str) -> str:
    if not isinstance(s, str) or not SLUG_RE.match(s):
        raise ValueError(f"invalid {field} (slug rule failed): {s!r}")
    return s


def packs_root(override: Optional[str] = None) -> Path:
    if override:
        return Path(override).resolve()
    env = os.environ.get("VISUAL_PACKS_ROOT")
    if env:
        return Path(env).resolve()
    return DEFAULT_PACKS_ROOT.resolve()


def project_root(project_id: str, root_override: Optional[str] = None) -> Path:
    return packs_root(root_override) / assert_slug(project_id, "project_id")


def pack_root(project_id: str, pack_id: str, root_override: Optional[str] = None) -> Path:
    return project_root(project_id, root_override) / assert_slug(pack_id, "pack_id")


def ensure_pack_skeleton(pid: str, pack_id: str, root_override: Optional[str] = None) -> Path:
    root = pack_root(pid, pack_id, root_override)
    for sub in (
        "style",
        "references",
        "references/characters",
        "references/rooms",
        "references/ui",
        "references/props",
        "references/materials",
        "inbox/images",
        "inbox/urls",
        "inbox/screenshots",
        "inbox/sketches",
        "inbox/notes",
        "sources",
        "prompts",
        "candidates",
        "reviews",
        "reviews/correction_notes",
        "exports/approved",
        "exports/contact_sheets",
        "exports/silhouette_sheets",
        "exports/hardware_review",
    ):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def load_yaml(path: Path) -> Any:
    if not path.exists():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8")) or None


def dump_yaml(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(data, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )


def load_json(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def load_pack_config(pid: str, pack_id: str, root_override: Optional[str] = None) -> Dict[str, Any]:
    path = pack_root(pid, pack_id, root_override) / "pack_config.yaml"
    data = load_yaml(path)
    if not isinstance(data, dict):
        raise FileNotFoundError(f"pack_config.yaml missing or invalid: {path}")
    return data


def save_pack_config(pid: str, pack_id: str, cfg: Dict[str, Any], root_override: Optional[str] = None) -> None:
    path = pack_root(pid, pack_id, root_override) / "pack_config.yaml"
    dump_yaml(path, cfg)


def candidate_meta_path(pid: str, pack_id: str, candidate_id: str, root_override: Optional[str] = None) -> Path:
    assert_slug(candidate_id, "candidate_id")
    return pack_root(pid, pack_id, root_override) / "candidates" / f"{candidate_id}.json"


def candidate_image_path(pid: str, pack_id: str, candidate_id: str, ext: str, root_override: Optional[str] = None) -> Path:
    assert_slug(candidate_id, "candidate_id")
    if not re.match(r"^(png|jpg|jpeg|gif)$", ext.lower()):
        raise ValueError(f"unsupported candidate ext: {ext!r}")
    return pack_root(pid, pack_id, root_override) / "candidates" / f"{candidate_id}.{ext.lower()}"


def iter_candidates(pid: str, pack_id: str, root_override: Optional[str] = None) -> Iterable[Dict[str, Any]]:
    cdir = pack_root(pid, pack_id, root_override) / "candidates"
    if not cdir.exists():
        return
    for f in sorted(cdir.glob("*.json")):
        meta = load_json(f)
        if isinstance(meta, dict):
            yield meta


def list_packs(pid: str, root_override: Optional[str] = None) -> List[Dict[str, Any]]:
    pr = project_root(pid, root_override)
    if not pr.exists():
        return []
    out: List[Dict[str, Any]] = []
    for d in sorted(pr.iterdir()):
        if not d.is_dir():
            continue
        cfg_path = d / "pack_config.yaml"
        cfg = load_yaml(cfg_path) if cfg_path.exists() else None
        if isinstance(cfg, dict):
            out.append(cfg)
    return out


def append_yaml_list(path: Path, entry: Dict[str, Any]) -> None:
    data = load_yaml(path) or []
    if not isinstance(data, list):
        raise ValueError(f"expected list in {path}")
    data.append(entry)
    dump_yaml(path, data)
