'use strict';

// perf_audit_smoke.test.js — Phase 13 static performance audit smoke tests.
//
// Fixtures:
//   - small PNG     (ok — under 200 KB, under 800×800)
//   - large PNG     (warn — over 200 KB)
//   - duplicate of small PNG (triggers duplication check)
//   - scenes/test.lua with 30 gfx.draw calls (flags draw_calls)
//   - source/sounds/test.wav (small — contributes to audio bytes)
//
// Run: node tests/perf_audit_smoke.test.js

const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');
const os     = require('os');
// Resolve sharp from server's own node_modules (tests live at repo root /tests/).
const sharp  = require(require.resolve('sharp', { paths: [path.join(__dirname, '../server')] }));

// Service under test — resolved from the worktree root.
const { audit } = require('../server/services/sdk_perf_audit');

// ---------------------------------------------------------------------------
// Mini test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log('  ok  ' + msg);
    passed++;
  } else {
    console.error('  FAIL ' + msg);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Generate a small 50×50 PNG (well under 200 KB). */
async function makeSmallPng() {
  return sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toBuffer();
}

/**
 * Generate a large PNG that exceeds the 200 KB limit.
 * Strategy: 400×400 grayscale with no compression hint so output file is large.
 * We use compressionLevel:0 to keep deflate minimal and push size up.
 */
async function makeLargePng() {
  // 400×400 grayscale noise -> uncompressed is 160 KB raw; force uncompressed
  // output by using compressionLevel 0 to maximise file size.
  const width  = 400;
  const height = 400;
  // Build random noise data so it won't compress well.
  const data = Buffer.alloc(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (i * 137 + 42) & 0xff;
  return sharp(data, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

/** Write a minimal WAV file (44-byte header + 1000 bytes silence). */
function makeWavBuffer() {
  const data = Buffer.alloc(44 + 1000, 0);
  // RIFF header
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + 1000, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);        // chunk size
  data.writeUInt16LE(1, 20);         // PCM
  data.writeUInt16LE(1, 22);         // mono
  data.writeUInt32LE(8000, 24);      // sample rate
  data.writeUInt32LE(8000, 28);      // byte rate
  data.writeUInt16LE(1, 32);         // block align
  data.writeUInt16LE(8, 34);         // bits per sample
  data.write('data', 36);
  data.writeUInt32LE(1000, 40);
  return data;
}

/** Lua file with 30 gfx.draw calls. */
function makeLuaWith30DrawCalls() {
  const lines = ['-- test scene'];
  for (let i = 0; i < 30; i++) {
    lines.push(`gfx.draw(sprites[${i}], ${i * 10}, 0)`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Setup fixture project
// ---------------------------------------------------------------------------

async function buildFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-perf-smoke-'));

  const imagesDir = path.join(root, 'source', 'images');
  const soundsDir = path.join(root, 'source', 'sounds');
  const scenesDir = path.join(root, 'source', 'scenes');

  await fsp.mkdir(imagesDir, { recursive: true });
  await fsp.mkdir(soundsDir, { recursive: true });
  await fsp.mkdir(scenesDir, { recursive: true });
  await fsp.mkdir(path.join(root, 'sdk_data'), { recursive: true });

  // Small PNG — ok
  const smallBuf = await makeSmallPng();
  await fsp.writeFile(path.join(imagesDir, 'small.png'), smallBuf);

  // Large PNG — should warn
  const largeBuf = await makeLargePng();
  await fsp.writeFile(path.join(imagesDir, 'large.png'), largeBuf);

  // Duplicate of small PNG — same bytes, different name
  await fsp.writeFile(path.join(imagesDir, 'small_copy.png'), smallBuf);

  // Lua scene with 30 draw calls
  await fsp.writeFile(path.join(scenesDir, 'test.lua'), makeLuaWith30DrawCalls());

  // Tiny WAV
  await fsp.writeFile(path.join(soundsDir, 'test.wav'), makeWavBuffer());

  return root;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n# perf_audit_smoke — Phase 13 audit service\n');

  let root;
  try {
    root = await buildFixture();
  } catch (e) {
    console.error('FATAL: fixture setup failed:', e.message);
    process.exit(1);
  }

  const projectId = 'perf-smoke-test';

  let report;
  try {
    console.log('Running audit on fixture project…');
    report = await audit(projectId, root);
    console.log('Audit complete.\n');
  } catch (e) {
    console.error('FATAL: audit() threw:', e.message || e);
    process.exit(1);
  }

  // --- Basic shape ---
  console.log('# report shape');
  assert(report && typeof report === 'object', 'report is an object');
  assert(typeof report.audited_at === 'string', 'report.audited_at is a string');
  assert(report.summary && typeof report.summary === 'object', 'report.summary exists');
  assert(Array.isArray(report.image_sizes), 'report.image_sizes is array');
  assert(Array.isArray(report.draw_calls), 'report.draw_calls is array');
  assert(Array.isArray(report.duplications), 'report.duplications is array');
  assert(Array.isArray(report.placeholders), 'report.placeholders is array');
  assert(Array.isArray(report.fixes), 'report.fixes is array');
  assert(report.memory_estimate && typeof report.memory_estimate === 'object', 'report.memory_estimate exists');

  // --- Persisted files ---
  console.log('\n# persisted output files');
  const sdkData = path.join(root, 'sdk_data');
  assert(fs.existsSync(path.join(sdkData, 'perf_audit.json')), 'perf_audit.json written');
  assert(fs.existsSync(path.join(sdkData, 'perf_audit.md')), 'perf_audit.md written');

  const persistedRaw = fs.readFileSync(path.join(sdkData, 'perf_audit.json'), 'utf8');
  let persisted;
  try { persisted = JSON.parse(persistedRaw); } catch (_e) { persisted = null; }
  assert(persisted && persisted.audited_at, 'persisted JSON is valid');

  // --- image_sizes: large.png must be flagged ---
  console.log('\n# image_sizes');
  assert(report.image_sizes.length >= 3, `image_sizes has >= 3 entries (got ${report.image_sizes.length})`);
  const largEntry = report.image_sizes.find((e) => path.basename(e.path) === 'large.png');
  assert(largEntry != null, 'large.png found in image_sizes');
  assert(largEntry && largEntry.severity !== 'ok', `large.png severity is warn/fail (got ${largEntry && largEntry.severity})`);
  assert(largEntry && largEntry.bytes > 200 * 1024, `large.png bytes > 200 KB (got ${largEntry && largEntry.bytes})`);

  const smallEntry = report.image_sizes.find((e) => path.basename(e.path) === 'small.png');
  assert(smallEntry != null, 'small.png found in image_sizes');
  assert(smallEntry && smallEntry.severity === 'ok', `small.png severity is ok (got ${smallEntry && smallEntry.severity})`);

  // --- duplications: small.png + small_copy.png ---
  console.log('\n# duplications');
  assert(report.duplications.length >= 1, `at least 1 duplication group (got ${report.duplications.length})`);
  const dupGroup = report.duplications.find((d) => d.count >= 2 && d.files.some((f) => path.basename(f) === 'small.png'));
  assert(dupGroup != null, 'duplication group contains small.png');
  assert(dupGroup && dupGroup.files.some((f) => path.basename(f) === 'small_copy.png'), 'duplication group contains small_copy.png');

  // --- draw_calls: test.lua must be flagged ---
  console.log('\n# draw_calls');
  assert(report.draw_calls.length >= 1, `at least 1 scene entry (got ${report.draw_calls.length})`);
  const testScene = report.draw_calls.find((sc) => path.basename(sc.scene) === 'test.lua');
  assert(testScene != null, 'test.lua found in draw_calls');
  assert(testScene && testScene.count >= 30, `test.lua has >= 30 draw calls (got ${testScene && testScene.count})`);
  assert(testScene && testScene.severity !== 'ok', `test.lua severity is warn/fail (got ${testScene && testScene.severity})`);

  // --- summary.warnings >= 3 ---
  console.log('\n# summary.warnings');
  assert(
    typeof report.summary.warnings === 'number' && report.summary.warnings >= 3,
    `summary.warnings >= 3 (got ${report.summary.warnings})`
  );

  // --- memory_estimate has audio bytes > 0 ---
  console.log('\n# memory_estimate');
  assert(report.memory_estimate.audio > 0, `audio bytes > 0 (got ${report.memory_estimate.audio})`);
  assert(report.memory_estimate.images > 0, `image bytes > 0 (got ${report.memory_estimate.images})`);
  assert(report.memory_estimate.total > 0, `total bytes > 0 (got ${report.memory_estimate.total})`);
  assert(typeof report.memory_estimate.budget_pct === 'number', 'budget_pct is a number');
  assert(typeof report.memory_estimate.severity === 'string', 'memory_estimate.severity is a string');

  // --- fixes list has at least one warn entry ---
  console.log('\n# fixes');
  const warnFixes = report.fixes.filter((f) => f.severity === 'warn');
  assert(warnFixes.length >= 1, `at least 1 warn fix (got ${warnFixes.length})`);

  // --- sprite count (no imagetable fixtures, so 0) ---
  console.log('\n# sprite count');
  assert(typeof report.summary.sprite_count === 'number', 'sprite_count is a number');
  assert(report.summary.scene_count >= 1, `scene_count >= 1 (got ${report.summary.scene_count})`);

  // Cleanup
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_e) { /* ignore */ }

  // --- Results ---
  console.log(`\n# results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
