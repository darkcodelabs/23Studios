'use strict';

// Pulp Autopilot — the "PRESS GO" orchestrator.
//
// Given a one-sentence pitch, drives the full pulp pipeline end-to-end:
//   1-7   workflow stages (brainstorm → menus) via pulp_workflow.runStage
//   8     scripts stage
//   9     asset.tile_burst  — generate tile art for cast portraits + filler
//   10    asset.scene_burst — generate room backgrounds for world.locations
//   11    asset.sound_burst — 6 default sfx via pulp_ai.generateSound
//   12    workflow.playtest
//
// Emits SSE-like events through onEvent: 'phase', 'log', 'asset', 'done',
// 'error'. Stage failures are recorded + skipped (recoverable=true). Only
// truly fatal errors (project missing, disk failure) abort the run.
//
// Concurrency contract:
//   - Claude (sendMessage) calls: ONE per project at a time. pulp_workflow
//     already serializes its own writes via withLock, but our orchestrator
//     also runs the stages sequentially (steps 2..8) so we never race the
//     subprocess.
//   - Image gen (pulp_ai.generateTileArt / generateScene): up to 4 concurrent
//     via an in-process pool.
//
// In-memory job map; one autopilot per project at a time.

const projects = require('./projects');
const wf = require('./pulp_workflow');
const ai = require('./pulp_ai');
const pulp = require('./pulp_project');
const scenes = require('./pulp_scenes');
const portraits = require('./pulp_portraits');
const assets = require('./pulp_assets');

const PIPELINE_STAGES = [
  'brainstorm', 'story', 'characters', 'world',
  'mechanics', 'vibe', 'menus', 'scripts'
];

const ASSET_STAGE_ID = 'assets';
const PLAYTEST_STAGE_ID = 'playtest';

const TILE_FILLER_PROMPTS = [
  'a stone floor tile',
  'a brick wall block',
  'a wooden door',
  'a sturdy chest',
  'a glowing coin',
  'a leafy bush',
  'a flowing water tile',
  'a flickering torch'
];

const DEFAULT_SOUND_PROMPTS = [
  { id: 'sfx_click',   name: 'click',   prompt: 'a soft UI click sound, short tick' },
  { id: 'sfx_confirm', name: 'confirm', prompt: 'a positive UI confirmation chirp, two-note rise' },
  { id: 'sfx_cancel',  name: 'cancel',  prompt: 'a UI cancel sound, descending two-note negative' },
  { id: 'sfx_pickup',  name: 'pickup',  prompt: 'an item pickup jingle, bright triangle wave' },
  { id: 'sfx_bump',    name: 'bump',    prompt: 'a soft bump or footstep thud' },
  { id: 'sfx_win',     name: 'win',     prompt: 'a brief victory fanfare, two short notes' }
];

const IMAGE_CONCURRENCY = 4;
const PITCH_MAX = 4000;

// In-memory job registry. Map<projectId, job>
const JOBS = new Map();

function aErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

function humanErr(e) {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  if (e.code && typeof e.code === 'string') {
    if (e.detail) {
      if (typeof e.detail === 'string') return `${e.code}: ${e.detail}`;
      try { return `${e.code}: ${JSON.stringify(e.detail)}`; } catch (_) { return e.code; }
    }
    return e.code;
  }
  if (e.message && typeof e.message === 'string') return e.message;
  try { return JSON.stringify(e); } catch (_) { return String(e); }
}

function sanitizePitch(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return clean.slice(0, PITCH_MAX).trim();
}

function slugifyId(s) {
  let v = String(s || '').toLowerCase();
  v = v.replace(/[^a-z0-9_-]+/g, '_');
  v = v.replace(/_+/g, '_');
  v = v.replace(/^[-_]+/, '');
  if (!v) v = 'tile';
  if (!/^[a-z0-9]/.test(v)) v = 'a' + v;
  return v.slice(0, 56);
}

function isJobRunning(projectId) {
  const j = JOBS.get(projectId);
  return !!(j && j.running);
}

function getJobStatus(projectId) {
  const j = JOBS.get(projectId);
  if (!j) {
    return { running: false, current_stage: null, summary: null };
  }
  return {
    running: !!j.running,
    current_stage: j.current_stage || null,
    summary: j.summary || null,
    pitch: j.pitch || ''
  };
}

