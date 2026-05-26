# Visual Pack Factory — Build Report

**Date:** 2026-05-26
**Scope:** Authored-feeling Playdate visual production pipeline as a
**shared 23 Studios service**. Built to address HAKCD-v4 phases V4–V8
(Newb replacement, tileset replacement, bedroom rebuild, playground
rebuild, UI refactor) and enforce V10's visual signoff gate. Reusable by
every game on the platform.

---

## 1. What was done

A new service was added to `23studios/` that takes inspiration sources
(images, screenshots, sketches, URLs, notes), shepherds candidates through
a review → approval → hardware-review → export pipeline, and produces
authored-feeling art that lands in the game repo's `source/images/` plus a
regenerated `source/data/visual_spec.lua`. Generated art **cannot** become
final without recorded human signoff, and (after v0.2.0) cannot ship
without a device photo on file.

- Shared service — lives in 23studios, every game project consumes it.
  HAKCD does not own a copy.
- Per-project pack state lives outside any game repo, at
  `server/data/visual_packs/<projectId>/<packId>/`.
- Exports are written into the consuming game repo at export time
  (`<project.local_path>/source/images/…` and
  `<project.local_path>/source/data/visual_spec.lua`).
- End-to-end smoke pass confirmed:
  `init → ingest → queue → approve(final) → export → spec → validate`
  all return `{"ok": true}`. Resulting `visual_spec.lua` was authored
  cleanly with the expected schema.

---

## 2. What landed

### 2.1 Factory (Python)

Path: `23studios/services/visual_pack_factory/`

**Tools (14):**

| Tool | Purpose |
|---|---|
| `tools/init_pack.py` | Bootstrap a new pack (skeleton dirs, `pack_config.yaml`, base prompt seed) |
| `tools/add_source.py` | Register inspiration source (`image`/`screenshot`/`sketch`/`url`/`note`); usage forced to `inspiration_only` |
| `tools/generate_pack.py` | Ingest a candidate file (single or batch) with sidecar metadata; provider pluggable (`manual`, `openrouter:…`, `human-artist`) |
| `tools/queue_review.py` | Move `generated` candidates to `queued_for_review`; write to `reviews/review_queue.yaml` |
| `tools/approve_candidate.py` | Set `approved_for_iteration` or `approved_final`. `--level final` REQUIRES `--reviewer` and writes to `approvals.yaml` |
| `tools/reject_candidate.py` | Mark `rejected` or `needs_correction`; optional correction-notes markdown |
| `tools/export_candidate.py` | Copy `approved_final` candidate into game repo, enforce dimension match, mirror audit copy |
| `tools/build_contact_sheet.py` | Grid of candidates / silhouettes / hardware photos for fast visual review |
| `tools/build_reference_board.py` | Mood board from active sources + text legend for URL/note refs |
| `tools/extract_style_notes.py` | Compute mean luminance, dark/light ratios, edge density per source (signal for the human style guide) |
| `tools/convert_to_playdate.py` | 1-bit conversion. `--dither none` (hard threshold, default) or `--dither bayer4`. Floyd-Steinberg DENIED by design |
| `tools/hardware_review.py` | Attach device photo + reviewer verdict; **only path** to set `hardware_reviewed=true` |
| `tools/validate_pack.py` | Validator. Exit `0` pass / `2` warnings / `3` errors. `--enforce-hardware` after v0.2.0 |
| `tools/update_visual_spec.py` | Regenerate `source/data/visual_spec.lua` from approved candidate set |

**Wrappers, schemas, templates:**

- `tools/validate_visuals.sh` — drop-in for `hakcd-v4/tools/canon/validate_visuals.sh`. Env: `PROJECT_ID=hakcd ENFORCE_HW=1`
- `schemas/visual_pack.schema.json`, `schemas/candidate.schema.json`, `schemas/review.schema.json`
- `templates/style_guide.md` — placeholder skeleton (V1 overwrites per pack)
- `templates/prompt_{character,room,tile,prop,ui,animation}_pack.md` — type-specific base prompts with explicit silhouette / dither / negative rules

