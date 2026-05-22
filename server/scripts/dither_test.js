#!/usr/bin/env node
'use strict';

// dither_test.js — Phase 4.5 Patch F CLI wrapper.
//
// Generates the five dither variants spec'd in
// docs/23studios_phase4_image_quality.md Patch B for one source asset of a
// known project, writes them under
// <local_path>/sdk_data/dither_variants/<sanitized_asset_id>/, and prints
// the resulting paths + byte sizes.
//
// Usage:
//   node server/scripts/dither_test.js <projectId> <assetId> [outDir]
//
// Example:
//   node server/scripts/dither_test.js hakcd-v2 scene:title_dial_tone

const path = require('path');
const ditherVariants = require('../services/dither_variants');

function usage() {
  process.stderr.write(
    'usage: node server/scripts/dither_test.js <projectId> <assetId> [outDir]\n' +
    '  e.g.  node server/scripts/dither_test.js hakcd-v2 scene:title_dial_tone\n'
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) { usage(); process.exit(1); }
  const projectId = argv[0];
  const assetId = argv[1];
  const outDir = argv[2] ? path.resolve(argv[2]) : null;

  let manifest;
  try {
    manifest = await ditherVariants.generateVariants(projectId, assetId, outDir);
  } catch (e) {
    process.stderr.write('dither_test FAILED: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(2);
  }

  process.stdout.write('source: ' + manifest.source_path + '\n');
  process.stdout.write('target: ' + manifest.target_w + 'x' + manifest.target_h + '\n');
  process.stdout.write('variants:\n');
  for (const name of Object.keys(manifest.variants)) {
    const v = manifest.variants[name];
    process.stdout.write(
      '  ' + name.padEnd(18) + ' ' +
      v.path + ' (' + v.bytes + ' bytes, algo=' + v.algo +
      ', contrast=' + v.contrast + ', brightness=' + v.brightness + ')\n'
    );
  }
  process.exit(0);
}

main();
