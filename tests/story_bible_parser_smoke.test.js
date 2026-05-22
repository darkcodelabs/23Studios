'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const parser = require('../server/services/story_bible_parser');

const HAKCD = path.join(__dirname, '..', 'HAKCD_story_bible_v0.1.md');
const RAW = fs.readFileSync(HAKCD, 'utf8');

test('parseBible extracts logline + setting + structure from HAKCD bible', () => {
  const bible = parser.parseBible(RAW);
  assert.ok(bible.logline && bible.logline.includes('17-year-old'),
            'logline should pull from ## LOGLINE');
  assert.ok(bible.setting && bible.setting.includes('1998'),
            'setting should mention 1998');
  assert.ok(bible.structure && bible.structure.includes('4 Acts'));
});

test('parseBible builds protagonist + antagonist + mentor objects', () => {
  const bible = parser.parseBible(RAW);
  assert.ok(bible.protagonist, 'protagonist exists');
  assert.ok(bible.protagonist.description.length > 100);
  assert.ok(bible.antagonist, 'antagonist exists');
  assert.equal(bible.antagonist.name.length > 0, true);
  assert.ok(bible.mentor, 'mentor exists');
  assert.ok(bible.mentor.real_name && bible.mentor.real_name.toLowerCase().includes('loyd'),
            'mentor real_name should mention Loyd');
});

test('parseBible cast list — 15 NPCs across 5 acts/coda', () => {
  const bible = parser.parseBible(RAW);
  assert.ok(Array.isArray(bible.cast));
  assert.equal(bible.cast.length, 15, `expected 15 NPCs, got ${bible.cast.length}`);
  // Mentor present
  const mentor = bible.cast.find((c) => c.name.toLowerCase().includes('mentor'));
  assert.ok(mentor, 'Mentor in cast');
  assert.equal(mentor.role, 'mentor');
  // RedHook present + tagged antagonist
  const red = bible.cast.find((c) => c.name.toLowerCase().includes('redhook'));
  assert.ok(red, 'RedHook in cast');
  assert.equal(red.role, 'antagonist');
  // Cory K cameo in coda
  const cory = bible.cast.find((c) => c.name === 'Cory K');
  assert.ok(cory, 'Cory K cameo in cast');
  assert.match(cory.act.toLowerCase(), /coda/);
});

test('parseBible scenes — 26 SC entries with code + name + mechanic fields', () => {
  const bible = parser.parseBible(RAW);
  assert.ok(Array.isArray(bible.scenes));
  assert.equal(bible.scenes.length, 26, `expected 26 scenes, got ${bible.scenes.length}`);
  const sc01 = bible.scenes[0];
  assert.equal(sc01.code, 'SC01');
  assert.ok(sc01.id.startsWith('sc01_'));
  assert.match(sc01.name, /Bedroom/);
  assert.ok(sc01.primary_mechanic, 'SC01 has primary_mechanic parsed');
});

test('parseBible acts — 4 acts with beats + setup + close', () => {
  const bible = parser.parseBible(RAW);
  assert.equal(bible.acts.length, 4, `expected 4 acts, got ${bible.acts.length}`);
  const act1 = bible.acts[0];
  assert.equal(act1.number, 1);
  assert.match(act1.name, /Boards/i);
  assert.ok(act1.length_target.includes('60-75'));
  assert.ok(act1.setup && act1.setup.length > 20);
  assert.ok(act1.beats.length >= 5, `Act 1 should have 5+ beats, got ${act1.beats.length}`);
  assert.ok(act1.hinge && act1.hinge.length > 0);
  assert.ok(act1.close && act1.close.length > 0);
});

test('parseBible items + skill_gates + tone_map populated', () => {
  const bible = parser.parseBible(RAW);
  assert.ok(bible.items.length > 5, 'item list parses bullets');
  assert.ok(bible.skill_gates && bible.skill_gates.includes('Skill') || bible.skill_gates.includes('|'),
            'skill_gates section captured (table or prose)');
  assert.ok(bible.tone_map && bible.tone_map.length > 50);
});

test('parseBible handles empty + malformed input without throwing', () => {
  const a = parser.parseBible('');
  assert.equal(a.logline, '');
  assert.deepEqual(a.cast, []);
  assert.deepEqual(a.scenes, []);
  const b = parser.parseBible(null);
  assert.equal(b.logline, '');
  const c = parser.parseBible('## NONSENSE\n\nbody.\n');
  assert.deepEqual(c.cast, []);
});

test('countsFor + sectionsDetected produce summary numbers', () => {
  const bible = parser.parseBible(RAW);
  const counts = parser.countsFor(bible);
  assert.equal(counts.cast, 15);
  assert.equal(counts.scenes, 26);
  assert.equal(counts.acts, 4);
  assert.ok(counts.beats > 20, 'beats counted across all acts');
  const detected = parser.sectionsDetected(bible);
  assert.ok(detected.includes('logline'));
  assert.ok(detected.includes('cast'));
  assert.ok(detected.includes('scenes'));
  assert.ok(detected.includes('acts'));
});

test('splitToFiles writes numbered .md files in canonical order', async () => {
  const bible = parser.parseBible(RAW);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-split-'));
  const r = await parser.splitToFiles(bible, tmp);
  assert.ok(r.written.length >= 15, `expected 15+ files, got ${r.written.length}: ${r.written}`);
  // Canonical naming + ordering
  assert.ok(r.written.includes('00_premise.md'));
  assert.ok(r.written.includes('08_cast.md'));
  assert.ok(r.written.includes('09_act1.md'));
  assert.ok(r.written.includes('10_act2.md'));
  assert.ok(r.written.includes('11_act3.md'));
  assert.ok(r.written.includes('12_act4.md'));
  assert.ok(r.written.includes('14_scenes.md'));
  // Files are non-trivial
  const cast = await fsp.readFile(path.join(tmp, '08_cast.md'), 'utf8');
  assert.ok(cast.includes('Mentor'));
  const act1 = await fsp.readFile(path.join(tmp, '09_act1.md'), 'utf8');
  assert.ok(act1.includes('Beat 1'));
  // Filename rules from sdk_bible.js — must match /^[a-z0-9][a-z0-9_-]*\.md$/
  for (const f of r.written) {
    assert.match(f, /^[a-z0-9][a-z0-9_-]*\.md$/, `filename ${f} must satisfy bible.js validator`);
  }
});