**Infrastructure:**

- `pack_config.py` — shared state helpers (slug rules, paths, YAML/JSON I/O, candidate iteration)
- `tools/_common.py` — arg-parsing + JSON-line emit pattern (Node parses last JSON line of stdout)
- `requirements.txt` — Pillow, PyYAML, jsonschema, rich, typer
- `installer.sh` — creates `.venv-visual-pack/`, installs deps, verifies ImageMagick (used only by `convert_to_playdate`, never for generation)
- `README.md` — full pipeline doc + REST surface + anti-pattern list

### 2.2 Per-project on-disk layout (created by factory)

```
server/data/visual_packs/<projectId>/<packId>/
  pack_config.yaml
  style/style_guide.md
  references/{characters,rooms,ui,props,materials}/
  inbox/{images,screenshots,sketches,urls,notes}/
  sources/source_registry.yaml
  sources/extracted_style_notes.yaml
  prompts/<type>_base.md
  candidates/<candidate_id>.{png,json}
  reviews/review_queue.yaml
  reviews/approvals.yaml
  reviews/rejections.yaml
  reviews/correction_notes/<candidate_id>.md
  exports/{approved,contact_sheets,silhouette_sheets,hardware_review}/
```

### 2.3 Candidate states

```
generated
  ↓ queue_review
queued_for_review
  ↓ approve --level iteration            ↘ reject
approved_for_iteration                      ↓
  ↓ approve --level final --reviewer       rejected / needs_correction
approved_final
  ↓ hardware_review --verdict pass
hardware_reviewed
  ↓ export_candidate (+ optional --enforce-hardware)
exported
```

Forbidden transitions:

- `generated → approved_final` without `--reviewer`
- `approved_final → exported` when dimensions ≠ `pack_config.target_dimensions`
- `approved_final → exported` with `--enforce-hardware` and no `hardware_reviewed=true`

---

## 3. Node integration

### 3.1 Service wrapper

`server/services/visual_pack.js` (~16 KB)

- Spawns Python tools via `child_process.spawn(py, args, { shell: false })`.
  Python picked in order:
  1. `services/visual_pack_factory/.venv-visual-pack/bin/python` (if present)
  2. `process.env.VISUAL_PACK_PYTHON`
  3. `python3`
- Sets `VISUAL_PACKS_ROOT` env so Python tools share the same root.
- Parses the **last JSON line** of stdout regardless of exit code
  (`validate_pack` returns `3` with a useful payload — we still consume it).
- Stderr is piped to the per-project `logBus` so observers see live output.
- 60s default timeout per tool, hard-killed on overrun.
- All inputs slug-validated against `^[a-z0-9][a-z0-9_-]{0,63}$` before
  reaching subprocess.
- Reuses `services/projects.js::getProject` to resolve `local_path` at
  export time and `services/playdate_validator.js` for the ingest gate.

**Exported functions:**

```
listPacks, initPack,
addSource,
listCandidates, ingestCandidate,
queueReview,
approveCandidate, rejectCandidate, exportCandidate,
recordHardwareReview,
buildContactSheet, buildReferenceBoard,
extractStyleNotes, convertToPlaydate,
validatePack, updateVisualSpec
```

### 3.2 REST routes

`server/routes/visual_pack.js` (~9 KB) — mounted at `/api/projects`,
inherits the global CSRF + auth chain from `index.js`.

```
GET    /projects/:id/visual-pack/packs
POST   /projects/:id/visual-pack/packs                                    init
POST   /projects/:id/visual-pack/packs/:packId/sources                    multipart
GET    /projects/:id/visual-pack/packs/:packId/candidates
POST   /projects/:id/visual-pack/packs/:packId/candidates                 multipart
POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/approve
POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/reject
POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/export
POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/hardware-review   multipart
POST   /projects/:id/visual-pack/packs/:packId/queue
POST   /projects/:id/visual-pack/packs/:packId/contact-sheet
POST   /projects/:id/visual-pack/packs/:packId/reference-board
POST   /projects/:id/visual-pack/packs/:packId/extract-style
POST   /projects/:id/visual-pack/validate
POST   /projects/:id/visual-pack/spec
POST   /projects/:id/visual-pack/convert
GET    /projects/:id/visual-pack/asset?path=<absolute>                    sandboxed download
```

