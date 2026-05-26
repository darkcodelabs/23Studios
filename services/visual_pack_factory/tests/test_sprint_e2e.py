"""End-to-end sprint smoke for the visual_pack_factory.

Exercises every CLI required by docs/visual-sprint DoD:

    add_source -> generate_pack -> queue_review -> approve_candidate ->
    reject_candidate -> export_candidate -> hardware_review ->
    build_contact_sheet (candidates, silhouettes, hardware) ->
    build_reference_board -> extract_style_notes ->
    update_visual_spec (V3 schema, merges into hakcd repo) ->
    validate_pack (--enforce-hardware)

Asserts:
  - all 5 sprint packs initialized
  - inspiration sources registered (image / url / note)
  - candidates generated with status=generated, art_status=generated
  - approve --level final REQUIRES --reviewer
  - rejected candidates do not export
  - hardware_reviewed=true only via hardware_review tool (not simulator)
  - 1-bit color check rejects grey-ramp PNGs
  - visual_spec.lua updated with V3 schema, hand-authored entries preserved
  - V3 validator (hakcd-v4 tools/canon/validate_visuals.sh) exits 0
  - validate_pack with --enforce-hardware exits 0 on approved candidate
  - re-runs are idempotent (visual_spec content identical)

Run: python -m tests.test_sprint_e2e
Exit 0 = pass, non-zero = fail.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FACTORY_ROOT = Path(__file__).resolve().parents[1]
HAKCD_REPO = Path("/home/hakcer/projects/hakcd-v4")
V3_VALIDATOR = HAKCD_REPO / "tools" / "canon" / "validate_visuals.sh"

sys.path.insert(0, str(FACTORY_ROOT))

from PIL import Image  # noqa: E402

from tools import (  # noqa: E402
    add_source,
    approve_candidate,
    build_contact_sheet,
    build_reference_board,
    export_candidate,
    extract_style_notes,
    generate_pack,
    hardware_review,
    init_pack,
    queue_review,
    reject_candidate,
    seed_hakcd_packs,
    update_visual_spec,
    validate_pack,
)
from tools import _common  # noqa: E402


# ---------- emit capture ----------------------------------------------------
class EmitCapture:
    """Capture emit() output via stdout interception (works across modules)."""

    def __init__(self):
        self.lines = []

    def __enter__(self):
        self._buf = []
        self._orig_write = sys.stdout.write
        self._orig_flush = sys.stdout.flush
        sys.stdout.write = self._write
        sys.stdout.flush = self._flush
        return self

    def __exit__(self, *exc):
        sys.stdout.write = self._orig_write
        sys.stdout.flush = self._orig_flush
        for chunk in "".join(self._buf).splitlines():
            chunk = chunk.strip()
            if chunk.startswith("{"):
                try:
                    self.lines.append(json.loads(chunk))
                except Exception:
                    pass

    def _write(self, s):
        self._buf.append(s)
        return len(s)

    def _flush(self):
        pass

    @property
    def last(self):
        return self.lines[-1] if self.lines else None


def call(fn, **kwargs) -> dict:
    """Invoke a tool's main() with kwargs as argparse.Namespace, capture emit."""
    ns = argparse.Namespace(**kwargs)
    cap = EmitCapture()
    with cap:
        try:
            fn(ns)
        except SystemExit as e:
            if e.code not in (0, None):
                # Some tools use SystemExit(2/3) for validate; surface it.
                raise
    if not cap.lines:
        raise RuntimeError(f"{fn.__module__} emitted no JSON")
    return cap.last


def call_expect_fail(fn, **kwargs) -> dict:
    """Invoke and expect SystemExit (fail). Return the last emitted payload.

    Some tools fail via fail() (ok:false). Others (validate_pack) emit a
    truthy report and then sys.exit(non-zero). Either form counts.
    """
    ns = argparse.Namespace(**kwargs)
    cap = EmitCapture()
    raised = False
    with cap:
        try:
            fn(ns)
        except SystemExit as e:
            raised = e.code not in (0, None)
    assert raised, f"{fn.__module__} should have failed (SystemExit non-zero)"
    assert cap.lines, "expected at least one emit before failure"
    return cap.lines[-1]


