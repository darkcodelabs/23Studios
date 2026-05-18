#!/usr/bin/env node
'use strict';

// build_hakcd_from_bible.js — build a real SDK game from a story bible.
//
// 1. Create new sdk project
// 2. Copy STORY_BIBLE_PATH -> <project>/sdk_data/story_bible.md
//    (sdk_autopilot reads it on every Claude call -> in-world output)
// 3. Run SDK autopilot SSE
// 4. Export pdx
// 5. Download tarball
//
// The bible is the SINGLE source of truth — pitch is intentionally minimal
// since the bible carries setting, characters, factions, beats.

const http = require('http');
const fs = require('fs');
const path = require('path');

const STUDIO = process.env.STUDIO_URL || 'http://127.0.0.1:8090';
const STORY_BIBLE_PATH = process.env.STORY_BIBLE_PATH
  || '/home/hakcer/projects/personal/hakcd/HAKCD_story_bible_v0.1.md';
const PROJECT_NAME = process.env.PROJECT_NAME || 'HAKCD (story bible build)';
const PITCH = process.env.PITCH
  || 'Build the game described in the attached story bible. Follow the bible faithfully — names, setting, acts, characters, factions, year, geography are all canon.';
const LOG = '/tmp/hakcd_bible_build.log';

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
  log('=== HAKCD STORY-BIBLE BUILD ===');
  log('bible: ' + STORY_BIBLE_PATH);
  if (!fs.existsSync(STORY_BIBLE_PATH)) {
    log('FATAL: bible not found at ' + STORY_BIBLE_PATH);
    process.exit(1);
  }
  const bible = fs.readFileSync(STORY_BIBLE_PATH, 'utf8');
  log(`bible loaded: ${bible.length} chars, ${bible.split('\n').length} lines`);

  log('-- step 1: handshake --');
  const me = await req({ method: 'GET', url: `${STUDIO}/api/auth/me` });
  if (!me.body || !me.body.csrf_token) { log('no csrf'); process.exit(1); }
  const cookies = (me.headers['set-cookie'] || []).map((s) => s.split(';')[0]).join('; ');
  const headers = { Cookie: cookies, 'x-csrf-token': me.body.csrf_token };

  log('-- step 2: create sdk project --');
  const suffix = Date.now().toString(36).slice(-6);
  const id = `hakcd-bible-${suffix}`;
  const localPath = path.join('/home/hakcer/projects/23studios/server/server/data/scratch_projects', id);
  fs.mkdirSync(path.join(localPath, '.git'), { recursive: true });
  const sdkDataDir = path.join(localPath, 'sdk_data');
  fs.mkdirSync(sdkDataDir, { recursive: true });

  // Copy bible into the project BEFORE create so autopilot finds it.
  fs.copyFileSync(STORY_BIBLE_PATH, path.join(sdkDataDir, 'story_bible.md'));
  log('bible copied -> ' + path.join(sdkDataDir, 'story_bible.md'));

  const create = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects`,
    headers,
    body: {
      id, name: PROJECT_NAME,
      description: PITCH.slice(0, 400),
      repo: 'https://github.com/local/scratch.git',
      local_path: localPath,
      platform: 'playdate',
      publisher: '23 Studios', developer: '23 Studios',
      build_command: '', preflight_command: '', captures_dir: '',
      status: 'active', game_type: 'sdk'
    }
  });
  if (create.status !== 201) {
    log(`project create FAIL ${create.status} ${JSON.stringify(create.body).slice(0, 200)}`);
    process.exit(1);
  }
  log('created: ' + create.body.project.id);

  log('-- step 3: autopilot SSE (bible-driven) --');
  const sse = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects/${id}/sdk/autopilot`,
    headers,
    body: { pitch: PITCH },
    sse: true
  });
  if (sse.status !== 200) { log('autopilot FAIL ' + sse.status); process.exit(1); }
  await new Promise((resolve) => {
    parseSSE(sse.stream, (evt, data) => {
      const summary = data && typeof data === 'object'
        ? (data.text || data.label || data.message || data.id || JSON.stringify(data).slice(0, 200))
        : String(data);
      log(`  [${evt}] ${summary}`);
    }, resolve);
  });
  log('autopilot stream closed');

  log('-- step 4: pdx export --');
  const exp = await req({
    method: 'POST',
    url: `${STUDIO}/api/projects/${id}/sdk/export`,
    headers, body: {}
  });
  log(`export start ${exp.status} ${JSON.stringify(exp.body).slice(0, 300)}`);
  const dl = exp.body && exp.body.download_url;
  const statusUrl = exp.body && exp.body.status_url;
  if (statusUrl) {
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await req({ method: 'GET', url: STUDIO + statusUrl, headers });
      const st = s.body && s.body.status;
      log(`  export status=${st || s.status}`);
      if (st === 'done' || st === 'failed') break;
    }
  }
  if (dl) {
    const outFile = `/tmp/hakcd_bible_${id}.pdx.tar`;
    try {
      await downloadToFile(STUDIO + dl, outFile, headers);
      const sz = fs.statSync(outFile).size;
      log(`export DOWNLOADED: ${outFile} (${sz} bytes)`);
    } catch (e) { log('download FAIL: ' + e.message); }
  }

  log('=== BUILD COMPLETE ===');
  log('project id: ' + id);
  log('local_path: ' + localPath);
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
