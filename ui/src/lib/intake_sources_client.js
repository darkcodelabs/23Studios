// intake_sources_client.js — Phase 6 A1 client helpers.
//
// Wraps the multipart POST + GET for /api/projects/:id/intake/sources.

import { api, getCsrfToken } from './api.js';

function getAppBase() {
  if (typeof window === 'undefined') return '';
  if (window.__APP_BASE__ !== undefined) return window.__APP_BASE__;
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  window.__APP_BASE__ = m ? m[1] : '';
  return window.__APP_BASE__;
}

function prefixed(u) {
  const b = getAppBase();
  return b ? b + u : u;
}

// spec:
//   bible?:        { file?: File, text?: string }
//   canon?:        { file?: File, text?: string }
//   skill_md?:     { file?: File, text?: string }
//   reference_images?: Array<{ file: File, tag?: string, subject_hint?: string }>
//   urls?:         Array<{ url, tag?, subject_hint? }>
//   notes?:        Array<{ text, tag? }>
export async function uploadSources(projectId, spec) {
  const fd = new FormData();

  function attachTextDoc(field, textField, entry) {
    if (!entry) return;
    if (entry.file) fd.append(field, entry.file);
    else if (typeof entry.text === 'string' && entry.text.trim()) fd.append(textField, entry.text);
  }
  attachTextDoc('bible', 'bible_text', spec.bible);
  attachTextDoc('canon', 'canon_text', spec.canon);
  attachTextDoc('skill_md', 'skill_text', spec.skill_md);

  const refMeta = [];
  if (Array.isArray(spec.reference_images)) {
    for (const r of spec.reference_images) {
      if (!r || !r.file) continue;
      fd.append('reference_images', r.file, r.file.name);
      refMeta.push({
        filename: r.file.name,
        tag: r.tag || '',
        subject_hint: r.subject_hint || ''
      });
    }
  }
  if (refMeta.length) fd.append('reference_meta', JSON.stringify(refMeta));
  if (Array.isArray(spec.urls) && spec.urls.length) fd.append('urls', JSON.stringify(spec.urls));
  if (Array.isArray(spec.notes) && spec.notes.length) fd.append('notes', JSON.stringify(spec.notes));

  // Multipart can't go through the JSON `api.post` (it sets Content-Type).
  // Use raw fetch with the CSRF header.
  const url = prefixed(`/api/projects/${encodeURIComponent(projectId)}/intake/sources`);
  const headers = {};
  const csrf = getCsrfToken();
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: fd
  });
  if (!res.ok) {
    let detail = null;
    try { detail = await res.json(); } catch (_e) { /* ignore */ }
    const err = new Error(`http_${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json();
}

export async function listSources(projectId) {
  return api.get(`/api/projects/${encodeURIComponent(projectId)}/intake/sources`);
}

export async function removeReference(projectId, filename) {
  return api.del(`/api/projects/${encodeURIComponent(projectId)}/intake/sources/refs/${encodeURIComponent(filename)}`);
}
