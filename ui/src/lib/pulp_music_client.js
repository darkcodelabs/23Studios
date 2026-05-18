import { api } from './api.js';

export async function getMusic(projectId) {
  return api.get(`/api/projects/${projectId}/pulp/music`);
}

export async function reassignMusic(projectId) {
  return api.post(`/api/projects/${projectId}/pulp/music/assign`, {});
}
