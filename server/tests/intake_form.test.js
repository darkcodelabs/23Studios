'use strict';

// intake_form.test.js — unit tests for wolf-intake's inferMissingFields
// + renderStoryBible.
//
// Expected module: server/services/intake.js (or similar). The tests
// t.skip() with TODO if the module hasn't landed.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CANDIDATE_PATHS = [
  '../services/intake_form',
  '../services/intake',
  '../services/sdk_intake'
];
let intake = null;
let intakeModulePath = null;
for (const rel of CANDIDATE_PATHS) {
  const abs = path.join(__dirname, rel + '.js');
  if (fs.existsSync(abs)) {
    try { intake = require(rel); intakeModulePath = abs; break; }
    catch (_e) { /* try next */ }
  }
}
const TODO_NOTE = 'TODO(wolf-intake): intake module not landed yet';

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'minimal_intake.json'), 'utf8'
));

const VALID_GENRES = new Set([
  'adventure', 'puzzle', 'action', 'narrative', 'sim',
  'sports', 'life-sim', 'rhythm', 'toy', 'horror', 'other'
]);

// Deterministic Claude stub. inferMissingFields() is expected to accept a
// `claudeFn` (or `client`) override; if it doesn't, the test still passes
// when the returned object is well-formed.
const CANNED_INFERENCE = {
  genre: 'horror',
  format: 'scene_based',
  setting_era: '1924',
  setting_location: 'a travelling carnival outside Chicago',
  setting_vibe: 'foggy boardwalk, kerosene lamps, distant calliope',
  protagonist_name: 'Cass Wren',
  protagonist_archetype: 'agent',
  antagonist_or_obstacle: 'the carnival itself — it remembers',
  mentor_or_ally: 'an ex-carnie named Doc Tully',
  visual_refs: ['Return of the Obra Dinn', 'Hotline Miami 1-bit', 'World of Horror'],
  visual_keywords: ['fog', 'kerosene', 'tarp', 'sawdust', 'static'],
  tone_refs: ['Annihilation'],
  tone_keywords: ['dread', 'wry', 'melancholic'],
  gameplay_refs: ['Obra Dinn'],
  crank_usage: 'central',
  accelerometer: false,
  audio_direction: 'ambient_drone',
  scene_count: 8,
  minigame_count: 2,
  playtime_target_min: 30,
  save_state: 'light',
  localization: ['en']
};

function stubClaude() {
  return async function (_prompt, _opts) {
    return JSON.stringify(CANNED_INFERENCE);
  };
}

test('inferMissingFields fills required keys + valid enum defaults', async (t) => {
  if (!intake) { t.skip(TODO_NOTE); return; }
  if (typeof intake.inferMissingFields !== 'function') {
    t.skip('TODO(wolf-intake): inferMissingFields not exported');
    return;
  }
  const filled = await intake.inferMissingFields(FIXTURE, { claudeFn: stubClaude() });
  assert.ok(filled && typeof filled === 'object', 'must return object');
  assert.equal(typeof filled.pitch, 'string', 'pitch preserved');
  assert.ok(filled.pitch.length > 0, 'pitch must not be blank');
  assert.ok(VALID_GENRES.has(filled.genre),
    `genre must be a valid enum value, got ${JSON.stringify(filled.genre)}`);
  // Required keys after inference. Per intake spec section 1.
  const required = [
    'pitch', 'genre', 'format',
    'setting_era', 'setting_location', 'setting_vibe',
    'protagonist_name', 'protagonist_archetype',
    'antagonist_or_obstacle',
    'visual_refs', 'visual_keywords',
    'tone_refs', 'tone_keywords',
    'gameplay_refs',
    'crank_usage', 'audio_direction',
    'scene_count', 'minigame_count', 'playtime_target_min', 'save_state'
  ];
  for (const k of required) {
    assert.ok(k in filled, `inferred object missing required key: ${k}`);
    // numbers may legitimately be 0 (then defaulted), so just check presence
    if (typeof filled[k] === 'string') {
      assert.ok(filled[k].length > 0,
        `inferred string field '${k}' must not be blank after inference`);
    }
  }
});

test('renderStoryBible substitutes every {intake.foo} placeholder', async (t) => {
  if (!intake) { t.skip(TODO_NOTE); return; }
  if (typeof intake.renderStoryBible !== 'function') {
    t.skip('TODO(wolf-intake): renderStoryBible not exported');
    return;
  }
  const filled = { ...FIXTURE, ...CANNED_INFERENCE };
  const md = await intake.renderStoryBible(filled, { projectName: 'Carnival Game' });
  assert.equal(typeof md, 'string', 'renderStoryBible must return string');
  assert.ok(md.length > 200, 'bible must be substantive');
  // No unsubstituted placeholders left.
  assert.doesNotMatch(md, /\{intake\.[a-z_]+\}/i,
    'no {intake.x} placeholders may remain after render');
  assert.doesNotMatch(md, /\{project_name\}/i,
    'no {project_name} placeholder may remain after render');
  // Spot-check that the canned values landed.
  assert.match(md, /Cass Wren/, 'protagonist must appear in bible');
  assert.match(md, /noir detective haunted carnival/, 'pitch must appear in bible');
});

test('intake module location is documented', (t) => {
  if (intakeModulePath) {
    t.diagnostic(`intake module: ${intakeModulePath}`);
  } else {
    t.diagnostic('no intake module found at any candidate path');
  }
});
