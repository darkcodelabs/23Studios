// Phase 3 API client. Pure HTTP wrappers around the routes mounted by
// server/routes/{styles,asset_library,late_add,npc,levels,minigames}.js.

import { api } from './api.js';

// ----- style axes / picker --------------------------------------------------
export const styles = {
  listAxes: () => api.get('/api/styles/axes'),
  getAxis: (axisId) => api.get(`/api/styles/axes/${axisId}`),

  listPacks: () => api.get('/api/styles/preset-packs'),
  getPack: (packId) => api.get(`/api/styles/preset-packs/${packId}`),

  generateOptions: (projectId, axisId, body) =>
    api.post(`/api/projects/${projectId}/styles/${axisId}/generate`, body || {}),
  listOptions: (projectId, axisId) =>
    api.get(`/api/projects/${projectId}/styles/${axisId}/options`),
  pickOption: (projectId, axisId, optionId) =>
    api.post(`/api/projects/${projectId}/styles/${axisId}/pick`, { optionId }),
  refineOption: (projectId, axisId, optionId, feedback) =>
    api.post(`/api/projects/${projectId}/styles/${axisId}/refine`, { optionId, feedback }),
  flagForReuse: (projectId, axisId, optionId) =>
    api.post(`/api/projects/${projectId}/styles/${axisId}/flag-for-reuse`, { optionId }),
  renderPreview: (projectId, axisId, optionId) =>
    api.post(`/api/projects/${projectId}/styles/${axisId}/preview`, { optionId }),
  fromIntake: (projectId, intake) =>
    api.post(`/api/projects/${projectId}/styles/from-intake`, { intake })
};

// ----- asset library --------------------------------------------------------
export const assetLibrary = {
  getIndex: (projectId) => api.get(`/api/projects/${projectId}/asset-library`),
  getPicks: (projectId) => api.get(`/api/projects/${projectId}/asset-library/picks`),
  listOptions: (projectId, axisId) => {
    const q = axisId ? `?axisId=${encodeURIComponent(axisId)}` : '';
    return api.get(`/api/projects/${projectId}/asset-library/options${q}`);
  },
  importPack: (projectId, packId, autoPick = true) =>
    api.post(`/api/projects/${projectId}/asset-library/preset-pack`, { packId, autoPick }),
  listShared: (projectId, category) => {
    const q = category ? `?category=${encodeURIComponent(category)}` : '';
    return api.get(`/api/projects/${projectId}/asset-library/shared-assets${q}`);
  }
};

// ----- late-add ops ---------------------------------------------------------
export const lateAdd = {
  addScene: (projectId, body) => api.post(`/api/projects/${projectId}/late-add/scenes`, body),
  addMinigame: (projectId, sceneId, body) =>
    api.post(`/api/projects/${projectId}/late-add/scenes/${sceneId}/add-minigame`, body),
  swapStyle: (projectId, axisId, body) =>
    api.post(`/api/projects/${projectId}/late-add/styles/${axisId}/swap`, body),
  retrofit: (projectId, featureId, params) =>
    api.post(`/api/projects/${projectId}/late-add/features/${featureId}`, { params }),
  addLevel: (projectId, body) => api.post(`/api/projects/${projectId}/late-add/levels`, body),
  rebuild: (projectId) => api.post(`/api/projects/${projectId}/late-add/rebuild`, {})
};

// ----- npc dialog trees -----------------------------------------------------
export const npc = {
  list: (projectId) => api.get(`/api/projects/${projectId}/npcs`),
  get: (projectId, npcId) => api.get(`/api/projects/${projectId}/npcs/${npcId}`),
  put: (projectId, npcId, tree) =>
    api.put(`/api/projects/${projectId}/npcs/${npcId}`, tree),
  del: (projectId, npcId) => api.del(`/api/projects/${projectId}/npcs/${npcId}`),
  simulate: (projectId, npcId, body) =>
    api.post(`/api/projects/${projectId}/npcs/${npcId}/simulate`, body || {})
};

// ----- levels ---------------------------------------------------------------
export const levels = {
  list: (projectId) => api.get(`/api/projects/${projectId}/levels`),
  get: (projectId, levelId) => api.get(`/api/projects/${projectId}/levels/${levelId}`),
  put: (projectId, levelId, level) =>
    api.put(`/api/projects/${projectId}/levels/${levelId}`, level),
  del: (projectId, levelId) => api.del(`/api/projects/${projectId}/levels/${levelId}`),
  newBlank: (projectId, body) => api.post(`/api/projects/${projectId}/levels/new-blank`, body)
};

// ----- minigame configs -----------------------------------------------------
export const minigames = {
  listKits: () => api.get('/api/minigame-kits'),
  getKit: (kitId) => api.get(`/api/minigame-kits/${kitId}`),
  listConfigs: (projectId) => api.get(`/api/projects/${projectId}/minigame-configs`),
  getConfig: (projectId, sceneId) =>
    api.get(`/api/projects/${projectId}/minigame-configs/${sceneId}`),
  putConfig: (projectId, sceneId, body) =>
    api.put(`/api/projects/${projectId}/minigame-configs/${sceneId}`, body),
  delConfig: (projectId, sceneId) =>
    api.del(`/api/projects/${projectId}/minigame-configs/${sceneId}`)
};
