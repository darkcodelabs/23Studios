import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon, Loader2, RefreshCw, X as XIcon, AlertCircle
} from 'lucide-react';
import { api } from '../lib/api.js';

// AssetEditModal — Phase 4.5 Patch E.
//
// Triggered by Edit / Regen buttons on an asset card. Shows the asset preview
// on the left and an edit form on the right: prompt textarea, reference
// checklist, model dropdown, dither dropdown. Cancel | Save Changes | Regen.
//
// "Save Changes (no regen)" is disabled in this first cut — no backend route
// exists yet to update the prompt sidecar without re-running the generator.
// Comment in code documents the follow-up.
//
// "Regen Now" POSTs to /api/projects/:id/gallery/assets/:assetId/regen with
// { promptOverride, modelOverride, referenceImages, ditherAlgo } and waits
// up to 60s. On success: calls onRegenComplete(updatedAsset) and closes.
//
// References:
//   - GET /api/projects/:id/references/manifest gives the merged manifest
//     ({ default_set, scene_references, portrait_references, card_references,
//       _source }). Pre-check entries that match the asset's type/tag.

// Same model list pulp_ai.js will actually accept — verified via OpenRouter
// /api/v1/models on 2026-05-17 (see pulp_ai.js:165-176). FLUX entries are
// opt-in and require Cory's STUDIO_IMAGE_MODEL env override; the dropdown
// surfaces them but they may fail upstream if not enabled on the account.
const MODEL_OPTIONS = [
  { value: 'openai/gpt-5-image',
    label: 'openai/gpt-5-image (default)' },
  { value: 'google/gemini-3-pro-image-preview',
    label: 'google/gemini-3-pro-image-preview' },
  { value: 'black-forest-labs/flux.2-flex',
    label: 'black-forest-labs/flux.2-flex (opt-in)' },
  { value: 'black-forest-labs/flux.2-klein-4b',
    label: 'black-forest-labs/flux.2-klein-4b (opt-in)' }
];

// dither.js exports — verified module surface, not the spec's invented names.
const DITHER_OPTIONS = [
  { value: 'atkinson',  label: 'atkinson' },
  { value: 'floyd',     label: 'floyd-steinberg' },
  { value: 'bayer4',    label: 'bayer 4x4' },
  { value: 'ordered8',  label: 'ordered 8x8' },
  { value: 'threshold', label: 'threshold (no dither)' }
];

const REGEN_FETCH_TIMEOUT_MS = 65 * 1000;

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

