// Thin fetchers for the unified preview gallery. All endpoints reuse the
// existing pulpApi underneath so we inherit auth, CSRF, base-url handling.
//
// Each helper returns a normalized list so the gallery can sort/filter
// without worrying about response shape variations.

import { pulpApi } from './pulp_api.js';

// Generic guard: server endpoints sometimes return `{ items: [] }` or just
// `[]`; we tolerate both and the documented `{ tiles: [...] }` shape.
function pickArray(resp, key) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp[key])) return resp[key];
  if (Array.isArray(resp.items)) return resp.items;
  return [];
}

export async function listTiles(projectId) {
  try {
    const r = await pulpApi.listTiles(projectId);
    return pickArray(r, 'tiles');
  } catch (_e) { return []; }
}

export async function listSounds(projectId) {
  try {
    const r = await pulpApi.listSounds(projectId);
    return pickArray(r, 'sounds');
  } catch (_e) { return []; }
}

export async function listSongs(projectId) {
  try {
    const r = await pulpApi.listSongs(projectId);
    return pickArray(r, 'songs');
  } catch (_e) { return []; }
}

export async function listRooms(projectId) {
  try {
    const r = await pulpApi.listRooms(projectId);
    return pickArray(r, 'rooms');
  } catch (_e) { return []; }
}

// Convenience: one-shot fetch of everything we render in the gallery.
export async function listAll(projectId) {
  const [tiles, sounds, songs, rooms] = await Promise.all([
    listTiles(projectId),
    listSounds(projectId),
    listSongs(projectId),
    listRooms(projectId)
  ]);
  return { tiles, sounds, songs, rooms };
}

// Tabs that each preview-kind jumps to when clicked.
export const KIND_TO_TAB = {
  tile: 'tile',
  scene: 'room',
  sound: 'sound',
  song: 'song'
};
