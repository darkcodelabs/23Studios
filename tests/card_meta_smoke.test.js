'use strict';

// card_meta_smoke.test.js — Phase 6 Dashboard cards
//
// Exercises server/routes/card_meta.js indirectly by seeding a fake project
// + asset tree, then hitting the in-memory express stack. No LLM calls.
//
// Run: node tests/card_meta_smoke.test.js

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const http = require('http');

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok ' + msg);
  else { console.error('  FAIL ' + msg); failed++; }
}

async function get(server, urlPath) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (b) => chunks.push(b));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    }).on('error', reject);
  });
}

async function main() {
  const tmpData = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-cardmeta-data-'));
  const tmpLocal = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-cardmeta-local-'));
  process.env.PROJECTS_DATA_DIR = tmpData;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-cardmeta';
  process.env.STUDIO_PASSWORD = process.env.STUDIO_PASSWORD || 'test';
  process.env.NODE_ENV = 'test';
  // Disable auth middleware for this smoke test.
  process.env.DISABLE_AUTH = '1';

  const projectId = 'cm-smoke';
  await fsp.writeFile(path.join(tmpData, 'projects.json'), JSON.stringify({
    projects: [{
      id: projectId,
      name: 'card meta smoke',
      description: 'shelf card test',
      repo: '',
      local_path: tmpLocal,
      platform: 'playdate',
      publisher: '', developer: '',
      build_command: '', preflight_command: '', captures_dir: '',
      created_at: '2026-05-19', status: 'active', game_type: 'sdk'
    }]
  }, null, 2));

  // Seed an asset tree:
  //   sdk_data/scenes/title_001.png + scene_*.json (x3)
  //   sdk_data/characters/*.png (x2)
  //   source/pdxinfo with version=0.4.2
  //   build/<proj>-0.4.2.pdx.zip
  await fsp.mkdir(path.join(tmpLocal, 'sdk_data', 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(tmpLocal, 'sdk_data', 'characters'), { recursive: true });
  await fsp.mkdir(path.join(tmpLocal, 'source'), { recursive: true });
  await fsp.mkdir(path.join(tmpLocal, 'build'), { recursive: true });
  // 1x1 PNG (8-byte signature + tiny IHDR-free stub is fine for fs counting).
  const pngStub = Buffer.from('89504e470d0a1a0a', 'hex');
  await fsp.writeFile(path.join(tmpLocal, 'sdk_data', 'scenes', 'title_001.png'), pngStub);
  for (const i of ['001', '002', '003']) {
    await fsp.writeFile(
      path.join(tmpLocal, 'sdk_data', 'scenes', `scene_${i}.json`),
      JSON.stringify({ id: i })
    );
  }
  await fsp.writeFile(path.join(tmpLocal, 'sdk_data', 'characters', 'hero.png'), pngStub);
  await fsp.writeFile(path.join(tmpLocal, 'sdk_data', 'characters', 'villain.png'), pngStub);
  await fsp.writeFile(path.join(tmpLocal, 'source', 'pdxinfo'),
    'name=Card Meta Smoke\nauthor=test\nversion=0.4.2\nbundleID=studios.smoke\n');
  const pdxName = `${projectId}-0.4.2.pdx.zip`;
  const pdxPath = path.join(tmpLocal, 'build', pdxName);
  await fsp.writeFile(pdxPath, Buffer.from('PKfake-zip-bytes'));

  // Build a stripped express app that mounts only card_meta + projects
  // resolution. We can't load server/index.js directly because it forces auth.
  const express = require('express');
  const cardMeta = require('../server/routes/card_meta');
  const app = express();
  app.use('/api/projects', cardMeta);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));

  console.log('# card_meta basic shape');
  const r = await get(server, `/api/projects/${projectId}/card_meta`);
  assert(r.status === 200, 'card_meta returns 200');
  const meta = JSON.parse(r.body.toString('utf8'));
  assert(meta.scene_count === 3, `scene_count = 3 (got ${meta.scene_count})`);
  assert(meta.character_count === 2, `character_count = 2 (got ${meta.character_count})`);
  assert(meta.version === '0.4.2', `version = 0.4.2 (got ${meta.version})`);
  assert(meta.title_image_url && meta.title_image_url.includes('title_001.png'),
    'title_image_url points at title_001.png');
  assert(meta.last_build_size > 0, 'last_build_size > 0');
  assert(meta.last_build_at > 0, 'last_build_at > 0');
  assert(meta.latest_pdx_zip_url && meta.latest_pdx_zip_url.includes('card_meta/pdx?name='),
    'latest_pdx_zip_url routes through card_meta/pdx');

  console.log('# card_meta/pdx download');
  const dl = await get(server, `/api/projects/${projectId}/card_meta/pdx?name=${encodeURIComponent(pdxName)}`);
  assert(dl.status === 200, 'pdx download returns 200');
  assert(dl.headers['content-type'] === 'application/zip', 'content-type is application/zip');
  assert(dl.body.toString('utf8').startsWith('PK'), 'body is the seeded zip bytes');

  console.log('# card_meta/pdx rejects path traversal');
  const bad = await get(server, `/api/projects/${projectId}/card_meta/pdx?name=..%2F..%2Fetc%2Fpasswd`);
  assert(bad.status === 400, 'traversal attempt rejected with 400');

  console.log('# card_meta/pdx rejects wrong extension');
  const bad2 = await get(server, `/api/projects/${projectId}/card_meta/pdx?name=evil.exe`);
  assert(bad2.status === 400, 'non-.pdx.zip extension rejected with 400');

  console.log('# card_meta for missing project');
  const miss = await get(server, '/api/projects/does-not-exist/card_meta');
  assert(miss.status === 404, 'missing project returns 404');

  server.close();
  await fsp.rm(tmpData, { recursive: true, force: true });
  await fsp.rm(tmpLocal, { recursive: true, force: true });

  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall ok');
}

main().catch((e) => {
  console.error('crash', e);
  process.exit(1);
});
