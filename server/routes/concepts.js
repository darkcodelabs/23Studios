'use strict';

// concepts.js — routes for the concept fan-out picker.
//
//   GET  /api/projects/:id/concepts            → { concepts, gate }
//   POST /api/projects/:id/concepts/choose     body: { chosen_id }
//   POST /api/projects/:id/concepts/hybridize  body: { ids: [a, b], notes }
//   POST /api/projects/:id/concepts/regenerate body: { concept_id, notes }

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const projects = require('../services/projects');
const claude = require('../services/claude');

const router = express.Router();
const SDK_DATA_REL = 'sdk_data';

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

async function getProjectPath(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!project.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  return project.local_path;
}

function conceptsDir(localPath) { return path.join(localPath, SDK_DATA_REL, 'concepts'); }
function gatesDir(localPath)    { return path.join(localPath, SDK_DATA_REL, 'gates'); }
function gatePath(localPath)    { return path.join(gatesDir(localPath), 'concept_pick.json'); }

async function readGate(localPath) {
  const p = gatePath(localPath);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(await fsp.readFile(p, 'utf8'));
}

async function readConcept(localPath, id) {
  const p = path.join(conceptsDir(localPath), id + '.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(await fsp.readFile(p, 'utf8'));
}

function askClaude({ projectId, cwd }, prompt) {
  return new Promise((resolve, reject) => {
    let acc = '';
    claude.sendMessage({
      projectId, cwd, text: prompt,
      onChunk: (c) => { acc += c; },
      onDone: () => resolve(acc),
      onError: reject,
    });
  });
}

function safeParseJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = m ? m[1] : text;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++;
    else if (candidate[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(candidate.slice(start, i + 1)); } catch (_e) { return null; }
      }
    }
  }
  return null;
}

// GET /api/projects/:id/concepts
router.get('/:id/concepts', async (req, res) => {
  try {
    const localPath = await getProjectPath(req.params.id);
    const gate = await readGate(localPath);
    if (!gate) return res.status(404).json({ error: 'no_concepts', detail: 'run autopilot brainstorm first' });
    const concepts = await Promise.all(
      gate.concepts.map((id) => readConcept(localPath, id))
    );
    res.json({ concepts: concepts.filter(Boolean), gate: { status: gate.status, chosen: gate.chosen, hybridized_from: gate.hybridized_from } });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/concepts/choose
router.post('/:id/concepts/choose', async (req, res) => {
  try {
    const localPath = await getProjectPath(req.params.id);
    const gate = await readGate(localPath);
    if (!gate) return res.status(404).json({ error: 'no_gate' });
    if (gate.status === 'locked') return res.status(409).json({ error: 'already_locked', detail: 'gate already locked; cannot re-choose' });
    const chosenId = String((req.body && req.body.chosen_id) || '').trim();
    if (!gate.concepts.includes(chosenId)) {
      return res.status(400).json({ error: 'invalid_concept', detail: `${chosenId} not in gate concept list` });
    }
    gate.chosen = chosenId;
    gate.status = 'locked';
    await fsp.writeFile(gatePath(localPath), JSON.stringify(gate, null, 2));
    res.json({ ok: true, gate });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/concepts/hybridize
router.post('/:id/concepts/hybridize', async (req, res) => {
  try {
    const localPath = await getProjectPath(req.params.id);
    const gate = await readGate(localPath);
    if (!gate) return res.status(404).json({ error: 'no_gate' });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const notes = String((req.body && req.body.notes) || '').trim();
    if (ids.length < 2) return res.status(400).json({ error: 'need_two_ids', detail: 'provide exactly 2 concept ids' });
    const [a, b] = await Promise.all([readConcept(localPath, ids[0]), readConcept(localPath, ids[1])]);
    if (!a || !b) return res.status(404).json({ error: 'concept_not_found' });

    const prompt = [
      'Blend these two Playdate game concepts into one. Preserve any requirements listed in the notes.',
      notes ? `Requirements: ${notes}` : '',
      '',
      `Concept A (${a.tone_seed}):\n${a.pitch_text}`,
      '',
      `Concept B (${b.tone_seed}):\n${b.pitch_text}`,
      '',
      'Output STRICT JSON only: { "title_suggestion": string, "genre": string, "mechanic_hook": string, "pitch_text": string }',
    ].filter(Boolean).join('\n');

    const text = await askClaude({ projectId: req.params.id, cwd: localPath }, prompt);
    const parsed = safeParseJson(text) || {};
    const hybrid = {
      id: 'concept_04',
      tone_seed: `hybrid of ${ids[0]} + ${ids[1]}`,
      pitch_text: parsed.pitch_text || text.slice(0, 1000),
      title_suggestion: parsed.title_suggestion || '',
      genre: parsed.genre || '',
      mechanic_hook: parsed.mechanic_hook || '',
    };
    await fsp.mkdir(conceptsDir(localPath), { recursive: true });
    await fsp.writeFile(path.join(conceptsDir(localPath), 'concept_04.json'), JSON.stringify(hybrid, null, 2));

    // Add to gate concepts list if not already present.
    if (!gate.concepts.includes('concept_04')) gate.concepts.push('concept_04');
    gate.hybridized_from = ids;
    await fsp.writeFile(gatePath(localPath), JSON.stringify(gate, null, 2));
    res.json({ concept: hybrid, gate });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/concepts/regenerate
router.post('/:id/concepts/regenerate', async (req, res) => {
  try {
    const localPath = await getProjectPath(req.params.id);
    const gate = await readGate(localPath);
    if (!gate) return res.status(404).json({ error: 'no_gate' });
    const conceptId = String((req.body && req.body.concept_id) || '').trim();
    const notes = String((req.body && req.body.notes) || '').trim();
    const existing = await readConcept(localPath, conceptId);
    if (!existing) return res.status(404).json({ error: 'concept_not_found', detail: conceptId });

    const prompt = [
      `Regenerate this Playdate game concept with the tone "${existing.tone_seed}".`,
      notes ? `Revision notes: ${notes}` : '',
      '',
      `Current concept:\n${existing.pitch_text}`,
      '',
      'Output STRICT JSON only: { "title_suggestion": string, "genre": string, "mechanic_hook": string, "pitch_text": string }',
    ].filter(Boolean).join('\n');

    const text = await askClaude({ projectId: req.params.id, cwd: localPath }, prompt);
    const parsed = safeParseJson(text) || {};
    const updated = {
      id: conceptId,
      tone_seed: existing.tone_seed,
      pitch_text: parsed.pitch_text || text.slice(0, 1000),
      title_suggestion: parsed.title_suggestion || '',
      genre: parsed.genre || '',
      mechanic_hook: parsed.mechanic_hook || '',
    };
    await fsp.writeFile(path.join(conceptsDir(localPath), conceptId + '.json'), JSON.stringify(updated, null, 2));
    res.json({ concept: updated });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
