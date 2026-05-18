#!/usr/bin/env node
'use strict';

// build_hakcd_sdk_v2.js — fully automated HAKCD 2.0 (SDK edition) build.
//
// 1. POST /api/projects to create a new game_type='sdk' project
// 2. POST /api/projects/:id/sdk/autopilot SSE — runs all stages
// 3. POST /api/projects/:id/sdk/export — pdc builds the .pdx
// 4. Poll status; download .pdx tarball
// 5. Final inventory

const http = require('http');
const fs = require('fs');
const path = require('path');

const STUDIO = process.env.STUDIO_URL || 'http://127.0.0.1:8090';
const LOG = '/tmp/hakcd_sdk_v2_build.log';

const PITCH = [
  'HAKCD 2.0 SDK edition: A Phreak\'s Tale. A 1-bit Playdate adventure',
  'set in 1995 starring a teenage hacker named newb. Player explores a',
  'beige-CRT bedroom (dial-in BBSes, read PHRACK), wanders a neighborhood',
  'utility room investigating phreak anomalies, attends a SecKC hackerspace',
  'meetup at Knuckleheads, and stages a final heist on the PwnGlove prototype',
  'in a megacorp lobby. Crank mini-games for signal-scanning + pattern-',
  'matching. Collect 23 COiNS for solved puzzles. Aesthetic: Mars After',
  'Midnight + Whitewater Wipeout dither. Music: tracker-scene chiptune.',
  'SFX: procedural retro arcade. Backgrounds are STATIC environments only —',
  'no characters in scene PNGs; player/NPCs render as separate sprites.'
].join(' ');

function log(s) {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${s}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG, line);
}

function req({ method, url, body, headers = {}, sse = false }) {
  const u = new URL(url);
  const opts = {
    method, hostname: u.hostname, port: u.port,
    path: u.pathname + u.search,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  return new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => {
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
      if (frame.startsWith(':')) continue;
      let evt = 'message', data = '';
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

function downloadToFile(url, outFile, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({
      method: 'GET', hostname: u.hostname, port: u.port,
      path: u.pathname + u.search, headers
    }, (res) => {
      if (res.statusCode !== 200) {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => reject(new Error(`status ${res.statusCode}: ${buf.slice(0, 200)}`)));
        return;
      }
      const f = fs.createWriteStream(outFile);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(outFile)));
      f.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}

async function main() {
  fs.writeFileSync(LOG, '');
  log('=== HAKCD 2.0 (SDK) BUILD START ===');

  // Step 1: create project (skip CSRF — anon w/ csrf_token in body works for
  // POST /api/projects in this server, but only if cookies match. Use the
  // local data path directly via filesystem if needed.)
  log('-- step 1: handshake --');
  const me = await req({ method: 'GET', url: `${STUDIO}/api/auth/me` });
  if (!me.body || !me.body.csrf_token) {
    log('no csrf token in /api/auth/me; aborting');
    process.exit(1);
  }
  const cookieJar = (me.headers['set-cookie'] || []).map((s) => s.split(';')[0]).join('; ');
  const headers = { Cookie: cookieJar, 'x-csrf-token': me.body.csrf_token };

  log('-- step 2: create SDK project --');
  // Compose a unique id ourselves since /api/projects/quick defaults to pulp.
  const suffix = Date.now().toString(36).slice(-5);
  const id = `hakcd-sdk-2-0-${suffix}`;
  const localPath = path.join('/home/hakcer/projects/23studios/server/server/data/scratch_projects', id);
  fs.mkdirSync(path.join(localPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(localPath, 'sdk_data'), { recursive: true });

  const create = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects`,
    headers,
    body: {
      id,
      name: 'HAKCD 2.0 (SDK)',
      description: PITCH.slice(0, 400),
      repo: 'https://github.com/local/scratch.git',
      local_path: localPath,
      platform: 'playdate',
      publisher: '23 Studios',
      developer: '23 Studios',
      build_command: '',
      preflight_command: '',
      captures_dir: '',
      status: 'active',
      game_type: 'sdk'
    }
  });
  if (create.status !== 201) {
    log(`project create FAIL status=${create.status} body=${JSON.stringify(create.body).slice(0, 300)}`);
    process.exit(1);
  }
  const projectId = create.body.project.id;
  log('created sdk project: ' + projectId);

  log('-- step 3: SDK autopilot SSE --');
  const sse = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects/${projectId}/sdk/autopilot`,
    headers,
    body: { pitch: PITCH },
    sse: true
  });
  if (sse.status !== 200) {
    log('autopilot start FAIL status=' + sse.status);
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

  log('-- step 4: SDK export --');
  const exp = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects/${projectId}/sdk/export`,
    headers,
    body: {}
  });
  log(`export start status=${exp.status} body=${JSON.stringify(exp.body).slice(0, 300)}`);
  const dl = exp.body && exp.body.download_url;
  const statusUrl = exp.body && exp.body.status_url;

  if (statusUrl) {
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 5000));
      const s = await req({ method: 'GET', url: STUDIO + statusUrl, headers });
      const st = s.body && s.body.status;
      log(`  export status=${st || s.status}`);
      if (st === 'done' || st === 'failed') break;
    }
  }

  if (dl) {
    const outFile = `/tmp/hakcd_sdk_v2_${projectId}.pdx.tar`;
    try {
      await downloadToFile(STUDIO + dl, outFile, headers);
      const sz = fs.statSync(outFile).size;
      log(`export DOWNLOADED: ${outFile} (${sz} bytes)`);
    } catch (e) {
      log('download FAIL: ' + e.message);
    }
  }

  log('=== HAKCD 2.0 (SDK) BUILD COMPLETE ===');
  log('project id: ' + projectId);
  log('local_path: ' + localPath);
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
