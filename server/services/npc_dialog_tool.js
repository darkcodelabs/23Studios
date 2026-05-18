'use strict';

// NPC dialog tool — graph CRUD for branching NPC conversations.
//
// Per CLAUDE.md: HAKCD's concepts/dialog.lua stays a linear pool sampler.
// 23studios adds SEPARATE dialog_tree.lua for branching (choices, conditions,
// flag setting). Scenes import whichever they need; some scenes import both.
//
// Storage: <project>/sdk_data/asset_library/npc_dialogs/<npc_id>.json
//
// Schema:
// {
//   "npc_id": "merchant_01",
//   "name": "The Tinker",
//   "portrait_asset_id": "opt_c1d2e3" | null,
//   "voice_synth_shape": "kWaveSquare" | null,
//   "nodes": [
//     { "id": "n_greet", "type": "say", "speaker": "npc",
//       "text": "First time in this part of town?",
//       "next": "n_choice_1" },
//     { "id": "n_choice_1", "type": "choice",
//       "options": [
//         { "text": "Yes.",   "sets_flag": "is_new", "next": "n_welcome" },
//         { "text": "Maybe.", "next": "n_skip" }
//       ] },
//     { "id": "n_check", "type": "condition",
//       "if_flag": "is_new",
//       "then_next": "n_long_intro",
//       "else_next": "n_short_intro" }
//   ],
//   "entry_node": "n_greet"
// }

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const assetLibrary = require('./asset_library');
const projects = require('./projects');

const NPC_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const NODE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const NODE_TYPES = new Set(['say', 'choice', 'condition', 'set_flag', 'end']);

function safeNpcId(id) { return typeof id === 'string' && NPC_ID_RE.test(id); }

function validateNode(node, idx) {
  if (!node || typeof node !== 'object') throw new Error(`node ${idx}: not an object`);
  if (!NODE_ID_RE.test(node.id || '')) throw new Error(`node ${idx}: invalid id "${node.id}"`);
  if (!NODE_TYPES.has(node.type)) throw new Error(`node ${idx} (${node.id}): invalid type "${node.type}"`);

  switch (node.type) {
    case 'say':
      if (typeof node.text !== 'string') throw new Error(`node ${node.id}: say.text required`);
      if (node.next && !NODE_ID_RE.test(node.next)) throw new Error(`node ${node.id}: invalid next "${node.next}"`);
      break;
    case 'choice':
      if (!Array.isArray(node.options) || node.options.length === 0) {
        throw new Error(`node ${node.id}: choice.options required (non-empty array)`);
      }
      for (const [j, o] of node.options.entries()) {
        if (typeof o.text !== 'string') throw new Error(`node ${node.id} option ${j}: text required`);
        if (o.next && !NODE_ID_RE.test(o.next)) throw new Error(`node ${node.id} option ${j}: invalid next`);
      }
      break;
    case 'condition':
      if (typeof node.if_flag !== 'string') throw new Error(`node ${node.id}: condition.if_flag required`);
      if (node.then_next && !NODE_ID_RE.test(node.then_next)) throw new Error(`node ${node.id}: invalid then_next`);
      if (node.else_next && !NODE_ID_RE.test(node.else_next)) throw new Error(`node ${node.id}: invalid else_next`);
      break;
    case 'set_flag':
      if (typeof node.flag !== 'string') throw new Error(`node ${node.id}: set_flag.flag required`);
      if (node.next && !NODE_ID_RE.test(node.next)) throw new Error(`node ${node.id}: invalid next`);
      break;
    case 'end':
      break;
  }
}

function validateTree(tree) {
  if (!tree || typeof tree !== 'object') throw new Error('tree must be an object');
  if (!safeNpcId(tree.npc_id)) throw new Error(`invalid npc_id: ${tree.npc_id}`);
  if (typeof tree.name !== 'string') throw new Error('tree.name required');
  if (!Array.isArray(tree.nodes)) throw new Error('tree.nodes must be an array');
  if (tree.nodes.length === 0) throw new Error('tree.nodes must be non-empty');

  const ids = new Set();
  for (const [i, n] of tree.nodes.entries()) {
    validateNode(n, i);
    if (ids.has(n.id)) throw new Error(`duplicate node id: ${n.id}`);
    ids.add(n.id);
  }

  if (!tree.entry_node) tree.entry_node = tree.nodes[0].id;
  if (!ids.has(tree.entry_node)) throw new Error(`entry_node "${tree.entry_node}" not in nodes`);

  // Verify all `next` / `then_next` / `else_next` refs resolve
  for (const n of tree.nodes) {
    const refs = [];
    if (n.type === 'say' || n.type === 'set_flag') refs.push(n.next);
    if (n.type === 'condition') { refs.push(n.then_next, n.else_next); }
    if (n.type === 'choice') {
      for (const o of n.options) refs.push(o.next);
    }
    for (const r of refs) {
      if (!r) continue;
      if (!ids.has(r)) throw new Error(`node ${n.id}: dangling ref to "${r}"`);
    }
  }

  return tree;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

async function listNpcs(projectId) {
  return assetLibrary.listNpcDialogs(projectId);
}

async function readNpc(projectId, npcId) {
  return assetLibrary.readNpcDialog(projectId, npcId);
}

async function writeNpc(projectId, npcId, tree) {
  if (!safeNpcId(npcId)) throw new Error(`invalid npc_id: ${npcId}`);
  if (tree.npc_id !== npcId) tree.npc_id = npcId;
  validateTree(tree);
  return assetLibrary.writeNpcDialog(projectId, npcId, tree);
}

async function deleteNpc(projectId, npcId) {
  return assetLibrary.deleteNpcDialog(projectId, npcId);
}

/**
 * Walk a tree starting at entry_node and simulate dialog flow given a set of
 * flags. Returns the path of node ids visited + the final node + any flags
 * set along the way. Used by the editor's "test mode".
 *
 * choiceTakes: array of indices (one per choice node visited) — caller picks
 * which branch to follow at each choice. Default = always pick index 0.
 */
async function simulate(projectId, npcId, { initialFlags = {}, choiceTakes = [] } = {}) {
  const tree = await readNpc(projectId, npcId);
  const nodes = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const flags = { ...initialFlags };
  const path = [];
  let cur = tree.entry_node;
  let choiceIdx = 0;
  let steps = 0;
  const MAX_STEPS = 200;

  while (cur && steps++ < MAX_STEPS) {
    const node = nodes[cur];
    if (!node) { path.push({ id: cur, error: 'missing' }); break; }
    path.push({ id: cur, type: node.type });

    if (node.type === 'end') break;
    if (node.type === 'say') {
      cur = node.next;
    } else if (node.type === 'set_flag') {
      flags[node.flag] = true;
      cur = node.next;
    } else if (node.type === 'condition') {
      cur = flags[node.if_flag] ? node.then_next : node.else_next;
    } else if (node.type === 'choice') {
      const idx = choiceTakes[choiceIdx++] || 0;
      const opt = node.options[idx] || node.options[0];
      if (opt.sets_flag) flags[opt.sets_flag] = true;
      cur = opt.next;
    } else {
      break;
    }
  }
  return { path, flags, completed: steps < MAX_STEPS };
}

module.exports = {
  listNpcs,
  readNpc,
  writeNpc,
  deleteNpc,
  simulate,
  _internals: { validateTree, validateNode, NODE_TYPES }
};
