'use strict';

// Phase 6 A4 — coverage_gap unit tests.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-coverage-'));
process.env.PROJECTS_DATA_DIR = tmpRoot;

const projects = require('../services/projects');
const coverage = require('../services/coverage_gap');

const PROJECT_DIR = path.join(tmpRoot, 'hakcd_test');
fs.mkdirSync(path.join(PROJECT_DIR, 'sdk_data', 'requirements'), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(PROJECT_DIR, 'sdk_data', 'source'), { recursive: true });

async function seed() {
  await projects.createProject({
    id: 'hakcd-test',
    name: 'fixture',
    description: 'A4 coverage test',
    repo: 'https://example.invalid/r.git',
    local_path: PROJECT_DIR,
    platform: 'playdate',
    game_type: 'sdk'
  });
}

async function writeFixtures({ derived, refCatalog, extracted, canon }) {
  await fsp.writeFile(path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'derived.json'), JSON.stringify(derived));
  await fsp.writeFile(path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'reference_catalog.json'), JSON.stringify(refCatalog));
  await fsp.writeFile(path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'extracted.json'), JSON.stringify(extracted));
  await fsp.writeFile(path.join(PROJECT_DIR, 'sdk_data', 'source', 'canon.md'), canon);
}

test('analyzeCoverage classifies covered / derivable / uncovered', async () => {
  await seed();
  await writeFixtures({
    derived: {
      requirements: [
        {
          id: 'req-SC01-scene_bg', kind: 'scene_bg', title: 'SC01 background',
          source_refs: [{ bible_id: 'SC01' }], anchor_refs: ['pixel/bedroom.png'],
          skill_rules: ['1bit'], dependencies: [], est_cost_usd: 0.08, reroll_budget: 2,
          agent_assignment: 'openrouter:openai/gpt-5-image-mini', gate_blocks: [], status: 'pending', notes: ''
        },
        {
          // canon mentions SC02 but no anchor — derivable.
          id: 'req-SC02-scene_bg', kind: 'scene_bg', title: 'SC02 background',
          source_refs: [{ bible_id: 'SC02' }], anchor_refs: [],
          skill_rules: ['1bit'], dependencies: [], est_cost_usd: 0.08, reroll_budget: 2,
          agent_assignment: 'openrouter', gate_blocks: [], status: 'pending', notes: ''
        },
        {
          // no canon, no anchor — uncovered.
          id: 'req-SC99-scene_bg', kind: 'scene_bg', title: 'SC99 background',
          source_refs: [{ bible_id: 'SC99' }], anchor_refs: [],
          skill_rules: ['1bit'], dependencies: [], est_cost_usd: 0.08, reroll_budget: 2,
          agent_assignment: 'openrouter', gate_blocks: [], status: 'pending', notes: ''
        }
      ]
    },
    refCatalog: {
      images: [
        { path: 'pixel/bedroom.png', anchored_to: { scenes: ['SC01'], characters: [], ui: [] } },
        { path: 'pixel/unrelated.png', anchored_to: { scenes: [], characters: [], ui: [] } }
      ]
    },
    extracted: {
      scenes: [{ id: 'SC01' }, { id: 'SC02' }, { id: 'SC99' }],
      characters: [{ name: 'Hero' }],
      minigames: []
    },
    canon: '# §1 Preamble\n\nGlobal style.\n\n# §4 Scene canon\n\nSC02 is the AOL lobby.\n'
  });

  const rep = await coverage.analyzeCoverage('hakcd-test');
  const map = new Map(rep.per_requirement.map((p) => [p.requirement_id, p]));

  // SC01 has anchor but no canon mention -> derivable (anchor present).
  assert.equal(map.get('req-SC01-scene_bg').status, 'derivable');
  // SC02 has canon §4 but no anchor -> derivable (canon present).
  assert.equal(map.get('req-SC02-scene_bg').status, 'derivable');
  // SC99 has neither -> uncovered.
  assert.equal(map.get('req-SC02-scene_bg').canon_section, '§4');
  assert.equal(map.get('req-SC99-scene_bg').status, 'uncovered');

  assert.equal(rep.totals.requirements, 3);
  assert.ok(rep.scenes.total >= 3);
  assert.ok(rep.canon_sections_found >= 2, 'canon §1 + §4 parsed');
  assert.ok(rep.references.named_but_unreferenced.find((x) => x.name === 'Hero'),
    'Hero has no reference image');
});

test('analyzeCoverage throws when derived.json is missing', async () => {
  await projects.createProject({
    id: 'no-derived',
    name: 'x',
    description: '',
    repo: 'https://example.invalid/r.git',
    local_path: path.join(tmpRoot, 'no_derived'),
    platform: 'playdate',
    game_type: 'sdk'
  });
  fs.mkdirSync(path.join(tmpRoot, 'no_derived', 'sdk_data', 'requirements'), { recursive: true });
  await assert.rejects(coverage.analyzeCoverage('no-derived'), (e) => e.code === 'no_derived');
});

test.after(async () => {
  try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});
