"""Merge factory-owned entries into a hakcd-style visual_spec.lua.

The downstream consumer (hakcd-v4 `tools/canon/validate_visuals.sh`) parses a
Lua file shaped like:

    local visual_spec = {
        <bareword_id> = {
            art_status = "final" | "placeholder" | "generated" | "wip" | "debug",
            type = "image" | "imagetable" | "sfx" | "music" | "tileset",
            path = "images/foo",                -- relative, NO extension
            sheet_dimensions = { w = ..., h = ... },
            target_dimensions = { w = ..., h = ... },
            human_reviewed = true | false,
            reviewer = "...",
            reviewed_at = "...",
            meets_readability_min = true | false,
            target_replacement_version = nil,
            frame_count = 1,
            readability_min_pct_screen = 0,
            reference_image = nil,
            notes = "...",
            id = "<id>",
            -- Factory-owned entries also carry:
            source_pack = "<pack_id>",
            approved_candidate = "<candidate_id>",
            hardware_reviewed = true | false,
            exported_to = "/abs/path/to/asset.png",
        },
        ...
    }
    function visual_spec.placeholders() ... end
    ...
    _G.visual_spec = visual_spec
    return visual_spec

The factory owns ONLY entries whose block contains `source_pack = "..."`.
Every other entry (hand-authored, audio, debug fixtures) is preserved verbatim
across regenerations. An id collision between a factory candidate and a
hand-authored entry is treated as an error — the caller must rename or
explicitly opt in via `--allow-overwrite-unmanaged`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ENTRY_START_RE = re.compile(r"^    ([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*$")
SOURCE_PACK_RE = re.compile(r'^\s*source_pack\s*=\s*"([^"]+)"')
TABLE_OPEN_RE = re.compile(r"local\s+visual_spec\s*=\s*\{\s*$")


@dataclass
class Entry:
    entry_id: str
    text: str                       # original block text including trailing `},`
    source_pack: Optional[str]      # set if this entry was factory-written

    @property
    def factory_owned(self) -> bool:
        return self.source_pack is not None


@dataclass
class ParsedSpec:
    head: str                       # everything up to and including `local visual_spec = {`
    tail: str                       # everything from the closing `}` of the table onward
    entries: Dict[str, Entry]       # ordered insertion preserved by dict


def parse_spec(path: Path) -> ParsedSpec:
    """Parse a hakcd visual_spec.lua into head + entry blocks + tail.

    If the file is missing, returns an empty default skeleton suitable for
    being populated and written out. If the file exists but does not contain
    the `local visual_spec = {` opener, the whole file is treated as head and
    an empty entries dict is returned (caller can decide to overwrite or
    fail).
    """
    if not path.exists():
        return ParsedSpec(head=_default_head(), tail=_default_tail(), entries={})

    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()

    # Find `local visual_spec = {`.
    open_idx = None
    for i, line in enumerate(lines):
        if TABLE_OPEN_RE.search(line):
            open_idx = i
            break
    if open_idx is None:
        # File exists but isn't shaped like a visual_spec — return as head only.
        return ParsedSpec(head=raw, tail="", entries={})

    head = "\n".join(lines[: open_idx + 1]) + "\n"

    # Walk through entries until we hit the matching close `}` for the outer
    # table. Outer brace depth starts at 1 (the `{` on the open line).
    entries: Dict[str, Entry] = {}
    i = open_idx + 1
    n = len(lines)
    close_idx = None
    while i < n:
        line = lines[i]
        m = ENTRY_START_RE.match(line)
        if m:
            entry_id = m.group(1)
            # Collect lines until brace depth returns to 1 (the outer table).
            block_lines = [line]
            depth = 1  # `{` on this line
            j = i + 1
            while j < n and depth > 0:
                bl = lines[j]
                depth += bl.count("{") - bl.count("}")
                block_lines.append(bl)
                j += 1
                if depth == 0:
                    break
            block_text = "\n".join(block_lines) + "\n"
            sp = None
            for bl in block_lines:
                sm = SOURCE_PACK_RE.match(bl)
                if sm:
                    sp = sm.group(1)
                    break
            entries[entry_id] = Entry(entry_id=entry_id, text=block_text, source_pack=sp)
            i = j
            continue
        # Look for the outer table close: a `}` at indent 0 ending the table.
        if line.startswith("}"):
            close_idx = i
            break
        i += 1

    if close_idx is None:
        # Outer close not found — emit defensively, treat rest as tail.
        tail = "\n".join(lines[i:]) + ("\n" if raw.endswith("\n") else "")
    else:
        tail = "\n".join(lines[close_idx:]) + ("\n" if raw.endswith("\n") else "")

    return ParsedSpec(head=head, tail=tail, entries=entries)


def merge(
    parsed: ParsedSpec,
    new_entries: Dict[str, str],
    *,
    allow_overwrite_unmanaged: bool = False,
) -> Tuple[ParsedSpec, List[str]]:
    """Return a new ParsedSpec with `new_entries` merged in.

    `new_entries` maps entry_id -> rendered Lua block text (including the
    leading `    <id> = {` line and the trailing `    },` line, newline-
    terminated).

    Rules:
      - If id is absent in `parsed.entries`: append.
      - If id exists and the existing entry is factory-owned: replace.
      - If id exists and the existing entry is NOT factory-owned:
          * default: collect as conflict, do NOT replace.
          * with allow_overwrite_unmanaged=True: replace.

    Returns (merged, conflicts). On any conflicts (default), caller should
    abort rather than silently lose hand-authored data.
    """
    merged_entries: Dict[str, Entry] = {}
    conflicts: List[str] = []

    # Walk existing in order so non-factory and unmodified factory entries keep
    # their position. Replace where allowed. Then append truly new ids at end.
    for eid, ent in parsed.entries.items():
        if eid in new_entries:
            if ent.factory_owned or allow_overwrite_unmanaged:
                # Re-parse the new block to detect source_pack for the
                # next round.
                sp = _extract_source_pack(new_entries[eid])
                merged_entries[eid] = Entry(entry_id=eid, text=new_entries[eid], source_pack=sp)
            else:
                conflicts.append(eid)
                merged_entries[eid] = ent  # preserve original until conflict resolved
        else:
            merged_entries[eid] = ent

    for eid, block in new_entries.items():
        if eid not in merged_entries:
            sp = _extract_source_pack(block)
            merged_entries[eid] = Entry(entry_id=eid, text=block, source_pack=sp)

    return (
        ParsedSpec(head=parsed.head, tail=parsed.tail, entries=merged_entries),
        conflicts,
    )


def render(parsed: ParsedSpec) -> str:
    out: List[str] = [parsed.head]
    for ent in parsed.entries.values():
        out.append(ent.text)
    out.append(parsed.tail)
    return "".join(out)


def render_entry(
    entry_id: str,
    fields: Dict[str, object],
) -> str:
    """Render one Lua entry block, alphabetical field order matching V3 style.

    `fields` values may be:
      - str         → quoted Lua string
      - int / float → numeric literal
      - bool        → "true" / "false"
      - None        → "nil"
      - dict        → nested table (e.g. sheet_dimensions = { w = .., h = .. })
    """
    lines = [f"    {entry_id} = {{"]
    for key in sorted(fields.keys()):
        val = fields[key]
        lines.append(f"        {key} = {_lua_value(val, indent=8)}")
    # Match HAKCD style: field lines do not have trailing commas (only nested
    # tables do). We add commas between fields for parser tolerance, then a
    # trailing `}, on the closer.
    # Re-emit with commas + closing brace.
    out = [lines[0]]
    body_keys = sorted(fields.keys())
    for k in body_keys:
        v = fields[k]
        out.append(f"        {k} = {_lua_value(v, indent=8)},")
    out.append("    },")
    return "\n".join(out) + "\n"


def _lua_value(v: object, indent: int) -> str:
    if v is None:
        return "nil"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        escaped = v.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if isinstance(v, dict):
        if not v:
            return "{}"
        pad = " " * (indent + 4)
        end_pad = " " * indent
        parts = [
            f"{pad}{k} = {_lua_value(val, indent=indent + 4)}"
            for k, val in sorted(v.items())
        ]
        return "{\n" + ",\n".join(parts) + f"\n{end_pad}}}"
    raise TypeError(f"unsupported lua value type: {type(v).__name__}")


def _extract_source_pack(block_text: str) -> Optional[str]:
    for line in block_text.splitlines():
        m = SOURCE_PACK_RE.match(line)
        if m:
            return m.group(1)
    return None


def _default_head() -> str:
    return (
        "-- source/data/visual_spec.lua\n"
        "-- AUTO-GENERATED by visual_pack_factory.\n"
        "-- Hand-authored entries (no `source_pack` field) are preserved across regens.\n"
        "-- Factory-owned entries carry `source_pack = \"<pack_id>\"` and are rewritten.\n"
        "--\n"
        "-- art_status values:\n"
        "--   'final'       — authored, human-reviewed, ships canonically.\n"
        "--   'placeholder' — known-bad asset awaiting replacement.\n"
        "--   'generated'   — synthesized (sfx) or scraped (music); acceptable to ship.\n"
        "--   'wip'         — in active development, not ship-ready.\n"
        "--   'debug'       — engine fixtures, dev-only; should not appear in release.\n"
        "\n"
        "local visual_spec = {\n"
    )


def _default_tail() -> str:
    return (
        "}\n"
        "\n"
        "function visual_spec.placeholders()\n"
        "    local out = {}\n"
        "    for k, v in pairs(visual_spec) do\n"
        "        if type(v) == 'table' and v.art_status == 'placeholder' then\n"
        "            table.insert(out, k)\n"
        "        end\n"
        "    end\n"
        "    table.sort(out)\n"
        "    return out\n"
        "end\n"
        "\n"
        "function visual_spec.failing_readability()\n"
        "    local out = {}\n"
        "    for k, v in pairs(visual_spec) do\n"
        "        if type(v) == 'table' and v.meets_readability_min == false then\n"
        "            table.insert(out, k)\n"
        "        end\n"
        "    end\n"
        "    table.sort(out)\n"
        "    return out\n"
        "end\n"
        "\n"
        "_G.visual_spec = visual_spec\n"
        "return visual_spec\n"
    )
