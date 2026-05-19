'use strict';

// release_packager_smoke.test.js
//
// Exercises server/services/sdk_release_packager.js in isolation.
// Fixtures: fake pdxinfo, a fake .pdx directory, an empty preview/recording dir.
// No network, no LLM, no pdc required.
//
// Run: node tests/release_packager_smoke.test.js

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  ok ' + msg);
    passed++;
  } else {
    console.error('  FAIL ' + msg);
    failed++;
  }
}

function assertExists(filePath, label) {
  assert(fs.existsSync(filePath), label + ' exists: ' + filePath);
}

async function main() {
  // --- Fixture setup ---
  const tmpData = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-relpkg-data-'));
  const tmpLocal = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-relpkg-local-'));

  process.env.PROJECTS_DATA_DIR = tmpData;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-relpkg';
  process.env.STUDIO_PASSWORD = process.env.STUDIO_PASSWORD || 'test';
  process.env.NODE_ENV = 'test';

  const projectId = 'relpkg-smoke';

  // Write projects.json
  await fsp.writeFile(path.join(tmpData, 'projects.json'), JSON.stringify({
    projects: [{
      id: projectId,
      name: 'Release Packager Smoke Test',
      description: 'A game about testing things.',
      repo: 'https://github.com/example/relpkg-smoke',
      local_path: tmpLocal,
      platform: 'playdate',
      publisher: 'DarkCode LLC',
      developer: 'DarkCode LLC',
      build_command: '',
      preflight_command: '',
      captures_dir: '',
      created_at: '2026-05-19',
      status: 'active',
      game_type: 'sdk'
    }]
  }, null, 2));

  // Build fixture directory tree under tmpLocal:
  //   source/pdxinfo
  //   sdk_data/project.json
  //   sdk_data/preview/recording/   (empty — tolerate absence)
  //   sdk_data/preview/recording is created but with no PNGs

  await fsp.mkdir(path.join(tmpLocal, 'source'), { recursive: true });
  await fsp.mkdir(path.join(tmpLocal, 'sdk_data', 'preview', 'recording'), { recursive: true });
  await fsp.mkdir(path.join(tmpLocal, 'sdk_data'), { recursive: true });

  // pdxinfo
  await fsp.writeFile(path.join(tmpLocal, 'source', 'pdxinfo'), [
    'name=Smoke Test Game',
    'author=DarkCode LLC',
    'description=A game about testing things.',
    'bundleID=ai.darkcode.smoketest',
    'version=0.0.1',
    'buildNumber=1',
    'sdkVersion=3.0.6',
    'imagePath=launcher'
  ].join('\n') + '\n');

  // sdk_data/project.json
  await fsp.writeFile(path.join(tmpLocal, 'sdk_data', 'project.json'), JSON.stringify({
    title: 'Smoke Test Game',
    description: 'A game about testing things.',
    developer: 'DarkCode LLC',
    mechanic_hook: 'Crank',
    scenes: [{ id: 'title', lua: '-- noop' }]
  }, null, 2));

  // Fake .pdx directory (just needs to exist; zip call may or may not work)
  const fakePdxDir = path.join(os.tmpdir(), `23studios_sdk_build/fake_job_smoke/build/smoke-test-game.pdx`);
  await fsp.mkdir(fakePdxDir, { recursive: true });
  await fsp.writeFile(path.join(fakePdxDir, 'main.pdx'), 'fake pdx data');
  // Stamp the job dir with project id
  const fakeJobDir = path.join(os.tmpdir(), '23studios_sdk_build/fake_job_smoke');
  await fsp.writeFile(path.join(fakeJobDir, '.project_id'), projectId);

  // Inject a synthetic job into sdk_export's in-memory map via a shim approach:
  // We'll monkey-patch getJobsByProject for this test run by importing the module
  // after setting up the file system.
  const sdkExport = require('../server/services/sdk_export');

  // Force-hydrate: the stamp file + pdx dir are on disk; getJobsByProject will
  // find them via the cold-load path. Clear the internal map first so it scans fresh.
  // We can call getJobsByProject directly — it scans ROOT_BUILD_DIR.
  // ROOT_BUILD_DIR = /tmp/23studios_sdk_build — the fakeJobDir is under it.
  const jobs = sdkExport.getJobsByProject(projectId);
  // The hydration may or may not find our fake job (depends on ROOT_BUILD_DIR env).
  // Regardless, we proceed: the packager tolerates a missing pdx (writes placeholder).

  const packager = require('../server/services/sdk_release_packager');

  // --- Test 1: parsePdxinfo ---
  console.log('\n# parsePdxinfo');
  const pdxinfoRaw = 'name=Foo\nauthor=Bar\nversion=1.2.3\nbundleID=ai.dc.foo\nsdkVersion=3.0.6\n';
  const info = packager.parsePdxinfo(pdxinfoRaw);
  assert(info.name === 'Foo', 'name parsed');
  assert(info.author === 'Bar', 'author parsed');
  assert(info.version === '1.2.3', 'version parsed');
  assert(info.sdkVersion === '3.0.6', 'sdkVersion parsed');
  assert(info.bundleID === 'ai.dc.foo', 'bundleID parsed');

  // Lines with no = are skipped
  const info2 = packager.parsePdxinfo('just a line\nkey=value\n');
  assert(info2.key === 'value', 'valid key extracted after invalid line');
  assert(!('just a line' in info2), 'headerless line not included');

  // --- Test 2: pack() — full integration ---
  console.log('\n# pack() basic smoke');
  const result = await packager.pack(projectId, { tag: 'v0.0.1-test', force: true, include_screenshots: true });

  assert(typeof result === 'object' && result !== null, 'pack returns an object');
  assert(typeof result.release_dir === 'string', 'release_dir is a string');
  assert(typeof result.tag === 'string' && result.tag === 'v0.0.1-test', 'tag matches');
  assert(Array.isArray(result.files), 'files is an array');
  assert(result.files.length > 0, 'files array is non-empty');

  const releaseDir = result.release_dir;

  // --- Test 3: Required files exist ---
  console.log('\n# required release files');
  assertExists(path.join(releaseDir, 'README.md'), 'README.md');
  assertExists(path.join(releaseDir, 'CHANGELOG.md'), 'CHANGELOG.md');
  assertExists(path.join(releaseDir, 'LICENSE'), 'LICENSE');
  assertExists(path.join(releaseDir, 'build.sh'), 'build.sh');

  // .pdx.zip (name may vary; check any .pdx.zip in release dir)
  const releaseFiles = fs.readdirSync(releaseDir);
  const pdxZip = releaseFiles.find((f) => f.endsWith('.pdx.zip'));
  assert(!!pdxZip, '.pdx.zip file present');
  if (pdxZip) {
    const zipStat = fs.statSync(path.join(releaseDir, pdxZip));
    assert(zipStat.size > 0, '.pdx.zip is non-empty');
  }

  // --- Test 4: presskit/ contents ---
  console.log('\n# presskit/ structure');
  const presskitDir = path.join(releaseDir, 'presskit');
  assertExists(presskitDir, 'presskit/ directory');
  assertExists(path.join(presskitDir, 'description.txt'), 'presskit/description.txt');
  assertExists(path.join(presskitDir, 'controls.txt'), 'presskit/controls.txt');
  assertExists(path.join(presskitDir, 'credits.txt'), 'presskit/credits.txt');
  assertExists(path.join(presskitDir, 'meta.json'), 'presskit/meta.json');

  // meta.json shape
  const metaRaw = fs.readFileSync(path.join(presskitDir, 'meta.json'), 'utf8');
  let meta;
  try { meta = JSON.parse(metaRaw); } catch (_e) { meta = null; }
  assert(meta !== null, 'meta.json is valid JSON');
  if (meta) {
    assert(typeof meta.title === 'string', 'meta.title is a string');
    assert(typeof meta.tag === 'string', 'meta.tag is a string');
    assert(typeof meta.sdk_version === 'string', 'meta.sdk_version is a string');
    assert(meta.tag === 'v0.0.1-test', 'meta.tag matches requested tag');
    assert('repo_url' in meta, 'meta.repo_url key present');
    assert(typeof meta.build_date === 'string', 'meta.build_date is a string');
    assert('byte_size' in meta, 'meta.byte_size key present');
  }

  // --- Test 5: screenshots dir absent when recording was empty ---
  console.log('\n# screenshots dir absent when recording is empty');
  const screenshotsDir = path.join(releaseDir, 'screenshots');
  // recording dir exists but has no PNGs — screenshots dir should NOT be created
  assert(!fs.existsSync(screenshotsDir), 'screenshots/ dir absent when no recording PNGs');

  // --- Test 6: files manifest has expected kinds ---
  console.log('\n# files manifest kinds');
  const kinds = new Set(result.files.map((f) => f.kind));
  assert(kinds.has('readme'), 'readme kind present');
  assert(kinds.has('changelog'), 'changelog kind present');
  assert(kinds.has('license'), 'license kind present');
  assert(kinds.has('build_script'), 'build_script kind present');
  assert(kinds.has('pdx'), 'pdx kind present');
  assert(kinds.has('presskit'), 'presskit kind present');
  // screenshot kind should be absent (empty recording dir)
  assert(!kinds.has('screenshot'), 'screenshot kind absent (no recordings)');

  // --- Test 7: README.md content sanity ---
  console.log('\n# README.md content');
  const readme = fs.readFileSync(path.join(releaseDir, 'README.md'), 'utf8');
  assert(readme.includes('Smoke Test Game'), 'README includes game title');
  assert(readme.includes('v0.0.1-test'), 'README includes tag');
  assert(readme.includes('Controls'), 'README has Controls section');
  assert(readme.includes('Installation'), 'README has Installation section');
  assert(readme.includes('3.0.6'), 'README includes SDK version');

  // --- Test 8: LICENSE content ---
  console.log('\n# LICENSE content');
  const license = fs.readFileSync(path.join(releaseDir, 'LICENSE'), 'utf8');
  assert(license.startsWith('MIT License'), 'LICENSE starts with MIT License');
  assert(license.includes('DarkCode'), 'LICENSE includes developer name');

  // --- Test 9: CHANGELOG.md content ---
  console.log('\n# CHANGELOG.md content');
  const changelog = fs.readFileSync(path.join(releaseDir, 'CHANGELOG.md'), 'utf8');
  assert(changelog.includes('v0.0.1-test'), 'CHANGELOG includes tag');

  // --- Test 10: build.sh is executable ---
  console.log('\n# build.sh');
  const buildShPath = path.join(releaseDir, 'build.sh');
  const buildSh = fs.readFileSync(buildShPath, 'utf8');
  assert(buildSh.includes('#!/usr/bin/env bash'), 'build.sh has bash shebang');
  assert(buildSh.includes('pdc'), 'build.sh references pdc');
  const buildShMode = fs.statSync(buildShPath).mode;
  assert((buildShMode & 0o111) !== 0, 'build.sh is executable');

  // --- Test 11: force=false refuses to overwrite existing pack ---
  console.log('\n# force=false prevents overwrite');
  let threw = false;
  try {
    await packager.pack(projectId, { tag: 'v0.0.1-test', force: false });
  } catch (e) {
    threw = true;
    assert(e.status === 409, 'overwrite error has status 409');
  }
  assert(threw, 'pack throws when release exists and force=false');

  // --- Test 12: getLatestPack ---
  console.log('\n# getLatestPack');
  const latest = await packager.getLatestPack(projectId);
  assert(latest !== null, 'getLatestPack returns an object');
  if (latest) {
    assert(latest.tag === 'v0.0.1-test', 'getLatestPack returns correct tag');
    assert(Array.isArray(latest.files), 'getLatestPack files is array');
    assert(typeof latest.release_dir === 'string', 'getLatestPack release_dir is string');
  }

  // --- Test 13: getLatestPack on nonexistent project returns null ---
  console.log('\n# getLatestPack on nonexistent project');
  const noLatest = await packager.getLatestPack('does-not-exist-xyz');
  assert(noLatest === null, 'getLatestPack returns null for unknown project');

  // --- Cleanup ---
  await fsp.rm(tmpData, { recursive: true, force: true });
  await fsp.rm(tmpLocal, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall ok');
}

main().catch((e) => {
  console.error('crash:', e);
  process.exit(1);
});
