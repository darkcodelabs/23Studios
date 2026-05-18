// Patrol API + SSE wrapper. Mirrors the SSE parsing pattern from
// pulp_workflow_client.runStage / pulp_autopilot_client.runAutopilot.
//
// The pipeline agent owns the server side:
//   POST /api/projects/:id/pulp/patrol         → JSON punch list
//   POST /api/projects/:id/pulp/patrol/regen   → SSE stream of fixes
//
// These wrappers MUST work even when the endpoints 404 — the patrol
// pipeline is being built concurrently. Callers can distinguish a 404
// from other errors via the `status` field on the thrown error.

import { api, getCsrfToken } from './api.js';

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

/**
 * Fetch the asset-coverage punch list.
 * Resolves to the raw server payload — caller is responsible for shape
 * tolerance (the pipeline agent's exact JSON shape is still settling).
 *
 * Expected shape (best-effort, defensive):
 *   {
 *     totals: {
 *       tiles:      { real: N, total: M },
 *       scenes:     { with_bg: N, total: M },
 *       characters: { with_portrait: N, total: M }
 *     },
 *     issues: [
 *       { kind: 'tile' | 'scene' | 'character', id: string,
 *         problem: string, action: string, critical?: boolean }
 *     ]
 *   }
 */
export function getPatrol(projectId) {
  // POST per spec — server treats this as "run patrol now".
  return api.post(`/api/projects/${projectId}/pulp/patrol`, {});
}

/**
 * runPatrolRegen(projectId, body?, handlers)
 *
 * Streams the regen SSE feed. handlers:
 *   onProgress({ current, total, id?, kind?, message? })
 *   onFixed({ kind, id, action? })
 *   onLog({ text })
 *   onError({ message })
 *   onDone({ summary? })
 *   onClose()
 *
 * Body is optional — defaults to {} which the server treats as "fix all".
 * Callers can pass { only: [{kind,id}, …] } to fix a single row when the
 * server supports it.
 *
 * Returns an AbortController.
 */
export function runPatrolRegen(projectId, body, handlers = {}) {
  const { onProgress, onFixed, onLog, onError, onDone, onClose } = handlers;
  const ctrl = new AbortController();
  const url = `${appBase()}/api/projects/${projectId}/pulp/patrol/regen`;

  (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'x-csrf-token': getCsrfToken() || ''
        },
        body: JSON.stringify(body || {})
      });
      if (!res.ok || !res.body) {
        onError?.({ message: `http_${res.status}`, status: res.status });
        onClose?.();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let dataLine = '';
          for (const ln of block.split('\n')) {
            if (ln.startsWith(':')) continue; // heartbeat
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataLine += ln.slice(5).trim();
          }
          if (!dataLine) continue;
          let data;
          try { data = JSON.parse(dataLine); } catch (_e) { continue; }
          if (event === 'progress') onProgress?.(data);
          else if (event === 'fixed') onFixed?.(data);
          else if (event === 'log') onLog?.(data);
          else if (event === 'error') onError?.(data);
          else if (event === 'done') onDone?.(data);
        }
      }
      onClose?.();
    } catch (e) {
      if (e?.name !== 'AbortError') {
        onError?.({ message: e?.message || 'stream_failed' });
      }
      onClose?.();
    }
  })();

  return ctrl;
}