# ---------- fixtures --------------------------------------------------------
def make_1bit_png(path: Path, w: int, h: int, pattern: str = "checker") -> None:
    """Write a pure 1-bit RGB PNG (only (0,0,0) and (255,255,255))."""
    im = Image.new("RGB", (w, h), (255, 255, 255))
    if pattern == "checker":
        for y in range(h):
            for x in range(w):
                if (x // 2 + y // 2) % 2 == 0:
                    im.putpixel((x, y), (0, 0, 0))
    elif pattern == "solid":
        im = Image.new("RGB", (w, h), (0, 0, 0))
    elif pattern == "hands":
        for y in range(h // 3, 2 * h // 3):
            for x in range(w // 3, 2 * w // 3):
                im.putpixel((x, y), (0, 0, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG")


def make_grey_png(path: Path, w: int, h: int) -> None:
    """Write a grey-ramp PNG that MUST fail the 1-bit check."""
    im = Image.new("RGB", (w, h), (128, 128, 128))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG")


# ---------- main flow -------------------------------------------------------
def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix="sprint_e2e_"))
    packs_root = workdir / "packs_root"
    fixtures = workdir / "fixtures"
    fixtures.mkdir(parents=True)
    repo = workdir / "hakcd-repo"

    # Copy a minimal HAKCD repo so we have a real visual_spec.lua to merge into.
    (repo / "source/data").mkdir(parents=True)
    (repo / "source/images").mkdir(parents=True)
    (repo / "tools/canon").mkdir(parents=True)
    shutil.copy(HAKCD_REPO / "source/data/visual_spec.lua",
                repo / "source/data/visual_spec.lua")
    shutil.copy(HAKCD_REPO / "source/pdxinfo", repo / "source/pdxinfo")
    shutil.copy(V3_VALIDATOR, repo / "tools/canon/validate_visuals.sh")

    # Mirror the existing image and sound files so V3 V1 path checks pass for
    # hand-authored entries.
    for ext in ("png", "wav"):
        for p in (HAKCD_REPO / "source").rglob(f"*.{ext}"):
            rel = p.relative_to(HAKCD_REPO / "source")
            dst = repo / "source" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists():
                try:
                    dst.symlink_to(p)
                except OSError:
                    shutil.copy(p, dst)

    print(f"[sprint] workdir={workdir}")
    project = "hakcd"

    # --- 1. seed 5 required packs ----------------------------------------
    seed_out = call(seed_hakcd_packs.main, project=project, packs_root=str(packs_root))
    assert len(seed_out.get("seeded", [])) == 5, f"expected 5 seeded, got: {seed_out}"
    print(f"[sprint] seeded packs: {seed_out['seeded']}")

    # --- 2. add sources to newb_character_pack ---------------------------
    ref_img = fixtures / "ref.png"
    make_1bit_png(ref_img, 48, 48, pattern="hands")
    src1 = call(add_source.main, project=project, pack="newb_character_pack",
                type="image", file=str(ref_img), url=None, text=None,
                usage="inspiration_only",
                notes="silhouette ref, hands centered", packs_root=str(packs_root))
    assert src1["source"]["type"] == "image"

    src2 = call(add_source.main, project=project, pack="newb_character_pack",
                type="url", file=None, url="https://example.com/ref.png",
                text=None, usage="inspiration_only", notes="online ref",
                packs_root=str(packs_root))
    assert src2["source"]["type"] == "url"

    src3 = call(add_source.main, project=project, pack="newb_character_pack",
                type="note", file=None, url=None,
                text="Chunky proportions, hands legible at 24in",
                usage="inspiration_only", notes="director note",
                packs_root=str(packs_root))
    assert src3["source"]["type"] == "note"
    print("[sprint] added 3 sources (image/url/note)")

    # --- 3. ingest 3 candidates -----------------------------------------
    cand_files = []
    for i, variant in enumerate(["a", "b", "c"]):
        p = fixtures / f"cand_{variant}.png"
        make_1bit_png(p, 48, 48, pattern="hands" if variant != "c" else "checker")
        cand_files.append(p)

    candidates: list[dict] = []
    for p, variant in zip(cand_files, ["a", "b", "c"]):
        out = call(generate_pack.main, project=project, pack="newb_character_pack",
                   file=str(p), batch=None, variant=variant, source_ids="",
                   provider="manual", prompt_hash=None, packs_root=str(packs_root))
        assert out["candidates"][0]["status"] == "generated"
        assert out["candidates"][0]["art_status"] == "generated"
        assert out["candidates"][0]["human_reviewed"] is False
        candidates.append(out["candidates"][0])
    print(f"[sprint] ingested {len(candidates)} candidates (status=generated)")

    # --- 4. queue review ------------------------------------------------
    qout = call(queue_review.main, project=project, pack="newb_character_pack",
                candidate=None, packs_root=str(packs_root))
    assert len(qout["queued"]) == 3
    print(f"[sprint] queued: {qout['queued']}")

    # --- 5. final approval requires --reviewer --------------------------
    fail_payload = call_expect_fail(
        approve_candidate.main,
        project=project, pack="newb_character_pack",
        candidate=candidates[0]["candidate_id"], level="final",
        reviewer=None, notes="", packs_root=str(packs_root),
    )
    assert fail_payload["code"] == "reviewer_required_for_final"
    print("[sprint] approve --level final without --reviewer correctly rejected")

    # Approve candidate A as final
    appr = call(approve_candidate.main, project=project, pack="newb_character_pack",
                candidate=candidates[0]["candidate_id"], level="final",
                reviewer="cory", notes="silhouette + hands clean",
                packs_root=str(packs_root))
    assert appr["candidate"]["status"] == "approved_final"
    assert appr["candidate"]["human_reviewed"] is True
    assert appr["candidate"]["approved_by"] == "cory"

    # --- 6. reject candidate B with correction --------------------------
    correction_md = fixtures / "correction.md"
    correction_md.write_text("# Keep\n- silhouette\n\n# Change\n- thicken pants\n", encoding="utf-8")
    rej = call(reject_candidate.main, project=project, pack="newb_character_pack",
               candidate=candidates[1]["candidate_id"], reason="hands unreadable",
               reviewer="cory", correction=True,
               correction_md=str(correction_md), packs_root=str(packs_root))
    assert rej["candidate"]["status"] == "needs_correction"

    # Reject candidate C outright
    rej2 = call(reject_candidate.main, project=project, pack="newb_character_pack",
                candidate=candidates[2]["candidate_id"], reason="unreadable silhouette",
                reviewer="cory", correction=False, correction_md=None,
                packs_root=str(packs_root))
    assert rej2["candidate"]["status"] == "rejected"
    print("[sprint] rejection + correction workflows recorded")

    # --- 7. export approved (with dimension + 1-bit guards) -------------
    # First try to export rejected — should fail.
    fail_exp = call_expect_fail(
        export_candidate.main, project=project, pack="newb_character_pack",
        candidate=candidates[2]["candidate_id"],
        project_local_path=str(repo), asset_name=None,
        enforce_hardware=False, packs_root=str(packs_root),
    )
    assert fail_exp["code"] == "not_approved_final"
    print("[sprint] rejected candidate refused export")

    # Export approved A
    exp = call(export_candidate.main, project=project, pack="newb_character_pack",
               candidate=candidates[0]["candidate_id"],
               project_local_path=str(repo),
               asset_name="newb-table-48-48.png",
               enforce_hardware=False, packs_root=str(packs_root))
    assert exp["candidate"]["status"] == "exported"
    exported_png = Path(exp["exported_to"])
    assert exported_png.exists()
    print(f"[sprint] exported to {exported_png}")

    # --- 8. 1-bit color check rejects grey PNG --------------------------
    grey = fixtures / "grey.png"
    make_grey_png(grey, 48, 48)
    out = call(generate_pack.main, project=project, pack="newb_character_pack",
               file=str(grey), batch=None, variant="d", source_ids="",
               provider="manual", prompt_hash=None, packs_root=str(packs_root))
    grey_cid = out["candidates"][0]["candidate_id"]
    call(queue_review.main, project=project, pack="newb_character_pack",
         candidate=grey_cid, packs_root=str(packs_root))
    call(approve_candidate.main, project=project, pack="newb_character_pack",
         candidate=grey_cid, level="final", reviewer="cory",
         notes="", packs_root=str(packs_root))
    # validate_pack must catch the 1-bit violation. validate_one returns errors,
    # but main() sys.exit(3) on any error — capture via SystemExit.
    fail_val = call_expect_fail(
        validate_pack.main, project=project, pack="newb_character_pack",
        enforce_hardware=False, packs_root=str(packs_root),
    )
    one_bit_errs = [
        e for r in fail_val.get("reports", [])
        for e in r.get("errors", [])
        if e["code"] == "not_1bit_color"
    ]
    assert one_bit_errs, f"expected not_1bit_color error, got: {fail_val}"
    print(f"[sprint] grey PNG caught by 1-bit check: {one_bit_errs[0]['offending_colors']}")
    # Reset by rejecting the grey candidate so the rest of the test passes.
    call(reject_candidate.main, project=project, pack="newb_character_pack",
         candidate=grey_cid, reason="not 1-bit", reviewer="cory",
         correction=False, correction_md=None, packs_root=str(packs_root))

    # --- 9. hardware review records device photo ------------------------
    hw_photo = fixtures / "device.jpg"
    Image.new("RGB", (640, 480), (10, 10, 10)).save(hw_photo, "JPEG")
    hw = call(hardware_review.main, project=project, pack="newb_character_pack",
              candidate=candidates[0]["candidate_id"], photo=str(hw_photo),
              reviewer="cory", verdict="pass",
              notes="hands legible from 24in", packs_root=str(packs_root))
    assert hw["candidate"]["hardware_reviewed"] is True
    print("[sprint] hardware review recorded")

    # --- 10. update_visual_spec — merges into hakcd visual_spec.lua ----
    before = (repo / "source/data/visual_spec.lua").read_text(encoding="utf-8")
    spec_out = call(update_visual_spec.main, project=project,
                    project_local_path=str(repo),
                    spec_relpath="source/data/visual_spec.lua",
                    packs_root=str(packs_root),
                    allow_overwrite_unmanaged=False)
    after = (repo / "source/data/visual_spec.lua").read_text(encoding="utf-8")
    assert spec_out["factory_owned"] == 1, f"expected 1 factory entry, got {spec_out}"
    assert spec_out["preserved"] == 44, f"expected 44 preserved, got {spec_out}"
    assert "source_pack = \"newb_character_pack\"" in after
    print(f"[sprint] visual_spec merged: {spec_out['factory_owned']} factory + {spec_out['preserved']} preserved")

    # --- 11. idempotency -----------------------------------------------
    spec_out2 = call(update_visual_spec.main, project=project,
                     project_local_path=str(repo),
                     spec_relpath="source/data/visual_spec.lua",
                     packs_root=str(packs_root),
                     allow_overwrite_unmanaged=False)
    after2 = (repo / "source/data/visual_spec.lua").read_text(encoding="utf-8")
    assert after == after2, "merger not idempotent"
    print("[sprint] visual_spec re-run is idempotent")

    # --- 12. V3 validator on merged hakcd output -----------------------
    proc = subprocess.run(
        ["bash", str(repo / "tools/canon/validate_visuals.sh")],
        cwd=str(repo), capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"V3 validator failed:\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    )
    print("[sprint] V3 validator exit=0 against merged spec")

    # --- 13. validate_pack passes with --enforce-hardware --------------
    # validate_pack expects every approved_final to have hardware_reviewed.
    # The pack has one exported (A, hw=true) and the grey-cand was rejected.
    val_pass = call(validate_pack.main, project=project,
                    pack="newb_character_pack",
                    enforce_hardware=True, packs_root=str(packs_root))
    pack_errs = sum(len(r["errors"]) for r in val_pass["reports"])
    assert pack_errs == 0, f"validate_pack --enforce-hardware failed: {val_pass}"
    print("[sprint] validate_pack --enforce-hardware exit=0")

    # --- 14. contact sheets (candidates + silhouettes + hardware) ------
    cs1 = call(build_contact_sheet.main, project=project,
               pack="newb_character_pack", mode="candidates",
               tile_size=128, cols=4, packs_root=str(packs_root))
    assert Path(cs1["contact_sheet"]).exists()
    cs2 = call(build_contact_sheet.main, project=project,
               pack="newb_character_pack", mode="silhouettes",
               tile_size=128, cols=4, packs_root=str(packs_root))
    assert Path(cs2["contact_sheet"]).exists()
    cs3 = call(build_contact_sheet.main, project=project,
               pack="newb_character_pack", mode="hardware",
               tile_size=128, cols=4, packs_root=str(packs_root))
    assert Path(cs3["contact_sheet"]).exists()
    print(f"[sprint] contact sheets built: {cs1['items']} / {cs2['items']} / {cs3['items']}")

    # --- 15. reference board (mood board from sources) -----------------
    rb = call(build_reference_board.main, project=project,
              pack="newb_character_pack", tile_size=128, cols=3,
              packs_root=str(packs_root))
    assert Path(rb["board"]).exists(), f"reference board not written: {rb}"
    print(f"[sprint] reference board: {rb['board']}")

    # --- 16. extract style notes ---------------------------------------
    sn = call(extract_style_notes.main, project=project,
              pack="newb_character_pack", packs_root=str(packs_root))
    assert Path(sn["notes_path"]).exists(), f"style notes not written: {sn}"
    print(f"[sprint] style notes: {sn['notes_path']} (analyzed={sn['analyzed']})")

    print("\n[sprint] ALL DoD ITEMS PASS")
    print(f"[sprint] workdir retained for inspection: {workdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
