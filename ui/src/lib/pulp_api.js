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

// Pulp tiles are canonically 8x8 (spec Section 3.1); SDK callers can pass
// dim=16 explicitly. These helpers accept an optional `dim` so existing
// 16x16 legacy projects continue to render without an opt-in flag.

export function pixelCountForDim(dim) {
  if (dim === 8) return 64;
  if (dim === 16) return 256;
  return 64;
}

/** Default to 8x8 (64-char) for new pulp projects. Legacy callers can pass dim=16. */
export function emptyPixels(dim = 8) {
  return '0'.repeat(pixelCountForDim(dim));
}

/**
 * Detect the tile dim from a pixel string. 64-char -> 8, 256-char -> 16.
 * Falls back to 8 (the new canonical default) when ambiguous.
 */
export function dimForPixels(pix) {
  if (typeof pix === 'string') {
    if (pix.length === 256) return 16;
    if (pix.length === 64) return 8;
  }
  return 8;
}

export function pixelsToArray(pix, dim) {
  const d = dim || dimForPixels(pix);
  const N = pixelCountForDim(d);
  const u = new Uint8Array(N);
  const s = (pix || '').padEnd(N, '0').slice(0, N);
  for (let i = 0; i < N; i++) u[i] = s.charCodeAt(i) === 49 ? 1 : 0;
  return u;
}

export function arrayToPixels(arr, dim) {
  const d = dim || (arr && arr.length === 64 ? 8 : 16);
  const N = pixelCountForDim(d);
  let s = '';
  for (let i = 0; i < N; i++) s += arr[i] ? '1' : '0';
  return s;
}

export function emptyFrame(dim = 8) {
  return { pixels: emptyPixels(dim) };
}

export function newTile(partial = {}, dim = 8) {
  return {
    name: 'untitled',
    type: 'world',
    solid: false,
    frames: [emptyFrame(dim)],
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
// Returns an HTMLCanvasElement. Dim is inferred from pixel-string length so
// 8x8 (new pulp default) and 16x16 (legacy / SDK) both render correctly.
export function rasterizeFrame(pixels, scale = 1, on = '#9dffce', off = 'transparent') {
  const dim = dimForPixels(pixels);
  const c = document.createElement('canvas');
  c.width = dim * scale;
  c.height = dim * scale;
  const ctx = c.getContext('2d');
  if (off !== 'transparent') {
    ctx.fillStyle = off;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = on;
  const arr = pixelsToArray(pixels, dim);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      if (arr[y * dim + x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c;
}
