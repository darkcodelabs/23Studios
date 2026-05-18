'use strict';

// sdk_export.js — Playdate native-SDK export pipeline (game_type='sdk').
//
// In contrast to pulp_export this skips the PulpScript transpiler entirely.
// SDK projects are Lua-native: scenes already are Lua modules, sprites use
// imagetables, audio = real wav/mp3 files. Export = stage everything under
// /tmp/build/<jobId>/source/ and run pdc.
//
// Tree shape inside <stage>/source/:
//   main.lua                   (copied verbatim from sdk_runtime_lua/main.lua)
//   pdxinfo                    (generated)
//   runtime/                   (copied from sdk_runtime_lua/)
//   assets/
//     game_data.lua            (emitted: { startup_scene, scenes:{id->path} })
//     scenes/<id>.png          (400x240 1-bit scene backgrounds)
//     characters/<id>-table-W-H.png   (imagetable sprite sheets)
//     sounds/*.wav             (sfx + bgm)
//   scenes/<id>.lua            (per-scene Lua emitted by autopilot or
//                               hand-authored; loaded by main via require_scene)

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const projects = require('./projects');
const assembly = require('./sdk_prompt_assembly');

const RUNTIME_DIR = path.join(__dirname, 'sdk_runtime_lua');
const ROOT_BUILD_DIR = path.join(os.tmpdir(), '23studios_sdk_build');

