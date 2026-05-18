#!/usr/bin/env node
'use strict';

// gen_sfx.js — generate baseline retro SFX (mono 22050 Hz 16-bit PCM WAV).
// Wrapper around sfx_synth. Port of HAKCD's gen_sfx.py CLI.
//
// Usage:
//   node server/scripts/gen_sfx.js --baseline --out=server/server/data/shared_sfx
//   node server/scripts/gen_sfx.js --preset=coin --out=coin.wav [--duration=0.25]
//   node server/scripts/gen_sfx.js --list

const path = require('path');
const sfx = require('../services/sfx_synth');

function parseArgs(argv) {
  const out = { baseline: false, list: false, preset: null, outPath: null, opts: {} };
  for (const a of argv) {
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--baseline') { out.baseline = true; continue; }
    if (a === '--list')     { out.list = true; continue; }
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1], v = m[2];
    if (k === 'preset')      out.preset = v;
    else if (k === 'out')    out.outPath = v;
    else if (k === 'duration') out.opts.duration = parseFloat(v);
    else if (k === 'pitch')    out.opts._pitch = parseFloat(v);
  }
  return out;
}

function applyPitch(preset, hz, opts) {
  if (!isFinite(hz)) return opts;
  switch (preset) {
    case 'select':    return { ...opts, start_hz: hz * 0.5, end_hz: hz };
    case 'deny':      return { ...opts, start_hz: hz, end_hz: hz * 0.35 };
    case 'kombo_hit': return { ...opts, root_hz: hz };
    case 'alert':     return { ...opts, hi_hz: hz, lo_hz: hz * 0.75 };
    case 'coin':      return { ...opts, high_hz: hz, low_hz: hz * 0.67 };
    default:          return opts; // click has no pitch
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write([
      'usage: gen_sfx.js [--baseline --out=<dir>] | [--preset=<name> --out=<file>] | [--list]',
      '',
      'flags:',
      '  --baseline       generate all 6 preset SFX into <out> dir',
      '  --preset=<name>  generate one preset SFX (click|select|deny|kombo_hit|alert|coin)',
      '  --out=<path>     output dir (baseline) or output .wav file (single preset)',
      '  --duration=<s>   override preset duration in seconds',
      '  --pitch=<Hz>     override preset base pitch in Hz (where applicable)',
      '  --list           print preset names and exit'
    ].join('\n') + '\n');
    process.exit(0);
  }

  if (args.list) {
    for (const name of sfx.BASELINE_NAMES) process.stdout.write(name + '\n');
    process.exit(0);
  }

  if (args.baseline) {
    if (!args.outPath) { process.stderr.write('--baseline requires --out=<dir>\n'); process.exit(2); }
    const r = sfx.generateBaseline({ destDir: args.outPath });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(0);
  }

  if (args.preset) {
    if (!args.outPath) { process.stderr.write('--preset requires --out=<file>\n'); process.exit(2); }
    const opts = applyPitch(args.preset, args.opts._pitch, args.opts);
    delete opts._pitch;
    const r = sfx.generateOne({ name: args.preset, destPath: path.resolve(args.outPath), opts });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(0);
  }

  process.stderr.write('one of --baseline, --preset, --list required\n');
  process.exit(2);
}

main();
