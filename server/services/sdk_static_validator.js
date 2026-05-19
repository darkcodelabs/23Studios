'use strict';

// sdk_static_validator.js — Step 7 of the 23studios canonical workflow.
//
// Reads <sdkRoot>/sdk_data/compiled_design.json (produced by sdk_design_compiler)
// and runs six structural checks:
//   1. rooms_reachable   — BFS from start scene; orphan detection
//   2. item_refs_resolve — every item id in interactions/puzzles must exist in inventory
//   3. dialogue_no_dead_ends — terminal dialogue nodes with no effect
//   4. puzzle_solvable   — topo-sort puzzle DAG; detect cycles + unreachable puzzles
//   5. endings_reachable — each ending's required flags reachable from initial save state
//   6. flag_consistency  — flags read-never-written and written-never-read
//
// Returns a structured report (see validate() jsdoc). Also writes the report to
// <sdkRoot>/sdk_data/design_validation.json as a side-effect.
//
// NOTE: Does NOT import from sdk_design_compiler.js — reads the JSON file directly.

const fsp = require('fs/promises');
const fs  = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function severity(fail, warn, pass) {
  if (fail) return 'fail';
  if (warn) return 'warn';
  return 'pass';
}

// BFS over rooms_graph. Returns Set of reachable room ids.
function bfsRooms(roomsGraph, startId) {
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = roomsGraph[cur];
    if (!node) continue;
    const exits = Array.isArray(node.exits) ? node.exits : [];
    for (const exit of exits) {
      const to = exit && exit.to;
      if (to && !visited.has(to)) queue.push(to);
    }
  }
  return visited;
}

// Kahn's algorithm topo-sort on adjacency map { id -> [deps] }.
// Returns { order: string[], cycles: string[][] }.
function topoSort(nodes) {
  const inDegree = {};
  const dependents = {}; // who depends on me

  for (const id of Object.keys(nodes)) {
    inDegree[id] = inDegree[id] || 0;
    dependents[id] = dependents[id] || [];
    for (const dep of (nodes[id] || [])) {
      dependents[dep] = dependents[dep] || [];
      dependents[dep].push(id);
      inDegree[id] = (inDegree[id] || 0) + 1;
    }
  }

  const queue = Object.keys(nodes).filter((id) => inDegree[id] === 0);
  const order = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    for (const dependent of (dependents[cur] || [])) {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) queue.push(dependent);
    }
  }

  // Any node not in order is part of a cycle.
  const remaining = Object.keys(nodes).filter((id) => !order.includes(id));
  // Build minimal cycle groups by strong-component (simplified: just list them).
  const cycles = remaining.length ? [remaining] : [];

  return { order, cycles };
}

// ---------------------------------------------------------------------------
// Check implementations
// ---------------------------------------------------------------------------

function checkRoomsReachable(design) {
  const roomsGraph = design.rooms_graph || {};
  const allIds = Object.keys(roomsGraph);

  if (allIds.length === 0) {
    return {
      id: 'rooms_reachable',
      severity: 'pass',
      detail: 'no rooms defined — nothing to check',
      orphans: []
    };
  }

  // Find start scene: prefer is_start:true, else first key.
  const startId = allIds.find((id) => roomsGraph[id] && roomsGraph[id].is_start) || allIds[0];
  const reachable = bfsRooms(roomsGraph, startId);
  const orphans = allIds.filter((id) => !reachable.has(id));
  const orphanRatio = orphans.length / allIds.length;

  const sev = severity(orphanRatio > 0.5, orphans.length > 0, true);

  let detail;
  if (orphans.length === 0) {
    detail = `all ${allIds.length} rooms reachable from "${startId}"`;
  } else {
    detail = `${orphans.length}/${allIds.length} rooms unreachable from "${startId}"` +
             (orphanRatio > 0.5 ? ' (>50% — fail)' : ' (warn)');
  }

  return { id: 'rooms_reachable', severity: sev, detail, orphans };
}