function cancelJob(projectId) {
  const j = JOBS.get(projectId);
  if (!j || !j.running) return false;
  j.cancelled = true;
  if (j.activeRunner && typeof j.activeRunner.abort === 'function') {
    try { j.activeRunner.abort(); } catch (_e) { /* noop */ }
  }
  return true;
}

// Drive a pulp_workflow.runStage call as a Promise; cancels via abort.
function runStagePromise({ projectId, stageId, userPrompt, model, onLog, getAbortHandle }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handle = wf.runStage({
      projectId,
      stageId,
      userPrompt,
      model,
      onChunk: (txt) => {
        if (typeof onLog === 'function') {
          // Throttle log lines a bit — only newlines and only the last 200 chars.
          const piece = String(txt || '');
          if (piece.length > 0) onLog(piece.slice(-400));
        }
      },
      onParsed: (payload) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      },
      onError: (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      }
    });
    if (typeof getAbortHandle === 'function') getAbortHandle(handle);
  });
}

// Build a per-stage user_prompt grounded in the pitch. The orchestrator
// always sends a useful instruction so Claude doesn't end up with an empty
// brief.
function buildStagePrompt(stageId, pitch) {
  const base = `Pitch (one sentence): "${pitch}"`;
  switch (stageId) {
    case 'brainstorm':
      return `${base}\n\nFlesh out this pitch into a short brainstorm: genre, hooks, target audience.`;
    case 'story':
      return `${base}\n\nWrite a tight 3-act story arc, with 2-4 beats per act and 1-3 themes.`;
    case 'characters':
      return `${base}\n\nDesign a small cast (3-5 characters) for this Playdate pulp game. Give each character an id, name, role, short bio, and a portrait_prompt that describes the character as 1-bit pixel art.`;
    case 'world':
      return `${base}\n\nDefine 4-6 locations for this pulp game. For each location include an id, name, vivid 1-2 sentence description, and a room_id (the location id again is fine).`;
    case 'mechanics':
      return `${base}\n\nDefine the core gameplay: game_type (one of: adventure, puzzle, action), a short list of player verbs, the primary loop, and the win condition.`;
    case 'vibe':
      return `${base}\n\nDefine the audio-visual vibe: aesthetic_lock (one paragraph), palette_notes, soundscape_notes, and 3-5 style_refs.`;
    case 'menus':
      return `${base}\n\nDesign the title screen and main menu: title.layout, title.prompt, main_menu.items (3-5 short labels).`;
    case 'scripts':
      return `${base}\n\nWrite a short PulpScript-style game_script (a few lines), one short script per tile (3-6 tiles), and one short script per room (3-5 rooms). Use only ascii.`;
    case 'playtest':
      return `${base}\n\nList 3-5 likely playtest issues (id, severity high|medium|low, description) and a short notes paragraph.`;
    default:
      return base;
  }
}

// Run image-gen tasks with a simple concurrency pool.
async function runPool(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await tasks[idx]() }; }
      catch (e) { results[idx] = { ok: false, error: e }; }
    }
  }
  const workers = [];
  const n = Math.max(1, Math.min(concurrency, tasks.length));
  for (let k = 0; k < n; k++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// Convert an image base64 PNG (from pulp_ai.generateTileArt) into a 256-bit
// frame string + persist a tile in the project.
async function persistTileFromBase64(projectId, idHint, name, b64) {
  if (!b64) throw new Error('no image data');
  const buf = Buffer.from(b64, 'base64');
  const pixels = await assets.convertPngToTileFrame(buf);
  // Pick a safe pulp id; if collision, suffix with -2, -3, etc.
  const baseId = slugifyId(idHint || name || 'tile');
  let id = baseId;
  let n = 2;
  for (;;) {
    try {
      await pulp.addCollectionItem(projectId, 'tiles', {
        id,
        name: (name || baseId).slice(0, 64),
        type: 'sprite',
        solid: false,
        frames: [{ pixels }],
        fps: 0,
        script: ''
      });
      return id;
    } catch (e) {
      if (e && e.code === 'duplicate_id' && n < 50) {
        id = `${baseId}_${n}`.slice(0, 60);
        n++;
        continue;
      }
      throw e;
    }
  }
}

// Persist a sound spec into the project (no audio file — pulp sounds are
// synthesized from the spec by the runtime).
async function persistSoundSpec(projectId, id, name, spec) {
  let finalId = slugifyId(id || name || 'sfx');
  let n = 2;
  for (;;) {
    try {
      await pulp.addCollectionItem(projectId, 'sounds', {
        id: finalId,
        name: (name || finalId).slice(0, 64),
        waveform: spec.waveform,
        freq_start: spec.freq_start,
        freq_end: spec.freq_end,
        duration_ms: spec.duration_ms,
        envelope: spec.envelope
      });
      return finalId;
    } catch (e) {
      if (e && e.code === 'duplicate_id' && n < 50) {
        finalId = `${slugifyId(id || name || 'sfx')}_${n}`.slice(0, 60);
        n++;
        continue;
      }
      throw e;
    }
  }
}

// Ensure a room exists with the given id. If missing, add a blank 15x25 grid.
async function ensureRoom(projectId, roomId, name) {
  const { project: cur } = await pulp.readPulp(projectId);
  const exists = (cur.rooms || []).some((r) => r.id === roomId);
  if (exists) return roomId;
  const blank = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 25; x++) row.push('');
    blank.push(row);
  }
  try {
    await pulp.addCollectionItem(projectId, 'rooms', {
      id: roomId,
      name: (name || roomId).slice(0, 64),
      song: '',
      grid: blank,
      script: ''
    });
    return roomId;
  } catch (e) {
    if (e && e.code === 'duplicate_id') return roomId;
    throw e;
  }
}

