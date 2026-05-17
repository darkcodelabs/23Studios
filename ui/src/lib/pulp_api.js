// Pulp game editor API client.
// Mirrors the server contract built by Agent A.
// All endpoints assume the auth context (cookie + CSRF) already set on api.

import { api, getCsrfToken } from './api.js';

const base = (id) => `/api/projects/${id}/pulp`;

// Raw PUT helper — the shared api client doesn't expose PUT, and the
// contract for /api/projects/:id/pulp distinguishes PUT (full replace)
// from PATCH (shallow merge). Mirror api.js semantics (json, CSRF, cookies).
function appBase() {
  if (typeof window === 'undefined') return '';
  if (window.__APP_BASE__ !== undefined) return window.__APP_BASE__;
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  window.__APP_BASE__ = m ? m[1] : '';
  return window.__APP_BASE__;
}

async function rawPut(url, body) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const t = getCsrfToken();
  if (t) headers['x-csrf-token'] = t;
  const fullUrl = url.startsWith('/') ? `${appBase()}${url}` : url;
  const res = await fetch(fullUrl, {
    method: 'PUT',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(body ?? {})
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
  if (res.status === 204) return null;
  return isJson ? res.json() : res.text();
}

export const pulpApi = {
  // Top-level pulp record
  get: (id) => api.get(base(id)),
  put: (id, body) => rawPut(base(id), body),
  patch: (id, body) => api.patch(base(id), body),

  // tiles
  listTiles: (id) => api.get(`${base(id)}/tiles`),
  createTile: (id, tile) => api.post(`${base(id)}/tiles`, tile),
  patchTile: (id, tid, patch) => api.patch(`${base(id)}/tiles/${encodeURIComponent(tid)}`, patch),
  deleteTile: (id, tid) => api.del(`${base(id)}/tiles/${encodeURIComponent(tid)}`),

  // rooms
  listRooms: (id) => api.get(`${base(id)}/rooms`),
  createRoom: (id, room) => api.post(`${base(id)}/rooms`, room),
  patchRoom: (id, rid, patch) => api.patch(`${base(id)}/rooms/${encodeURIComponent(rid)}`, patch),
  deleteRoom: (id, rid) => api.del(`${base(id)}/rooms/${encodeURIComponent(rid)}`),

  // sounds (sfx)
  listSounds: (id) => api.get(`${base(id)}/sounds`),
  createSound: (id, sound) => api.post(`${base(id)}/sounds`, sound),
  patchSound: (id, sid, patch) => api.patch(`${base(id)}/sounds/${encodeURIComponent(sid)}`, patch),
  deleteSound: (id, sid) => api.del(`${base(id)}/sounds/${encodeURIComponent(sid)}`),

  // songs
  listSongs: (id) => api.get(`${base(id)}/songs`),
  createSong: (id, song) => api.post(`${base(id)}/songs`, song),
  patchSong: (id, sid, patch) => api.patch(`${base(id)}/songs/${encodeURIComponent(sid)}`, patch),
  deleteSong: (id, sid) => api.del(`${base(id)}/songs/${encodeURIComponent(sid)}`)
};

// ---------- helpers shared across pulp UI ----------

export const TILE_TYPES = ['world', 'sprite', 'item', 'exit', 'player'];

export function emptyPixels() {
  // 16x16 = 256 chars of '0'
  return '0'.repeat(256);
}

export function pixelsToArray(pix) {
  const u = new Uint8Array(256);
  const s = (pix || '').padEnd(256, '0').slice(0, 256);
  for (let i = 0; i < 256; i++) u[i] = s.charCodeAt(i) === 49 ? 1 : 0;
  return u;
}

export function arrayToPixels(arr) {
  let s = '';
  for (let i = 0; i < 256; i++) s += arr[i] ? '1' : '0';
  return s;
}

export function emptyFrame() {
  return { pixels: emptyPixels() };
}

export function newTile(partial = {}) {
  return {
    name: 'untitled',
    type: 'world',
    solid: false,
    frames: [emptyFrame()],
    fps: 6,
    script: '',
    ...partial
  };
}

export function newRoom(partial = {}) {
  const grid = [];
  for (let r = 0; r < 15; r++) {
    const row = new Array(25).fill(null);
    grid.push(row);
  }
  return {
    name: 'untitled room',
    song: null,
    grid,
    script: '',
    ...partial
  };
}

export function newSound(partial = {}) {
  return {
    name: 'sfx',
    waveform: 'sine',
    freq_start: 440,
    freq_end: 440,
    duration_ms: 200,
    envelope: { attack: 5, decay: 50, sustain: 0.6, release: 80 },
    ...partial
  };
}

export function newSong(partial = {}) {
  return {
    name: 'song',
    bpm: 120,
    loop_from: 0,
    tracks: [[]],
    ...partial
  };
}

// Rasterize a tile frame into an offscreen canvas, scale = pixels per cell.
// Returns an HTMLCanvasElement.
export function rasterizeFrame(pixels, scale = 1, on = '#9dffce', off = 'transparent') {
  const c = document.createElement('canvas');
  c.width = 16 * scale;
  c.height = 16 * scale;
  const ctx = c.getContext('2d');
  if (off !== 'transparent') {
    ctx.fillStyle = off;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = on;
  const arr = pixelsToArray(pixels);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (arr[y * 16 + x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c;
}