function checkItemRefsResolve(design) {
  const inventoryRules = design.inventory_rules || {};
  const knownItems = new Set((inventoryRules.items || []).map((i) => i.id).filter(Boolean));

  const broken = [];

  // Check interactions_map
  const interactionsMap = design.interactions_map || {};
  for (const [key, interaction] of Object.entries(interactionsMap)) {
    const obj = interaction && interaction.object;
    if (obj && !knownItems.has(obj)) {
      broken.push({ site: `interactions_map[${key}].object`, ref: obj });
    }
  }

  // Check puzzle_dag requires
  const puzzleDag = design.puzzle_dag || {};
  for (const [puzzleId, puzzle] of Object.entries(puzzleDag)) {
    const requires = Array.isArray(puzzle && puzzle.requires) ? puzzle.requires : [];
    for (const req of requires) {
      // requires entries can be item ids or flag names; check both item and flag namespaces.
      // Only flag as broken if it's clearly an item ref (not a flag name — flags are in state_flags).
      if (req && !knownItems.has(req)) {
        const flags = new Set(Object.keys(design.state_flags || {}));
        if (!flags.has(req)) {
          broken.push({ site: `puzzle_dag[${puzzleId}].requires`, ref: req });
        }
      }
    }
  }

  const sev = severity(broken.length > 0, false, true);
  const detail = broken.length === 0
    ? `all item references resolve (${knownItems.size} items in inventory)`
    : `${broken.length} broken item reference(s)`;

  return { id: 'item_refs_resolve', severity: sev, detail, broken };
}

function checkDialogueNoDeadEnds(design) {
  const triggers = design.dialogue_triggers || {};
  const terminal_nodes = [];

  for (const [triggerId, trigger] of Object.entries(triggers)) {
    const nodes = trigger && (trigger.nodes || trigger.tree || {});
    if (!nodes || typeof nodes !== 'object') continue;

    for (const [nodeId, node] of Object.entries(nodes)) {
      const responses = Array.isArray(node && node.responses) ? node.responses : [];
      if (responses.length === 0) continue; // truly terminal with no choices — allowed

      // Check if all responses lead to nodes with no further options AND no effect.
      let allLeadToDeadEnd = true;
      for (const response of responses) {
        const nextId = response && response.next;
        const effect = response && response.effect;

        // If the response itself has an effect, it's not a dead end.
        if (effect && (effect.set_flag || effect.give_item)) {
          allLeadToDeadEnd = false;
          break;
        }

        if (!nextId) {
          // Response with no next node — check if it has an effect.
          if (!effect) {
            // truly dead — no next, no effect; contributes to dead end
          } else {
            allLeadToDeadEnd = false;
            break;
          }
          continue;
        }

        const nextNode = nodes[nextId];
        if (!nextNode) {
          // Broken ref — still a dead end candidate
          continue;
        }

        const nextResponses = Array.isArray(nextNode.responses) ? nextNode.responses : [];
        const nextEffect = nextNode.effect;

        if (nextResponses.length > 0 || (nextEffect && (nextEffect.set_flag || nextEffect.give_item))) {
          allLeadToDeadEnd = false;
          break;
        }
      }

      if (allLeadToDeadEnd) {
        terminal_nodes.push({ trigger: triggerId, node: nodeId });
      }
    }
  }

  const sev = severity(false, terminal_nodes.length > 0, true);
  const detail = terminal_nodes.length === 0
    ? 'no dialogue dead ends detected'
    : `${terminal_nodes.length} terminal dialogue node(s) with no further options or effects`;

  return { id: 'dialogue_no_dead_ends', severity: sev, detail, terminal_nodes };
}

