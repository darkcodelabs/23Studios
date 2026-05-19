'use strict';

// sdk_milestones.js — incremental milestone builds for SDK projects.
//
// Each milestone stages a subset of source files, runs pdc, writes
// sdk_data/milestones/<id>/status.json, and returns a status object.
//
// Exports:
//   runMilestone(projectId, milestoneId, opts?) -> Promise<status>
//   runAll(projectId, opts?)                    -> Promise<status[]>
//   listMilestones(projectId)                   -> Promise<status[]>

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');
const projects = require('./projects');

// ---------------------------------------------------------------------------
// Canonical milestone definitions
// ---------------------------------------------------------------------------

const MILESTONES = [
  { id: 'm01_boot',          requires: [],                 needs: ['main.lua', 'scenes/title.lua'] },
  { id: 'm02_title',         requires: ['m01_boot'],       needs: ['launcher/card.png'] },
  { id: 'm03_first_room',    requires: ['m02_title'],      needs: ['scenes/*.lua', 'scenes/*.png'] },
  { id: 'm04_inventory',     requires: ['m03_first_room'], needs: ['inventory.lua'] },
  { id: 'm05_dialogue',      requires: ['m04_inventory'],  needs: ['dialogue.lua'] },
  { id: 'm06_puzzles',       requires: ['m05_dialogue'],   needs: ['compiled_design.json'] },
  { id: 'm07_full_game',     requires: ['m06_puzzles'],    needs: [] },
  { id: 'm08_polish',        requires: ['m07_full_game'],  needs: ['sounds/', 'music/'] },
  { id: 'release_candidate', requires: ['m08_polish'],     needs: [] }
];

const MILESTONE_IDS = new Set(MILESTONES.map((m) => m.id));
const MILESTONE_MAP = new Map(MILESTONES.map((m) => [m.id, m]));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUILD_BASE = '/tmp/23studios_milestones';

function milestoneDataDir(localPath, milestoneId) {
  return path.join(localPath, 'sdk_data', 'milestones', milestoneId);
}

function statusFile(localPath, milestoneId) {
  return path.join(milestoneDataDir(localPath, milestoneId), 'status.json');
}

function logFile(localPath, milestoneId) {
  return path.join(milestoneDataDir(localPath, milestoneId), 'log.txt');
}

