#!/usr/bin/env node
'use strict';

// patrol_cli.js — usage:
//   node server/scripts/patrol_cli.js <project_id> [--regen] [--kind=tile,scene]
//
// Runs the patrol on the given project, prints the punch list, and (if
// --regen is passed) fires regenAll with concurrency 4. Useful for CI and
// for the user to rerun after editing.
//
// Requires a populated .env (OPENROUTER_API_KEY + PROJECTS_DATA_DIR).

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const patrol = require('../services/pulp_patrol');

function parseArgs(argv) {
  const out = { projectId: '', regen: false, kinds: null };
  for (const a of argv) {
    if (!out.projectId && !a.startsWith('-')) { out.projectId = a; continue; }
    if (a === '--regen') { out.regen = true; continue; }
    if (a.startsWith('--kind=')) {
      out.kinds = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

function fmtSummary(s) {
  return [
    `tiles: ${s.tiles_total} total / ${s.tiles_missing} missing / ${s.tiles_placeholder} placeholder`,
    `scenes: ${s.scenes_total} total / ${s.scenes_missing_bg} missing bg`,
    `characters: ${s.characters_total} total / ${s.characters_missing_portrait} missing portrait`
  ].join('\n  ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.projectId) {
    process.stdout.write([
      'usage: patrol_cli.js <project_id> [--regen] [--kind=tile,scene,character]',
      '',
      'examples:',
      '  patrol_cli.js hakcd-2-0-a-phreak-s-tal-gefqh',
      '  patrol_cli.js hakcd-2-0-a-phreak-s-tal-gefqh --regen',
      '  patrol_cli.js hakcd-2-0-a-phreak-s-tal-gefqh --regen --kind=scene'
    ].join('\n') + '\n');
    process.exit(args.help ? 0 : 2);
  }

  process.stdout.write(`[patrol] project=${args.projectId}\n`);
  const r = await patrol.patrolProject(args.projectId);
  process.stdout.write(`[patrol] summary:\n  ${fmtSummary(r.summary)}\n`);
  process.stdout.write(`[patrol] issues=${r.issues.length}\n`);
  for (const i of r.issues.slice(0, 50)) {
    process.stdout.write(`  ${i.kind.padEnd(10)} ${String(i.id).padEnd(30)} ${i.problem}\n`);
  }
  if (r.issues.length > 50) {
    process.stdout.write(`  ... ${r.issues.length - 50} more\n`);
  }

  if (!args.regen) {
    process.stdout.write('[patrol] (run with --regen to fix)\n');
    return;
  }

  if (r.issues.length === 0) {
    process.stdout.write('[patrol] nothing to do.\n');
    return;
  }

  process.stdout.write(`[patrol] regenerating ${r.issues.length} issues...\n`);
  const result = await patrol.regenAll(args.projectId, {
    kinds: args.kinds || undefined,
    concurrency: 4,
    onProgress: (ev) => {
      if (ev.stage === 'plan') {
        process.stdout.write(`[patrol] planning ${ev.total} fixes\n`);
        return;
      }
      const it = ev.item || {};
      // Stage 'fixed' fires for every completed item — success or failure.
      // Use the item's own ok flag (or absence of error) for the label.
      const succeeded = it.ok === true || (it.ok === undefined && !it.error);
      const tag = ev.stage === 'fixed' && succeeded ? 'OK  ' : 'FAIL';
      process.stdout.write(
        `[${ev.current}/${ev.total}] ${tag} ${(it.kind || '?').padEnd(10)} ${String(it.id || '?').padEnd(30)} ${
          it.took_ms ? it.took_ms + 'ms' : ''} ${it.error ? '  err=' + it.error : ''}\n`
      );
    }
  });

  process.stdout.write('[patrol] BEFORE:\n  ' + fmtSummary(result.summary.before) + '\n');
  process.stdout.write('[patrol] AFTER:\n  ' + fmtSummary(result.summary.after) + '\n');
  process.stdout.write(`[patrol] fixed=${result.fixed.length} failed=${result.failed.length}\n`);
  if (result.failed.length > 0) {
    process.stdout.write('[patrol] failures:\n');
    for (const f of result.failed) {
      process.stdout.write(`  ${f.kind} ${f.id} :: ${f.error}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`[patrol] FATAL ${e && (e.stack || e.message) || e}\n`);
  process.exit(1);
});