// --- Public API ---

/**
 * startAutopilot({ projectId, pitch, model, onEvent }) -> { job, awaitDone }
 *
 * Returns synchronously with the job record and a Promise that resolves
 * after the run finishes (success OR failure — never rejects).
 */
function startAutopilot({ projectId, pitch, model, onEvent }) {
  if (isJobRunning(projectId)) {
    throw aErr(409, 'autopilot_already_running');
  }
  const cleanPitch = sanitizePitch(pitch);
  if (!cleanPitch) throw aErr(400, 'bad_request', 'pitch required');

  const emit = (event, data) => {
    if (typeof onEvent !== 'function') return;
    try { onEvent(event, data); } catch (_e) { /* listener error */ }
  };

  const job = {
    projectId,
    pitch: cleanPitch,
    model: model || null,
    running: true,
    cancelled: false,
    current_stage: null,
    activeRunner: null,
    started_at: Date.now(),
    summary: {
      tiles_added: 0,
      scenes_added: 0,
      sounds_added: 0,
      stages_complete: 0,
      stages_failed: 0
    }
  };
  JOBS.set(projectId, job);

  const phases = [
    { id: 'brainstorm',     label: 'brainstorm',     kind: 'workflow' },
    { id: 'story',          label: 'story',          kind: 'workflow' },
    { id: 'characters',     label: 'characters',     kind: 'workflow' },
    { id: 'world',          label: 'world',          kind: 'workflow' },
    { id: 'mechanics',      label: 'mechanics',      kind: 'workflow' },
    { id: 'vibe',           label: 'vibe',           kind: 'workflow' },
    { id: 'menus',          label: 'menus',          kind: 'workflow' },
    { id: 'tile_burst',     label: 'generate tile art', kind: 'asset' },
    { id: 'scene_burst',    label: 'generate scenes',   kind: 'asset' },
    { id: 'sound_burst',    label: 'generate sounds',   kind: 'asset' },
    { id: 'scripts',        label: 'scripts',        kind: 'workflow' },
    { id: 'playtest',       label: 'playtest',       kind: 'workflow' }
  ];

  const totalPhases = phases.length;

  const awaitDone = (async () => {
    try {
      // 0. Validate project is pulp.
      const project = await projects.getProject(projectId);
      if (!project) {
        emit('error', { message: 'project not found', stage: null, recoverable: false });
        return;
      }
      if (project.game_type !== 'pulp') {
        emit('error', { message: 'not a pulp project', stage: null, recoverable: false });
        return;
      }

      // We pull world/characters outputs after their stages run so the asset
      // bursts have something to feed off of.
      let charactersOut = null;
      let worldOut = null;

      for (let pIdx = 0; pIdx < phases.length; pIdx++) {
        if (job.cancelled) {
          emit('log', { text: 'autopilot cancelled' });
          break;
        }
        const phase = phases[pIdx];
        job.current_stage = phase.id;
        const pct = Math.round((pIdx / totalPhases) * 100);
        emit('phase', { stage: phase.id, label: phase.label, pct });

        if (phase.kind === 'workflow') {
          const prompt = buildStagePrompt(phase.id, cleanPitch);
          try {
            const payload = await runStagePromise({
              projectId,
              stageId: phase.id,
              userPrompt: prompt,
              model: job.model || undefined,
              onLog: (t) => emit('log', { text: t }),
              getAbortHandle: (h) => { job.activeRunner = h; }
            });
            job.summary.stages_complete += 1;
            emit('log', { text: `[${phase.id}] complete` });
            if (phase.id === 'characters') charactersOut = payload && payload.output;
            if (phase.id === 'world') worldOut = payload && payload.output;
          } catch (e) {
            job.summary.stages_failed += 1;
            emit('error', {
              message: humanErr(e),
              stage: phase.id,
              recoverable: true
            });
            emit('log', { text: `[${phase.id}] failed (continuing)` });
          } finally {
            job.activeRunner = null;
          }
          continue;
        }

        // Asset phases.
        if (phase.id === 'tile_burst') {
          await runTileBurst({ projectId, charactersOut, model: job.model, emit, job });
        } else if (phase.id === 'scene_burst') {
          await runSceneBurst({ projectId, worldOut, model: job.model, emit, job });
        } else if (phase.id === 'sound_burst') {
          await runSoundBurst({ projectId, emit, job });
        }
      }

      // Mark the assets workflow stage complete with our accumulated summary.
      try {
        await wf.applyStageOutput(projectId, ASSET_STAGE_ID, {
          tile_ids_planned: [],
          scene_room_ids: [],
          sound_ids: DEFAULT_SOUND_PROMPTS.map((s) => s.id),
          generation_log: [
            `tiles_added=${job.summary.tiles_added}`,
            `scenes_added=${job.summary.scenes_added}`,
            `sounds_added=${job.summary.sounds_added}`
          ]
        });
        job.summary.stages_complete += 1;
      } catch (_e) {
        // Non-fatal — assets stage may already be in_progress or locked.
      }

      emit('done', { summary: job.summary });
    } catch (e) {
      emit('error', { message: humanErr(e), stage: job.current_stage, recoverable: false });
    } finally {
      job.running = false;
      job.current_stage = null;
      job.activeRunner = null;
    }
  })();

  // Don't let unhandled rejections crash the process — emit catches everything.
  awaitDone.catch(() => {});

  return { job, awaitDone };
}

