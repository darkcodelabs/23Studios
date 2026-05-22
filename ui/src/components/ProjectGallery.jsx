import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Image as ImageIcon, Loader2, Hammer, UploadCloud, Check, X as XIcon,
  RefreshCw, Pencil, AlertCircle, Plus, Filter as FilterIcon, ArrowUpDown
} from 'lucide-react';
import { api } from '../lib/api.js';
import AssetEditModal from './AssetEditModal.jsx';
import ReferenceUploadModal from './ReferenceUploadModal.jsx';

// ProjectGallery — Phase 4.5 Patch C.
//
// Per-asset gallery for an SDK project. Fetches the real gallery API when
// available; falls back to enumerating sdk_data/{scenes,characters,launcher}
// via the /files endpoint when the Patch A backend is not yet live.
//
// Responsibilities:
//   * filter chips (type + state, multi-select) + sort dropdown
//   * references row (thumbnails of project + global references)
//   * grid of asset cards with state badge + approve/reject/edit/regen
//   * click image opens preview modal with prompt + metadata
//   * approve / reject with optimistic UI + POST
//   * 5s polling refresh while mounted
//
// Wired routes:
//   GET    /api/projects/:id/gallery                       (preferred)
//   GET    /api/projects/:id/files?path=sdk_data/scenes    (fallback)
//   POST   /api/projects/:id/gallery/assets/:assetId/approve
//   POST   /api/projects/:id/gallery/assets/:assetId/reject
//   GET    /api/projects/:id/references/manifest           (preferred)
//   GET    /api/projects/:id/references                    (fallback)

const POLL_MS = 5000;

// ----------------------------------------------------------------------------
// URL + path helpers
// ----------------------------------------------------------------------------

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