function fileRawUrl(projectId, relPath) {
  return `${appBase()}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

function referenceImageUrl(projectId, filename) {
  // Per-project uploaded refs land under sdk_data/asset_library/references/.
  // Global defaults (sourced from hakcd_pixel_collection) live there too on
  // most projects. /file/raw will 404 quietly for missing entries.
  return fileRawUrl(projectId, `sdk_data/asset_library/references/${filename}`);
}

function resolveImageUrl(projectId, asset) {
  if (asset.imageUrl && asset.imageUrl.startsWith('/')) {
    return appBase() + asset.imageUrl;
  }
  if (asset.imageUrl) return asset.imageUrl;
  return null;
}

// Pre-check references: pull every entry from the manifest, then mark as
// pre-checked the ones that the asset's type/tag would naturally use.
//
// Asset type → manifest bucket map:
//   scene     → scene_references.<tag> (fall back to default_set)
//   portrait  → portrait_references.default
//   launcher  → card_references.default
function defaultReferenceSelections(manifest, asset) {
  if (!manifest) return new Set();
  const out = new Set();
  const addAll = (arr) => {
    if (Array.isArray(arr)) for (const n of arr) out.add(n);
  };

  const type = asset.type || 'scene';
  if (type === 'scene') {
    const tags = Array.isArray(asset.tags) ? asset.tags : [];
    if (manifest.scene_references && tags.length > 0) {
      for (const tag of tags) {
        addAll(manifest.scene_references[tag]);
      }
    }
    if (out.size === 0) addAll(manifest.default_set);
  } else if (type === 'portrait') {
    if (manifest.portrait_references) addAll(manifest.portrait_references.default);
    if (out.size === 0) addAll(manifest.default_set);
  } else if (type === 'launcher') {
    if (manifest.card_references) addAll(manifest.card_references.default);
    if (out.size === 0) addAll(manifest.default_set);
  } else {
    addAll(manifest.default_set);
  }
  return out;
}

// Flatten merged manifest into a single deduped list with source labels so
// the checklist can render every distinct filename once.
function flattenManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return [];
  const seen = new Map();
  const sources = manifest._source || {};

  const push = (filename, bucketKey) => {
    if (!filename || typeof filename !== 'string') return;
    if (!seen.has(filename)) {
      const origin = sources[bucketKey] || 'default';
      seen.set(filename, { filename, origins: new Set([bucketKey]), origin });
    } else {
      seen.get(filename).origins.add(bucketKey);
    }
  };

  if (Array.isArray(manifest.default_set)) {
    for (const n of manifest.default_set) push(n, 'default_set');
  }
  for (const bucket of ['scene_references', 'portrait_references', 'card_references']) {
    const group = manifest[bucket];
    if (group && typeof group === 'object') {
      for (const [key, arr] of Object.entries(group)) {
        if (!Array.isArray(arr)) continue;
        for (const n of arr) push(n, `${bucket}.${key}`);
      }
    }
  }
  return Array.from(seen.values());
}

export default function AssetEditModal({ projectId, asset, onClose, onRegenComplete }) {
  const dialogRef = useRef(null);

  const [manifest, setManifest] = useState(null);
  const [manifestLoading, setManifestLoading] = useState(true);

  const [prompt, setPrompt] = useState(asset?.prompt || '');
  const [model, setModel] = useState(
    asset?.model && typeof asset.model === 'string'
      ? asset.model.replace(/^openrouter:/, '')
      : MODEL_OPTIONS[0].value
  );
  const [ditherAlgo, setDitherAlgo] = useState(asset?.ditherAlgo || 'atkinson');
  const [selectedRefs, setSelectedRefs] = useState(() => new Set());
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);

  // Showmodal/cancel lifecycle.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el || !asset) return;
    if (typeof el.showModal === 'function' && !el.open) {
      try { el.showModal(); } catch (_e) { /* already open */ }
    }
    const onCancel = (e) => { e.preventDefault(); onClose(); };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [asset, onClose]);

  // Load manifest + initialize selection defaults once.
  useEffect(() => {
    if (!asset || !projectId) return;
    let cancelled = false;
    setManifestLoading(true);
    api.get(`/api/projects/${projectId}/references/manifest`)
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        setSelectedRefs(defaultReferenceSelections(m, asset));
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[AssetEditModal] manifest load failed', e);
        setManifest({});
      })
      .finally(() => { if (!cancelled) setManifestLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, asset]);

  // Reset form when the asset changes (e.g. user opens edit modal on a
  // different card without closing it first).
  useEffect(() => {
    if (!asset) return;
    setPrompt(asset.prompt || '');
    setModel(
      asset.model && typeof asset.model === 'string'
        ? asset.model.replace(/^openrouter:/, '')
        : MODEL_OPTIONS[0].value
    );
    setDitherAlgo(asset.ditherAlgo || 'atkinson');
    setError(null);
  }, [asset]);

  const allRefs = useMemo(() => flattenManifest(manifest), [manifest]);

  const toggleRef = useCallback((filename) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const promptChanged = (prompt || '') !== (asset?.prompt || '');

  const handleRegen = useCallback(async () => {
    if (!asset || !projectId) return;
    setRegenerating(true);
    setError(null);

    // Hand-rolled AbortController for the 65s envelope. The backend has a
    // 60s timeout internally, but network latency can stretch a few seconds
    // past that — keep this just slightly higher to surface real timeouts.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REGEN_FETCH_TIMEOUT_MS);

    try {
      const enc = encodeURIComponent(asset.id);
      const body = {
        promptOverride: promptChanged ? prompt : null,
        modelOverride: model && model !== asset.model ? model : null,
        referenceImages: Array.from(selectedRefs),
        ditherAlgo: ditherAlgo || null
      };
      const res = await api.post(
        `/api/projects/${projectId}/gallery/assets/${enc}/regen`,
        body,
        { signal: ac.signal }
      );
      const updated = (res && res.asset) || null;
      if (typeof onRegenComplete === 'function') {
        onRegenComplete(updated);
      }
      onClose();
    } catch (e) {
      const detail = (e && e.detail && (e.detail.detail || e.detail.error))
        || (e && e.message)
        || 'regen failed';
      setError(String(detail));
    } finally {
      clearTimeout(timer);
      setRegenerating(false);
    }
  }, [asset, projectId, prompt, promptChanged, model, ditherAlgo, selectedRefs, onClose, onRegenComplete]);

  if (!asset) return null;
  const src = resolveImageUrl(projectId, asset);

  return (
    <dialog
      ref={dialogRef}
      className="bg-transparent p-0 backdrop:bg-black/60 max-w-none max-h-none"
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="bg-ink-900 ring-1 ring-ink-700 rounded-lg w-[min(1100px,96vw)] max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-800">
          <span className="text-sm font-mono text-ink-100 truncate">{asset.name}</span>
          <span className="text-[10px] text-ink-500 uppercase tracking-wide">
            {asset.type || 'asset'} edit
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={regenerating}
            className="text-ink-400 hover:text-ink-100 p-1 disabled:opacity-50"
            title="close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body: preview | form */}
        <div className="flex-1 min-h-0 overflow-auto grid md:grid-cols-[1fr_400px] gap-0">
          <div className="bg-ink-950 flex items-center justify-center min-h-[300px] p-4">
            {src ? (
              <img
                src={src}
                alt={asset.name}
                className="max-w-full max-h-[72vh] object-contain image-render-pixel"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <ImageIcon className="w-10 h-10 text-ink-700" />
            )}
          </div>

          <div className="p-4 space-y-4 text-xs border-l border-ink-800 overflow-auto">
            {/* Prompt */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-ink-500 uppercase tracking-wider">
                  Prompt
                </label>
                {promptChanged ? (
                  <span className="text-[10px] text-amber-300 font-mono">edited</span>
                ) : null}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={regenerating}
                rows={10}
                className="w-full text-[11px] bg-ink-950 text-ink-100 rounded p-2 ring-1 ring-ink-700 focus:outline-none focus:ring-accent/40 font-mono whitespace-pre-wrap"
                placeholder="prompt sent to the image model"
              />
              {!asset.prompt ? (
                <p className="text-[10px] text-ink-500 mt-1">
                  No prompt sidecar on disk yet — type one above to set it.
                </p>
              ) : null}
            </div>

            {/* Model */}
            <div>
              <label className="text-[10px] text-ink-500 uppercase tracking-wider block mb-1">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={regenerating}
                className="w-full bg-ink-950 text-ink-100 text-[11px] rounded px-2 py-1.5 ring-1 ring-ink-700 focus:outline-none focus:ring-accent/40"
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {/* If asset.model is one we don't recognize, surface it so it
                    survives the round-trip. */}
                {model && !MODEL_OPTIONS.some((o) => o.value === model) ? (
                  <option value={model}>{model}</option>
                ) : null}
              </select>
            </div>

            {/* Dither algo */}
            <div>
              <label className="text-[10px] text-ink-500 uppercase tracking-wider block mb-1">
                Dither algorithm
              </label>
              <select
                value={ditherAlgo || ''}
                onChange={(e) => setDitherAlgo(e.target.value)}
                disabled={regenerating}
                className="w-full bg-ink-950 text-ink-100 text-[11px] rounded px-2 py-1.5 ring-1 ring-ink-700 focus:outline-none focus:ring-accent/40"
              >
                {DITHER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-ink-500 mt-1">
                Recorded in the sidecar; pulp_ai's existing per-asset-class
                dither applies on the buffer.
              </p>
            </div>

            {/* Reference checklist */}
            <div>
              <label className="text-[10px] text-ink-500 uppercase tracking-wider block mb-1">
                Reference images ({selectedRefs.size}/{allRefs.length})
              </label>
              {manifestLoading ? (
                <div className="flex items-center gap-2 text-ink-500">
                  <Loader2 className="w-3 h-3 animate-spin" /> loading manifest…
                </div>
              ) : allRefs.length === 0 ? (
                <p className="text-[10px] text-ink-500">
                  No references in the manifest. Upload PNGs via Add Reference.
                </p>
              ) : (
                <div className="max-h-48 overflow-auto rounded ring-1 ring-ink-800 bg-ink-950 p-2 space-y-1">
                  {allRefs.map((r) => {
                    const checked = selectedRefs.has(r.filename);
                    return (
                      <label
                        key={r.filename}
                        className="flex items-center gap-2 cursor-pointer hover:bg-ink-900/70 rounded px-1 py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRef(r.filename)}
                          disabled={regenerating}
                          className="accent-accent"
                        />
                        <span className="font-mono text-[11px] text-ink-200 truncate flex-1">
                          {r.filename}
                        </span>
                        <span className="text-[9px] text-ink-500 uppercase tracking-wide">
                          {r.origin === 'project' ? 'proj' : 'def'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {error ? (
              <div className="text-[11px] text-red-300 bg-red-900/20 border border-red-800/40 rounded px-2 py-1.5 flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer: Cancel | Save (disabled) | Regen */}
        <div className="px-4 py-3 border-t border-ink-800 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={regenerating}
            className="text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex-1" />
          {/*
            Save Changes (no regen) — disabled in this cut. The gallery
            backend has no endpoint to update the sidecar prompt without
            re-running the generator. Follow-up: add
            PUT /api/projects/:id/gallery/assets/:assetId with body { prompt }
            and have gallery.js rewrite the .prompt.json sidecar in place.
          */}
          <button
            type="button"
            disabled
            title="No-op save not implemented — backend needs a PUT route to update the sidecar without regen. Use Regen Now to commit changes."
            className="text-xs px-3 py-1.5 rounded bg-ink-900 text-ink-500 ring-1 ring-ink-800 cursor-not-allowed"
          >
            Save Changes (no regen)
          </button>
          <button
            type="button"
            onClick={handleRegen}
            disabled={regenerating || !prompt.trim()}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {regenerating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {regenerating ? 'Regenerating…' : 'Regen Now'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