async function runTileBurst({ projectId, charactersOut, model, emit, job }) {
  const project = await projects.getProject(projectId);
  if (!project) return;

  // ---- 1) Character portraits (64x64 proper portrait pipeline) ----
  const cast = Array.isArray(charactersOut && charactersOut.cast) ? charactersOut.cast : [];
  const portraitTasks = [];
  for (const c of cast.slice(0, 8)) {
    const idHint = c && (c.id || c.name) ? slugifyId(c.id || c.name) : null;
    if (!idHint) continue;
    const prompt = (c && (c.portrait_prompt || c.bio || c.name)) || 'a mysterious character';
    portraitTasks.push(async () => {
      if (job.cancelled) throw aErr(499, 'cancelled');
      // Ensure a Character record exists (idempotent). pulp.getCharacter throws
      // 404 'item_not_found' when missing — that's expected; create then.
      let existing = null;
      try { existing = await pulp.getCharacter(projectId, idHint); }
      catch (e) { if (e && (e.code === 'item_not_found' || e.status === 404)) existing = null; else { emit('log', { text: `character ${idHint}: ${humanErr(e)}` }); return null; } }
      if (!existing) {
        try {
          await pulp.createCharacter(projectId, {
            id: idHint,
            name: c.name || idHint,
            role: c.role || '',
            bio: (c.bio || '').slice(0, 1000),
            portrait_prompt: prompt.slice(0, 1000)
          });
        } catch (e) {
          emit('log', { text: `character ${idHint} create: ${humanErr(e)}` });
          return null;
        }
      }
      try {
        await portraits.generateAndSavePortrait({
          projectId, safeCid: idHint, prompt, model: model || undefined
        });
        job.summary.portraits_added = (job.summary.portraits_added || 0) + 1;
        emit('asset', {
          kind: 'portrait',
          id: idHint,
          count_so_far: job.summary.portraits_added,
          total_planned: cast.length
        });
        return idHint;
      } catch (e) {
        emit('log', { text: `portrait ${idHint}: ${humanErr(e)}` });
        return null;
      }
    });
  }

  // ---- 2) Generic filler world tiles (still 16x16 pulp tiles) ----
  const tileLabels = TILE_FILLER_PROMPTS.map((p, i) => ({
    idHint: `tile_${i + 1}`, name: p.slice(0, 40), prompt: p
  }));
  const tileTasks = tileLabels.map((lab) => async () => {
    if (job.cancelled) throw aErr(499, 'cancelled');
    const out = await ai.generateTileArt({
      projectId, prompt: lab.prompt, model: model || undefined
    });
    const id = await persistTileFromBase64(projectId, lab.idHint, lab.name, out.image_base64);
    job.summary.tiles_added += 1;
    emit('asset', {
      kind: 'tile', id,
      count_so_far: job.summary.tiles_added,
      total_planned: tileLabels.length
    });
    return id;
  });

  emit('log', { text: `tile_burst: ${portraitTasks.length} portraits + ${tileLabels.length} tiles queued` });
  const allTasks = portraitTasks.concat(tileTasks);
  const results = await runPool(allTasks, IMAGE_CONCURRENCY);
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    emit('log', { text: `tile_burst: ${failed}/${allTasks.length} failed` });
  }
}