function fileRawUrl(projectId, relPath) {
  return `${appBase()}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

// Asset imageUrl resolution. Backend may return an absolute /api/... URL
// (preferred) or a bare relative path. Either way, prefix with __APP_BASE__
// when present so the code-server /proxy/<port> case works.
function resolveImageUrl(projectId, asset) {
  if (asset.imageUrl && asset.imageUrl.startsWith('/')) {
    return appBase() + asset.imageUrl;
  }
  if (asset.imageUrl) return asset.imageUrl;
  if (asset._rawPath) return fileRawUrl(projectId, asset._rawPath);
  return null;
}

// ----------------------------------------------------------------------------
// Fallback enumeration
// ----------------------------------------------------------------------------

// Walk three known sdk_data directories via the generic /files endpoint to
// build a best-effort asset list. The /files endpoint returns
//   { path, items: [{ name, type, size, modified }] }
// We treat every PNG as a pending asset since no gallery_state.json is
// available without Patch A.
async function enumerateViaFiles(projectId) {
  const targets = [
    { path: 'sdk_data/scenes',     type: 'scene' },
    { path: 'sdk_data/characters', type: 'portrait' },
    { path: 'sdk_data/launcher',   type: 'launcher' }
  ];
  const assets = [];
  for (const t of targets) {
    let listing;
    try {
      listing = await api.get(`/api/projects/${projectId}/files?path=${encodeURIComponent(t.path)}`);
    } catch (_e) {
      // Directory may not exist yet for this project — that is fine.
      continue;
    }
    const items = (listing && Array.isArray(listing.items)) ? listing.items : [];
    for (const it of items) {
      if (it.type !== 'file') continue;
      if (!/\.png$/i.test(it.name)) continue;
      const stem = it.name.replace(/\.png$/i, '');
      const rel = `${t.path}/${it.name}`;
      assets.push({
        id: `${t.type}:${stem}`,
        type: t.type,
        name: stem,
        imageUrl: null,
        _rawPath: rel,
        prompt: null,
        model: null,
        ditherAlgo: null,
        createdAt: it.modified ? new Date(it.modified).toISOString() : null,
        state: 'pending'
      });
    }
  }
  return assets;
}

// ----------------------------------------------------------------------------
// Filter + sort
// ----------------------------------------------------------------------------

const TYPE_KEYS = ['scene', 'portrait', 'card', 'launcher'];
const STATE_KEYS = ['pending', 'approved', 'rejected', 'regenerating'];

const TYPE_LABELS = {
  scene: 'Scenes',
  portrait: 'Portraits',
  card: 'Cards',
  launcher: 'Launcher'
};

const STATE_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  regenerating: 'Regenerating'
};

function applyFilters(assets, filters) {
  let out = assets;
  if (filters.types.length > 0) {
    const set = new Set(filters.types);
    out = out.filter((a) => set.has(a.type));
  }
  if (filters.states.length > 0) {
    const set = new Set(filters.states);
    out = out.filter((a) => set.has(a.state || 'pending'));
  }
  return out;
}

function applySort(assets, sortKey) {
  const arr = [...assets];
  switch (sortKey) {
    case 'type':
      arr.sort((a, b) =>
        (a.type || '').localeCompare(b.type || '') ||
        (a.name || '').localeCompare(b.name || ''));
      break;
    case 'name':
      arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    case 'created':
    default: {
      const ts = (a) => a.createdAt ? Date.parse(a.createdAt) || 0 : 0;
      arr.sort((a, b) => ts(b) - ts(a));
    }
  }
  return arr;
}

// ----------------------------------------------------------------------------
// State badge
// ----------------------------------------------------------------------------

const STATE_BADGE = {
  pending: {
    label: 'PENDING',
    cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    dot: 'bg-amber-400'
  },
  approved: {
    label: 'APPROVED',
    cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    dot: 'bg-emerald-400'
  },
  rejected: {
    label: 'REJECTED',
    cls: 'bg-red-500/15 text-red-300 ring-red-500/30',
    dot: 'bg-red-400'
  },
  regenerating: {
    label: 'REGEN',
    cls: 'bg-blue-500/15 text-blue-300 ring-blue-500/30 animate-pulse',
    dot: 'bg-blue-400'
  }
};

function StateBadge({ state }) {
  const meta = STATE_BADGE[state] || STATE_BADGE.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ring-1 font-mono ${meta.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

// ----------------------------------------------------------------------------
// Filter bar
// ----------------------------------------------------------------------------

function FilterChip({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-[11px] px-2 py-1 rounded ring-1 transition-colors ' +
        (active
          ? 'bg-accent/15 text-accent ring-accent/30'
          : 'bg-ink-900 text-ink-300 ring-ink-800 hover:bg-ink-800/60')
      }
    >
      {label}
    </button>
  );
}

function FilterBar({ filters, setFilters, sortKey, setSortKey, total, shown }) {
  const toggleType = (k) => {
    setFilters((f) => ({
      ...f,
      types: f.types.includes(k) ? f.types.filter((t) => t !== k) : [...f.types, k]
    }));
  };
  const toggleState = (k) => {
    setFilters((f) => ({
      ...f,
      states: f.states.includes(k) ? f.states.filter((s) => s !== k) : [...f.states, k]
    }));
  };
  const clearAll = () => setFilters({ types: [], states: [] });
  const anyActive = filters.types.length > 0 || filters.states.length > 0;

  return (
    <div className="bg-ink-900 ring-1 ring-ink-800 rounded-md px-3 py-2 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-[10px] text-ink-500 uppercase tracking-wider">
        <FilterIcon className="w-3 h-3" /> filter
      </div>
      <FilterChip active={!anyActive} label="All" onClick={clearAll} />
      {TYPE_KEYS.map((k) => (
        <FilterChip
          key={`t:${k}`}
          active={filters.types.includes(k)}
          label={TYPE_LABELS[k]}
          onClick={() => toggleType(k)}
        />
      ))}
      <span className="text-ink-700">·</span>
      {STATE_KEYS.map((k) => (
        <FilterChip
          key={`s:${k}`}
          active={filters.states.includes(k)}
          label={STATE_LABELS[k]}
          onClick={() => toggleState(k)}
        />
      ))}
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 text-[10px] text-ink-500 uppercase tracking-wider">
        <ArrowUpDown className="w-3 h-3" /> sort
      </div>
      <select
        value={sortKey}
        onChange={(e) => setSortKey(e.target.value)}
        className="bg-ink-950 text-ink-200 text-[11px] rounded px-2 py-1 ring-1 ring-ink-800 focus:outline-none focus:ring-accent/40"
      >
        <option value="created">Created</option>
        <option value="type">Type</option>
        <option value="name">Name</option>
      </select>
      <span className="text-[10px] text-ink-500 font-mono ml-1">
        {shown}/{total}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// References row
// ----------------------------------------------------------------------------

function referenceImageUrl(projectId, ref) {
  // Manifest entries (Patch A) may carry filename only. Project-scope
  // references (Phase 6 B5) carry a `path` relative to local_path.
  if (ref.url) return ref.url.startsWith('/') ? appBase() + ref.url : ref.url;
  if (ref.path) return fileRawUrl(projectId, ref.path);
  if (ref.filename) {
    return fileRawUrl(projectId, `sdk_data/asset_library/${ref.filename}`);
  }
  return null;
}

function ReferenceThumb({ projectId, ref }) {
  const url = referenceImageUrl(projectId, ref);
  const label = ref.name || ref.filename || (ref.path && ref.path.split('/').pop()) || 'ref';
  return (
    <div className="shrink-0 w-16 flex flex-col items-center gap-1" title={label}>
      <div className="w-16 h-16 rounded ring-1 ring-ink-800 bg-ink-950 flex items-center justify-center overflow-hidden">
        {url ? (
          <img
            src={url}
            alt={label}
            className="max-w-full max-h-full object-contain image-render-pixel"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <ImageIcon className="w-4 h-4 text-ink-700" />
        )}
      </div>
      <div className="text-[10px] text-ink-500 font-mono truncate w-full text-center">
        {label}
      </div>
    </div>
  );
}

function ReferencesRow({ projectId, references, onAdd }) {
  if (!references || references.length === 0) {
    return (
      <div className="bg-ink-900 ring-1 ring-ink-800 rounded-md px-3 py-3 flex items-center gap-3">
        <div className="flex-1 text-[11px] text-ink-400">
          No references uploaded. Drop PNGs here or click Upload.
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700"
        >
          <Plus className="w-3 h-3" /> Add Reference
        </button>
      </div>
    );
  }
  return (
    <div className="bg-ink-900 ring-1 ring-ink-800 rounded-md px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-[10px] text-ink-500 uppercase tracking-wider">
          References ({references.length})
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700"
        >
          <Plus className="w-3 h-3" /> Add Reference
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {references.map((r, idx) => (
          <ReferenceThumb
            key={r.path || r.filename || r.name || idx}
            projectId={projectId}
            ref={r}
          />
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Asset card
// ----------------------------------------------------------------------------

function AssetCard({ projectId, asset, onApprove, onReject, onOpen, onEdit, error }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const src = resolveImageUrl(projectId, asset);
  const state = asset.state || 'pending';
  const canAct = state !== 'regenerating' && !busy;

  const doApprove = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try { await onApprove(asset); } finally { setBusy(false); }
  };

  const openReject = (e) => {
    e.stopPropagation();
    setRejecting(true);
  };

  const cancelReject = (e) => {
    e.stopPropagation();
    setRejecting(false);
    setReason('');
  };

  const confirmReject = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await onReject(asset, reason.trim() || null);
      setRejecting(false);
      setReason('');
    } finally { setBusy(false); }
  };

  return (
    <div
      className="rounded-lg ring-1 ring-ink-800 bg-ink-900 overflow-hidden flex flex-col group hover:ring-ink-700 transition-colors"
    >
      <button
        type="button"
        onClick={() => onOpen(asset)}
        className="bg-ink-950 aspect-[5/3] flex items-center justify-center w-full overflow-hidden"
        title="open preview"
      >
        {src ? (
          <img
            src={src}
            alt={asset.name}
            className="max-w-full max-h-full object-contain image-render-pixel"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <ImageIcon className="w-8 h-8 text-ink-700" />
        )}
      </button>

      <div className="px-3 py-2 border-t border-ink-800 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-100 truncate font-mono" title={asset.name}>
            {asset.name}
          </div>
          <div className="text-[10px] text-ink-500 uppercase tracking-wide">
            {asset.type || 'asset'}
          </div>
        </div>
        <StateBadge state={state} />
      </div>

      {error ? (
        <div className="px-3 py-1.5 text-[10px] text-red-300 bg-red-900/20 border-t border-red-800/40 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      ) : null}

      {rejecting ? (
        <div className="px-3 py-2 border-t border-ink-800 bg-ink-950/40 space-y-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason (optional)"
            className="w-full text-[11px] bg-ink-900 text-ink-100 rounded px-2 py-1 ring-1 ring-ink-700 focus:outline-none focus:ring-red-500/40"
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmReject(e);
              if (e.key === 'Escape') cancelReject(e);
            }}
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={confirmReject}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
              Reject
            </button>
            <button
              type="button"
              onClick={cancelReject}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-ink-800 flex items-center gap-1.5">
          <button
            type="button"
            onClick={doApprove}
            disabled={!canAct || state === 'approved'}
            title={state === 'approved' ? 'already approved' : 'approve'}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:hover:bg-emerald-600/90"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Approve
          </button>
          <button
            type="button"
            onClick={openReject}
            disabled={!canAct || state === 'rejected'}
            title={state === 'rejected' ? 'already rejected' : 'reject'}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700 disabled:opacity-40"
          >
            <XIcon className="w-3 h-3" />
            Reject
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit && onEdit(asset, { mode: 'edit' }); }}
            disabled={!canAct}
            title="edit prompt / references and optionally regenerate"
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700 disabled:opacity-40"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit && onEdit(asset, { mode: 'regen' }); }}
            disabled={!canAct}
            title="open regen panel"
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700 disabled:opacity-40"
          >
            <RefreshCw className="w-3 h-3" /> Regen
          </button>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Preview modal
// ----------------------------------------------------------------------------

function PreviewModal({ projectId, asset, onClose, onApprove, onReject, onEdit }) {
  const ref = useRef(null);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !asset) return;
    if (typeof el.showModal === 'function' && !el.open) {
      try { el.showModal(); } catch (_e) { /* already open */ }
    }
    const onCancel = (e) => { e.preventDefault(); onClose(); };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [asset, onClose]);

  if (!asset) return null;
  const src = resolveImageUrl(projectId, asset);
  const state = asset.state || 'pending';

  const doApprove = async () => {
    setBusy(true);
    try {
      await onApprove(asset);
      onClose();
    } finally { setBusy(false); }
  };

  const doReject = async () => {
    setBusy(true);
    try {
      await onReject(asset, reason.trim() || null);
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <dialog
      ref={ref}
      className="bg-transparent p-0 backdrop:bg-black/60 max-w-none max-h-none"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="bg-ink-900 ring-1 ring-ink-700 rounded-lg w-[min(960px,95vw)] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-800">
          <span className="text-sm font-mono text-ink-100 truncate">{asset.name}</span>
          <span className="text-[10px] text-ink-500 uppercase tracking-wide">
            {asset.type || 'asset'}
          </span>
          <StateBadge state={state} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 p-1"
            title="close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto grid md:grid-cols-[1fr_300px] gap-0">
          <div className="bg-ink-950 flex items-center justify-center min-h-[300px] p-4">
            {src ? (
              <img
                src={src}
                alt={asset.name}
                className="max-w-full max-h-[70vh] object-contain image-render-pixel"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <ImageIcon className="w-10 h-10 text-ink-700" />
            )}
          </div>
          <div className="p-4 space-y-3 text-xs border-l border-ink-800 overflow-auto">
            <Meta label="id" value={asset.id} />
            <Meta label="type" value={asset.type} />
            <Meta label="model" value={asset.model || '—'} />
            <Meta label="dither" value={asset.ditherAlgo || '—'} />
            <Meta
              label="created"
              value={asset.createdAt ? new Date(asset.createdAt).toLocaleString() : '—'}
            />
            <div>
              <div className="text-[10px] text-ink-500 uppercase tracking-wider mb-1">
                Prompt
              </div>
              <pre className="text-[11px] text-ink-200 bg-ink-950 rounded p-2 ring-1 ring-ink-800 whitespace-pre-wrap font-mono max-h-64 overflow-auto">
                {asset.prompt || '(prompt not recorded — sidecar pending in Patch A)'}
              </pre>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-ink-800 flex items-center gap-2 flex-wrap">
          {rejecting ? (
            <>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="reason (optional)"
                className="flex-1 min-w-[200px] text-xs bg-ink-950 text-ink-100 rounded px-2 py-1.5 ring-1 ring-ink-700 focus:outline-none focus:ring-red-500/40"
                autoFocus
              />
              <button
                type="button"
                onClick={doReject}
                disabled={busy}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
                Confirm reject
              </button>
              <button
                type="button"
                onClick={() => { setRejecting(false); setReason(''); }}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={doApprove}
                disabled={busy || state === 'approved'}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Approve
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={busy || state === 'rejected'}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700 disabled:opacity-50"
              >
                <XIcon className="w-3.5 h-3.5" />
                Reject
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => { onClose(); onEdit && onEdit(asset, { mode: 'edit' }); }}
                disabled={busy}
                title="edit prompt / references"
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700 disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button
                type="button"
                onClick={() => { onClose(); onEdit && onEdit(asset, { mode: 'regen' }); }}
                disabled={busy}
                title="open regen panel"
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Regen
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-ink-500 uppercase tracking-wider">{label}</div>
      <div className="text-ink-200 font-mono break-all">{value || '—'}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Empty + banner states
// ----------------------------------------------------------------------------

function EmptyAssets({ onBuild, onUpload }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4 text-ink-400">
      <ImageIcon className="w-10 h-10 opacity-30" />
      <div className="space-y-1">
        <p className="text-ink-200 font-medium text-base">No assets generated yet.</p>
        <p className="text-ink-500 text-sm max-w-md">
          Click Build .pdx to start the pipeline, or upload assets manually.
        </p>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={onBuild}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent text-black hover:bg-accent/90"
        >
          <Hammer className="w-3.5 h-3.5" /> Build .pdx
        </button>
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-100 ring-1 ring-ink-700"
        >
          <UploadCloud className="w-3.5 h-3.5" /> Upload
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Data fetchers
// ----------------------------------------------------------------------------

// Returns { assets, source } where source ∈ { 'gallery', 'files', 'empty' }.
async function fetchAssets(projectId) {
  try {
    const r = await api.get(`/api/projects/${projectId}/gallery`);
    if (r && Array.isArray(r.assets) && r.assets.length > 0) {
      return { assets: r.assets, source: 'gallery' };
    }
    // 200 with empty list — backend live but project has nothing yet.
    if (r && Array.isArray(r.assets)) {
      // Try fallback anyway in case the autopilot has written PNGs the
      // gallery service doesn't index yet.
      const fb = await enumerateViaFiles(projectId);
      if (fb.length > 0) return { assets: fb, source: 'files' };
      return { assets: [], source: 'empty' };
    }
  } catch (e) {
    if (!(e && (e.status === 404 || e.status === 501))) {
      // Real error — still try fallback so user gets *something*.
      console.warn('[gallery] /gallery error', e);
    }
  }
  // Fallback to file enumeration.
  try {
    const assets = await enumerateViaFiles(projectId);
    return { assets, source: assets.length > 0 ? 'files' : 'empty' };
  } catch (e) {
    console.warn('[gallery] file enumeration failed', e);
    return { assets: [], source: 'empty' };
  }
}

async function fetchReferences(projectId) {
  try {
    const r = await api.get(`/api/projects/${projectId}/references/manifest`);
    if (r && Array.isArray(r.items)) return r.items;
    // Patch A spec returns { default_set, scene_references, ... } — flatten.
    if (r && typeof r === 'object') {
      const seen = new Set();
      const out = [];
      const push = (name) => {
        if (!name || seen.has(name)) return;
        seen.add(name);
        out.push({ filename: name, name });
      };
      if (Array.isArray(r.default_set)) r.default_set.forEach(push);
      for (const key of ['scene_references', 'portrait_references', 'card_references']) {
        const group = r[key];
        if (group && typeof group === 'object') {
          for (const arr of Object.values(group)) {
            if (Array.isArray(arr)) arr.forEach(push);
          }
        }
      }
      if (out.length > 0) return out;
    }
  } catch (_e) { /* fall through */ }
  try {
    const r = await api.get(`/api/projects/${projectId}/references`);
    if (r && Array.isArray(r.items)) {
      return r.items.map((it) => ({
        path: it.path,
        name: it.name || (it.path && it.path.split('/').pop())
      }));
    }
  } catch (_e) { /* swallow */ }
  return [];
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------

export default function ProjectGallery() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [assets, setAssets] = useState(null);
  const [source, setSource] = useState('empty');
  const [references, setReferences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ types: [], states: [] });
  const [sortKey, setSortKey] = useState('created');
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null); // { asset, mode }
  const [uploadingRefs, setUploadingRefs] = useState(false);
  const [cardErrors, setCardErrors] = useState({});

  const assetsRef = useRef([]);
  useEffect(() => { assetsRef.current = assets || []; }, [assets]);

  // Initial + polling load. We replace assets whose createdAt is newer than
  // the cached version, and bring in any new ones.
  const refresh = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const [a, refs] = await Promise.all([
        fetchAssets(id),
        fetchReferences(id)
      ]);
      setReferences(refs);
      if (silent) {
        // Merge — replace by id if newer createdAt; otherwise keep current
        // state so an optimistic update isn't clobbered by a stale poll.
        const cur = assetsRef.current || [];
        const byId = new Map(cur.map((x) => [x.id, x]));
        for (const incoming of a.assets) {
          const prev = byId.get(incoming.id);
          if (!prev) { byId.set(incoming.id, incoming); continue; }
          const prevTs = prev.createdAt ? Date.parse(prev.createdAt) || 0 : 0;
          const newTs = incoming.createdAt ? Date.parse(incoming.createdAt) || 0 : 0;
          if (newTs > prevTs) {
            byId.set(incoming.id, incoming);
          } else {
            // Keep current asset (preserves optimistic state); but pick up
            // server-side state if we have no local override.
            byId.set(incoming.id, { ...incoming, state: prev.state || incoming.state });
          }
        }
        // Drop assets that no longer exist on the server.
        const incomingIds = new Set(a.assets.map((x) => x.id));
        const merged = [];
        for (const [aid, v] of byId.entries()) {
          if (incomingIds.has(aid)) merged.push(v);
        }
        setAssets(merged);
        setSource(a.source);
      } else {
        setAssets(a.assets);
        setSource(a.source);
      }
    } catch (e) {
      if (!silent) console.warn('[gallery] refresh failed', e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  // Initial load on mount + when id changes.
  useEffect(() => {
    setAssets(null);
    refresh(false);
  }, [refresh]);

  // Polling. Skip when the preview modal is open to avoid stomping the
  // version the user is looking at.
  useEffect(() => {
    if (preview) return;
    const handle = setInterval(() => { refresh(true); }, POLL_MS);
    return () => clearInterval(handle);
  }, [refresh, preview]);

  // Optimistic approve.
  const handleApprove = useCallback(async (asset) => {
    const prevState = asset.state;
    setAssets((cur) => (cur || []).map((a) =>
      a.id === asset.id ? { ...a, state: 'approved' } : a));
    setCardErrors((m) => { const n = { ...m }; delete n[asset.id]; return n; });
    try {
      const enc = encodeURIComponent(asset.id);
      await api.post(`/api/projects/${id}/gallery/assets/${enc}/approve`, {});
    } catch (e) {
      setAssets((cur) => (cur || []).map((a) =>
        a.id === asset.id ? { ...a, state: prevState } : a));
      const msg = (e && e.detail && (e.detail.error || e.detail.detail)) || e?.message || 'approve failed';
      setCardErrors((m) => ({ ...m, [asset.id]: String(msg) }));
    }
  }, [id]);

  // Optimistic reject.
  const handleReject = useCallback(async (asset, reason) => {
    const prevState = asset.state;
    setAssets((cur) => (cur || []).map((a) =>
      a.id === asset.id ? { ...a, state: 'rejected' } : a));
    setCardErrors((m) => { const n = { ...m }; delete n[asset.id]; return n; });
    try {
      const enc = encodeURIComponent(asset.id);
      await api.post(`/api/projects/${id}/gallery/assets/${enc}/reject`,
        reason ? { reason } : {});
    } catch (e) {
      setAssets((cur) => (cur || []).map((a) =>
        a.id === asset.id ? { ...a, state: prevState } : a));
      const msg = (e && e.detail && (e.detail.error || e.detail.detail)) || e?.message || 'reject failed';
      setCardErrors((m) => ({ ...m, [asset.id]: String(msg) }));
    }
  }, [id]);

  // Edit modal triggers.
  const handleEdit = useCallback((asset, opts) => {
    setEditing({ asset, mode: (opts && opts.mode) || 'edit' });
    setCardErrors((m) => { const n = { ...m }; delete n[asset.id]; return n; });
  }, []);

  // Called by AssetEditModal when a regen finishes successfully. Replace the
  // asset record in place (so the new image url + sidecar values render) and
  // flip state badge to 'pending' (the backend already reset it). We also
  // briefly flash 'regenerating' here as an extra visual cue — the next poll
  // will replace this with the final server state.
  const handleRegenComplete = useCallback((updatedAsset) => {
    setAssets((cur) => {
      if (!cur || !updatedAsset || !updatedAsset.id) return cur;
      return cur.map((a) => (a.id === updatedAsset.id ? { ...a, ...updatedAsset } : a));
    });
  }, []);

  const visibleAssets = useMemo(() => {
    if (!assets) return [];
    return applySort(applyFilters(assets, filters), sortKey);
  }, [assets, filters, sortKey]);

  const total = assets ? assets.length : 0;

  if (loading && assets === null) {
    return (
      <div className="p-6 flex items-center gap-2 text-ink-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> loading gallery…
      </div>
    );
  }

  const handleBuild = () => navigate(`/projects/${id}/build/milestones`);
  // In-modal upload (Phase 4.5 Patch D). The standalone Reference Library
  // page at /projects/:id/author/references still exists as a deeper UI.
  const handleUpload = () => setUploadingRefs(true);

  return (
    <div className="p-4 space-y-3">
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        sortKey={sortKey}
        setSortKey={setSortKey}
        total={total}
        shown={visibleAssets.length}
      />

      <ReferencesRow
        projectId={id}
        references={references}
        onAdd={handleUpload}
      />

      {source === 'files' ? (
        <p className="text-[11px] text-amber-400 font-mono px-1">
          Backend gallery API not yet live — showing best-effort listing from sdk_data/.
        </p>
      ) : null}

      {total === 0 ? (
        <EmptyAssets onBuild={handleBuild} onUpload={handleUpload} />
      ) : visibleAssets.length === 0 ? (
        <div className="py-12 text-center text-ink-500 text-sm">
          No assets match the current filters.
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {visibleAssets.map((a) => (
            <AssetCard
              key={a.id || `${a.type}:${a.name}`}
              projectId={id}
              asset={a}
              onApprove={handleApprove}
              onReject={handleReject}
              onOpen={(x) => setPreview(x)}
              onEdit={handleEdit}
              error={cardErrors[a.id]}
            />
          ))}
        </div>
      )}

      {preview ? (
        <PreviewModal
          projectId={id}
          asset={preview}
          onClose={() => setPreview(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
        />
      ) : null}

      {editing ? (
        <AssetEditModal
          projectId={id}
          asset={editing.asset}
          onClose={() => setEditing(null)}
          onRegenComplete={(updated) => {
            if (updated) handleRegenComplete(updated);
            setEditing(null);
          }}
        />
      ) : null}

      {uploadingRefs ? (
        <ReferenceUploadModal
          projectId={id}
          onClose={() => setUploadingRefs(false)}
          onUploadComplete={() => {
            // Trigger an asset/refs refetch so the references row updates.
            refresh(true);
          }}
        />
      ) : null}
    </div>
  );
}
