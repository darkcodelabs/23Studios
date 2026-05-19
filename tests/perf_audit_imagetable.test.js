'use strict';

// perf_audit_imagetable.test.js — imagetable-aware sizing + geometry check
//
// Covers:
//   - boss-table-32-32.png at 128×128 (4×4 frames) → ok, no warn, tiles evenly
//   - border-table-400-240.png at 1600×240 (4×1 frames) → ok, no warn (was warn before fix)
//   - bad-table-32-32.png at 100×64 (doesn't tile on width) → fail imagetable_geometry
//   - huge.png (no -table- suffix) at 1200×1200 → warn as before (dim check still fires)
//
// Run: node tests/perf_audit_imagetable.test.js

const path = require('path');
const fs   = require('fs');
const fsp  = require('fs/promises');
const os   = require('os');

// Resolve sharp from server's own node_modules (tests live at repo root /tests/).
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../server')] }));

// Service under test.
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
// PNG fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a PNG of exact pixel dimensions whose per-row black ratio varies
 * enough (stddev > 0.04) to pass playdate_validator.isPlaceholderScenePng.
 * Strategy: every even row is all-white, every odd row is all-black — this
 * gives mean=0.5 and stddev=0.5, well above the 0.04 threshold.
 */
async function makePng(w, h) {
  // 1-channel greyscale: row y is all-black (0) if odd, all-white (255) if even.
  const data = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const val = (y % 2 === 0) ? 255 : 0;
    data.fill(val, y * w, (y + 1) * w);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

/**
 * Create a PNG that exceeds 200 KB by using noise + no compression.
 * Uses a 1200×1200 canvas so it also exceeds the 800 px dim threshold.
 */
async function makeHugePng() {
  const w = 1200;
  const h = 1200;
  const data = Buffer.alloc(w * h);
  for (let i = 0; i < data.length; i++) data[i] = (i * 137 + 13) & 0xff;
  return sharp(data, { raw: { width: w, height: h, channels: 1 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Fixture project builder
// ---------------------------------------------------------------------------

async function buildFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-imagetable-'));

  const imagesDir = path.join(root, 'source', 'images');
  const soundsDir = path.join(root, 'source', 'sounds');
  const scenesDir = path.join(root, 'source', 'scenes');

  await fsp.mkdir(imagesDir, { recursive: true });
  await fsp.mkdir(soundsDir, { recursive: true });
  await fsp.mkdir(scenesDir, { recursive: true });
  await fsp.mkdir(path.join(root, 'sdk_data'), { recursive: true });

  // 1. boss-table-32-32.png — 128×128 (4×4 frames). Frame dims 32×32 are sane.
  //    Sheet tiles evenly: 128%32==0, 128%32==0.
  const boss = await makePng(128, 128);
  await fsp.writeFile(path.join(imagesDir, 'boss-table-32-32.png'), boss);

  // 2. border-table-400-240.png — 1600×240 (4×1 frames, PWNGLOVE-style sheet).
  //    Frame dims 400×240 are sane (< 800 each). Previously false-positive on width.
  const border = await makePng(1600, 240);
  await fsp.writeFile(path.join(imagesDir, 'border-table-400-240.png'), border);

  // 3. bad-table-32-32.png — 100×64. Frame dim 32×32 but 100%32==4 (doesn't tile on W).
  const bad = await makePng(100, 64);
  await fsp.writeFile(path.join(imagesDir, 'bad-table-32-32.png'), bad);

  // 4. huge.png — 1200×1200, no -table- suffix. Should warn on dim (> 800 px).
  const huge = await makeHugePng();
  await fsp.writeFile(path.join(imagesDir, 'huge.png'), huge);

  return root;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n# perf_audit_imagetable — imagetable-aware sizing + geometry check\n');

  let root;
  try {
    root = await buildFixture();
  } catch (e) {
    console.error('FATAL: fixture setup failed:', e.message);
    process.exit(1);
  }

  let report;
  try {
    console.log('Running audit on imagetable fixture project…');
    report = await audit('imagetable-test', root);
    console.log('Audit complete.\n');
  } catch (e) {
    console.error('FATAL: audit() threw:', e.message || e);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Report shape: imagetable_geometry must exist
  // -------------------------------------------------------------------------
  console.log('# report shape');
  assert(Array.isArray(report.imagetable_geometry), 'report.imagetable_geometry is an array');

  // -------------------------------------------------------------------------
  // image_sizes checks
  // -------------------------------------------------------------------------
  console.log('\n# image_sizes — imagetable PNGs flagged is_imagetable');
  const imgBoss   = report.image_sizes.find((e) => path.basename(e.path) === 'boss-table-32-32.png');
  const imgBorder = report.image_sizes.find((e) => path.basename(e.path) === 'border-table-400-240.png');
  const imgBad    = report.image_sizes.find((e) => path.basename(e.path) === 'bad-table-32-32.png');
  const imgHuge   = report.image_sizes.find((e) => path.basename(e.path) === 'huge.png');

  assert(imgBoss != null,   'boss-table-32-32.png present in image_sizes');
  assert(imgBorder != null, 'border-table-400-240.png present in image_sizes');
  assert(imgBad != null,    'bad-table-32-32.png present in image_sizes');
  assert(imgHuge != null,   'huge.png present in image_sizes');

  assert(imgBoss   && imgBoss.is_imagetable   === true,  'boss-table-32-32 is_imagetable=true');
  assert(imgBorder && imgBorder.is_imagetable === true,  'border-table-400-240 is_imagetable=true');
  assert(imgBad    && imgBad.is_imagetable    === true,  'bad-table-32-32 is_imagetable=true');
  assert(imgHuge   && imgHuge.is_imagetable   === false, 'huge.png is_imagetable=false');

  // -------------------------------------------------------------------------
  // boss-table-32-32.png → ok, no warn
  // -------------------------------------------------------------------------
  console.log('\n# boss-table-32-32.png — 128×128, 4×4 frames, should be ok');
  assert(imgBoss && imgBoss.severity === 'ok',
    `boss-table-32-32 image_sizes severity=ok (got ${imgBoss && imgBoss.severity})`);

  const geosBoss = report.imagetable_geometry.filter((g) => path.basename(g.path) === 'boss-table-32-32.png');
  assert(geosBoss.length === 1, 'boss-table-32-32 has 1 imagetable_geometry entry');
  assert(geosBoss[0] && geosBoss[0].severity === 'ok',
    `boss-table-32-32 geometry severity=ok (got ${geosBoss[0] && geosBoss[0].severity})`);
  assert(geosBoss[0] && geosBoss[0].remainder_w === 0 && geosBoss[0].remainder_h === 0,
    'boss-table-32-32 remainders are 0,0');

  const fixesBoss = report.fixes.filter((f) => f.item === 'boss-table-32-32.png');
  assert(fixesBoss.length === 0, 'no fix entries for boss-table-32-32.png');

  // -------------------------------------------------------------------------
  // border-table-400-240.png → ok, no warn (was false-positive before fix)
  // -------------------------------------------------------------------------
  console.log('\n# border-table-400-240.png — 1600×240 (4×1 frames), per-frame 400×240, should be ok');
  assert(imgBorder && imgBorder.severity === 'ok',
    `border-table-400-240 image_sizes severity=ok (got ${imgBorder && imgBorder.severity})`);

  const geosBorder = report.imagetable_geometry.filter((g) => path.basename(g.path) === 'border-table-400-240.png');
  assert(geosBorder.length === 1, 'border-table-400-240 has 1 imagetable_geometry entry');
  assert(geosBorder[0] && geosBorder[0].severity === 'ok',
    `border-table-400-240 geometry severity=ok (got ${geosBorder[0] && geosBorder[0].severity})`);
  assert(geosBorder[0] && geosBorder[0].frame_w === 400 && geosBorder[0].frame_h === 240,
    'border-table-400-240 frame dims parsed correctly: 400×240');
  assert(geosBorder[0] && geosBorder[0].remainder_w === 0 && geosBorder[0].remainder_h === 0,
    'border-table-400-240 remainders are 0,0');

  const fixesBorder = report.fixes.filter((f) => f.item === 'border-table-400-240.png');
  assert(fixesBorder.length === 0, 'no fix entries for border-table-400-240.png');

  // -------------------------------------------------------------------------
  // bad-table-32-32.png → fail imagetable_geometry (100 is not divisible by 32)
  // -------------------------------------------------------------------------
  console.log('\n# bad-table-32-32.png — 100×64, frame 32×32, doesn\'t tile on width');
  const geosBad = report.imagetable_geometry.filter((g) => path.basename(g.path) === 'bad-table-32-32.png');
  assert(geosBad.length === 1, 'bad-table-32-32 has 1 imagetable_geometry entry');
  assert(geosBad[0] && geosBad[0].severity === 'fail',
    `bad-table-32-32 geometry severity=fail (got ${geosBad[0] && geosBad[0].severity})`);
  assert(geosBad[0] && geosBad[0].remainder_w === 4,
    `bad-table-32-32 remainder_w=4 (100%32, got ${geosBad[0] && geosBad[0].remainder_w})`);
  assert(geosBad[0] && geosBad[0].remainder_h === 0,
    `bad-table-32-32 remainder_h=0 (64%32, got ${geosBad[0] && geosBad[0].remainder_h})`);

  const fixesBad = report.fixes.filter((f) => f.item === 'bad-table-32-32.png');
  assert(fixesBad.length >= 1, 'bad-table-32-32 has at least 1 fix entry');
  const geomFix = fixesBad.find((f) => f.severity === 'fail');
  assert(geomFix != null, 'bad-table-32-32 has a fail-severity fix');
  assert(geomFix && geomFix.fix_hint && geomFix.fix_hint.includes("doesn't tile evenly"),
    `bad-table-32-32 fix_hint mentions "doesn't tile evenly" (got: ${geomFix && geomFix.fix_hint})`);
  assert(geomFix && geomFix.fix_hint && geomFix.fix_hint.includes('100×64'),
    'bad-table-32-32 fix_hint includes file dims 100×64');
  assert(geomFix && geomFix.fix_hint && geomFix.fix_hint.includes('32×32'),
    'bad-table-32-32 fix_hint includes frame dims 32×32');
  assert(geomFix && geomFix.fix_hint && geomFix.fix_hint.includes('4×0'),
    'bad-table-32-32 fix_hint includes remainder 4×0');

  // Recommendation text refers to imagetable (not "oversized image")
  assert(geomFix && geomFix.recommendation && geomFix.recommendation.toLowerCase().includes('imagetable'),
    'bad-table-32-32 fail recommendation mentions imagetable');

  // -------------------------------------------------------------------------
  // huge.png — no -table- suffix, 1200×1200 → warn on dim
  // -------------------------------------------------------------------------
  console.log('\n# huge.png — 1200×1200, no -table- suffix, should warn on dimensions');
  assert(imgHuge && imgHuge.severity !== 'ok',
    `huge.png severity is warn/fail (got ${imgHuge && imgHuge.severity})`);
  assert(imgHuge && imgHuge.w === 1200 && imgHuge.h === 1200,
    `huge.png dims read as 1200×1200 (got ${imgHuge && imgHuge.w}×${imgHuge && imgHuge.h})`);

  // huge.png should not appear in imagetable_geometry
  const geosHuge = report.imagetable_geometry.filter((g) => path.basename(g.path) === 'huge.png');
  assert(geosHuge.length === 0, 'huge.png absent from imagetable_geometry');

  // huge.png fix recommendation should use the old "Resize or split" text
  const fixHuge = report.fixes.find((f) => f.item === 'huge.png');
  assert(fixHuge != null, 'huge.png has a fix entry');
  assert(fixHuge && fixHuge.recommendation && fixHuge.recommendation.includes('Resize or split'),
    `huge.png recommendation says "Resize or split" (got: ${fixHuge && fixHuge.recommendation})`);
  assert(fixHuge && fixHuge.fix_hint && fixHuge.fix_hint.includes('800×800'),
    `huge.png fix_hint mentions 800×800 (got: ${fixHuge && fixHuge.fix_hint})`);

  // -------------------------------------------------------------------------
  // imagetable_geometry array contains exactly 3 entries (boss, border, bad)
  // -------------------------------------------------------------------------
  console.log('\n# imagetable_geometry array');
  assert(report.imagetable_geometry.length === 3,
    `imagetable_geometry has 3 entries (got ${report.imagetable_geometry.length})`);

  // -------------------------------------------------------------------------
  // summary.errors >= 1 (bad-table-32-32 geometry fail)
  // -------------------------------------------------------------------------
  console.log('\n# summary counts');
  assert(typeof report.summary.errors === 'number' && report.summary.errors >= 1,
    `summary.errors >= 1 (got ${report.summary.errors})`);

  // Cleanup
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_e) { /* ignore */ }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  console.log(`\n# results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
