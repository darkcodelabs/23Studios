import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Save, History, Loader2, Upload, AlertCircle, ImageOff
} from 'lucide-react';
import { api } from '../lib/api.js';

// SceneEditor — design pass 3, screen 4.
//
// Full-page route mounted at /projects/:id/author/gallery/:assetId/edit.
// Fidelity reference:
//   design_handoff_23_studios/screen-editor.jsx
//   design_handoff_23_studios/23studios_design_README_revised.md §"Screens > 4. Scene Editor"
//
// Reads asset via Patch A endpoint GET /api/projects/:id/gallery/assets/:assetId
// and posts edits via POST /api/projects/:id/gallery/assets/:assetId/regen
// ({ promptOverride, modelOverride, ditherAlgo, referenceImages }).
//
// References list: GET /api/projects/:id/references/manifest.
//
// AssetEditModal.jsx still owns the inline regen flow from the gallery card
// menu. This route is the full-page drill-down for prompt + params + ref
// editing — same backend, more breathing room.

// ─── Constants — mirrored from AssetEditModal so the dropdowns stay aligned ──
const MODEL_OPTIONS = [
  { value: 'openai/gpt-5-image',
    label: 'openai/gpt-5-image (default)' },
  { value: 'google/gemini-3-pro-image-preview',
    label: 'google/gemini-3-pro-image-preview' },
  { value: 'black-forest-labs/flux.2-flex',
    label: 'black-forest-labs/flux.2-flex' },
  { value: 'black-forest-labs/flux.2-klein-4b',
    label: 'black-forest-labs/flux.2-klein-4b' },
  { value: 'black-forest-labs/flux.2-max',
    label: 'black-forest-labs/flux.2-max' }
];

// dither.js (server) exports atkinson / floyd / bayer4 / ordered8 / threshold.
const DITHER_OPTIONS = [
  { value: 'atkinson',  label: 'atkinson' },
  { value: 'floyd',     label: 'floyd-steinberg' },
  { value: 'bayer4',    label: 'bayer 4x4' },
  { value: 'ordered8',  label: 'ordered 8x8' },
  { value: 'threshold', label: 'threshold (no dither)' }
];

const REGEN_TIMEOUT_MS = 65 * 1000;

const TABS = ['Art', 'Audio', 'Code', 'Prompt', 'References'];

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}
function resolveImageUrl(asset) {
  if (!asset || !asset.imageUrl) return null;
  if (asset.imageUrl.startsWith('/')) return appBase() + asset.imageUrl;
  return asset.imageUrl;
}
function referenceImageUrl(projectId, filename) {
  return `${appBase()}/api/projects/${projectId}/file/raw?path=${encodeURIComponent('sdk_data/asset_library/references/' + filename)}`;
}

