'use strict';

// cost.js — Phase 6 B8 (Cost Panel)
//
// Per-project OpenRouter spend surface:
//   GET    /api/projects/:id/cost                 -> summary + recent calls
//   PUT    /api/projects/:id/cost/cap             -> set cap_usd
//   GET    /api/projects/:id/cost/export.csv      -> CSV of all logged calls
//
// All routes resolve the project via services/projects to enforce existence
// + auth scoping; the JSONL ledger itself lives at
//   <local_path>/sdk_data/openrouter_spend.jsonl

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');

const projects = require('../services/projects');
const spend = require('../services/openrouter_spend');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = (e && e.status) ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

async function loadProjectOrFail(id, res) {
  const idErr = validateId(id);
  if (idErr) { res.status(400).json({ error: 'bad_request', detail: idErr }); return null; }
  const p = await projects.getProject(id);
  if (!p) { res.status(404).json({ error: 'project_not_found' }); return null; }
  return p;
}

router.get('/projects/:id/cost', async (req, res) => {
  try {
    const p = await loadProjectOrFail(req.params.id, res);
    if (!p) return;
    const recentLimit = Math.max(0, Math.min(500, parseInt(req.query.recent, 10) || 50));
    const summary = await spend.summarize(req.params.id, { recentLimit });
    res.json(summary);
  } catch (e) { sendErr(res, e); }
});

router.put('/projects/:id/cost/cap', async (req, res) => {
  try {
    const p = await loadProjectOrFail(req.params.id, res);
    if (!p) return;
    const cap = req.body && req.body.cap_usd;
    const v = await spend.setCap(req.params.id, cap);
    res.json({ ok: true, cap_usd: v });
  } catch (e) { sendErr(res, e); }
});

// CSV export. Streams the JSONL file once and re-emits as CSV; small enough
// in practice (one row per OpenRouter call) that the all-in-memory approach
// is fine for v1.
router.get('/projects/:id/cost/export.csv', async (req, res) => {
  try {
    const p = await loadProjectOrFail(req.params.id, res);
    if (!p) return;
    const localPath = p.local_path;
    const file = path.join(localPath, 'sdk_data', 'openrouter_spend.jsonl');
    let raw = '';
    try { raw = await fsp.readFile(file, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="cost_${p.id}.csv"`);
        return res.end('ts,project_id,stage,scene_id,kind,model,prompt_tokens,completion_tokens,total_cost_usd,fallback\n');
      }
      throw e;
    }
    const header = 'ts,project_id,stage,scene_id,kind,model,prompt_tokens,completion_tokens,total_cost_usd,fallback\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cost_${p.id}.csv"`);
    res.write(header);
    const lines = raw.split('\n');
    for (const ln of lines) {
      if (!ln) continue;
      let row;
      try { row = JSON.parse(ln); } catch (_e) { continue; }
      const cells = [
        new Date(row.ts || Date.now()).toISOString(),
        row.project_id || '',
        row.stage || '',
        row.scene_id || '',
        row.kind || '',
        row.model || '',
        Number(row.prompt_tokens) || 0,
        Number(row.completion_tokens) || 0,
        (Number(row.total_cost_usd) || 0).toFixed(6),
        row.fallback ? '1' : '0'
      ].map((c) => {
        const s = String(c);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      res.write(cells.join(',') + '\n');
    }
    res.end();
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