async function readStatus(localPath, milestoneId) {
  const sf = statusFile(localPath, milestoneId);
  try {
    const raw = await fsp.readFile(sf, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

// Expand a glob pattern like 'scenes/*.lua' against the given source dir.
// Returns matched file paths relative to sourceDir (forward-slash separated).
function expandGlob(sourceDir, pattern) {
  // Simple glob: supports '*' within a path segment.
  const parts = pattern.split('/');
  function walk(dir, segments) {
    if (segments.length === 0) return [dir];
    const [seg, ...rest] = segments;
    if (!seg.includes('*')) {
      const candidate = path.join(dir, seg);
      if (!fs.existsSync(candidate)) return [];
      if (rest.length === 0) return [candidate];
      const st = fs.statSync(candidate);
      if (!st.isDirectory()) return [];
      return walk(candidate, rest);
    }
    // Wildcard — list directory + filter.
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { return []; }
    const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const matched = entries.filter((e) => re.test(e.name));
    if (rest.length === 0) return matched.map((e) => path.join(dir, e.name));
    return matched.filter((e) => e.isDirectory()).flatMap((e) => walk(path.join(dir, e.name), rest));
  }
  const results = walk(sourceDir, parts);
  // Convert to relative paths (from sourceDir).
  return results.map((p) => path.relative(sourceDir, p));
}

// Determine which source files are "needed" for a milestone (all milestones
// accumulated up to and including this one).
function collectNeededPatterns(milestoneId) {
  const idx = MILESTONES.findIndex((m) => m.id === milestoneId);
  const patterns = new Set();
  for (let i = 0; i <= idx; i++) {
    for (const need of MILESTONES[i].needs) {
      patterns.add(need);
    }
  }
  return [...patterns];
}

// Stage the build: copy matching source files, stub the rest.
// Returns the staged source dir.
async function stageSource(projectId, milestoneId, localPath) {
  const sourceDir = path.join(localPath, 'source');
  const stagedRoot = path.join(BUILD_BASE, projectId, milestoneId);
  const stagedSource = path.join(stagedRoot, 'source');
  await fsp.mkdir(stagedSource, { recursive: true });

  // Collect all source files.
  let allSourceFiles = [];
  function scanDir(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { return; }
    for (const e of entries) {
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        scanDir(path.join(dir, e.name), relPath);
      } else {
        allSourceFiles.push(relPath);
      }
    }
  }
  if (fs.existsSync(sourceDir)) {
    scanDir(sourceDir, '');
  }

  // Build the set of "included" file patterns for this milestone.
  const neededPatterns = collectNeededPatterns(milestoneId);

  // For each pattern, expand against the sourceDir to get concrete files.
  const includedFiles = new Set();
  for (const pattern of neededPatterns) {
    const matched = expandGlob(sourceDir, pattern);
    for (const rel of matched) {
      includedFiles.add(rel.replace(/\\/g, '/'));
    }
    // If it ends with '/', include all files under that dir.
    if (pattern.endsWith('/')) {
      const dir = pattern.slice(0, -1);
      for (const f of allSourceFiles) {
        if (f.startsWith(dir + '/') || f === dir) {
          includedFiles.add(f.replace(/\\/g, '/'));
        }
      }
    }
  }

  // Copy included files; stub Lua files that are not included.
  for (const relFile of allSourceFiles) {
    const src = path.join(sourceDir, relFile);
    const dest = path.join(stagedSource, relFile);
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    if (includedFiles.has(relFile.replace(/\\/g, '/'))) {
      await fsp.copyFile(src, dest);
    } else if (relFile.endsWith('.lua')) {
      // Stub: no-op Lua module.
      await fsp.writeFile(dest, '-- stub\nreturn {}\n', 'utf8');
    } else {
      // Non-Lua non-included file: copy as-is (assets, pdxinfo, etc.)
      await fsp.copyFile(src, dest);
    }
  }

  return { stagedSource, stagedRoot };
}

// Resolve pdc binary.
function findPdc() {
  const candidates = [
    process.env.PDC_PATH,
    '/opt/PlaydateSDK/bin/pdc',
    path.join(require('os').homedir(), 'Developer', 'PlaydateSDK', 'bin', 'pdc')
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Try PATH.
  return 'pdc';
}

// ---------------------------------------------------------------------------
// Core: runMilestone
// ---------------------------------------------------------------------------

async function runMilestone(projectId, milestoneId, opts = {}) {
  if (!MILESTONE_IDS.has(milestoneId)) {
    const e = new Error('unknown_milestone');
    e.status = 400;
    throw e;
  }

  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!project.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  const localPath = project.local_path;

  const milestone = MILESTONE_MAP.get(milestoneId);

  // Check dependency chain — unless force=true.
  if (!opts.force) {
    for (const dep of milestone.requires) {
      const depStatus = await readStatus(localPath, dep);
      if (!depStatus || depStatus.boots === false) {
        return {
          milestone: milestoneId,
          ok: false,
          error: 'prior_failed',
          depends_on: dep,
          boots: false,
          built_at: null,
          pdx_path: null,
          bytes: null,
          errors: []
        };
      }
    }
  }

  // Stage source.
  let stagedSource, stagedRoot;
  try {
    ({ stagedSource, stagedRoot } = await stageSource(projectId, milestoneId, localPath));
  } catch (e) {
    const errMsg = 'stage_failed: ' + e.message;
    const status = {
      milestone: milestoneId,
      ok: false,
      error: errMsg,
      boots: false,
      built_at: new Date().toISOString(),
      pdx_path: null,
      bytes: null,
      errors: [errMsg],
      depends_on: milestone.requires
    };
    const dataDir = milestoneDataDir(localPath, milestoneId);
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(statusFile(localPath, milestoneId), JSON.stringify(status, null, 2));
    await fsp.writeFile(logFile(localPath, milestoneId), errMsg + '\n');
    return status;
  }

  const pdxName = projectId + '.pdx';
  const pdxOut = path.join(stagedRoot, 'build', pdxName);
  await fsp.mkdir(path.join(stagedRoot, 'build'), { recursive: true });

  const pdc = findPdc();
  const logLines = [];

  logLines.push(`[milestone] ${milestoneId}`);
  logLines.push(`[pdc] ${pdc} ${stagedSource} ${pdxOut}`);
  logLines.push(`[started] ${new Date().toISOString()}`);

  const result = spawnSync(pdc, [stagedSource, pdxOut], {
    shell: false,
    timeout: 60000,
    encoding: 'utf8'
  });

  if (result.stdout) logLines.push('[stdout]\n' + result.stdout);
  if (result.stderr) logLines.push('[stderr]\n' + result.stderr);
  logLines.push(`[exit] ${result.status}`);
  logLines.push(`[finished] ${new Date().toISOString()}`);

  const boots = result.status === 0;
  const errors = [];
  if (!boots) {
    const detail = result.stderr || result.stdout || ('pdc exit ' + result.status);
    errors.push(detail.trim());
  }

  let bytes = null;
  if (boots && fs.existsSync(pdxOut)) {
    // pdx is a directory — sum file sizes.
    try {
      function sumDir(d) {
        let total = 0;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const fp = path.join(d, e.name);
          if (e.isDirectory()) total += sumDir(fp);
          else total += fs.statSync(fp).size;
        }
        return total;
      }
      bytes = sumDir(pdxOut);
    } catch (_e) { bytes = null; }
  }

  const dataDir = milestoneDataDir(localPath, milestoneId);
  await fsp.mkdir(dataDir, { recursive: true });

  const status = {
    milestone: milestoneId,
    ok: boots,
    built_at: new Date().toISOString(),
    pdx_path: pdxOut,
    bytes,
    boots,
    errors,
    depends_on: milestone.requires
  };

  await fsp.writeFile(statusFile(localPath, milestoneId), JSON.stringify(status, null, 2));
  await fsp.writeFile(logFile(localPath, milestoneId), logLines.join('\n') + '\n');

  return status;
}

// ---------------------------------------------------------------------------
// runAll: sequence all milestones, stop at first failure
// ---------------------------------------------------------------------------

async function runAll(projectId, opts = {}) {
  const results = [];
  for (const m of MILESTONES) {
    const status = await runMilestone(projectId, m.id, opts);
    results.push(status);
    if (!status.boots) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// listMilestones: read status.json for every milestone
// ---------------------------------------------------------------------------

async function listMilestones(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!project.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  const localPath = project.local_path;

  const statuses = await Promise.all(
    MILESTONES.map(async (m) => {
      const s = await readStatus(localPath, m.id);
      if (s) return s;
      return {
        milestone: m.id,
        ok: null,
        built_at: null,
        pdx_path: null,
        bytes: null,
        boots: null,
        errors: [],
        depends_on: m.requires
      };
    })
  );
  return statuses;
}

module.exports = { runMilestone, runAll, listMilestones, MILESTONES };