// Run the section-16 QA checklist against the staged build + sdk data.
// Returns { pass: bool, failures: [{check, where, detail}] }. Does NOT
// throw — caller decides whether to gate pdc on the result.
function runQaChecklist(stageDir, project, sdkData) {
  const failures = [];
  const scenes = Array.isArray(sdkData && sdkData.scenes) ? sdkData.scenes : [];
  for (const check of (assembly.QA_CHECKS || [])) {
    if (check.scope === 'scene') {
      for (const s of scenes) {
        try {
          const detail = check.run(s, sdkData, project);
          if (detail) failures.push({ check: check.id,
                                       where: 'scene:' + (s && s.id),
                                       detail });
        } catch (e) {
          failures.push({ check: check.id,
                          where: 'scene:' + (s && s.id),
                          detail: 'check threw: ' + e.message });
        }
      }
    } else if (check.scope === 'project') {
      try {
        const detail = check.run(sdkData, project, stageDir);
        if (detail) failures.push({ check: check.id,
                                     where: 'project',
                                     detail });
      } catch (e) {
        failures.push({ check: check.id, where: 'project',
                        detail: 'check threw: ' + e.message });
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

const _jobs = new Map();

function newJobId() {
  return 'sdk_' + crypto.randomBytes(8).toString('hex');
}

function log(onEvent, text) {
  if (typeof onEvent === 'function') {
    try { onEvent({ type: 'log', text }); } catch (_e) { /* ignore */ }
  }
}

function progress(onEvent, step, pct, msg) {
  if (typeof onEvent === 'function') {
    try { onEvent({ type: 'progress', step, pct, msg }); } catch (_e) { /* ignore */ }
  }
}

async function copyDir(src, dst) {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}

function whichBin(name) {
  return new Promise((resolve) => {
    const r = require('child_process').spawnSync('which', [name], { encoding: 'utf8' });
    resolve(r.status === 0 && r.stdout ? r.stdout.trim() : null);
  });
}

function findPdc() {
  const candidates = [
    process.env.PLAYDATE_SDK_PATH && path.join(process.env.PLAYDATE_SDK_PATH, 'bin', 'pdc'),
    path.join(os.homedir(), 'Developer', 'PlaydateSDK', 'bin', 'pdc'),
    '/opt/PlaydateSDK/bin/pdc',
    '/usr/local/bin/pdc',
    '/usr/bin/pdc'
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).mode & 0o111) return c;
  }
  // fallback to PATH lookup via spawnSync('which')
  const { spawnSync } = require('child_process');
  const w = spawnSync('which', ['pdc'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout) return w.stdout.trim();
  return null;
}

function runPdc(pdcBin, sourceDir, outPdx, onEvent) {
  return new Promise((resolve, reject) => {
    const args = [sourceDir, outPdx];
    const child = spawn(pdcBin, args, { shell: false });
    child.stdout.on('data', (b) => {
      for (const line of b.toString().split(/\r?\n/)) if (line) log(onEvent, '[pdc] ' + line);
    });
    child.stderr.on('data', (b) => {
      for (const line of b.toString().split(/\r?\n/)) if (line) log(onEvent, '[pdc!] ' + line);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('pdc exit ' + code));
    });
  });
}

// Build assets/game_data.lua from the SDK project file.
function buildGameDataLua(project, sdkData) {
  const scenes = Array.isArray(sdkData.scenes) ? sdkData.scenes : [];
  const startup = sdkData.startup_scene
    || (scenes[0] && scenes[0].id)
    || 'title';
  const sceneMap = scenes.reduce((m, s) => {
    if (s && s.id) m[s.id] = `scenes/${s.id}`;
    return m;
  }, {});
  // Emit minimal Lua module.
  const lines = ['-- generated by sdk_export.js — do not edit', '',
    'game_data = {',
    `  startup_scene = ${JSON.stringify(startup)},`,
    '  scenes = {'];
  for (const id of Object.keys(sceneMap)) {
    lines.push(`    [${JSON.stringify(id)}] = ${JSON.stringify(sceneMap[id])},`);
  }
  lines.push('  }', '}', '', 'return game_data', '');
  return lines.join('\n');
}

function buildPdxInfo(project, jobId) {
  const lines = [
    `name=${(project.name || project.id || 'SDK Game').slice(0, 64)}`,
    `author=${(project.developer || project.publisher || '23 Studios').slice(0, 64)}`,
    `description=${(project.description || '').slice(0, 256)}`,
    `bundleID=ai.darkcode.${(project.id || jobId).replace(/[^a-z0-9._-]/gi, '').toLowerCase().slice(0, 32)}`,
    `version=0.1.0`,
    `buildNumber=1`,
    `imagePath=launcher`
  ];
  return lines.join('\n') + '\n';
}

async function readSdkData(project) {
  // sdk data lives under <local_path>/sdk_data/project.json
  const sdkDataPath = path.join(project.local_path || '', 'sdk_data', 'project.json');
  if (!fs.existsSync(sdkDataPath)) {
    return { scenes: [], entities: [], startup_scene: 'title' };
  }
  try {
    return JSON.parse(await fsp.readFile(sdkDataPath, 'utf8'));
  } catch (e) {
    throw new Error('sdk_data/project.json parse failed: ' + e.message);
  }
}

async function startExport({ projectId, onEvent }) {
  const project = await projects.getProject(projectId);
  if (!project) throw Object.assign(new Error('not_found'), { status: 404 });
  if (project.game_type !== 'sdk') {
    throw Object.assign(new Error('not_sdk_project'), { status: 400 });
  }
  if (!project.local_path) throw new Error('project has no local_path');

  const jobId = newJobId();
  const stageRoot = path.join(ROOT_BUILD_DIR, jobId);
  const sourceDir = path.join(stageRoot, 'source');
  const buildDir = path.join(stageRoot, 'build');
  const runtimeDir = path.join(sourceDir, 'runtime');
  const assetsDir = path.join(sourceDir, 'assets');
  const scenesAssetsDir = path.join(assetsDir, 'scenes');
  const charactersDir = path.join(assetsDir, 'characters');
  const soundsDir = path.join(assetsDir, 'sounds');
  const scenesScriptsDir = path.join(sourceDir, 'scenes');

  const job = {
    id: jobId, project_id: projectId, status: 'running',
    started_at: Date.now(), stage_dir: stageRoot
  };
  _jobs.set(jobId, job);

  (async () => {
    try {
      progress(onEvent, 'stage', 10, 'preparing build tree');
      await fsp.rm(stageRoot, { recursive: true, force: true });
      for (const d of [sourceDir, buildDir, runtimeDir, assetsDir,
                       scenesAssetsDir, charactersDir, soundsDir, scenesScriptsDir]) {
        await fsp.mkdir(d, { recursive: true });
      }
      // Stamp the stage dir with the project id so getJobsByProject() can
      // recover after a server restart.
      await fsp.writeFile(path.join(stageRoot, '.project_id'), projectId);

      progress(onEvent, 'runtime', 20, 'copying sdk runtime');
      await copyDir(RUNTIME_DIR, runtimeDir);
      // main.lua lives at source/, not runtime/.
      const mainSrc = path.join(runtimeDir, 'main.lua');
      if (fs.existsSync(mainSrc)) {
        await fsp.rename(mainSrc, path.join(sourceDir, 'main.lua'));
      }
      // README under concepts/ is documentation, not pdc-friendly. Strip it.
      const conceptReadme = path.join(runtimeDir, 'concepts', 'README.md');
      if (fs.existsSync(conceptReadme)) await fsp.unlink(conceptReadme);

      const sdkData = await readSdkData(project);

      progress(onEvent, 'data', 30, 'emitting game_data.lua');
      await fsp.writeFile(path.join(assetsDir, 'game_data.lua'),
                          buildGameDataLua(project, sdkData));

      progress(onEvent, 'scenes', 40, 'copying scene backgrounds + per-scene Lua');
      const sceneAssetsSrc = path.join(project.local_path, 'sdk_data', 'scenes');
      if (fs.existsSync(sceneAssetsSrc)) {
        for (const f of fs.readdirSync(sceneAssetsSrc)) {
          if (/\.(png|gif|jpe?g)$/i.test(f)) {
            await fsp.copyFile(path.join(sceneAssetsSrc, f), path.join(scenesAssetsDir, f));
          }
        }
      }
      for (const s of (sdkData.scenes || [])) {
        if (s && s.id && typeof s.lua === 'string' && s.lua.trim()) {
          await fsp.writeFile(path.join(scenesScriptsDir, `${s.id}.lua`), s.lua);
        } else if (s && s.id) {
          // Fallback: emit a no-op scene module that just draws the bg.
          const bgRel = `assets/scenes/${s.id}`;
          await fsp.writeFile(path.join(scenesScriptsDir, `${s.id}.lua`),
            generateFallbackScene(s.id, bgRel));
        }
      }

      progress(onEvent, 'entities', 55, 'copying entity imagetables');
      const entitySrc = path.join(project.local_path, 'sdk_data', 'characters');
      if (fs.existsSync(entitySrc)) {
        for (const f of fs.readdirSync(entitySrc)) {
          if (/\.(png|gif)$/i.test(f)) {
            await fsp.copyFile(path.join(entitySrc, f), path.join(charactersDir, f));
          }
        }
      }

      progress(onEvent, 'sounds', 65, 'copying sounds');
      const sfxSrc = path.join(project.local_path, 'sdk_data', 'sfx_baseline');
      if (fs.existsSync(sfxSrc)) {
        for (const f of fs.readdirSync(sfxSrc)) {
          if (/\.(wav|mp3|aiff)$/i.test(f)) {
            await fsp.copyFile(path.join(sfxSrc, f), path.join(soundsDir, f));
          }
        }
      }
      const musicSrc = path.join(project.local_path, 'sdk_data', 'scene_music');
      if (fs.existsSync(musicSrc)) {
        // BLOAT FIX: previously copied EVERY rendered library track (~25
        // tracker WAVs × 5-25 MB each = 240+ MB). Only copy WAVs that a
        // scene actually references via its bgm_file. Compress each to
        // MP3 96kbps mono via ffmpeg before copying — pdc accepts MP3
        // natively + size drops ~85%.
        const referenced = new Set();
        for (const s of (sdkData.scenes || [])) {
          if (s && typeof s.bgm_file === 'string') {
            const base = path.basename(s.bgm_file).replace(/\.(wav|mp3|aiff)$/i, '');
            referenced.add(base);
          }
          // Scenes are also referenced by `<scene_id>.wav` directly (the
          // autopilot's music phase renames the assigned track to match).
          if (s && s.id) referenced.add(s.id);
        }

        const ffmpegBin = await whichBin('ffmpeg');
        let copied = 0, compressed = 0, skipped = 0;
        for (const f of fs.readdirSync(musicSrc)) {
          if (!/\.wav$/i.test(f)) continue;
          const stem = f.replace(/\.wav$/i, '');
          if (!referenced.has(stem)) { skipped++; continue; }
          const src = path.join(musicSrc, f);
          const destMp3 = path.join(soundsDir, stem + '.mp3');
          if (ffmpegBin) {
            try {
              await new Promise((resolve, reject) => {
                const ff = spawn(ffmpegBin, ['-y', '-loglevel', 'error',
                  '-i', src, '-ac', '1', '-ar', '44100', '-b:a', '96k', destMp3],
                  { shell: false });
                let err = '';
                ff.stderr.on('data', (b) => { err += b.toString(); });
                ff.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code + ': ' + err.slice(0,200))));
              });
              compressed++;
            } catch (e) {
              log(onEvent, `music compress fail ${f}: ${e.message}; copying raw wav`);
              await fsp.copyFile(src, path.join(soundsDir, f));
              copied++;
            }
          } else {
            await fsp.copyFile(src, path.join(soundsDir, f));
            copied++;
          }
        }
        log(onEvent, `music: ${compressed} compressed mp3 + ${copied} raw wav + ${skipped} skipped (unused library)`);
      }

      progress(onEvent, 'pdxinfo', 70, 'writing pdxinfo');
      await fsp.writeFile(path.join(sourceDir, 'pdxinfo'), buildPdxInfo(project, jobId));

      // Launcher assets (card.png 350x155, icon.png 32x32, launchImage.png
      // 400x240, optional animation.txt). pdxinfo's imagePath=launcher
      // already points here. Copy whatever the autopilot's launcher stage
      // produced; missing files surface as QA failures below, not silent.
      const launcherSrc = path.join(project.local_path, 'sdk_data', 'launcher');
      const launcherDst = path.join(sourceDir, 'launcher');
      await fsp.mkdir(launcherDst, { recursive: true });
      if (fs.existsSync(launcherSrc)) {
        for (const f of fs.readdirSync(launcherSrc)) {
          if (/\.(png|gif|txt)$/i.test(f)) {
            await fsp.copyFile(path.join(launcherSrc, f),
                               path.join(launcherDst, f));
          }
        }
      }

      progress(onEvent, 'qa', 75, 'running section-16 QA checklist');
      const qa = runQaChecklist(stageRoot, project, sdkData);
      for (const f of qa.failures) {
        log(onEvent, `[qa] ${f.check} @ ${f.where}: ${f.detail}`);
      }
      if (!qa.pass) {
        const summary = qa.failures.slice(0, 12)
          .map((f) => `- ${f.check} @ ${f.where}: ${f.detail}`).join('\n');
        const more = qa.failures.length > 12
          ? `\n... and ${qa.failures.length - 12} more` : '';
        throw new Error('QA checklist failed (' + qa.failures.length
          + ' issues):\n' + summary + more);
      }
      log(onEvent, '[qa] all checks passed');

      progress(onEvent, 'pdc', 80, 'invoking pdc');
      const pdcBin = findPdc();
      if (!pdcBin) throw new Error('pdc not found — set PLAYDATE_SDK_PATH');
      const projectIdSafe = (project.id || 'sdk_game').replace(/[^A-Za-z0-9._-]/g, '_');
      const outPdx = path.join(buildDir, `${projectIdSafe}.pdx`);
      log(onEvent, `pdc: ${pdcBin}`);
      await runPdc(pdcBin, sourceDir, outPdx, onEvent);

      job.status = 'done';
      job.out_pdx = outPdx;
      progress(onEvent, 'done', 100, 'pdx built');
      log(onEvent, `pdx: ${outPdx}`);
    } catch (e) {
      job.status = 'failed';
      job.error = e.message || String(e);
      log(onEvent, 'FATAL: ' + job.error);
    }
  })();

  return job;
}

