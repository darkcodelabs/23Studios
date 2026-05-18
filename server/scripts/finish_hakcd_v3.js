#!/usr/bin/env node
'use strict';

// finish_hakcd_v3.js <projectId>
// Runs the post-autopilot steps for a v3 build using the LATEST code:
//   - drop HAKCD extras (23 coins + 47 nfos + 9 tools)
//   - patrol --regen --force --kind=tile  (apply silhouette-first prompts)
//   - patrol --regen --kind=scene,character (placeholders only)
//   - seed music library + POST /pulp/music/assign
//   - re-trigger export, wait, download
//
// Useful when the original driver process was started against an older
// snapshot of these scripts.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STUDIO = process.env.STUDIO_URL || 'http://127.0.0.1:8090';
const projectId = process.argv[2];
if (!projectId) { console.error('usage: finish_hakcd_v3.js <projectId>'); process.exit(2); }
const LOG = `/tmp/hakcd3_finish_${projectId}.log`;

function log(line) {
  const stamp = new Date().toISOString();
  const out = `[${stamp}] ${line}\n`;
  process.stdout.write(out);
  fs.appendFileSync(LOG, out);
}

function req({ method, url, body, headers = {} }) {
  const u = new URL(url);
  const opts = {
    method, hostname: u.hostname, port: u.port,
    path: u.pathname + u.search,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  return new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch (_e) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
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

async function authHandshake() {
  const r = await req({ method: 'GET', url: `${STUDIO}/api/auth/me` });
  return { csrf: r.body && r.body.csrf_token };
}

async function main() {
  fs.writeFileSync(LOG, '');
  log(`=== finish_hakcd_v3 ${projectId} ===`);

  const auth = await authHandshake();
  const headers = { 'x-csrf-token': auth.csrf || '' };

  log('-- extras: 23 coins + 47 NFOs + 9 tools as stubs --');
  try {
    const src = '/tmp/hakcd2_extras.js';
    const dst = `/tmp/finish_v3_extras_${projectId}.js`;
    const txt = fs.readFileSync(src, 'utf8')
      .replace(/const PROJECT_ID = '[^']+'/, `const PROJECT_ID = '${projectId}'`)
      .replace(/const LOG = '[^']+'/, `const LOG = '/tmp/finish_v3_extras_${projectId}.log'`)
      .replace(/const PROMPTS = '[^']+'/, `const PROMPTS = '/tmp/finish_v3_extras_${projectId}_prompts.jsonl'`);
    fs.writeFileSync(dst, txt);
    await runChild('node', [dst]);
  } catch (e) { log('extras (non-fatal): ' + (e.code || e.message)); }

  log('-- patrol --regen --force --kind=tile --');
  try {
    await runChild('node', ['scripts/patrol_cli.js', projectId, '--regen', '--force', '--kind=tile']);
  } catch (e) { log('patrol force-regen (non-fatal): ' + (e.code || e.message)); }

  log('-- patrol --regen --kind=scene,character --');
  try {
    await runChild('node', ['scripts/patrol_cli.js', projectId, '--regen', '--kind=scene,character']);
  } catch (e) { log('patrol scenes/chars (non-fatal): ' + (e.code || e.message)); }

  log('-- seed music library + assign --');
  try {
    const sceneMusicDir = path.join(__dirname, '..', '..', 'server', 'server', 'data',
                                    'scratch_projects', projectId, 'pulp_data', 'scene_music');
    await runChild('node', ['scripts/seed_music.js', `--dir=${sceneMusicDir}`, '--limit=30']);
    const r = await req({
      method: 'POST',
      url: `${STUDIO}/api/projects/${projectId}/pulp/music/assign`,
      headers,
      body: {}
    });
    log(`music assign status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`);
  } catch (e) { log('music assign (non-fatal): ' + (e.code || e.message)); }

  log('-- export + wait + download --');
  try {
    const exp = await req({
      method: 'POST',
      url: `${STUDIO}/api/projects/${projectId}/pulp/export`,
      headers,
      body: {}
    });
    log('export start status=' + exp.status + ' body=' + JSON.stringify(exp.body).slice(0, 300));
    const dl = exp.body && exp.body.download_url;
    if (dl) {
      const deadline = Date.now() + 10 * 60 * 1000;
      const outFile = `/tmp/hakcd3_${projectId}.pdx.tar`;
      let done = false;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 5000));
        const r = await req({ method: 'GET', url: STUDIO + dl, headers });
        if (r.status === 200) {
          await new Promise((resolve, reject) => {
            const u = new URL(STUDIO + dl);
            const r2 = http.request({
              method: 'GET', hostname: u.hostname, port: u.port,
              path: u.pathname + u.search, headers
            }, (res) => {
              const f = fs.createWriteStream(outFile);
              res.pipe(f);
              f.on('finish', () => f.close(resolve));
            });
            r2.on('error', reject);
            r2.end();
          });
          const sz = fs.statSync(outFile).size;
          log(`export DOWNLOADED: ${outFile} (${sz} bytes)`);
          done = true;
          break;
        }
        log(`export poll status=${r.status}`);
      }
      if (!done) log('export timeout (10 min)');
    }
  } catch (e) { log('export FAIL: ' + e.message); }

  log('-- final patrol summary --');
  try { await runChild('node', ['scripts/patrol_cli.js', projectId]); }
  catch (e) { log('patrol summary err: ' + (e.code || e.message)); }

  log('=== finish_hakcd_v3 COMPLETE ===');
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
