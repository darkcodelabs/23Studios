'use strict';

// sdk_design_compiler.js — Game Design Compiler (Step 3 of canonical workflow).
//
// Reads the AI-generated source data for an SDK project and emits a single
// sdk_data/compiled_design.json that captures the room graph, interaction map,
// puzzle DAG, inventory rules, dialogue triggers, state flags, save schema,
// and endings.  runSceneLua consumes this so it has a validated game model
// before emitting Lua -- no more freestyle goblin code.
//
// Derives as much as possible from the existing scene and character JSON.
// When a section cannot be derived (items/dialogue/interactions not yet
// generated), it emits an empty array and records a compiler_warning.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const SDK_DATA_REL = 'sdk_data';
const COMPILED_FILENAME = 'compiled_design.json';
const COMPILER_VERSION = 1;

// ---------------------------------------------------------------------------
// Loader helpers
// ---------------------------------------------------------------------------

function loadJsonFile(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_e) {
    return fallback;
  }
}

function loadScenes(sdkRoot) {
  const dir = path.join(sdkRoot, 'scenes');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const scenes = [];
  for (const f of files) {
    const data = loadJsonFile(path.join(dir, f), null);
    if (data && typeof data === 'object') scenes.push(data);
  }
  return scenes;
}

function loadCharacters(sdkRoot) {
  const dir = path.join(sdkRoot, 'characters');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const chars = [];
  for (const f of files) {
    const data = loadJsonFile(path.join(dir, f), null);
    if (data && typeof data === 'object') chars.push(data);
  }
  return chars;
}