function checkPuzzleSolvable(design) {
  const puzzleDag = design.puzzle_dag || {};
  const saveSchema = design.save_schema || {};
  const stateFlags = design.state_flags || {};

  // Collect all flags that are true by default in save schema.
  const initialFlags = new Set();
  for (const field of (saveSchema.fields || [])) {
    if (field && field.default === true) initialFlags.add(field.name || field.id);
  }

  // Build dependency graph: puzzleId -> [list of flag deps from puzzle.requires]
  // Also collect produces sets.
  const puzzleIds = Object.keys(puzzleDag);
  const puzzleRequiresFlags = {}; // puzzleId -> [flag names it needs]
  const puzzleProduces = {}; // puzzleId -> [flag names it produces]

  for (const puzzleId of puzzleIds) {
    const puzzle = puzzleDag[puzzleId];
    const requires = Array.isArray(puzzle && puzzle.requires) ? puzzle.requires : [];
    const produces = Array.isArray(puzzle && puzzle.produces) ? puzzle.produces : [];
    puzzleRequiresFlags[puzzleId] = requires;
    puzzleProduces[puzzleId] = produces;
  }

  // Build adjacency for topo-sort: puzzle depends on other puzzles that produce its required flags.
  const depMap = {};
  for (const puzzleId of puzzleIds) {
    depMap[puzzleId] = [];
    for (const requiredFlag of puzzleRequiresFlags[puzzleId]) {
      // Find which puzzle produces this flag.
      for (const otherId of puzzleIds) {
        if (otherId !== puzzleId && puzzleProduces[otherId].includes(requiredFlag)) {
          depMap[puzzleId].push(otherId);
        }
      }
    }
  }

  const { order, cycles } = topoSort(depMap);

  // Walk in topo order, accumulating available flags.
  const availableFlags = new Set(initialFlags);
  const unreachable = [];

  for (const puzzleId of order) {
    const required = puzzleRequiresFlags[puzzleId];
    const missingFlags = required.filter((f) => {
      // A flag must either be in initialFlags, or produced by a prior puzzle.
      if (availableFlags.has(f)) return false;
      // Also check state_flags to see if it's defined at all.
      if (!(f in stateFlags)) return false; // not a flag — might be an item ref, handled elsewhere
      return true;
    });

    if (missingFlags.length > 0) {
      unreachable.push({ puzzle: puzzleId, missing_flags: missingFlags });
    }

    // Regardless, add produced flags so subsequent puzzles can use them.
    for (const produced of puzzleProduces[puzzleId]) {
      availableFlags.add(produced);
    }
  }

  const hasCycles = cycles.length > 0;
  const hasUnreachable = unreachable.length > 0;

  const sev = severity(hasCycles || hasUnreachable, false, true);

  let detail;
  if (!hasCycles && !hasUnreachable) {
    detail = `all ${puzzleIds.length} puzzle(s) solvable`;
  } else {
    const parts = [];
    if (hasCycles) parts.push(`${cycles[0].length} puzzle(s) in cycle(s)`);
    if (hasUnreachable) parts.push(`${unreachable.length} puzzle(s) unreachable`);
    detail = parts.join('; ');
  }

  return { id: 'puzzle_solvable', severity: sev, detail, unreachable, cycles };
}

function checkEndingsReachable(design) {
  const endings = design.endings || [];
  const puzzleDag = design.puzzle_dag || {};
  const saveSchema = design.save_schema || {};

  // Build the full set of flags reachable through completed puzzle DAG from initial state.
  const initialFlags = new Set();
  for (const field of (saveSchema.fields || [])) {
    if (field && field.default === true) initialFlags.add(field.name || field.id);
  }

  // Collect all flags any puzzle can produce (ignoring order for endings check — if it's
  // in the DAG at all and the DAG is acyclic, it's potentially reachable).
  const allProducible = new Set(initialFlags);
  for (const puzzle of Object.values(puzzleDag)) {
    for (const f of (Array.isArray(puzzle && puzzle.produces) ? puzzle.produces : [])) {
      allProducible.add(f);
    }
  }

  const unreachable = [];
  for (const ending of endings) {
    const endingId = ending.id || ending.name || JSON.stringify(ending);
    const required = Array.isArray(ending.requires) ? ending.requires : [];
    const missingFlags = required.filter((f) => !allProducible.has(f));
    if (missingFlags.length > 0) {
      unreachable.push({ ending: endingId, missing_flags: missingFlags });
    }
  }

  const sev = severity(unreachable.length > 0, false, true);
  const detail = unreachable.length === 0
    ? `all ${endings.length} ending(s) reachable`
    : `${unreachable.length}/${endings.length} ending(s) have unreachable required flags`;

  return { id: 'endings_reachable', severity: sev, detail, unreachable };
}

