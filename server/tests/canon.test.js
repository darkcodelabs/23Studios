'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-test-'));
process.env.PROJECTS_DATA_DIR = TMP;

const projects = require('../services/projects');
const canon = require('../services/canon');

(async () => {
  const localPath = path.join(TMP, 'proj-local');
  await fsp.mkdir(path.join(localPath, '.git'), { recursive: true });
  await fsp.mkdir(path.join(localPath, 'sdk_data'), { recursive: true });

  const projectId = 'canon-smoke';
  await projects.createProject({
    id: projectId,
    name: 'Canon Smoke',
    description: '',
    repo: 'https://github.com/local/scratch.git',
    local_path: localPath,
    platform: 'playdate',
    publisher: '23',
    developer: '23',
    build_command: '',
    preflight_command: '',
    captures_dir: '',
    status: 'active',
    game_type: 'sdk'
  });

  // Empty start
  const empty = await canon.getCanon(projectId);
  assert.strictEqual(empty.content, '', 'empty start');
  assert.strictEqual(empty.sections.length, 0, 'no sections');

  // Save v1
  const v1 = await canon.saveCanon(projectId, '# §1 Tone\n\nLow contrast.\n\n## §2 Palette\n\n1-bit.\n', { edit_note: 'initial draft' });
  assert.strictEqual(v1.version, 1, 'first save is v1');

  const after = await canon.getCanon(projectId);
  assert.ok(after.content.includes('§1 Tone'), 'content contains heading');
  assert.strictEqual(after.sections.length, 2, 'two sections parsed');
  assert.strictEqual(after.sections[0].section_symbol, '§1');
  assert.strictEqual(after.sections[1].section_symbol, '§2');
  assert.strictEqual(after.active_version, 'v1.md', 'symlink points at v1.md');

  // Save v2
  const v2 = await canon.saveCanon(projectId, '# §1 Tone\n\nUpdated.\n', { edit_note: 'reword' });
  assert.strictEqual(v2.version, 2, 'second save is v2');
  const after2 = await canon.getCanon(projectId);
  assert.ok(after2.content.includes('Updated'), 'v2 content read back');
  assert.strictEqual(after2.active_version, 'v2.md');

  // Reject empty content
  let bad = false;
  try { await canon.saveCanon(projectId, ''); } catch (e) {
    bad = true; assert.strictEqual(e.status, 400);
  }
  assert.ok(bad, 'empty content rejected');

  // Usage: empty when work_graph.json missing
  const u1 = await canon.getCanonUsage(projectId);
  assert.strictEqual(Object.keys(u1.usage).length, 0, 'no usage when graph missing');
  assert.strictEqual(u1.source, 'empty');

  // Seed work_graph.json
  await fsp.writeFile(path.join(localPath, 'sdk_data', 'work_graph.json'), JSON.stringify({
    nodes: [
      { id: 'scene-01', canon_refs: ['§1', '1-tone'] },
      { id: 'scene-02', canon_refs: ['§2'] },
      { id: 'asset-03', canon_refs: ['§1'] }
    ]
  }));

  const u2 = await canon.getCanonUsage(projectId);
  assert.strictEqual(u2.source, 'work_graph.json');
  assert.ok(Array.isArray(u2.usage['§1']));
  assert.ok(u2.usage['§1'].includes('scene-01'));
  assert.ok(u2.usage['§1'].includes('asset-03'));
  assert.ok(u2.usage['§2'].includes('scene-02'));

  // 404 project
  let nf = false;
  try { await canon.getCanon('nope'); } catch (e) { nf = true; assert.strictEqual(e.status, 404); }
  assert.ok(nf, '404 on unknown project');

  await fsp.rm(TMP, { recursive: true, force: true });
  console.log('canon smoke OK');
})().catch((e) => { console.error(e); process.exit(1); });
