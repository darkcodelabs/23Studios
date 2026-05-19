'use strict';

// sdk_auto_gate.js — auto-sign-off canonical gates when objective quality
// signals are all green. Lets the pipeline run hands-free for full-auto
// flows without permanently breaking the human-loop contract.
//
// Sign-off rules (all must hold for a gate to auto-clear):
//   visual_identity   — perf audit: no FAIL fixes (no placeholders) +
//                       static validator clean
//   first_playable    — milestone_m04 boots=true with smoketest ok
//   puzzle_sanity     — static validator puzzle_solvable + endings_reachable
//                       both pass
//   difficulty        — milestone_m07_full_game boots=true
//   core_mechanic     — only when STUDIO_AUTO_SIGN_GATES=1 (creative,
//                       human normally signs)
//   vibe_check        — only when STUDIO_AUTO_SIGN_GATES=1
//
// Default mode (STUDIO_AUTO_SIGN_GATES unset): signs visual_identity,
// first_playable, puzzle_sanity, difficulty if their objective signals
// are green. Leaves core_mechanic + vibe_check for the human.
//
// Full-auto mode (STUDIO_AUTO_SIGN_GATES=1): signs ALL 6 if any objective
// signal is green for them, falls back to "auto-cleared, no objective
// signal" notes for the two creative gates.
//
// Best-effort: any service crash → no sign-off, no exception bubbled.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const gates = require('./gates');

const FULL_AUTO = () => process.env.STUDIO_AUTO_SIGN_GATES === '1';

async function readJsonOrNull(fp) {
  try { return JSON.parse(await fsp.readFile(fp, 'utf8')); }
  catch (_e) { return null; }
}

async function loadSignals(localPath) {
  const sdk = path.join(localPath, 'sdk_data');
  const [perf, validator, critic, m04, m07, mrc] = await Promise.all([
    readJsonOrNull(path.join(sdk, 'perf_audit.json')),
    readJsonOrNull(path.join(sdk, 'design_validation.json')),
    readJsonOrNull(path.join(sdk, 'qa_critic.json')),
    readJsonOrNull(path.join(sdk, 'milestones', 'm04_inventory', 'status.json')),
    readJsonOrNull(path.join(sdk, 'milestones', 'm07_full_game', 'status.json')),
    readJsonOrNull(path.join(sdk, 'milestones', 'release_candidate', 'status.json'))
  ]);
  return { perf, validator, critic, m04, m07, mrc };
}

function perfClean(perf) {
  if (!perf || !Array.isArray(perf.fixes)) return null;
  return !perf.fixes.some((f) => f && f.severity === 'fail');
}

function validatorClean(v) {
  return !!(v && v.ok === true && (!v.summary || v.summary.failed === 0));
}

function validatorPuzzleClean(v) {
  if (!v || !Array.isArray(v.checks)) return null;
  const puzzle = v.checks.find((c) => c.id === 'puzzle_solvable');
  const endings = v.checks.find((c) => c.id === 'endings_reachable');
  return !!(puzzle && puzzle.severity !== 'fail' &&
            endings && endings.severity !== 'fail');
}

function criticGreen(c) {
  if (!c) return null;
  return c.recommendation === 'ship' ||
         (c.aggregate && typeof c.aggregate.avg_score === 'number' && c.aggregate.avg_score >= 7);
}

function milestoneGreen(m) {
  return !!(m && m.boots === true && (!m.smoketest || m.smoketest.ok !== false));
}

/**
 * autoSignIfGreen(projectId) — runs the rule set, signs canonical gates
 * that pass their objective signal. Returns { signed: [...gateIds], skipped: [...] }.
 */
async function autoSignIfGreen(projectId) {
  const project = await projects.getProject(projectId);
  if (!project || !project.local_path) {
    return { signed: [], skipped: [], error: 'project_not_found' };
  }

  // Make sure the canonical gates exist before trying to sign.
  await gates.seedCanonicalGates(projectId, project.local_path);

  const signals = await loadSignals(project.local_path);
  const list = await gates.readCanonicalGates(project.local_path);
  const byId = Object.fromEntries(list.map((g) => [g.id, g]));
  const fullAuto = FULL_AUTO();

  // Rule -> sign condition mapping. null = "no signal available".
  const rules = {
    visual_identity: () => perfClean(signals.perf) === true && validatorClean(signals.validator),
    first_playable: () => milestoneGreen(signals.m04),
    puzzle_sanity:  () => validatorPuzzleClean(signals.validator) === true,
    difficulty:     () => milestoneGreen(signals.m07),
    core_mechanic:  () => fullAuto && criticGreen(signals.critic) === true,
    vibe_check:     () => fullAuto && criticGreen(signals.critic) === true
  };

  const signed = [];
  const skipped = [];
  for (const [gateId, ruleFn] of Object.entries(rules)) {
    const g = byId[gateId];
    if (!g) { skipped.push({ gate: gateId, reason: 'gate_missing' }); continue; }
    if (g.status === 'signed_off') { skipped.push({ gate: gateId, reason: 'already_signed' }); continue; }
    let shouldSign;
    try { shouldSign = ruleFn(); }
    catch (_e) { shouldSign = false; }
    if (!shouldSign) { skipped.push({ gate: gateId, reason: 'signal_not_green' }); continue; }
    try {
      const note = fullAuto
        ? 'auto-signed by sdk_auto_gate (full-auto mode)'
        : 'auto-signed by sdk_auto_gate — objective signal green';
      await gates.signOffCanonical({
        projectId, gateId, notes: note, signedOffBy: 'sdk_auto_gate'
      });
      signed.push(gateId);
    } catch (e) {
      skipped.push({ gate: gateId, reason: 'sign_failed: ' + (e.message || e) });
    }
  }

  return { signed, skipped, full_auto: fullAuto };
}

module.exports = { autoSignIfGreen };