**Multer config:** 10 MB / 1 file per request, in-memory storage,
LIMIT_FILE_SIZE → 413, LIMIT_FILE_COUNT → 400, LIMIT_UNEXPECTED_FILE → 400.

**Asset download:** strict path containment — request must resolve INSIDE
`PACKS_ROOT/<projectId>/`. No traversal, no symlink escape.

### 3.3 Mount in `server/index.js`

Two lines added (require + mount):

```js
const visualPackRouter = require('./routes/visual_pack');
// …
app.use('/api/projects', visualPackRouter);   // line 271
```

Sits after the existing `buildEventsRouter`, inside the auth+CSRF chain.

### 3.4 Reused existing infrastructure (per CLAUDE.md "Use what's already there")

- `services/projects.js` — project lookup, `local_path` resolution
- `services/playdate_validator.js` — `isPlaceholderScenePng` for ingest gate
- `services/logBus.js` — stderr / warn streaming to per-project subscribers
- `services/validation.js` — `validateId` for `:id` route param check
- `multer` — already a dep; same upload pattern as `routes/references.js`

No new LLM clients, no new image-gen libs, no TypeScript, no pnpm.

---

## 4. Anti-placeholder enforcement

Placeholder art was the root cause of the prior pipeline failure — the
factory exists to make shipping placeholders impossible. Enforcement is
layered at four points:

### 4.1 At Node ingest (boundary)

`services/visual_pack.js :: ingestCandidate` runs the uploaded PNG buffer
through `playdate_validator.isPlaceholderScenePng` **before** writing to
disk:

```
if (verdict.placeholder) {
  throw vpErr(422, 'placeholder_rejected', {
    reason: verdict.reason,
    hint: 'visual_pack_factory refuses placeholder art at ingest. ' +
          'Pass bypass_placeholder_gate=true only for intentional debug fixtures.'
  });
}
```

- HTTP `422 placeholder_rejected` returned to the caller.
- `bypass_placeholder_gate=true` is the **only** way past, intended for
  intentional debug fixtures. Bypassed candidates still get full
  downstream gating (state machine, dimension check, hardware review).
- Detector errors do NOT block the ingest (logged as a warn) — a flaky
  detector should never block real art.

### 4.2 In Python state machine

- `generate_pack.py` enters the candidate at `status="generated",
  art_status="generated", human_reviewed=false, approved=false`.
- `approve_candidate.py --level final` is the **only** transition to
  `approved_final`, and it REQUIRES `--reviewer`. Recorded in
  `reviews/approvals.yaml` with a UTC timestamp.
- `export_candidate.py` refuses to export anything that isn't
  `approved_final` with `human_reviewed=true`.

### 4.3 At export

`export_candidate.py`:

- Loads the candidate image, compares `im.size` to
  `pack_config.target_dimensions`. Mismatch → `dimension_mismatch` fail.
- With `--enforce-hardware`, refuses if `hardware_reviewed != true`.
- Writes both the game-repo copy AND an audit copy under
  `exports/approved/` so the trail survives even if the game repo is
  reset.

### 4.4 At validate (build gate)

`validate_pack.py` (exit `3` = build-blocking error) flags:

- `final_not_reviewed` — `approved_final` without `human_reviewed`
- `dim_mismatch` — any `approved_final` / `exported` whose PNG dimensions
  ≠ `target_dimensions`
- `image_missing` — sidecar metadata pointing at a non-existent file
- `non_inspiration_usage` — any source registered with anything other
  than `usage=inspiration_only` (copyright firewall)
- `missing_hardware_review` — with `--enforce-hardware`, any
  `approved_final` lacking a hardware record