// Also pull scene list from project.json — the autopilot writes the full
// scene array there with exits/type/description, which individual per-scene
// JSON files may not have yet.
function loadProjectJson(sdkRoot) {
  const fp = path.join(sdkRoot, 'project.json');
  return loadJsonFile(fp, { scenes: [], characters: [] });
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

// Extract scene ids mentioned in a description string. We look for tokens that
// look like scene ids (snake_case, possibly with numbers). A mention is
// counted when the description contains the id as a whole word / token.
function extractMentionedSceneIds(text, knownIds) {
  if (!text || !knownIds || !knownIds.length) return [];
  const mentioned = [];
  for (const id of knownIds) {
    // Match id as a standalone token (not part of a larger word).
    const re = new RegExp('\\b' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(text)) mentioned.push(id);
  }
  return mentioned;
}

// Infer objects (props) from a scene's description using a simple noun-phrase
// heuristic. We capture words that look like nouns (single-word objects the
// player might interact with) from a known-prop vocabulary, or fall back to
// extracting capitalised words as probable named objects.
const PROP_KEYWORDS = [
  'door', 'gate', 'key', 'chest', 'lever', 'button', 'switch', 'ladder',
  'rope', 'stone', 'statue', 'book', 'scroll', 'torch', 'lantern', 'window',
  'mirror', 'table', 'chair', 'desk', 'cabinet', 'crate', 'barrel', 'pipe',
  'panel', 'terminal', 'console', 'computer', 'radio', 'phone', 'lock',
  'safe', 'box', 'bag', 'note', 'letter', 'map', 'wheel', 'gear', 'valve',
  'plant', 'tree', 'fountain', 'well', 'ladder', 'trapdoor', 'hatch',
  'sign', 'poster', 'painting', 'altar', 'pedestal', 'pillar', 'column'
];

function extractObjects(description) {
  if (!description) return [];
  const lower = description.toLowerCase();
  const found = PROP_KEYWORDS.filter((w) => lower.includes(w));
  return [...new Set(found)];
}

// Pull flag names from save_state patterns in scene text.  Patterns:
//   save_state.set("flag_x", ...) / save_state.get("flag_y") /
//   gameState.flag_x / state.flag_ ...
function extractFlagsFromText(text) {
  if (!text) return [];
  const flags = new Set();
  // save_state.set("flag_name", ...) or save_state.get("flag_name")
  for (const m of text.matchAll(/save_state\.\w+\(\s*["']([a-z_][a-z0-9_]*)["']/gi)) {
    flags.add(m[1]);
  }
  // gameState.flag_name or state.flag_name
  for (const m of text.matchAll(/(?:gameState|state)\.([a-z_][a-z0-9_]*)/gi)) {
    const candidate = m[1];
    // Only include if it looks like a flag (not a method call)
    if (!candidate.includes('(') && candidate !== candidate.toUpperCase()) {
      flags.add(candidate);
    }
  }
  return [...flags];
}

// Build rooms_graph from scenes.  Exits come from scene.exits[] if present;
// otherwise we do a best-effort mention scan against the full description.
function buildRoomsGraph(scenes, warnings) {
  if (!scenes.length) {
    warnings.push('rooms_graph: no scenes found — cannot derive room graph');
    return {};
  }
  const knownIds = scenes.map((s) => s && s.id).filter(Boolean);
  const graph = {};

  for (const s of scenes) {
    if (!s || !s.id) continue;
    const exits = [];

    // Prefer explicit exits array from scene JSON.
    if (Array.isArray(s.exits) && s.exits.length) {
      for (const ex of s.exits) {
        if (!ex) continue;
        const to = ex.to || ex.scene_id || ex.destination;
        if (to && knownIds.includes(to)) {
          exits.push({ to, trigger: ex.trigger || ex.condition || 'player_action' });
        }
      }
    }

    // Supplement with mention-based inference if exits array was empty.
    if (!exits.length) {
      const desc = [s.description, s.custom_spec].filter(Boolean).join(' ');
      const mentioned = extractMentionedSceneIds(desc, knownIds.filter((id) => id !== s.id));
      for (const mid of mentioned) {
        exits.push({ to: mid, trigger: 'inferred_from_description' });
      }
      if (mentioned.length) {
        // Not a warning, just informational — mention-inferred exits may be wrong.
      }
    }

    const objects = extractObjects(s.description || '');

    graph[s.id] = { exits, objects };
  }

  if (Object.keys(graph).length === 0) {
    warnings.push('rooms_graph: all scene entries lacked ids — graph is empty');
  }
  return graph;
}

// Build interactions_map.  Requires an interactions source (not yet in the
// pipeline) — derive a skeleton from scene objects.
function buildInteractionsMap(scenes, rawInteractions, warnings) {
  const hasSource = Array.isArray(rawInteractions) && rawInteractions.length > 0;
  if (!hasSource) {
    warnings.push('interactions_map: interactions.json not present — deriving inspect-only interactions from scene objects');
  }

  const map = {};
  for (const s of scenes) {
    if (!s || !s.id) continue;
    if (hasSource) {
      const relevant = rawInteractions.filter(
        (i) => i && (i.scene === s.id || i.scene_id === s.id)
      );
      if (relevant.length) {
        map[s.id] = relevant.map((i) => ({
          object: i.object || i.prop || 'unknown',
          verb: i.verb || 'inspect',
          effect: i.effect || {}
        }));
        continue;
      }
    }
    // Fallback: give each scene object an inspect interaction.
    const objects = extractObjects(s.description || '');
    if (objects.length) {
      map[s.id] = objects.map((obj) => ({
        object: obj,
        verb: 'inspect',
        effect: { text: `You look at the ${obj}.` }
      }));
    }
  }
  return map;
}

// Build puzzle DAG.  Requires explicit puzzle data; without it we can infer
// very little — emit empty + warn.
function buildPuzzleDag(rawInteractions, warnings) {
  const puzzles = [];
  if (!Array.isArray(rawInteractions) || !rawInteractions.length) {
    warnings.push('puzzle_dag: no interactions/puzzles source — DAG is empty; add interactions.json to populate');
    return puzzles;
  }

  // A puzzle entry in interactions looks like:
  //   { id, type: "puzzle", requires, produces, scene }
  for (const item of rawInteractions) {
    if (!item || item.type !== 'puzzle') continue;
    puzzles.push({
      id: item.id || ('puzzle_' + puzzles.length),
      requires: Array.isArray(item.requires) ? item.requires : [],
      produces: Array.isArray(item.produces) ? item.produces : [],
      scene: item.scene || item.scene_id || null
    });
  }
  if (!puzzles.length) {
    warnings.push('puzzle_dag: interactions.json has no puzzle-type entries — DAG is empty');
  }
  return puzzles;
}

// Build inventory rules from items.json.
function buildInventoryRules(rawItems, warnings) {
  const items = [];
  if (!Array.isArray(rawItems) || !rawItems.length) {
    warnings.push('inventory_rules: items.json not present — inventory rules are empty; add items.json to populate');
    return { items };
  }
  for (const item of rawItems) {
    if (!item) continue;
    items.push({
      id: item.id || item.name || 'unknown',
      scene: item.scene || item.found_in || null,
      pickup: item.pickup || item.pickup_condition || 'always',
      use_in: item.use_in || item.used_in || null
    });
  }
  return { items };
}

// Build dialogue_triggers from characters + optional dialogue.json.
function buildDialogueTriggers(characters, rawDialogue, warnings) {
  const hasDialogue = rawDialogue && typeof rawDialogue === 'object'
    && !Array.isArray(rawDialogue) && Object.keys(rawDialogue).length;
  const hasDialogueArr = Array.isArray(rawDialogue) && rawDialogue.length;

  if (!hasDialogue && !hasDialogueArr) {
    warnings.push('dialogue_triggers: dialogue.json not present — triggers derived from character roster only');
  }

  const triggers = {};
  const dialogueSource = hasDialogue ? rawDialogue : {};

  for (const c of characters) {
    if (!c || !c.id) continue;
    const npcId = c.id;
    const nodes = [];

    // Pull from dialogue source if available.
    const npcDialogue = dialogueSource[npcId] || (hasDialogueArr
      ? rawDialogue.filter((d) => d && (d.npc_id === npcId || d.character === npcId))
      : []);
    if (Array.isArray(npcDialogue)) {
      for (const node of npcDialogue) {
        if (!node) continue;
        nodes.push({
          scene: node.scene || node.scene_id || null,
          node: node.node || node.id || 'root',
          when: Array.isArray(node.when) ? node.when : []
        });
      }
    } else if (npcDialogue && typeof npcDialogue === 'object') {
      // Keyed by node id.
      for (const [nodeId, nodeData] of Object.entries(npcDialogue)) {
        if (!nodeData) continue;
        nodes.push({
          scene: nodeData.scene || null,
          node: nodeId,
          when: Array.isArray(nodeData.when) ? nodeData.when : []
        });
      }
    }

    // Always emit at least the root trigger so the runtime knows this NPC exists.
    if (!nodes.length) {
      nodes.push({
        scene: c.home_scene || null,
        node: 'root',
        when: []
      });
    }
    triggers[npcId] = nodes;
  }

  if (!Object.keys(triggers).length) {
    warnings.push('dialogue_triggers: no characters found — triggers map is empty');
  }
  return triggers;
}

// Collect all state flags mentioned across scenes, story bible mentions, and
// puzzle DAG produces/requires.
function buildStateFlags(scenes, puzzleDag, storyBibleText) {
  const flags = new Set();

  // From scenes (description + custom_spec).
  for (const s of scenes) {
    if (!s) continue;
    const text = [s.description, s.custom_spec, s.lua].filter(Boolean).join('\n');
    for (const f of extractFlagsFromText(text)) flags.add(f);
  }

  // From puzzle DAG.
  for (const p of puzzleDag) {
    for (const f of (p.requires || [])) flags.add(f);
    for (const f of (p.produces || [])) flags.add(f);
  }

  // From story bible text.
  if (storyBibleText) {
    for (const f of extractFlagsFromText(storyBibleText)) flags.add(f);
  }

  // Always include universal runtime flags.
  flags.add('game_started');
  flags.add('game_completed');

  return [...flags].sort();
}

// Build typed save schema from known flags + items.
function buildSaveSchema(stateFlags, inventoryRules) {
  const fields = [];

  // One bool field per flag.
  for (const flag of stateFlags) {
    fields.push({ key: flag, type: 'bool', default: false });
  }

  // One string field per inventory item (tracks whether picked up).
  for (const item of (inventoryRules.items || [])) {
    const key = 'has_' + (item.id || 'item').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    if (!fields.find((f) => f.key === key)) {
      fields.push({ key, type: 'bool', default: false });
    }
  }

  // Standard progress + positioning fields.
  const standards = [
    { key: 'current_scene', type: 'string', default: '' },
    { key: 'play_time_ms', type: 'int', default: 0 }
  ];
  for (const s of standards) {
    if (!fields.find((f) => f.key === s.key)) fields.push(s);
  }

  return { fields };
}

// Infer endings from puzzle DAG + scene names.
function buildEndings(scenes, puzzleDag, warnings) {
  const endings = [];

  // Explicit: scenes with type 'cutscene' and 'end' in id/name.
  for (const s of scenes) {
    if (!s || !s.id) continue;
    const isEnd = /\bend\b/i.test(s.id) || /\bend\b/i.test(s.name || '') || s.type === 'ending';
    if (isEnd) {
      // Collect any flags required to reach this scene via DAG.
      const requires = [];
      for (const p of puzzleDag) {
        if (p.scene === s.id && p.produces && p.produces.length) {
          requires.push(...p.produces);
        }
      }
      endings.push({ id: s.id, requires: [...new Set(requires)] });
    }
  }

  // Puzzle-DAG produces that contain 'end' or 'win'.
  for (const p of puzzleDag) {
    for (const flag of (p.produces || [])) {
      if (/\b(end|win|complete|finish)\b/i.test(flag)) {
        const id = 'ending_' + flag;
        if (!endings.find((e) => e.id === id)) {
          endings.push({ id, requires: p.requires || [] });
        }
      }
    }
  }

  if (!endings.length) {
    warnings.push('endings: could not infer any endings from scenes or puzzle DAG — add scenes with "end" in their id or puzzle produces with win/complete flags');
  }
  return endings;
}

// ---------------------------------------------------------------------------
// Public: compile(projectId, sdkRoot)
// ---------------------------------------------------------------------------

// Runs the full compiler pass.  Returns the compiled_design object AND writes
// it to <sdkRoot>/compiled_design.json.
//
// projectId is accepted for logging / future tracing but not used for I/O;
// all I/O goes through sdkRoot.
async function compile(projectId, sdkRoot) {
  const warnings = [];

  // 1. Load inputs --------------------------------------------------------
  const projectData = loadProjectJson(sdkRoot);

  // Scenes: prefer project.json scenes (richer) then fall back to per-scene files.
  let scenes = Array.isArray(projectData.scenes) && projectData.scenes.length
    ? projectData.scenes
    : loadScenes(sdkRoot);

  // Characters: prefer project.json then per-character files.
  let characters = Array.isArray(projectData.characters) && projectData.characters.length
    ? projectData.characters
    : loadCharacters(sdkRoot);

  const storyBiblePath = path.join(sdkRoot, 'story_bible.md');
  const storyBibleText = fs.existsSync(storyBiblePath)
    ? fs.readFileSync(storyBiblePath, 'utf8')
    : null;

  const itemsPath = path.join(sdkRoot, 'items.json');
  const rawItems = loadJsonFile(itemsPath, null);
  if (!rawItems) {
    warnings.push('items.json missing — inventory rules will be empty');
  }

  const dialoguePath = path.join(sdkRoot, 'dialogue.json');
  const rawDialogue = loadJsonFile(dialoguePath, null);
  if (!rawDialogue) {
    warnings.push('dialogue.json missing — dialogue triggers will use character roster only');
  }

  const interactionsPath = path.join(sdkRoot, 'interactions.json');
  const rawInteractions = loadJsonFile(interactionsPath, null);
  if (!rawInteractions) {
    warnings.push('interactions.json missing — interaction map and puzzle DAG will be skeletal');
  }

  // 2. Derive sections ---------------------------------------------------
  const rooms_graph = buildRoomsGraph(scenes, warnings);
  const interactions_map = buildInteractionsMap(
    scenes,
    Array.isArray(rawInteractions) ? rawInteractions : [],
    warnings
  );
  const puzzle_dag = buildPuzzleDag(
    Array.isArray(rawInteractions) ? rawInteractions : [],
    warnings
  );
  const inventory_rules = buildInventoryRules(
    Array.isArray(rawItems) ? rawItems : [],
    warnings
  );
  const dialogue_triggers = buildDialogueTriggers(
    characters,
    rawDialogue || [],
    warnings
  );
  const state_flags = buildStateFlags(scenes, puzzle_dag, storyBibleText);
  const save_schema = buildSaveSchema(state_flags, inventory_rules);
  const endings = buildEndings(scenes, puzzle_dag, warnings);

  // 3. Assemble output ---------------------------------------------------
  const compiled = {
    rooms_graph,
    interactions_map,
    puzzle_dag,
    inventory_rules,
    dialogue_triggers,
    state_flags,
    save_schema,
    endings,
    compiler_version: COMPILER_VERSION,
    compiled_at: new Date().toISOString(),
    compiler_warnings: warnings
  };

  // 4. Write to disk -----------------------------------------------------
  const outPath = path.join(sdkRoot, COMPILED_FILENAME);
  await fsp.writeFile(outPath, JSON.stringify(compiled, null, 2));

  return compiled;
}

// Read the previously compiled design for a project.  Returns null if not
// compiled yet.
async function read(sdkRoot) {
  const fp = path.join(sdkRoot, COMPILED_FILENAME);
  try {
    const raw = await fsp.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers exposed for sdk_autopilot wiring
// ---------------------------------------------------------------------------

// Returns the compiled section most relevant to a single scene.  Used in
// runSceneLua to build the vars bag injected into assembleSystemPrompt.
function compiledSectionForScene(compiled, sceneId) {
  if (!compiled || !sceneId) return {};
  return {
    room: (compiled.rooms_graph && compiled.rooms_graph[sceneId]) || null,
    interactions: (compiled.interactions_map && compiled.interactions_map[sceneId]) || [],
    puzzles: (compiled.puzzle_dag || []).filter((p) => p && p.scene === sceneId),
    state_flags: compiled.state_flags || [],
    save_schema: compiled.save_schema || { fields: [] },
    inventory_rules: compiled.inventory_rules || { items: [] }
  };
}

module.exports = {
  compile,
  read,
  compiledSectionForScene
};
