#!/usr/bin/env node
'use strict';

// seed_music CLI
//
// Usage:
//   node server/scripts/seed_music.js [--dir=server/server/data/shared_music]
//                                     [--source=<path>] [--limit=N]
//
// Prints the music_library legal disclaimer first, then renders each tracker
// module under --source into --dir using music_library.seedLocalLibrary, and
// prints a JSON summary on stdout. Exits 0 on full success, 1 on any error.

const path = require('path');
const musicLibrary = require('../services/music_library');

const DEFAULT_DEST = 'server/server/data/shared_music';
const DEFAULT_SOURCE = '/home/hakcer/projects/personal/hakcd/tools/keygenmusic_scraper/downloads/keygenmusic';

function parseArgs(argv) {
  const args = { dir: DEFAULT_DEST, source: DEFAULT_SOURCE, limit: null };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (key === 'dir') args.dir = val;
    else if (key === 'source') args.source = val;
    else if (key === 'limit') {
      const n = parseInt(val, 10);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const destDir = path.isAbsolute(args.dir) ? args.dir : path.resolve(process.cwd(), args.dir);
  const sourceDir = path.isAbsolute(args.source) ? args.source : path.resolve(process.cwd(), args.source);

  // music_library prints the disclaimer itself on every seedLocalLibrary call,
  // but the task spec says the CLI must print it FIRST. Print our own copy
  // (same lines) so it appears at the very top of the run, then delegate.
  process.stderr.write('[music_library] LEGAL: tracker music from keygenmusic.tk is for local\n');
  process.stderr.write('[music_library] development reference only. Do NOT bundle into a public\n');
  process.stderr.write('[music_library] release. See keygenmusic.tk/terms.\n');

  let result;
  try {
    result = await musicLibrary.seedLocalLibrary({
      destDir,
      sourceDir,
      limit: args.limit
    });
  } catch (e) {
    const summary = {
      destDir,
      count: 0,
      errors: [{ code: e.code || 'fatal', message: e.message }]
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    process.exit(1);
    return;
  }

  const summary = {
    destDir: result.destDir,
    count: result.manifest.length,
    errors: result.errors
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exit(result.errors.length === 0 ? 0 : 1);
}

main().catch(e => {
  process.stderr.write(`[seed_music] fatal: ${e && e.stack || e}\n`);
  process.exit(1);
});