function checkFlagConsistency(design) {
  const stateFlags = design.state_flags || {};
  const allFlagNames = new Set(Object.keys(stateFlags));
  const puzzleDag = design.puzzle_dag || {};
  const endings = design.endings || [];
  const dialogueTriggers = design.dialogue_triggers || {};
  const interactionsMap = design.interactions_map || {};

  const readSites = new Set();
  const writeSites = new Set();

  // Read sites: puzzle_dag[*].requires
  for (const puzzle of Object.values(puzzleDag)) {
    for (const f of (Array.isArray(puzzle && puzzle.requires) ? puzzle.requires : [])) {
      if (allFlagNames.has(f)) readSites.add(f);
    }
  }

  // Read sites: endings[*].requires
  for (const ending of endings) {
    for (const f of (Array.isArray(ending.requires) ? ending.requires : [])) {
      if (allFlagNames.has(f)) readSites.add(f);
    }
  }

  // Read sites: dialogue_triggers[*].when
  for (const trigger of Object.values(dialogueTriggers)) {
    const when = trigger && trigger.when;
    if (!when) continue;
    // when can be a string flag name or array of flag names
    const flagList = Array.isArray(when) ? when : [when];
    for (const f of flagList) {
      if (typeof f === 'string' && allFlagNames.has(f)) readSites.add(f);
    }
  }

  // Write sites: puzzle_dag[*].produces
  for (const puzzle of Object.values(puzzleDag)) {
    for (const f of (Array.isArray(puzzle && puzzle.produces) ? puzzle.produces : [])) {
      if (allFlagNames.has(f)) writeSites.add(f);
    }
  }

  // Write sites: interactions_map[*].effect.set_flag
  for (const interaction of Object.values(interactionsMap)) {
    const effect = interaction && interaction.effect;
    const setFlag = effect && effect.set_flag;
    if (setFlag && allFlagNames.has(setFlag)) writeSites.add(setFlag);
  }

  const read_never_written = [...allFlagNames].filter((f) => readSites.has(f) && !writeSites.has(f));
  const written_never_read = [...allFlagNames].filter((f) => writeSites.has(f) && !readSites.has(f));

  const sev = severity(false, read_never_written.length > 0 || written_never_read.length > 0, true);

  const parts = [];
  if (read_never_written.length) parts.push(`${read_never_written.length} flag(s) read but never written`);
  if (written_never_read.length) parts.push(`${written_never_read.length} flag(s) written but never read`);
  const detail = parts.length ? parts.join('; ') : `all ${allFlagNames.size} flag(s) consistent`;

  return { id: 'flag_consistency', severity: sev, detail, read_never_written, written_never_read };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * validate(projectId, sdkRoot)
 *
 * Reads <sdkRoot>/sdk_data/compiled_design.json and runs six structural checks.
 * Persists the report to <sdkRoot>/sdk_data/design_validation.json.
 *
 * @param {string} projectId
 * @param {string} sdkRoot   absolute path to the project's local working directory
 * @returns {Promise<object>} structured report
 */
async function validate(projectId, sdkRoot) {
  const compiledPath = path.join(sdkRoot, 'sdk_data', 'compiled_design.json');

  if (!fs.existsSync(compiledPath)) {
    return {
      ok: false,
      error: 'no_compiled_design',
      detail: 'run /api/projects/:id/design/compile first'
    };
  }

  let design;
  try {
    const raw = await fsp.readFile(compiledPath, 'utf8');
    design = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      error: 'parse_error',
      detail: `compiled_design.json is not valid JSON: ${e.message}`
    };
  }

  const checks = [
    checkRoomsReachable(design),
    checkItemRefsResolve(design),
    checkDialogueNoDeadEnds(design),
    checkPuzzleSolvable(design),
    checkEndingsReachable(design),
    checkFlagConsistency(design)
  ];

  let passed = 0, warned = 0, failed = 0;
  for (const c of checks) {
    if (c.severity === 'pass') passed++;
    else if (c.severity === 'warn') warned++;
    else failed++;
  }

  const report = {
    ok: failed === 0,
    project_id: projectId,
    ran_at: new Date().toISOString(),
    summary: { passed, warned, failed },
    checks
  };

  // Persist as side-effect.
  try {
    const outPath = path.join(sdkRoot, 'sdk_data', 'design_validation.json');
    await fsp.mkdir(path.join(sdkRoot, 'sdk_data'), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  } catch (_e) {
    // Non-fatal — still return the report.
  }

  return report;
}

module.exports = { validate };