async function runSceneBurst({ projectId, worldOut, model, emit, job }) {
  const locations = Array.isArray(worldOut && worldOut.locations) ? worldOut.locations : [];
  const planned = locations.slice(0, 8);
  if (planned.length === 0) {
    emit('log', { text: 'scene_burst: no world.locations — skipped' });
    return;
  }

  // First ensure rooms exist (needed so saveSceneAndPatchRoom can patch them).
  for (const loc of planned) {
    if (job.cancelled) return;
    const rid = slugifyId(loc.room_id || loc.id || loc.name);
    if (!rid) continue;
    try { await ensureRoom(projectId, rid, loc.name || rid); }
    catch (e) {
      emit('log', { text: `room ${rid}: ${humanErr(e)}` });
    }
  }

  const tasks = planned.map((loc) => async () => {
    if (job.cancelled) throw aErr(499, 'cancelled');
    const rid = slugifyId(loc.room_id || loc.id || loc.name);
    if (!rid) return null;
    const prompt = `${loc.name || rid}: ${loc.description || 'a moody location'}`;
    const out = await scenes.generateAndSaveScene({
      projectId,
      safeRid: rid,
      prompt,
      model: model || undefined
    });
    job.summary.scenes_added += 1;
    emit('asset', {
      kind: 'scene',
      id: rid,
      count_so_far: job.summary.scenes_added,
      total_planned: planned.length
    });
    return out;
  });

  emit('log', { text: `scene_burst: ${planned.length} scenes queued` });
  const results = await runPool(tasks, IMAGE_CONCURRENCY);
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    emit('log', { text: `scene_burst: ${failed}/${planned.length} failed` });
  }
}

async function runSoundBurst({ projectId, emit, job }) {
  emit('log', { text: `sound_burst: ${DEFAULT_SOUND_PROMPTS.length} sfx queued` });
  // Run sounds sequentially (each calls Claude — keep it serial per project).
  for (const s of DEFAULT_SOUND_PROMPTS) {
    if (job.cancelled) break;
    try {
      const spec = await ai.generateSound({ projectId, prompt: s.prompt });
      const id = await persistSoundSpec(projectId, s.id, s.name, spec);
      job.summary.sounds_added += 1;
      emit('asset', {
        kind: 'sound',
        id,
        count_so_far: job.summary.sounds_added,
        total_planned: DEFAULT_SOUND_PROMPTS.length
      });
    } catch (e) {
      emit('log', { text: `sound ${s.id}: ${humanErr(e)}` });
    }
  }
}

module.exports = {
  startAutopilot,
  getJobStatus,
  cancelJob,
  isJobRunning,
  // exported for tests
  _internals: {
    sanitizePitch,
    slugifyId,
    buildStagePrompt,
    PIPELINE_STAGES,
    DEFAULT_SOUND_PROMPTS,
    TILE_FILLER_PROMPTS
  }
};
