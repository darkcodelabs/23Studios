// Workflow API + SSE wrappers. Mirrors the SSE parsing in ChatPanel.jsx so the
// stage-run stream renders identically to the OpenRouter chat stream.

import { api, getCsrfToken } from './api.js';

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

export function getWorkflow(projectId) {
  return api.get(`/api/projects/${projectId}/pulp/workflow`);
}

export function patchStage(projectId, stageId, body) {
  return api.patch(`/api/projects/${projectId}/pulp/workflow/stages/${stageId}`, body || {});
}

export function applyOutput(projectId, stageId, output) {
  return api.post(`/api/projects/${projectId}/pulp/workflow/stages/${stageId}/apply`, output);
}

export function resetWorkflow(projectId) {
  return api.post(`/api/projects/${projectId}/pulp/workflow/reset`, {});
}

/**
 * Stream a stage run. Returns an AbortController so callers can cancel.
 *
 *   const ctrl = runStage(pid, 'brainstorm',
 *     { user_prompt: 'pitch', model: 'claude' },
 *     { onChunk(text) {}, onParsed({ output, status, warnings }) {}, onError(m) {}, onClose() {} }
 *   );
 *   ctrl.abort();  // to cancel
 */
export function runStage(projectId, stageId, body, handlers = {}) {
  const { onChunk, onParsed, onError, onClose } = handlers;
  const ctrl = new AbortController();
  const url = `${appBase()}/api/projects/${projectId}/pulp/workflow/stages/${stageId}/run`;

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
        onError?.(`http_${res.status}`);
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
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataLine += ln.slice(5).trim();
          }
          if (!dataLine) continue;
          let data;
          try { data = JSON.parse(dataLine); } catch (_e) { continue; }
          if (event === 'chunk') {
            if (data.text) onChunk?.(data.text);
          } else if (event === 'parsed') {
            onParsed?.(data);
          } else if (event === 'error') {
            onError?.(data.message || 'stream_failed');
          }
        }
      }
      onClose?.();
    } catch (e) {
      if (e.name !== 'AbortError') onError?.(e?.message || 'stream_failed');
      onClose?.();
    }
  })();

  return ctrl;
}

// Canonical stage metadata. Server is authoritative on stage_order + requires,
// but we ship a fallback so the UI can render before the first fetch lands and
// so the compact bar in non-workflow tabs has labels.
export const STAGE_META = {
  brainstorm: { label: 'brainstorm', placeholder: 'Pitch your game in one sentence. What is the feel, the hook, the dream?' },
  story:      { label: 'story',      placeholder: 'Describe the plot, acts, and key beats.' },
  characters: { label: 'characters', placeholder: 'Who is the player? Who do they meet? Describe each character.' },
  world:      { label: 'world',      placeholder: 'Describe the setting and key locations.' },
  mechanics:  { label: 'mechanics',  placeholder: 'List the verbs the player can perform and how they win.' },
  vibe:       { label: 'vibe',       placeholder: 'Aesthetic references, mood, palette, fonts, audio direction.' },
  menus:      { label: 'menus',      placeholder: 'Title screen, pause menu, inventory, settings. What does the UI feel like?' },
  assets:     { label: 'assets',     placeholder: 'Sprites, tiles, songs, sfx. What needs to be produced?' },
  scripts:    { label: 'scripts',    placeholder: 'Per-room scripts, NPC behaviors, item interactions.' },
  playtest:   { label: 'playtest',   placeholder: 'What do you want to test? Bugs to hunt, polish to find.' }
};

export const FALLBACK_STAGE_ORDER = [
  'brainstorm', 'story', 'characters', 'world',
  'mechanics', 'vibe', 'menus', 'assets', 'scripts', 'playtest'
];

export const FALLBACK_REQUIRES = {
  brainstorm: [],
  story:      ['brainstorm'],
  characters: ['story'],
  world:      ['story'],
  mechanics:  ['brainstorm'],
  vibe:       ['brainstorm'],
  menus:      ['vibe', 'mechanics'],
  assets:     ['characters', 'world', 'vibe'],
  scripts:    ['mechanics', 'world', 'characters'],
  playtest:   ['scripts', 'assets']
};

export function emptyWorkflow() {
  const stages = {};
  for (const id of FALLBACK_STAGE_ORDER) {
    stages[id] = {
      status: FALLBACK_REQUIRES[id].length === 0 ? 'empty' : 'locked',
      input: '',
      output: null,
      requires: FALLBACK_REQUIRES[id],
      last_updated_ts: null,
      ai_log: []
    };
  }
  return { stage_order: FALLBACK_STAGE_ORDER, stages };
}
