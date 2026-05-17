// AI assist client for the Pulp editor.
// Mirrors the server contract built by Agent D-server. All endpoints assume
// the same cookie + CSRF context as the shared `api` helper.

import { api } from './api.js';

const aiBase = (id) => `/api/projects/${id}/pulp/ai`;

export const pulpAi = {
  generateTileArt: (projectId, body) => api.post(`${aiBase(projectId)}/tile-art`, body),
  generateScript: (projectId, body) => api.post(`${aiBase(projectId)}/script`, body),
  generateRoomLayout: (projectId, body) => api.post(`${aiBase(projectId)}/room-layout`, body),
  generateSound: (projectId, body) => api.post(`${aiBase(projectId)}/sound`, body),
  getLog: (projectId) => api.get(`${aiBase(projectId)}/log`)
};

// Fallback static model list when OpenRouter is unreachable.
export const FALLBACK_IMAGE_MODELS = [
  'openai/dall-e-3',
  'black-forest-labs/flux-1-pro',
  'google/imagen-4'
];

// Heuristic filter for image-gen models in an OpenRouter-style model list.
export function filterImageModels(models) {
  if (!Array.isArray(models)) return FALLBACK_IMAGE_MODELS;
  const out = [];
  for (const m of models) {
    const id = (m && (m.id || m.slug)) || (typeof m === 'string' ? m : null);
    if (!id) continue;
    const modality = (m && (m.modality || m.output_modalities || m.architecture?.output_modalities)) || '';
    const flat = Array.isArray(modality) ? modality.join(',') : String(modality);
    if (/image/i.test(flat) || /dall-e|flux|imagen|stable-diffusion|sdxl/i.test(id)) {
      out.push(id);
    }
  }
  return out.length ? out : FALLBACK_IMAGE_MODELS;
}

// Decode a base64-encoded 16x16 PNG (or any small image) to the 256-char
// '0'/'1' pixels string used by tile frames. Resolves to the pixels string.
// Threshold treats any pixel with luminance > 127 (and alpha > 0) as "on".
export function decodeImageToPixels(base64) {
  return new Promise((resolve, reject) => {
    if (!base64 || typeof base64 !== 'string') {
      reject(new Error('empty image payload'));
      return;
    }
    const src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 16;
        c.height = 16;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let s = '';
        for (let i = 0; i < 16 * 16; i++) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          const a = data[i * 4 + 3];
          // luminance approx, alpha-gated
          const lum = (r * 0.299 + g * 0.587 + b * 0.114);
          s += (a > 16 && lum > 127) ? '1' : '0';
        }
        resolve(s);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('failed to decode image'));
    img.src = src;
  });
}