`tools/validate_visuals.sh` is a drop-in build-gate wrapper:

```bash
PROJECT_ID=hakcd ENFORCE_HW=1 \
  /home/hakcer/projects/23studios/services/visual_pack_factory/tools/validate_visuals.sh
```

Exits `0` pass / `2` warnings / `3` errors. HAKCD-v4 wires this in to
replace its `tools/canon/validate_visuals.sh`.

### 4.5 Hardware-review rule (separate, intentionally strict)

Only `tools/hardware_review.py` (or the corresponding REST endpoint)
flips `hardware_reviewed`. Inputs required:

- `--photo <device_photo>` — real device photo, NOT a simulator screenshot
- `--reviewer <handle>`
- `--verdict pass|fail`

Photos are hashed and stored under `exports/hardware_review/`. Once V10's
gate is ENFORCED, no `approved_final` ships without a photo on file.

---

## 5. Smoke verification

End-to-end run on a synthetic 48x48 sprite confirmed every stage:

```
init_pack            → ok (pack_config.yaml written)
generate_pack        → ok (candidate ingested, status=generated)
queue_review         → ok (status=queued_for_review)
approve_candidate    → ok (status=approved_final, reviewer recorded)
export_candidate     → ok (PNG written to repo/source/images/, audit copy mirrored)
update_visual_spec   → ok (visual_spec.lua regenerated, 1 entry)
validate_pack        → ok (0 errors, 0 warnings)
```

Node modules both `require()` cleanly:

```
require('./server/routes/visual_pack');
require('./server/services/visual_pack');
// → OK
```

---

## 6. Out of scope (intentionally)

- **No UI page.** Service + REST only. UI can come later.
- **No actual image generation.** Factory is intake-only by design — any
  generator (OpenRouter via existing `pulp_ai.js`, human artists, an
  external pipeline) plugs in as a candidate provider.
- **No git commits.** All file changes left uncommitted for review.
- **No vendoring into HAKCD-v4.** Wire-in is via HTTP + the
  `validate_visuals.sh` wrapper. The factory lives in 23studios only.

---

## 7. Files added / changed

**Added (factory):**
- `services/visual_pack_factory/README.md`
- `services/visual_pack_factory/requirements.txt`
- `services/visual_pack_factory/installer.sh`
- `services/visual_pack_factory/pack_config.py`
- `services/visual_pack_factory/__init__.py`
- `services/visual_pack_factory/tools/__init__.py`
- `services/visual_pack_factory/tools/_common.py`
- `services/visual_pack_factory/tools/{14 tools}.py`
- `services/visual_pack_factory/tools/validate_visuals.sh`
- `services/visual_pack_factory/schemas/{visual_pack,candidate,review}.schema.json`
- `services/visual_pack_factory/templates/style_guide.md`
- `services/visual_pack_factory/templates/prompt_{6 types}.md`

**Added (Node):**
- `server/services/visual_pack.js`
- `server/routes/visual_pack.js`

**Changed (Node):**
- `server/index.js` — added `visualPackRouter` require + mount line
  (lines 68, 271)

**Added (HAKCD wire-in handoff):**
- `/home/hakcer/projects/hakcd-v4/docs/VISUAL_PACK_FACTORY_WIREIN.md`

**Added (this report):**
- `docs/VISUAL_PACK_FACTORY_BUILD_REPORT.md`

---

## 8. Pointers

| Need | Path |
|---|---|
| Factory source of truth | `services/visual_pack_factory/README.md` |
| Node service entry | `server/services/visual_pack.js` |
| REST routes | `server/routes/visual_pack.js` |
| Mount | `server/index.js:271` |
| HAKCD-side wire-in spec | `/home/hakcer/projects/hakcd-v4/docs/VISUAL_PACK_FACTORY_WIREIN.md` |
| HAKCD pack-ids index (to be created during wire-in) | `/home/hakcer/projects/hakcd-v4/docs/visual_packs.md` |
