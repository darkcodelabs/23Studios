// extract_client.js — Phase 6 A2 client helpers.

import { api } from './api.js';

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

export async function startExtract(projectId) {
  return api.post(`/api/projects/${encodeURIComponent(projectId)}/extract/run`, {});
}

export async function getResult(projectId) {
  try { return await api.get(`/api/projects/${encodeURIComponent(projectId)}/extract/result`); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

export async function getLog(projectId) {
  try { return await api.get(`/api/projects/${encodeURIComponent(projectId)}/extract/log`); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

// Subscribe to the SSE stream for a job.
// onEvent(event) is invoked for each progress event. Returns an unsubscribe fn.
export function subscribeExtractStream(projectId, jobId, onEvent, onError) {
  const url = prefixed(`/api/projects/${encodeURIComponent(projectId)}/extract/stream/${encodeURIComponent(jobId)}`);
  const es = new EventSource(url, { withCredentials: true });
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      onEvent && onEvent(data);
      if (data.phase === 'terminal' || data.phase === 'job_done' || data.phase === 'job_failed') {
        es.close();
      }
    } catch (_e) { /* ignore parse error */ }
  };
  es.onerror = (e) => {
    if (onError) onError(e);
  };
  return () => es.close();
}
