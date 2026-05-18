#!/usr/bin/env node
'use strict';

// build_hakcd_v3.js — fully automated HAKCD 3.0 build.
//
// 1. POST /api/projects/quick with HAKCD canonical pitch -> get new id
// 2. PATCH project to set tile_dim=16 (skill: 16 minimum, 32 recommended;
//    16 fits a 25x15 room into 400x240 1:1)
// 3. POST /api/projects/:id/pulp/autopilot SSE stream — run all stages
//    (brainstorm -> story -> characters -> world -> mechanics -> vibe ->
//    menus -> assets -> sound_burst -> scripts -> playtest)
// 4. POST /api/projects/:id/pulp/patrol/regen — fix any placeholder/missing
//    assets that slipped through (kinds: tile, scene, character)
// 5. node scripts/gen_sfx.js --baseline --out=<project>/pulp_data/sfx_baseline
//    — drop in HAKCD's 6 procedural SFX (click/select/deny/kombo_hit/alert/coin)
// 6. POST /api/projects/:id/pulp/export — try the pdx export, log success/OOM
// 7. Stream every event to stdout + /tmp/hakcd3_build.log

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STUDIO = process.env.STUDIO_URL || 'http://127.0.0.1:8090';
const LOG = '/tmp/hakcd3_build.log';

const PITCH = [
  'HAKCD 3.0: A Phreak\'s Tale. A first-person 1-bit Playdate adventure',
  'set in 1995 starring a teenage hacker named newb. Explore your',
  'beige-CRT bedroom, dial into a local BBS (RANCID PRIME), wander a',
  'utility room to investigate dial-tone anomalies, attend a SecKC',
  'hackerspace meetup at Knuckleheads, and steal back the PwnGlove',
  'from a megacorp lobby. Crank-based mini-games for signal scanning',
  'and pattern matching. Collect 23 COiNS for solving in-world puzzles.',
  'Aesthetic: Mars After Midnight + Whitewater Wipeout dither. Music:',
  'tracker-scene chiptune. SFX: procedural retro arcade.'
].join(' ');

function log(line) {
  const stamp = new Date().toISOString();
  const out = `[${stamp}] ${line}\n`;
  process.stdout.write(out);
  fs.appendFileSync(LOG, out);
}

function req({ method, url, body, headers = {}, sse = false }) {
  const u = new URL(url);
  const opts = {
    method,
    hostname: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const r = lib.request(opts, (res) => {
      if (sse) return resolve({ status: res.statusCode, headers: res.headers, stream: res });
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch (_e) { parsed = buf; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function parseSSE(stream, onEvent, onEnd) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.startsWith(':')) continue; // heartbeat
      let evt = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch (_e) { parsed = data; }
      onEvent(evt, parsed);
    }
  });
  stream.on('end', onEnd);
  stream.on('error', (e) => { log('SSE error: ' + e.message); onEnd(); });
}

function getCookie(r) {
  const sc = r.headers['set-cookie'] || [];
  return sc.map((s) => s.split(';')[0]).join('; ');
}

async function authHandshake() {
  const r = await req({ method: 'GET', url: `${STUDIO}/api/auth/me` });
  return { cookie: getCookie(r), csrf: r.body && r.body.csrf_token };
}

function runChild(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const cp = spawn(cmd, args, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    cp.stdout.on('data', (c) => { out += c; process.stdout.write(c); fs.appendFileSync(LOG, c); });
    cp.stderr.on('data', (c) => { err += c; process.stderr.write(c); fs.appendFileSync(LOG, c); });
    cp.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(Object.assign(new Error(`${cmd} exit ${code}`), { stdout: out, stderr: err, code }));
    });
  });
}

async function main() {
  fs.writeFileSync(LOG, '');
  log('=== HAKCD 3.0 BUILD START ===');
  log('studio: ' + STUDIO);
  log('pitch: ' + PITCH.slice(0, 100) + '...');

  log('-- step 1: handshake --');
  const auth = await authHandshake();
  if (!auth.csrf) { log('FATAL: no csrf token'); process.exit(1); }
  const headers = { Cookie: auth.cookie, 'x-csrf-token': auth.csrf };

  log('-- step 2: quick-create project --');
  const create = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects/quick`,
    headers,
    body: { pitch: PITCH }
  });
  if (create.status !== 201) {
    log('quick-create FAIL: status=' + create.status + ' body=' + JSON.stringify(create.body));
    process.exit(1);
  }
  const projectId = create.body.project.id;
  log('created: ' + projectId);

  log('-- step 3: set tile_dim=16 --');
  const tilePatch = await req({
    method: 'PATCH',
    url: `${STUDIO}/api/projects/${projectId}/pulp`,
    headers,
    body: { tile_dim: 16 }
  });
  log('tile_dim patch status=' + tilePatch.status);

  log('-- step 4: start autopilot SSE --');
  const sse = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects/${projectId}/pulp/autopilot`,
    headers,
    body: { pitch: PITCH },
    sse: true
  });
  if (sse.status !== 200) {
    log('autopilot start FAIL: status=' + sse.status);
    process.exit(1);
  }
  await new Promise((resolve) => {
    parseSSE(sse.stream, (evt, data) => {
      const summary = data && typeof data === 'object'
        ? (data.text || data.label || data.message || data.id || JSON.stringify(data).slice(0, 200))
        : String(data);
      log(`  [${evt}] ${summary}`);
    }, resolve);
  });
  log('autopilot stream closed');

  log('-- step 5: patrol --regen for stragglers --');
  try {
    await runChild('node', ['scripts/patrol_cli.js', projectId, '--regen']);
  } catch (e) {
    log('patrol stragglers (non-fatal): ' + (e.code || e.message));
  }

  log('-- step 6: drop baseline procedural SFX --');
  // The pulp project's local_path lives under server/data/scratch_projects/<id>
  // OR server/server/data/scratch_projects/<id> depending on CWD resolution.
  const candidatePaths = [
    path.join(__dirname, '..', '..', 'server', 'server', 'data', 'scratch_projects', projectId, 'pulp_data', 'sfx_baseline'),
    path.join(__dirname, '..', 'data', 'scratch_projects', projectId, 'pulp_data', 'sfx_baseline')
  ];
  let sfxDir = null;
  for (const p of candidatePaths) {
    const parent = path.dirname(path.dirname(p));
    if (fs.existsSync(parent)) { sfxDir = p; break; }
  }
  if (sfxDir) {
    log('sfx out: ' + sfxDir);
    try {
      await runChild('node', ['scripts/gen_sfx.js', '--baseline', `--out=${sfxDir}`]);
    } catch (e) {
      log('sfx baseline FAIL (non-fatal): ' + (e.code || e.message));
    }
  } else {
    log('sfx out: could not resolve project path; skipping');
  }

  log('-- step 7: attempt pdx export --');
  try {
    const exp = await req({
      method: 'POST',
      url: `${STUDIO}/api/projects/${projectId}/pulp/export`,
      headers,
      body: {}
    });
    log('export status=' + exp.status + ' body=' + JSON.stringify(exp.body).slice(0, 300));
  } catch (e) {
    log('export FAIL (likely OOM): ' + e.message);
  }

  log('-- final patrol summary --');
  try {
    await runChild('node', ['scripts/patrol_cli.js', projectId]);
  } catch (e) {
    log('patrol summary err: ' + (e.code || e.message));
  }

  log('=== HAKCD 3.0 BUILD COMPLETE ===');
  log('project id: ' + projectId);
  log('log: ' + LOG);
}

main().catch((e) => {
  log('FATAL: ' + (e.stack || e.message));
  process.exit(1);
});
