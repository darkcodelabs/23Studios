// Pulp asset upload helpers.
// Multipart uploads can't go through the shared `api` helper (which serializes
// to JSON), so we hand-roll fetch here while mirroring its conventions:
//   - prefix /api/... with window.__APP_BASE__ (code-server /proxy/<port>)
//   - attach x-csrf-token from getCsrfToken()
//   - same-origin credentials
// JSON-bodied endpoints (e.g. /launcher-card/generate, PATCH /pulp) still go
// through the shared `api` client.

import { api, getCsrfToken } from './api.js';

function appBase() {
  if (typeof window === 'undefined') return '';
  if (window.__APP_BASE__ !== undefined) return window.__APP_BASE__;
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  window.__APP_BASE__ = m ? m[1] : '';
  return window.__APP_BASE__;
}

function prefixed(u) {
  if (typeof u !== 'string' || !u.startsWith('/')) return u;
  const b = appBase();
  return b ? b + u : u;
}

async function multipart(url, form) {
  const headers = { Accept: 'application/json' };
  const t = getCsrfToken();
  if (t) headers['x-csrf-token'] = t;
  const res = await fetch(prefixed(url), {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: form
  });
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  if (!res.ok) {
    let detail = null;
    try { detail = isJson ? await res.json() : await res.text(); } catch (_e) { /* ignore */ }
    const err = new Error(`http_${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return isJson ? res.json() : res.text();
}

// ---------- limits ----------
export const ASSET_LIMITS = {
  tiles:    { maxFiles: 32, maxBytes: 4 * 1024 * 1024, accept: 'image/*' },
  sounds:   { maxFiles: 16, maxBytes: 4 * 1024 * 1024, accept: 'audio/*' },
  songs:    { maxFiles: 32, maxBytes: 4 * 1024 * 1024, accept: '.json,application/json' },
  launcher: { maxFiles: 1,  maxBytes: 4 * 1024 * 1024, accept: 'image/*' }
};

export function validateFiles(kind, files) {
  const limit = ASSET_LIMITS[kind];
  if (!limit) return { accepted: Array.from(files), skipped: [] };
  const arr = Array.from(files).slice(0, limit.maxFiles);
  const overflow = Array.from(files).slice(limit.maxFiles).map((f) => ({
    filename: f.name, reason: `over ${limit.maxFiles}-file limit`
  }));
  const accepted = [];
  const skipped = [...overflow];
  for (const f of arr) {
    if (f.size > limit.maxBytes) {
      skipped.push({ filename: f.name, reason: `over ${(limit.maxBytes / 1024 / 1024).toFixed(0)} MB` });
      continue;
    }
    accepted.push(f);
  }
  return { accepted, skipped };
}

// ---------- tiles ----------
// POST /api/projects/:id/pulp/import-tiles
//   multipart: files[], optional type, optional solid ('true'/'false')
//   -> { tiles, skipped }
export async function importTiles(projectId, files, opts = {}) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  if (opts.type) form.append('type', opts.type);
  if (typeof opts.solid === 'boolean') form.append('solid', opts.solid ? 'true' : 'false');
  return multipart(`/api/projects/${projectId}/pulp/import-tiles`, form);
}

// ---------- sounds ----------
export async function importSounds(projectId, files) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  return multipart(`/api/projects/${projectId}/pulp/import-sounds`, form);
}

// ---------- launcher card ----------
export async function uploadLauncherCard(projectId, file) {
  const form = new FormData();
  form.append('file', file, file.name);
  return multipart(`/api/projects/${projectId}/pulp/launcher-card`, form);
}

export async function generateLauncherCard(projectId, body) {
  return api.post(`/api/projects/${projectId}/pulp/launcher-card/generate`, body);
}

// Build a cache-busted img src for the launcher card binary endpoint.
export function launcherCardUrl(projectId, cacheBust) {
  const base = appBase();
  const path = `/api/projects/${projectId}/pulp/launcher-card`;
  const full = base ? base + path : path;
  return `${full}?v=${cacheBust || Date.now()}`;
}