function generateFallbackScene(id, bgRel) {
  return [
    `-- scenes/${id}.lua — autopilot fallback (just draws the background)`,
    'local gfx <const> = playdate.graphics',
    '',
    `local Scene_${safeIdent(id)} = {}`,
    '',
    `function Scene_${safeIdent(id)}:enter()`,
    `  self._bg = gfx.image.new("${bgRel}")`,
    'end',
    '',
    `function Scene_${safeIdent(id)}:update(dt) end`,
    '',
    `function Scene_${safeIdent(id)}:draw()`,
    '  gfx.clear(gfx.kColorWhite)',
    '  if self._bg then self._bg:draw(0, 0) end',
    'end',
    '',
    `return Scene_${safeIdent(id)}`,
    ''
  ].join('\n');
}

function safeIdent(s) {
  return String(s || 'scene').replace(/[^A-Za-z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}

function getJob(id) {
  if (_jobs.has(id)) return _jobs.get(id);
  // Cold-load: scan ROOT_BUILD_DIR/<id> for an already-completed pdx that
  // a previous process produced. The in-memory map is cleared on restart;
  // the disk artifact persists, so we synthesize a 'done' job entry.
  const stageRoot = path.join(ROOT_BUILD_DIR, id);
  if (!fs.existsSync(stageRoot)) return null;
  const buildDir = path.join(stageRoot, 'build');
  if (!fs.existsSync(buildDir)) return null;
  for (const f of fs.readdirSync(buildDir)) {
    if (f.endsWith('.pdx')) {
      const full = path.join(buildDir, f);
      const synthesized = {
        id, project_id: null, status: 'done',
        started_at: fs.statSync(stageRoot).mtimeMs,
        stage_dir: stageRoot, out_pdx: full,
        recovered: true
      };
      _jobs.set(id, synthesized);
      return synthesized;
    }
  }
  return null;
}

function getJobsByProject(pid) {
  // Hydrate the in-memory map from any stage dirs on disk first. Each
  // build lives at ROOT_BUILD_DIR/<jobId> and its game_data.lua names
  // the project (no — actually only pdxinfo names it, which is just the
  // display name). Track project_id via a `.project_id` file we drop at
  // export time so we don't have to parse pdxinfo here.
  if (fs.existsSync(ROOT_BUILD_DIR)) {
    for (const jobDir of fs.readdirSync(ROOT_BUILD_DIR)) {
      if (_jobs.has(jobDir)) continue;
      const stamp = path.join(ROOT_BUILD_DIR, jobDir, '.project_id');
      if (!fs.existsSync(stamp)) continue;
      try {
        const onDisk = fs.readFileSync(stamp, 'utf8').trim();
        const j = getJob(jobDir);
        if (j) j.project_id = onDisk;
      } catch (_e) { /* swallow */ }
    }
  }
  const out = [];
  for (const j of _jobs.values()) if (j.project_id === pid) out.push(j);
  return out;
}

module.exports = {
  startExport,
  getJob,
  getJobsByProject,
  runQaChecklist,
  _internals: { buildGameDataLua, buildPdxInfo, findPdc, runPdc, runQaChecklist }
};
