# server/tests

`node --test tests` runs every `*.test.js` here. Use `node:test` + `node:assert`
only — no jest, no mocha.

## Files

- `dither.test.js` — image dither algorithm sanity (existing).
- `pulp_transpiler.test.js` — PulpScript -> Lua codegen fixtures (existing).
- `sdk_prompt_assembly.test.js` — unit tests for
  `services/sdk_prompt_assembly.js` (UNIVERSAL_DIRECTIVE, STAGE_AUGMENTS,
  `assembleSystemPrompt`, `buildSceneLuaFromFeatures`, `runQaChecklist`).
  Tests `t.skip()` with a TODO when the module hasn't landed yet so the
  gap stays visible in CI output.
- `sdk_export_qa.test.js` — integration test for the section-16 QA gate
  against a synthetic on-disk bad scene under `/tmp/qa_fixture_<pid>/`.
  Skips with TODO when `runQaChecklist` isn't exported yet.
- `intake_form.test.js` — unit tests for `services/intake.js`'s
  `inferMissingFields` + `renderStoryBible`. Uses a deterministic Claude
  stub via the `claudeFn` injection point. Skips with TODO when the
  intake module hasn't landed yet.
- `fixtures/minimal_intake.json` — pitch-only intake form used by the
  intake test + the smoke script.

## Smoke (`npm run smoke:sdk`)

`scripts/smoke_sdk_pipeline.js` runs three offline phases end-to-end and
prints PASS/FAIL per phase. Each phase mocks its external dependency so
the script never touches the network or a real Playdate SDK binary.

| Phase | What it covers | Mocked |
|-------|----------------|--------|
| 1 | intake form -> `story_bible.md` round-trip | Claude (`claudeFn` injection) |
| 2 | single autopilot stage: assembled system prompt = directive + bible + stage augment, then a stubbed Claude reply | Claude (`services/claude.js` swapped in `require.cache`), image gen (`services/pulp_ai.js` swapped) |
| 3 | real `sdk_export` packaging path (project.json read, scene Lua emit, asset copy, pdxinfo, pdc invocation) | `child_process.spawn` intercepted to fake the `pdc` call; also fakes `which pdc` |

Whatever subset of the new wolf-* modules has landed gets exercised for
real; the rest is patched out so the smoke still completes. The script
exits 0 if all three phases pass, 1 otherwise.

Run from anywhere:

    npm --prefix server run smoke:sdk

Workdir lives at `/tmp/smoke_sdk_<pid>/` and is kept on disk after the
run for inspection.

## Mockable deps

- `services/claude.js` — `sendMessage` accepts `{onChunk, onDone, onError}`
  callbacks; substitute the whole module in `require.cache` or inject a
  `claudeFn` where supported.
- `services/openrouter.js` — same treatment if needed; smoke script does
  not exercise it.
- `services/pulp_ai.js` — `generateScene` + `generatePortrait` are the
  image-gen entrypoints; stub to return `{buffer, width, height}` with a
  tiny PNG.
- `child_process.spawn` — wrap to intercept `pdc` invocations; everything
  else (ffmpeg, which) can pass through.

## Conventions

- Tests must be hermetic: no real Claude / OpenRouter / pdc.
- `t.skip()` with a `TODO(wolf-<lane>):` prefix when a dependent module
  hasn't landed. Re-enable in the follow-up commit that lands the module.
