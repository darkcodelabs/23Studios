'use strict';

// Phase 6 A5 — interview unit tests.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a5-interview-'));
process.env.PROJECTS_DATA_DIR = tmpRoot;

const projects = require('../services/projects');
const interview = require('../services/interview');

const PROJECT_DIR = path.join(tmpRoot, 'hakcd_test');
fs.mkdirSync(path.join(PROJECT_DIR, 'sdk_data', 'requirements'), { recursive: true, mode: 0o700 });

async function seedProject() {
  await projects.createProject({
    id: 'hakcd-test', name: 'fixture', description: 'A5 test',
    repo: 'https://example.invalid/r.git', local_path: PROJECT_DIR,
    platform: 'playdate', game_type: 'sdk'
  });
}

async function writeFixtures() {
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'coverage_report.json'),
    JSON.stringify({
      totals: { requirements: 3, covered: 1, derivable: 1, needs_canon: 0, uncovered: 1 },
      scenes: { total: 3, covered: ['SC01'], derivable: ['SC02'], needs_canon: [], uncovered: ['SC99'] },
      references: {
        total: 1, anchored: 1, ambiguous: [], unanchored: [],
        named_but_unreferenced: [{ kind: 'character', name: 'Cass' }],
        _bible_chars_unreferenced: 1
      },
      minigames: {
        total: 2,
        covered: [],
        needs_custom_recipe: ['DTMF box'],
        deferred_by_default: ['haxheadroom']
      }
    })
  );
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'extracted.json'),
    JSON.stringify({
      scenes: [
        { id: 'SC01', title: 'Hub', summary: 'long enough summary describes the bedroom hub clearly' },
        { id: 'SC02', title: 'Lobby', summary: '' }
      ],
      characters: [{ name: 'Cass', dialog_samples: [] }],
      minigames: [{ name: '23_coins', has_spec: false }]
    })
  );
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'derived.json'),
    JSON.stringify({
      requirements: [
        { id: 'req-SC01-scene_bg', kind: 'scene_bg' },
        { id: 'req-SC02-scene_bg', kind: 'scene_bg' },
        { id: 'req-SC99-scene_bg', kind: 'scene_bg' }
      ]
    })
  );
}

test('buildQuestionQueue emits questions for each gap category', async () => {
  await seedProject();
  await writeFixtures();
  const q = await interview.buildQuestionQueue('hakcd-test');
  assert.ok(q.questions.length > 0);
  // Critical: SC99 (uncovered scene)
  assert.ok(q.questions.find((qq) => qq.severity === 'critical' && qq.related_scenes.includes('SC99')));
  // Minigame: haxheadroom (deferred-by-default)
  assert.ok(q.questions.find((qq) => qq.question_text.includes('haxheadroom')));
  // Minigame: DTMF box (needs custom recipe — high severity)
  assert.ok(q.questions.find((qq) => qq.question_text.includes('DTMF box') && qq.severity === 'high'));
  // SC02 empty-summary heuristic
  assert.ok(q.questions.find((qq) => qq.id.startsWith('q-scene-emptysummary')));
  // Cass no portrait
  assert.ok(q.questions.find((qq) => qq.question_text.includes('Cass')));
});

test('answerQuestion flips status + updates progress counters', async () => {
  const q = await interview.getQueue('hakcd-test');
  // Pick a non-critical question so the lock-refuses test below still has work.
  const target = q.questions.find((qq) => qq.severity !== 'critical');
  assert.ok(target, 'fixture has at least one non-critical question');
  const r = await interview.answerQuestion('hakcd-test', target.id, 'answer', 'do option A');
  assert.equal(r.question.status, 'answered');
  assert.equal(r.queue_progress.answered_count, 1);
  assert.equal(r.queue_progress.pending_count, q.total_questions - 1);
});

test('lockInterview refuses while critical questions remain unanswered', async () => {
  // Ensure the critical SC99 question is still pending at this point.
  const q = await interview.getQueue('hakcd-test');
  assert.ok(q.questions.some((qq) => qq.severity === 'critical' && qq.status === 'pending'));
  await assert.rejects(interview.lockInterview('hakcd-test'), (e) => e.code === 'critical_unclosed');
});

test('lockInterview succeeds after critical questions are deferred + emits scope candidate', async () => {
  const q = await interview.getQueue('hakcd-test');
  for (const qq of q.questions.filter((x) => x.severity === 'critical' && x.status === 'pending')) {
    await interview.answerQuestion('hakcd-test', qq.id, 'defer');
  }
  const candidate = await interview.lockInterview('hakcd-test');
  assert.equal(candidate.proposed_in_scope.length + candidate.proposed_deferred.length, 3);
  assert.ok(candidate.deferred_count >= 1, 'at least one defer recorded');
});

test('lockInterview is idempotent — second call returns 409', async () => {
  await assert.rejects(interview.lockInterview('hakcd-test'), (e) => e.code === 'already_locked');
});

test.after(async () => {
  try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});
