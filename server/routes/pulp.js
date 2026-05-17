'use strict';

const express = require('express');

const pulp = require('../services/pulp_project');

const router = express.Router({ mergeParams: true });

// Collection name (URL segment) -> internal key
const COLLECTION_ROUTE = {
  tiles: 'tiles',
  rooms: 'rooms',
  sounds: 'sounds',
  songs: 'songs'
};

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  // Log identifier + summary only; never log file contents.
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp]', id, e && (e.code || e.message) || 'unknown');
  return res.status(fallback).json({ error: 'server_error', id });
}

router.get('/:id/pulp', async (req, res) => {
  try {
    const r = await pulp.readPulp(req.params.id);
    res.json({ project: r.project, exists: r.exists });
  } catch (e) { sendErr(res, e); }
});

router.put('/:id/pulp', async (req, res) => {
  try {
    const project = await pulp.writeFullPulp(req.params.id, req.body);
    res.json({ project });
  } catch (e) { sendErr(res, e); }
});

router.patch('/:id/pulp', async (req, res) => {
  try {
    const project = await pulp.patchPulp(req.params.id, req.body);
    res.json({ project });
  } catch (e) { sendErr(res, e); }
});

for (const [seg, key] of Object.entries(COLLECTION_ROUTE)) {
  // singular label for response key
  const single = seg.replace(/s$/, '');

  router.get(`/:id/pulp/${seg}`, async (req, res) => {
    try {
      const list = await pulp.listCollection(req.params.id, key);
      res.json({ [seg]: list });
    } catch (e) { sendErr(res, e); }
  });

  router.post(`/:id/pulp/${seg}`, async (req, res) => {
    try {
      const item = await pulp.addCollectionItem(req.params.id, key, req.body);
      res.status(201).json({ [single]: item });
    } catch (e) { sendErr(res, e); }
  });

  router.patch(`/:id/pulp/${seg}/:tid`, async (req, res) => {
    try {
      const item = await pulp.patchCollectionItem(
        req.params.id, key, req.params.tid, req.body
      );
      res.json({ [single]: item });
    } catch (e) { sendErr(res, e); }
  });

  router.delete(`/:id/pulp/${seg}/:tid`, async (req, res) => {
    try {
      await pulp.deleteCollectionItem(req.params.id, key, req.params.tid);
      res.json({ ok: true });
    } catch (e) { sendErr(res, e); }
  });
}

module.exports = router;
