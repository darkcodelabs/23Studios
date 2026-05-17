// Pulp scene (per-room background image) client.
//
// Mirrors pulp_upload.js conventions:
//   - prefix /api/... with window.__APP_BASE__ (code-server /proxy/<port>)
//   - attach x-csrf-token from getCsrfToken()
//   - same-origin credentials
//
// Server contract (parallel SCENES-SRV):
//   POST  /api/projects/:id/pulp/rooms/:rid/scene          multipart `file`
//   GET   /api/projects/:id/pulp/rooms/:rid/scene          binary PNG (404 if absent)
//   POST  /api/projects/:id/pulp/rooms/:rid/scene/generate body { prompt, model?, style? }
//   POST  /api/projects/:id/pulp/import-scenes             multipart `files[]` (+ mode=auto)
//   PATCH /api/projects/:id/pulp/rooms/:rid                body { background_image: '' }

import { api, getCsrfToken } from './api.js';
import { pulpApi } from './pulp_api.js';

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
export const SCENE_LIMITS = {
  single: { maxBytes: 8 * 1024 * 1024, accept: 'image/*' },
  bulk:   { maxFiles: 64, maxBytes: 8 * 1024 * 1024, accept: 'image/*' }
};

export const SCENE_STYLE_LOCK = '1-bit isometric Playdate aesthetic';

// ---------- single-room scene ----------

// POST /api/projects/:id/pulp/rooms/:rid/scene  multipart `file`
export async function uploadScene(projectId, roomId, file) {
  const form = new FormData();
  form.append('file', file, file.name);
  return multipart(
    `/api/projects/${projectId}/pulp/rooms/${encodeURIComponent(roomId)}/scene`,
    form
  );
}

// POST /api/projects/:id/pulp/rooms/:rid/scene/generate  body { prompt, model?, style? }
export async function generateScene(projectId, roomId, body) {
  return api.post(
    `/api/projects/${projectId}/pulp/rooms/${encodeURIComponent(roomId)}/scene/generate`,
    body
  );
}

// PATCH /pulp/rooms/:rid  { background_image: '' } — clears the scene.
// We route through the existing pulpApi.patchRoom shape to keep state in sync.
export async function clearScene(projectId, roomId) {
  return pulpApi.patchRoom(projectId, roomId, { background_image: '' });
}

// ---------- bulk import ----------

// POST /api/projects/:id/pulp/import-scenes  multipart files[] + mode=auto
export async function bulkImportScenes(projectId, files, opts = {}) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  form.append('mode', opts.mode || 'auto');
  return multipart(`/api/projects/${projectId}/pulp/import-scenes`, form);
}

// ---------- url helper ----------

// Build a cache-busted image URL for the scene binary endpoint.
export function sceneUrl(projectId, roomId, cacheBust) {
  const base = appBase();
  const path = `/api/projects/${projectId}/pulp/rooms/${encodeURIComponent(roomId)}/scene`;
  const full = base ? base + path : path;
  return `${full}?v=${cacheBust || Date.now()}`;
}

// ---------- helpers ----------

export function validateSceneFiles(files, kind = 'bulk') {
  const limit = SCENE_LIMITS[kind] || SCENE_LIMITS.bulk;
  const max = limit.maxFiles || Infinity;
  const arr = Array.from(files).slice(0, max);
  const overflow = Array.from(files).slice(max).map((f) => ({
    filename: f.name, reason: `over ${max}-file limit`
  }));
  const accepted = [];
  const skipped = [...overflow];
  for (const f of arr) {
    if (!/^image\//.test(f.type)) {
      skipped.push({ filename: f.name, reason: 'not an image' });
      continue;
    }
    if (f.size > limit.maxBytes) {
      skipped.push({ filename: f.name, reason: `over ${(limit.maxBytes / 1024 / 1024).toFixed(0)} MB` });
      continue;
    }
    accepted.push(f);
  }
  return { accepted, skipped };
}