// Flatten the merged manifest into a deduped filename list with origin label.
function flattenManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return [];
  const seen = new Map();
  const push = (filename, bucket) => {
    if (!filename || typeof filename !== 'string') return;
    if (!seen.has(filename)) seen.set(filename, { filename, buckets: new Set([bucket]) });
    else seen.get(filename).buckets.add(bucket);
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

// Same pre-check heuristic as AssetEditModal — keep the two surfaces aligned.
function defaultReferenceSelections(manifest, asset) {
  if (!manifest) return new Set();
  const out = new Set();
  const addAll = (arr) => { if (Array.isArray(arr)) for (const n of arr) out.add(n); };
  const type = asset?.type || 'scene';
  if (type === 'scene') {
    const tags = Array.isArray(asset?.tags) ? asset.tags : [];
    if (manifest.scene_references && tags.length > 0) {
      for (const tag of tags) addAll(manifest.scene_references[tag]);
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

// ─── Tiny presentational helpers ────────────────────────────────────────────
function Panel({ title, right, children, style }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        ...(style || {})
      }}
    >
      <div
        className="flex items-center font-mono uppercase"
        style={{
          padding: '10px 14px',
          gap: 10,
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          letterSpacing: '.12em',
          color: 'var(--text-muted)'
        }}
      >
        <span>{title}</span>
        {right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function Pill({ tone = 'default', children }) {
  const map = {
    default: { bg: 'transparent', fg: 'var(--text-muted)', bd: 'var(--border-2)' },
    accent:  { bg: 'var(--accent-soft)', fg: 'var(--accent)', bd: 'var(--accent-dim)' }
  };
  const s = map[tone] || map.default;
  return (
    <span
      className="font-mono uppercase"
      style={{
        fontSize: 10,
        letterSpacing: '.08em',
        padding: '2px 7px',
        borderRadius: 3,
        background: s.bg, color: s.fg, border: `1px solid ${s.bd}`
      }}
    >{children}</span>
  );
}

// Render the prompt with {tokens} amber and crank/operator phosphor.
// Plain HTML escape first, then bracket + verb spans — matches the design's
// .prompt-edit token coloring.
function escHtml(s) {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function tokenizePromptHtml(s) {
  const escaped = escHtml(s);
  return escaped
    .replace(/\{([^}]+)\}/g, '<span class="prompt-tok">$1</span>')
    .replace(/\b(crank|operator)\b/gi, '<span class="prompt-tok-2">$1</span>');
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function SceneEditor() {
  const navigate = useNavigate();
  const { id: projectId, assetId } = useParams();

  const [asset, setAsset]   = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [manifestLoading, setManifestLoading] = useState(true);

  const [activeTab, setActiveTab] = useState('Art');
  const [prompt, setPrompt] = useState('');
  const [model, setModel]   = useState(MODEL_OPTIONS[0].value);
  const [ditherAlgo, setDitherAlgo] = useState('atkinson');
  const [selectedRefs, setSelectedRefs] = useState(() => new Set());

  const [regenerating, setRegenerating] = useState(false);
  const [err, setErr] = useState(null);

  // Force a dark body bg matching the design — pages without ProjectShell
  // ancestry would otherwise inherit whatever was painted last.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = 'var(--bg)';
    return () => { document.body.style.background = prev; };
  }, []);

  // Load asset.
  const loadAsset = useCallback(async () => {
    setLoadErr(null);
    try {
      const enc = encodeURIComponent(assetId);
      const r = await api.get(`/api/projects/${projectId}/gallery/assets/${enc}`);
      const a = r && r.asset ? r.asset : r;
      setAsset(a || null);
      if (a) {
        setPrompt(a.prompt || '');
        setModel(
          a.model && typeof a.model === 'string'
            ? a.model.replace(/^openrouter:/, '')
            : MODEL_OPTIONS[0].value
        );
        setDitherAlgo(a.ditherAlgo || 'atkinson');
      }
    } catch (e) {
      setLoadErr(e?.detail?.detail || e?.message || 'failed to load asset');
    }
  }, [projectId, assetId]);

  useEffect(() => { loadAsset(); }, [loadAsset]);

  // Load manifest after asset arrives so pre-check defaults can fire.
  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    setManifestLoading(true);
    api.get(`/api/projects/${projectId}/references/manifest`)
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        setSelectedRefs(defaultReferenceSelections(m, asset));
      })
      .catch(() => { if (!cancelled) setManifest({}); })
      .finally(() => { if (!cancelled) setManifestLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, asset]);

  const allRefs = useMemo(() => flattenManifest(manifest), [manifest]);

  const promptChanged = (prompt || '') !== (asset?.prompt || '');

  const toggleRef = useCallback((filename) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const handleRegen = useCallback(async () => {
    if (!asset) return;
    setRegenerating(true);
    setErr(null);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REGEN_TIMEOUT_MS);
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
      if (updated) {
        setAsset(updated);
        setPrompt(updated.prompt || '');
        setModel(
          updated.model && typeof updated.model === 'string'
            ? updated.model.replace(/^openrouter:/, '')
            : MODEL_OPTIONS[0].value
        );
        setDitherAlgo(updated.ditherAlgo || 'atkinson');
      } else {
        await loadAsset();
      }
    } catch (e) {
      const detail = (e && e.detail && (e.detail.detail || e.detail.error))
        || (e && e.message) || 'regen failed';
      setErr(String(detail));
    } finally {
      clearTimeout(timer);
      setRegenerating(false);
    }
  }, [asset, projectId, prompt, promptChanged, model, ditherAlgo, selectedRefs, loadAsset]);

  const handleSave = useCallback(() => {
    // No backend route exists to update the .prompt.json sidecar without
    // re-running the generator. AssetEditModal.jsx documents the same gap:
    // PUT /api/projects/:id/gallery/assets/:assetId is the followup. Until
    // that lands, "save" = re-run with the current edits.
    handleRegen();
  }, [handleRegen]);

  const backHref = `/projects/${projectId}/author/gallery`;
  const goBack = () => navigate(backHref);

  const imageUrl = resolveImageUrl(asset);
  const showLayers = asset && asset.type === 'scene';
  const history = (asset && Array.isArray(asset.regenHistory)) ? asset.regenHistory : [];

  return (
    <div
      className="font-ui"
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh'
      }}
    >
      {/* Local <style> — tokenized prompt highlights only. Keeping it
          page-scoped (vs. a shared CSS file edit) per pass discipline. */}
      <style>{`
        .prompt-tok    { color: var(--accent); background: var(--accent-soft); padding: 0 3px; border-radius: 2px; }
        .prompt-tok-2  { color: var(--phosphor); background: oklch(85% 0.20 145 / .12); padding: 0 3px; border-radius: 2px; }
        .se-prompt {
          min-height: 140px;
          background: var(--bg-2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.55;
          color: var(--text-soft);
          white-space: pre-wrap;
          outline: none;
        }
        .se-prompt:focus { border-color: var(--accent-dim); }
        .se-tab {
          appearance: none;
          background: transparent; border: 0;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: .08em; text-transform: uppercase;
          color: var(--text-muted);
          padding: 10px 14px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
        }
        .se-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .se-tab:hover  { color: var(--text-soft); }
        .se-tool {
          appearance: none;
          border: 1px solid var(--border-2);
          background: var(--surface);
          width: 32px; height: 32px;
          border-radius: var(--radius-sm);
          display: grid; place-items: center;
          font-family: var(--font-mono); font-size: 11px;
          color: var(--text-muted); cursor: pointer;
        }
        .se-tool:hover { color: var(--text); }
        .se-refgrid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
        }
        .se-refgrid .cell {
          aspect-ratio: 1;
          background: var(--bg-2);
          border: 1px dashed var(--border-2);
          border-radius: var(--radius-sm);
          display: grid; place-items: center;
          font-family: var(--font-mono); font-size: 10px;
          color: var(--text-dim);
          text-align: center;
          padding: 4px;
          position: relative;
          overflow: hidden;
          cursor: pointer;
        }
        .se-refgrid .cell.filled { background: oklch(85% 0.03 80); border-style: solid; border-color: var(--border); color: oklch(20% 0.01 75); }
        .se-refgrid .cell.checked { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-dim) inset; }
        .se-refgrid .cell img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
        .se-historystrip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
        .se-historystrip .h { flex: none; width: 72px; height: 46px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 3px; display: grid; place-items: center; color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; }
      `}</style>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: 24,
          padding: '24px 32px 40px'
        }}
      >
        {/* ─── LEFT column (1.2fr) ───────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Header */}
          <div className="flex items-center" style={{ gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={goBack}
              className="font-ui inline-flex items-center"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-2)',
                color: 'var(--text-muted)',
                padding: '5px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                gap: 6,
                cursor: 'pointer'
              }}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> back to workspace
            </button>
            <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {asset ? asset.id : '—'}
            </span>
            <h2
              className="font-ui"
              style={{ margin: 0, marginLeft: 8, fontWeight: 500, fontSize: 18, letterSpacing: '-.01em' }}
            >
              {asset ? (asset.name || asset.id) : 'loading…'}
            </h2>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="font-ui inline-flex items-center"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-muted)',
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12, gap: 6, cursor: 'pointer'
                }}
                title="regen history below; this opens nothing yet"
              >
                <History className="w-3.5 h-3.5" /> history
              </button>
              <button
                type="button"
                onClick={handleRegen}
                disabled={regenerating || !asset}
                className="font-ui inline-flex items-center"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent-dim)',
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12, gap: 6, cursor: regenerating ? 'wait' : 'pointer',
                  opacity: regenerating || !asset ? 0.5 : 1
                }}
              >
                {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                regen
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={regenerating || !asset}
                className="font-ui inline-flex items-center"
                style={{
                  background: 'oklch(74% 0.14 145 / .15)',
                  color: 'var(--ok)',
                  border: '1px solid oklch(50% 0.1 145)',
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12, gap: 6, cursor: regenerating ? 'wait' : 'pointer',
                  opacity: regenerating || !asset ? 0.5 : 1
                }}
                title="save = re-run with current edits (no sidecar-only PUT yet)"
              >
                <Save className="w-3.5 h-3.5" /> save
              </button>
            </div>
          </div>

          {/* Tab strip */}
          <div
            style={{
              display: 'flex', gap: 4,
              borderBottom: '1px solid var(--border)'
            }}
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={'se-tab ' + (activeTab === t ? 'active' : '')}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tool bar */}
          <div
            style={{
              display: 'flex', gap: 4,
              padding: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)'
            }}
          >
            {['✎', '⌫', '▣', '▦', '／'].map((g, i) => (
              <button key={i} type="button" className="se-tool" title="canvas tools — preview only">{g}</button>
            ))}
            <span style={{ width: 1, background: 'var(--border)', margin: '4px 4px' }} />
            <button type="button" className="se-tool" title="undo">⤺</button>
            <button type="button" className="se-tool" title="redo">⤻</button>
            <span style={{ width: 1, background: 'var(--border)', margin: '4px 4px' }} />
            <select
              value={ditherAlgo}
              onChange={(e) => setDitherAlgo(e.target.value)}
              className="font-mono"
              style={{
                background: 'var(--surface)',
                color: 'var(--text-soft)',
                border: '1px solid var(--border-2)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: 11
              }}
            >
              {DITHER_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px' }}>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>zoom</span>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text)' }}>200%</span>
            </span>
          </div>

          {/* Art canvas — 400×240 frame inside dark panel */}
          <div
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 32,
              display: 'grid',
              placeItems: 'center',
              minHeight: 380
            }}
          >
            <div
              style={{
                background: 'oklch(85% 0.03 80)',
                width: 400, height: 240,
                borderRadius: 3,
                boxShadow: '0 0 0 4px oklch(15% 0.01 75), 0 8px 30px rgba(0,0,0,.5)',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={asset?.name || 'asset'}
                  className="pixelated"
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'contain',
                    imageRendering: 'pixelated'
                  }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : asset ? (
                <div
                  className="absolute inset-0 grid place-items-center font-mono"
                  style={{ color: 'oklch(40% 0.01 75)', fontSize: 11 }}
                >
                  <ImageOff className="w-4 h-4 mr-1 inline" /> no preview
                </div>
              ) : null}
            </div>
          </div>

          {/* Frames strip — shown for sprite-style assets; render a stub
              otherwise so the layout doesn't pop. Real sprite-frame data
              isn't tracked yet, so this is a visual placeholder for now. */}
          <Panel title={`frames · ${asset && asset.frames ? asset.frames.length : 1}`}>
            <div className="se-historystrip">
              {(asset && Array.isArray(asset.frames) && asset.frames.length > 0
                ? asset.frames
                : [{ name: asset?.name || 'frame', primary: true }]
              ).map((f, i) => (
                <div
                  key={i}
                  className="h"
                  style={{
                    borderColor: i === 0 ? 'var(--accent)' : 'var(--border)',
                    background: imageUrl ? 'oklch(85% 0.03 80)' : 'var(--bg-2)',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  {i === 0 && imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
                    />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {loadErr ? (
            <div
              className="font-mono"
              style={{
                color: 'var(--danger)', fontSize: 12,
                background: 'oklch(64% 0.18 25 / .12)',
                border: '1px solid oklch(50% 0.15 25)',
                padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                display: 'flex', alignItems: 'center', gap: 8
              }}
            >
              <AlertCircle className="w-3.5 h-3.5" /> {loadErr}
            </div>
          ) : null}
        </div>

        {/* ─── RIGHT column (1fr) ────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Asset prompt */}
          <Panel
            title="asset prompt"
            right={promptChanged ? <Pill tone="accent">edited</Pill> : null}
          >
            {/* contenteditable surface so we can show token coloring while
                the user edits. Plain text round-trips through innerText —
                no rich-text payload reaches the server. */}
            <div
              className="se-prompt"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onInput={(e) => setPrompt(e.currentTarget.innerText)}
              onBlur={(e) => {
                // Re-render with tokenization once edit ends so colors come
                // back. The user's caret jump is acceptable per the design.
                const v = e.currentTarget.innerText;
                e.currentTarget.innerHTML = tokenizePromptHtml(v);
              }}
              dangerouslySetInnerHTML={{ __html: tokenizePromptHtml(prompt) }}
            />
            <div className="flex" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleRegen}
                disabled={regenerating || !prompt.trim()}
                className="font-ui inline-flex items-center"
                style={{
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  border: '1px solid var(--accent-dim)',
                  padding: '5px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, gap: 6, cursor: 'pointer',
                  opacity: regenerating || !prompt.trim() ? 0.5 : 1
                }}
              >
                {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                regen asset
              </button>
              <button
                type="button"
                disabled
                className="font-ui"
                title="diff vs last revision — coming with the sidecar history endpoint"
                style={{
                  background: 'transparent', color: 'var(--text-dim)',
                  border: '1px solid var(--border-2)',
                  padding: '5px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, cursor: 'not-allowed', opacity: 0.5
                }}
              >
                diff vs last
              </button>
              <span style={{ marginLeft: 'auto' }} className="font-mono" >
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  rev {history.length}{history.length > 0 ? ` · ${new Date(history[history.length - 1]?.at || Date.now()).toLocaleString()}` : ''}
                </span>
              </span>
            </div>
            {err ? (
              <div
                className="font-mono"
                style={{
                  marginTop: 10,
                  color: 'var(--danger)', fontSize: 11,
                  background: 'oklch(64% 0.18 25 / .12)',
                  border: '1px solid oklch(50% 0.15 25)',
                  padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                  display: 'flex', alignItems: 'center', gap: 6
                }}
              >
                <AlertCircle className="w-3 h-3" /> {err}
              </div>
            ) : null}
          </Panel>

          {/* References */}
          <Panel
            title={`references · ${selectedRefs.size}/${allRefs.length} selected`}
            right={
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                drag to swap
              </span>
            }
          >
            {manifestLoading ? (
              <div className="flex items-center font-mono" style={{ gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                <Loader2 className="w-3 h-3 animate-spin" /> loading manifest…
              </div>
            ) : allRefs.length === 0 ? (
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                no references in the manifest. upload a PNG to bias the generator.
              </p>
            ) : (
              <div className="se-refgrid">
                {/* Show up to 6 ref cells per spec; rest collapse into a
                    "+N more" cell. Each cell toggles its selection. */}
                {allRefs.slice(0, 6).map((r) => {
                  const checked = selectedRefs.has(r.filename);
                  return (
                    <button
                      key={r.filename}
                      type="button"
                      onClick={() => toggleRef(r.filename)}
                      className={'cell filled ' + (checked ? 'checked' : '')}
                      title={r.filename}
                    >
                      <img
                        src={referenceImageUrl(projectId, r.filename)}
                        alt={r.filename}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </button>
                  );
                })}
                {Array.from({ length: Math.max(0, 6 - allRefs.length) }).map((_, i) => (
                  <div key={`empty-${i}`} className="cell">drop reference</div>
                ))}
              </div>
            )}
            {allRefs.length > 6 ? (
              <p className="font-mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)' }}>
                +{allRefs.length - 6} more references in the manifest — toggle from the workspace Refs tab.
              </p>
            ) : null}
            <p className="font-mono" style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55 }}>
              References are mood, not literal — the dither pass smooths everything to 1-bit.
            </p>
            <button
              type="button"
              disabled
              className="font-ui inline-flex items-center"
              style={{
                marginTop: 10,
                background: 'transparent', color: 'var(--text-dim)',
                border: '1px dashed var(--border-2)',
                padding: '5px 10px', borderRadius: 'var(--radius-sm)',
                fontSize: 12, gap: 6, cursor: 'not-allowed', opacity: 0.6
              }}
              title="reference upload from the editor route — coming once /api/projects/:id/references upload route lands"
            >
              <Upload className="w-3.5 h-3.5" /> upload reference
            </button>
          </Panel>

          {/* Layers — scenes only */}
          {showLayers ? (
            <Panel title="layers">
              <div style={{ margin: '-14px' }}>
                {[
                  { n: 'subject silhouette', visible: true, locked: false },
                  { n: 'mid background',     visible: true, locked: false },
                  { n: 'dither overlay',     visible: true, locked: true  }
                ].map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center"
                    style={{
                      padding: '10px 14px',
                      gap: 10,
                      borderTop: i === 0 ? 0 : '1px solid var(--border)'
                    }}
                  >
                    <span className="font-mono" style={{ width: 22, color: 'var(--text-muted)', fontSize: 11 }}>
                      {l.visible ? '●' : '○'}
                    </span>
                    <span className="font-mono" style={{ width: 22, color: 'var(--text-muted)', fontSize: 11 }}>
                      {l.locked ? '🔒' : ''}
                    </span>
                    <span style={{ fontSize: 13, flex: 1, color: 'var(--text-soft)' }}>{l.n}</span>
                    <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                      {i % 2 ? '8 px' : '16 px'}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {/* Generation params */}
          <Panel title="generation params">
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <ParamRow k="seed">
                <span style={{ color: 'var(--text)' }}>
                  {asset?.seed || asset?.id?.slice(-8) || '—'}
                </span>
              </ParamRow>
              <ParamRow k="model">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="font-mono"
                  style={{
                    background: 'var(--bg-2)', color: 'var(--text)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 3, padding: '2px 6px', fontSize: 11
                  }}
                >
                  {MODEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.value}</option>
                  ))}
                  {model && !MODEL_OPTIONS.some((o) => o.value === model) ? (
                    <option value={model}>{model}</option>
                  ) : null}
                </select>
              </ParamRow>
              <ParamRow k="dither">
                <select
                  value={ditherAlgo}
                  onChange={(e) => setDitherAlgo(e.target.value)}
                  className="font-mono"
                  style={{
                    background: 'var(--bg-2)', color: 'var(--text)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 3, padding: '2px 6px', fontSize: 11
                  }}
                >
                  {DITHER_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </ParamRow>
              <ParamRow k="contrast"><span style={{ color: 'var(--text)' }}>0.72</span></ParamRow>
              <ParamRow k="samples"><span style={{ color: 'var(--text)' }}>{asset?.samples || 48}</span></ParamRow>
              <ParamRow k="guidance"><span style={{ color: 'var(--text)' }}>{asset?.guidance || 6.4}</span></ParamRow>
              <ParamRow k="refs"><span style={{ color: 'var(--text)' }}>{selectedRefs.size}</span></ParamRow>
            </div>
          </Panel>

          {/* Cost & history */}
          <Panel
            title="cost & history"
            right={
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                {history.length} revs
              </span>
            }
          >
            {history.length === 0 ? (
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                no regen history yet. trigger a regen to start the timeline.
              </p>
            ) : (
              <div className="se-historystrip">
                {history.slice(-12).map((h, i) => (
                  <div key={i} className="h" title={new Date(h.at).toLocaleString()}>
                    {(i + 1)}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// Param row helper.
function ParamRow({ k, children }) {
  return (
    <div
      className="flex"
      style={{
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 0',
        borderBottom: '1px dashed var(--border)'
      }}
    >
      <span style={{ color: 'var(--text-dim)' }}>{k}</span>
      <span>{children}</span>
    </div>
  );
}
