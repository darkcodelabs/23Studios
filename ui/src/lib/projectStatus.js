// projectStatus.js — single source of truth for the "what state is this
// project in" badge that Library cards + AppShell sidebar project rows render.
//
// Before this helper, both surfaces leaned on `project.status` (always
// 'active' for live projects), so every pill rendered as DRAFT. The five
// terminal states we expose, in priority order:
//
//   BUILDING — autopilot is actively running for this project
//              (/api/projects/:id/sdk/autopilot/status `running: true`)
//   REVIEW   — at least one gallery asset is in `awaiting_review`
//              (/api/projects/:id/gallery)
//   BROKEN   — most recent build failed (project.status === 'broken')
//   SHIPPED  — a packed release exists AND a download URL is available
//              (card_meta.last_build_at + card_meta.latest_pdx_zip_url)
//   DRAFT    — fallback (none of the above)
//
// The helper is intentionally async and fetches secondary signals on demand.
// Callers should cache the result per project and refresh on a slow interval
// (Library does ~10s) so we never block first paint on these probes.
//
// All probes are best-effort: a failed status request degrades gracefully
// to the next signal rather than throwing.

import { api } from './api.js';

export const STATUS = Object.freeze({
  BUILDING: 'BUILDING',
  REVIEW:   'REVIEW',
  BROKEN:   'BROKEN',
  SHIPPED:  'SHIPPED',
  DRAFT:    'DRAFT'
});

// Pure decision function — exposed for tests and for callers that already
// have the autopilot + gallery payloads in hand and want to avoid the extra
// fetches. `cardMeta`, `autopilot`, `gallery` may each be null/undefined.
//
// `project.status === 'broken'` overrides everything except an actively
// running autopilot (the autopilot run is the most recent signal — if it's
// running now, that's the current truth even if a prior build crashed).
export function decideStatus({ project, cardMeta, autopilot, gallery }) {
  if (autopilot && autopilot.running === true) return STATUS.BUILDING;
  const rawStatus = (project && project.status || '').toLowerCase();
  if (rawStatus === 'broken' || rawStatus === 'failed') return STATUS.BROKEN;
  if (gallery && Array.isArray(gallery.assets)) {
    const pending = gallery.assets.some((a) => a && a.state === 'awaiting_review');
    if (pending) return STATUS.REVIEW;
  }
  if (cardMeta && cardMeta.last_build_at && cardMeta.latest_pdx_zip_url) {
    return STATUS.SHIPPED;
  }
  return STATUS.DRAFT;
}

// Lightweight in-module cache so back-to-back lookups (e.g. AppShell sidebar
// rendering the same project list Library just queried) don't refetch.
// Keyed by project id. Entries expire after TTL_MS.
const TTL_MS = 8_000;
const cache = new Map();

function cacheGet(id) {
  const entry = cache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(id);
    return null;
  }
  return entry.value;
}

function cacheSet(id, value) {
  cache.set(id, { at: Date.now(), value });
}

// Public API — fetches autopilot + gallery signals and combines with the
// supplied project + cardMeta into one STATUS code. Safe to call without
// awaiting: every internal fetch is wrapped in try/catch.
export async function derivedStatus(project, cardMeta, opts = {}) {
  if (!project || !project.id) return STATUS.DRAFT;
  const id = project.id;

  if (!opts.skipCache) {
    const cached = cacheGet(id);
    if (cached) return cached;
  }

  // Fire the two probes in parallel. Catch each individually so one slow
  // endpoint doesn't poison the other.
  const [autopilot, gallery] = await Promise.all([
    api.get(`/api/projects/${id}/sdk/autopilot/status`).catch(() => null),
    api.get(`/api/projects/${id}/gallery`).catch(() => null)
  ]);

  const decision = decideStatus({ project, cardMeta, autopilot, gallery });
  cacheSet(id, decision);
  return decision;
}

// Synchronous variant for callers that have already collected the inputs
// (e.g. the Library page batches probes for every project, then renders
// each card off the snapshot). Mirrors decideStatus but with the same
// argument shape derivedStatus uses.
export function derivedStatusSync(project, cardMeta, autopilot, gallery) {
  return decideStatus({ project, cardMeta, autopilot, gallery });
}

// Drop everything — used by tests, and exposed so a hard refresh button
// can clear cached decisions if/when one ever lands.
export function clearStatusCache() {
  cache.clear();
}

// Tiny English-only pluralizer kept here because it sits alongside the
// "3 projects · N scenes" string Library renders. Two callers (Library +
// AppShell pills); deduplicating here avoids a third copy later.
export function pluralize(n, singular, plural) {
  const count = Number(n) || 0;
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${plural || (singular + 's')}`;
}

// Test surface — same idiom Library uses for its pure helpers.
export const __TEST__ = { decideStatus, derivedStatusSync, pluralize, STATUS };
