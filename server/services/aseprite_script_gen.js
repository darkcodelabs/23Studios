'use strict';

// Prompt→Aseprite script generation. Replaces raster image generation:
// instead of asking a model for pixels, we ask a TEXT model for an Aseprite
// Lua script that authors the pixels, then execute it headless via
// aseprite_runner.js and validate via aseprite_validate.js.
//
// generateAsset() is the full loop:
//   spec → Lua (LLM) → run (bwrap jail) → validate → on failure, feed the
//   error back and regenerate, up to maxAttempts. The winning script is
//   returned alongside the artifacts — the script IS the canonical source
//   and must be stored with the candidate.

const { spawn } = require('child_process');
const os = require('os');

const { streamChat } = require('./openrouter');
const runner = require('./aseprite_runner');
const { validateArtifact } = require('./aseprite_validate');
const driftDetect = require('./drift_detect');

const DEFAULT_MODEL = process.env.ASEPRITE_SCRIPT_MODEL || 'anthropic/claude-sonnet-4.5';
const MAX_ATTEMPTS = Number(process.env.ASEPRITE_GEN_MAX_ATTEMPTS || 3);
const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN || 'claude';

// Stateless one-shot Claude Code CLI call. Deliberately NOT claude.js's
// sendMessage: that keeps a per-project --continue session and writes project
// chat history — wrong surface for internal pipeline calls. Used when
// model === 'claude-code' or as automatic fallback when OpenRouter has no
// credits (402).
function claudeOneShot(text, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ['-p'], {
      cwd: os.tmpdir(),
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let errBuf = '';
    const killer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { errBuf += d; });
    proc.on('error', (e) => { clearTimeout(killer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(killer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude exited ${code}: ${errBuf.slice(0, 300)}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

// Curated API surface the model is allowed to lean on. Small on purpose:
// everything needed to author 1-bit sprites, nothing that touches the
// filesystem beyond the ASE_OUT_DIR contract.
const API_CHEATSHEET = `
ASEPRITE LUA API — ALLOWED SURFACE (Aseprite 1.3 scripting API):
- Sprite(w, h, ColorMode.INDEXED) — always INDEXED
- sprite.transparentColor = 0
- Palette(n); palette:setColor(i, Color{r,g,b,a}); sprite:setPalette(palette)
- sprite:newEmptyFrame() to add frames (frame 1 exists already)
- sprite:newCel(sprite.layers[1], frameNumber) → cel; cel.image → Image
- image:putPixel(x, y, paletteIndex) — 0-based coords
- image:drawImage(other, Point(x, y))
- sprite:newTag(fromFrame, toFrame); tag.name = "walk"
- app.fs.joinPath(a, b)
- os.getenv("ASE_OUT_DIR") — the ONLY writable directory
- sprite:saveAs(path) for the .aseprite source
- app.command.ExportSpriteSheet{ ui=false, askOverwrite=false,
    type=SpriteSheetType.HORIZONTAL or SpriteSheetType.ROWS,
    textureFilename=path, dataFilename="" }
FORBIDDEN (script is rejected before execution if present):
os.execute, io.popen, os.remove, os.rename, loadstring, dofile, require, WebSocket.
`.trim();

const PLAYDATE_CANON = `
PLAYDATE HARD RULES (violations auto-reject the artifact):
- Palette EXACTLY: index 0 transparent (a=0), index 1 pure black (0,0,0,255),
  index 2 pure white (255,255,255,255). Nothing else. No grays ever.
- Shading = dithering patterns drawn pixel-by-pixel (checkerboard/Bayer), never midtones.
- Imagetable export name MUST be <name>-table-<frameW>-<frameH>.png.
- Frames laid out left-to-right (HORIZONTAL) or row-per-state (ROWS), rectangular grid.
- Strong 2px-minimum silhouette strokes; asset must read at actual size on a
  400x240 1-bit reflective screen.
- Animated states need >= 4 frames.
- End the script with: print("ASE_GEN_OK")
`.trim();

function systemPrompt({ styleGuide, spec }) {
  const parts = [
    'You are a pixel-art author for Playdate. You produce ONE Aseprite Lua batch script and nothing else.',
    'The script procedurally authors the requested asset pixel-by-pixel. It is not placeholder art:',
    'invest real effort in silhouette, proportion, texture dithering, and per-frame animation change.',
    'Reply with ONLY a single ```lua fenced block. No prose before or after.',
    API_CHEATSHEET,
    PLAYDATE_CANON,
  ];
  if (styleGuide) parts.push(`PACK STYLE GUIDE:\n${styleGuide}`);
  if (spec) parts.push(`ASSET SPEC (authoritative):\n${JSON.stringify(spec, null, 2)}`);
  return parts.join('\n\n');
}

function extractLua(reply) {
  const m = /```lua\s*\n([\s\S]*?)```/.exec(reply) || /```\s*\n([\s\S]*?)```/.exec(reply);
  if (!m) return null;
  return m[1].trim();
}

async function generateScript({ prompt, spec, styleGuide, model, projectId, priorScript, failureNotes, signal }) {
  const messages = [{ role: 'system', content: systemPrompt({ styleGuide, spec }) }];
  if (priorScript) {
    messages.push({ role: 'assistant', content: '```lua\n' + priorScript + '\n```' });
    messages.push({
      role: 'user',
      content:
        `That script failed. Fix it and return the FULL corrected script.\n` +
        `Failure:\n${failureNotes}\n` +
        `Keep everything that worked; change only what is needed.`,
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  // Same pre-send drift contract as the old raster path (Phase 6 C3):
  // forbidden-token sweep always, canon vocabulary when project known.
  const driftMode = String(process.env.STUDIO_DRIFT_DETECT || 'block').toLowerCase();
  if (driftMode !== 'off') {
    const drift = await driftDetect.checkPromptDrift({
      projectId: projectId || null,
      prompt_body: messages.map((m) => m.content).join('\n'),
    });
    if (!drift.passes) {
      if (projectId) {
        try {
          await driftDetect.appendDriftFlag(projectId, {
            kind: 'pre_send',
            stage: 'aseprite_script',
            required_missing: drift.required_missing,
            forbidden_present: drift.forbidden_present,
            anchor_missing: drift.anchor_missing,
            drift_score: drift.drift_score,
            mode: driftMode,
          });
        } catch (_e) { /* never let logging fail the call */ }
      }
      if (driftMode !== 'log') {
        const e = new Error('drift_blocked');
        e.code = 'drift_blocked';
        e.status = 409;
        e.detail = drift;
        throw e;
      }
    }
  }

  const chosen = model || DEFAULT_MODEL;
  let reply;
  if (chosen === 'claude-code') {
    reply = await claudeOneShot(messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'));
  } else {
    try {
      reply = await streamChat({
        model: chosen,
        messages,
        projectId,
        stage: 'aseprite_script',
        onDelta: () => {},
        signal,
      });
    } catch (err) {
      // OpenRouter out of credits → emergency Claude Code CLI fallback,
      // same posture as the STRIKE planner/synth fallback.
      const status = err && (err.status || err.statusCode);
      if (status === 402 || /402/.test(String(err && err.message))) {
        reply = await claudeOneShot(messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'));
      } else {
        throw err;
      }
    }
  }

  const lua = extractLua(reply);
  if (!lua) {
    const e = new Error('no_lua_block');
    e.status = 502;
    throw e;
  }
  runner.screenScript(lua); // throws forbidden_lua_pattern with details
  return lua;
}

// Full generation loop. spec:
// { name, kind: 'imagetable'|'image', frameW, frameH, frames, states? }
// Returns { ok, script, attempts, artifacts, validation, jobId, history }.
async function generateAsset({ prompt, spec, styleGuide, model, projectId, maxAttempts = MAX_ATTEMPTS, signal }) {
  const history = [];
  let priorScript = null;
  let failureNotes = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let script;
    try {
      script = await generateScript({ prompt, spec, styleGuide, model, projectId, priorScript, failureNotes, signal });
    } catch (err) {
      history.push({ attempt, phase: 'script_gen', error: err.code || err.message, detail: err.detail });
      if (err.message === 'forbidden_lua_pattern' || err.code === 'forbidden_lua_pattern') {
        priorScript = null;
        failureNotes = `Script used a forbidden Lua pattern: ${JSON.stringify(err.detail)}`;
        continue;
      }
      throw err;
    }

    const run = await runner.runScript(script, { projectId });
    if (!run.ok) {
      history.push({
        attempt, phase: 'execute', jobId: run.jobId, exitCode: run.exitCode,
        timedOut: run.timedOut, stderr: run.stderr.slice(-2000),
      });
      priorScript = script;
      failureNotes =
        `aseprite exited ${run.exitCode}${run.timedOut ? ' (TIMEOUT)' : ''}, ` +
        `artifacts=${run.artifacts.length}\nstderr (tail):\n${run.stderr.slice(-2000)}`;
      continue;
    }

    const pngs = run.artifacts.filter((a) => a.name.endsWith('.png'));
    const validations = [];
    for (const png of pngs) {
      validations.push({ artifact: png.name, ...(await validateArtifact(png.path, spec)) });
    }
    const failed = validations.filter((v) => !v.ok);
    if (failed.length === 0 && pngs.length > 0) {
      history.push({ attempt, phase: 'validated', jobId: run.jobId });
      return { ok: true, script, attempts: attempt, jobId: run.jobId, jobDir: run.jobDir, artifacts: run.artifacts, validation: validations, history };
    }

    history.push({ attempt, phase: 'validate', jobId: run.jobId, failed });
    priorScript = script;
    failureNotes =
      `Script ran but artifacts failed validation:\n${JSON.stringify(failed, null, 2)}\n` +
      `Remember: only palette indexes 0/1/2, pure black/white, exact frame dims, ` +
      `-table-${spec.frameW}-${spec.frameH}.png naming.`;
    await runner.cleanupJob(run.jobId);
  }

  return { ok: false, script: priorScript, attempts: maxAttempts, artifacts: [], validation: [], history };
}

module.exports = { generateAsset, generateScript, extractLua, DEFAULT_MODEL };
