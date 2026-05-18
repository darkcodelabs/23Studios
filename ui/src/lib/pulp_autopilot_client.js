// Autopilot SSE client wrapper. Mirrors pulp_workflow_client.runStage.
// Returns an AbortController so callers can cancel mid-stream.

import { api, getCsrfToken } from './api.js';

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

export function getStatus(projectId) {
  return api.get(`/api/projects/${projectId}/pulp/autopilot/status`);
}

export function cancel(projectId) {
  return api.post(`/api/projects/${projectId}/pulp/autopilot/cancel`, {});
}

export function quickCreateProject(pitch) {
  return api.post(`/api/projects/quick`, { pitch });
}

/**
 * runAutopilot(projectId, { pitch, model }, handlers)
 *
 * Streams the server pulp_autopilot SSE feed. handlers can include:
 *   onPhase({stage, label, pct})
 *   onLog({text})
 *   onAsset({kind, id, count_so_far, total_planned})
 *   onDone({summary})
 *   onError({message, stage, recoverable})
 *   onClose()
 *
 * Returns an AbortController.
 */
export function runAutopilot(projectId, body, handlers = {}) {
  const { onPhase, onLog, onAsset, onDone, onError, onClose } = handlers;
  const ctrl = new AbortController();
  const url = `${appBase()}/api/projects/${projectId}/pulp/autopilot`;

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
        let detail = '';
        try { detail = await res.text(); } catch (_e) { /* ignore */ }
        onError?.({
          message: `http_${res.status}${detail ? ': ' + detail.slice(0, 200) : ''}`,
          stage: null,
          recoverable: false
        });
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
            if (ln.startsWith(':')) continue; // heartbeat / comment
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataLine += ln.slice(5).trim();
          }
          if (!dataLine) continue;
          let data;
          try { data = JSON.parse(dataLine); } catch (_e) { continue; }
          if (event === 'phase') onPhase?.(data);
          else if (event === 'log') onLog?.(data);
          else if (event === 'asset') onAsset?.(data);
          else if (event === 'done') onDone?.(data);
          else if (event === 'error') onError?.(data);
        }
      }
      onClose?.();
    } catch (e) {
      if (e?.name !== 'AbortError') {
        onError?.({
          message: e?.message || 'stream_failed',
          stage: null,
          recoverable: false
        });
      }
      onClose?.();
    }
  })();

  return ctrl;
}

export const AUTOPILOT_STAGES = [
  { id: 'brainstorm',  label: 'brainstorm' },
  { id: 'story',       label: 'story' },
  { id: 'characters',  label: 'characters' },
  { id: 'world',       label: 'world' },
  { id: 'mechanics',   label: 'mechanics' },
  { id: 'vibe',        label: 'vibe' },
  { id: 'menus',       label: 'menus' },
  { id: 'tile_burst',  label: 'tile art' },
  { id: 'scene_burst', label: 'scenes' },
  { id: 'sound_burst', label: 'sounds' },
  { id: 'scripts',     label: 'scripts' },
  { id: 'playtest',    label: 'playtest' }
];
