import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud, X as XIcon, Trash2, AlertCircle, Loader2, Check
} from 'lucide-react';
import { api } from '../lib/api.js';

// ReferenceUploadModal — Phase 4.5 Patch D.
//
// In-modal multi-file PNG upload for the gallery's references row.
// Posts each file to POST /api/projects/:id/references (multipart, field "file")
// — endpoint added in Phase 4.5 Patch A (commit 7cbc8b4).
//
// Layout:
//   - Drag-and-drop zone + click-to-select fallback (PNG only)
//   - Per-file preview thumbnail + assignment dropdown (multi-select)
//   - Existing per-project references list with delete buttons (NOT defaults)
//
// Assignment dropdown — multi-select via checkbox group:
//   default | scene_title | scene_interior | scene_exterior | scene_ui |
//   portrait | card
// Uploads land in the project's reference dir; assignments update the per-
// project manifest after upload via PUT /api/projects/:id/references/manifest.
//
// On success: invokes onUploadComplete(mergedManifest) so the parent can
// refetch its references row.

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47]; // \x89PNG

const ASSIGNMENT_TARGETS = [
  { id: 'default',         label: 'Default set',     bucket: 'default_set',          key: null },
  { id: 'scene_title',     label: 'Scene: title',    bucket: 'scene_references',     key: 'title' },
  { id: 'scene_interior',  label: 'Scene: interior', bucket: 'scene_references',     key: 'interior' },
  { id: 'scene_exterior',  label: 'Scene: exterior', bucket: 'scene_references',     key: 'exterior' },
  { id: 'scene_ui',        label: 'Scene: UI',       bucket: 'scene_references',     key: 'ui' },
  { id: 'portrait',        label: 'Portraits',       bucket: 'portrait_references',  key: 'default' },
  { id: 'card',            label: 'Cards / launcher', bucket: 'card_references',     key: 'default' }
];

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

function fileRawUrl(projectId, relPath) {
  return `${appBase()}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

// Quick PNG-magic sniff so the UI can reject non-PNGs before round-tripping
// to the server. The backend re-validates magic bytes regardless.
async function isPngFile(file) {
  if (!file || file.size < PNG_HEADER.length) return false;
  if (!/\.png$/i.test(file.name)) return false;
  const head = await file.slice(0, PNG_HEADER.length).arrayBuffer();
  const view = new Uint8Array(head);
  for (let i = 0; i < PNG_HEADER.length; i++) {
    if (view[i] !== PNG_HEADER[i]) return false;
  }
  return true;
}

function sanitizeName(name) {
  // Match the server's SAFE_FILENAME_RE: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.png$/
  const base = (name || '').replace(/^[^A-Za-z0-9]+/, '');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!cleaned) return null;
  return /\.png$/i.test(cleaned) ? cleaned : cleaned + '.png';
}

function PendingFileRow({ entry, onAssignmentToggle, onRemove }) {
  return (
    <div className="bg-ink-950 ring-1 ring-ink-800 rounded p-3 flex gap-3 items-start">
      <div className="w-16 h-16 rounded ring-1 ring-ink-800 bg-ink-900 flex items-center justify-center overflow-hidden shrink-0">
        {entry.previewUrl ? (
          <img
            src={entry.previewUrl}
            alt={entry.name}
            className="max-w-full max-h-full object-contain image-render-pixel"
          />
        ) : (
          <UploadCloud className="w-4 h-4 text-ink-700" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-100 font-mono truncate flex-1" title={entry.name}>
            {entry.name}
          </span>
          <span className="text-[10px] text-ink-500 font-mono">
            {(entry.file.size / 1024).toFixed(1)} kB
          </span>
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            disabled={entry.status === 'uploading'}
            className="text-ink-500 hover:text-red-400 p-1 disabled:opacity-50"
            title="remove from queue"
          >
            <XIcon className="w-3 h-3" />
          </button>
        </div>

        {entry.status === 'error' ? (
          <div className="text-[10px] text-red-300 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{entry.error || 'upload failed'}</span>
          </div>
        ) : entry.status === 'done' ? (
          <div className="text-[10px] text-emerald-300 flex items-center gap-1">
            <Check className="w-3 h-3" /> uploaded
          </div>
        ) : entry.status === 'uploading' ? (
          <div className="text-[10px] text-ink-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> uploading…
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ASSIGNMENT_TARGETS.map((t) => {
              const checked = entry.assignments.has(t.id);
              return (
                <label
                  key={t.id}
                  className={
                    'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ring-1 cursor-pointer ' +
                    (checked
                      ? 'bg-accent/15 text-accent ring-accent/30'
                      : 'bg-ink-900 text-ink-400 ring-ink-800 hover:bg-ink-800')
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onAssignmentToggle(entry.id, t.id)}
                    className="hidden"
                  />
                  {t.label}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ExistingRefRow({ projectId, item, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState(null);

  const doDelete = useCallback(async () => {
    setDeleting(true);
    setErr(null);
    try {
      await api.del(`/api/projects/${projectId}/references/${encodeURIComponent(item.filename)}`);
      if (typeof onDeleted === 'function') onDeleted(item.filename);
    } catch (e) {
      const msg = (e && e.detail && (e.detail.detail || e.detail.error)) || e?.message || 'delete failed';
      setErr(String(msg));
    } finally {
      setDeleting(false);
    }
  }, [projectId, item.filename, onDeleted]);

  const url = fileRawUrl(projectId, `sdk_data/asset_library/references/${item.filename}`);

  return (
    <div className="bg-ink-950 ring-1 ring-ink-800 rounded p-2 flex items-center gap-2">
      <div className="w-10 h-10 rounded ring-1 ring-ink-800 bg-ink-900 flex items-center justify-center overflow-hidden shrink-0">
        <img
          src={url}
          alt={item.filename}
          className="max-w-full max-h-full object-contain image-render-pixel"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-mono text-ink-200 truncate">{item.filename}</div>
        {err ? <div className="text-[10px] text-red-300 truncate">{err}</div> : null}
      </div>
      <button
        type="button"
        onClick={doDelete}
        disabled={deleting}
        className="text-ink-500 hover:text-red-400 p-1 disabled:opacity-50"
        title="delete reference (project-only; defaults are read-only)"
      >
        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default function ReferenceUploadModal({ projectId, onClose, onUploadComplete }) {
  const dialogRef = useRef(null);
  const fileInputRef = useRef(null);

  const [pending, setPending] = useState([]);   // queued, not yet sent
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState(null);

  // Existing per-project references — fetched once on mount and refreshed
  // after each successful upload/delete so the list stays current.
  const [manifest, setManifest] = useState(null);
  const [manifestLoading, setManifestLoading] = useState(true);

  // showmodal/cancel lifecycle.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.showModal === 'function' && !el.open) {
      try { el.showModal(); } catch (_e) { /* already open */ }
    }
    const onCancel = (e) => { e.preventDefault(); onClose(); };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const refreshManifest = useCallback(async () => {
    setManifestLoading(true);
    try {
      const m = await api.get(`/api/projects/${projectId}/references/manifest`);
      setManifest(m);
    } catch (e) {
      console.warn('[ReferenceUploadModal] manifest load failed', e);
    } finally {
      setManifestLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refreshManifest(); }, [refreshManifest]);

  // Revoke object URLs when entries are removed or modal closes.
  useEffect(() => {
    return () => {
      for (const p of pending) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback(async (fileList) => {
    setTopError(null);
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const next = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        next.push({ id: crypto.randomUUID(), file: f, name: sanitizeName(f.name) || f.name,
          previewUrl: null, status: 'error', error: 'file too large (max 10MB)',
          assignments: new Set(['default']) });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const ok = await isPngFile(f);
      if (!ok) {
        next.push({ id: crypto.randomUUID(), file: f, name: sanitizeName(f.name) || f.name,
          previewUrl: null, status: 'error', error: 'not a PNG (magic bytes failed)',
          assignments: new Set(['default']) });
        continue;
      }
      const cleanName = sanitizeName(f.name) || 'upload.png';
      next.push({
        id: crypto.randomUUID(),
        file: f,
        name: cleanName,
        previewUrl: URL.createObjectURL(f),
        status: 'queued',
        error: null,
        assignments: new Set(['default'])
      });
    }
    setPending((cur) => [...cur, ...next]);
  }, []);

  const onDragOver = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
  }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    const dt = e.dataTransfer;
    if (dt && dt.files) addFiles(dt.files);
  }, [addFiles]);

  const onPickFiles = useCallback((e) => {
    addFiles(e.target.files);
    // clear so re-selecting the same file fires onChange again
    e.target.value = '';
  }, [addFiles]);

  const removePending = useCallback((id) => {
    setPending((cur) => {
      const found = cur.find((p) => p.id === id);
      if (found && found.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return cur.filter((p) => p.id !== id);
    });
  }, []);

  const toggleAssignment = useCallback((entryId, targetId) => {
    setPending((cur) => cur.map((p) => {
      if (p.id !== entryId) return p;
      const next = new Set(p.assignments);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return { ...p, assignments: next };
    }));
  }, []);

  const uploadAll = useCallback(async () => {
    const queued = pending.filter((p) => p.status === 'queued');
    if (queued.length === 0) return;
    setBusy(true);
    setTopError(null);

    // Track names that landed successfully + their assignments so we can
    // update the manifest in one round-trip after all uploads finish.
    const successByEntry = [];

    for (const entry of queued) {
      setPending((cur) => cur.map((p) => p.id === entry.id
        ? { ...p, status: 'uploading', error: null }
        : p));
      try {
        const fd = new FormData();
        fd.append('file', entry.file, entry.name);
        fd.append('filename', entry.name);
        // eslint-disable-next-line no-await-in-loop
        const res = await api.post(`/api/projects/${projectId}/references`, fd);
        const uploadedName = (res && res.uploaded && res.uploaded.filename) || entry.name;
        successByEntry.push({ filename: uploadedName, assignments: Array.from(entry.assignments) });
        setPending((cur) => cur.map((p) => p.id === entry.id
          ? { ...p, status: 'done', error: null, name: uploadedName }
          : p));
      } catch (e) {
        const msg = (e && e.detail && (e.detail.detail || e.detail.error)) || e?.message || 'upload failed';
        setPending((cur) => cur.map((p) => p.id === entry.id
          ? { ...p, status: 'error', error: String(msg) }
          : p));
      }
    }

    // Manifest update — merge new filenames into the buckets the user picked.
    if (successByEntry.length > 0) {
      try {
        // Pull current manifest fresh so we don't clobber concurrent edits.
        const current = await api.get(`/api/projects/${projectId}/references/manifest`);
        const next = {
          default_set: Array.isArray(current.default_set) ? [...current.default_set] : [],
          scene_references: { ...(current.scene_references || {}) },
          portrait_references: { ...(current.portrait_references || {}) },
          card_references: { ...(current.card_references || {}) }
        };
        // Deep clone buckets so we don't mutate the cached current.
        for (const b of ['scene_references', 'portrait_references', 'card_references']) {
          for (const k of Object.keys(next[b])) {
            next[b][k] = Array.isArray(next[b][k]) ? [...next[b][k]] : [];
          }
        }

        for (const { filename, assignments } of successByEntry) {
          for (const aId of assignments) {
            const target = ASSIGNMENT_TARGETS.find((t) => t.id === aId);
            if (!target) continue;
            if (target.bucket === 'default_set') {
              if (!next.default_set.includes(filename)) next.default_set.push(filename);
            } else {
              if (!next[target.bucket][target.key]) next[target.bucket][target.key] = [];
              if (!next[target.bucket][target.key].includes(filename)) {
                next[target.bucket][target.key].push(filename);
              }
            }
          }
        }

        const updated = await api.put(`/api/projects/${projectId}/references/manifest`, next);
        if (typeof onUploadComplete === 'function') onUploadComplete(updated);
        setManifest(updated);
      } catch (e) {
        const msg = (e && e.detail && (e.detail.detail || e.detail.error)) || e?.message || 'manifest update failed';
        setTopError(String(msg));
      }
    }

    setBusy(false);
  }, [pending, projectId, onUploadComplete]);

  const removeFromExisting = useCallback((filename) => {
    setManifest((cur) => {
      if (!cur) return cur;
      // Best-effort optimistic prune — the server scrubs the per-project
      // manifest on delete, so refresh to be safe.
      return cur;
    });
    refreshManifest();
  }, [refreshManifest]);

  const queuedCount = useMemo(() => pending.filter((p) => p.status === 'queued').length, [pending]);
  const errorCount = useMemo(() => pending.filter((p) => p.status === 'error').length, [pending]);
  const doneCount = useMemo(() => pending.filter((p) => p.status === 'done').length, [pending]);

  // Per-project (deletable) uploads. We don't have a per-bucket "is this from
  // defaults" map on a file basis, so list every distinct filename whose
  // _source says 'project' for ANY bucket — those are the ones we own.
  const projectFilenames = useMemo(() => {
    if (!manifest) return [];
    const source = manifest._source || {};
    const ownedByProject = new Set();
    // Mark all filenames in buckets whose source is 'project'.
    if (source.default_set === 'project' && Array.isArray(manifest.default_set)) {
      for (const n of manifest.default_set) ownedByProject.add(n);
    }
    for (const bucket of ['scene_references', 'portrait_references', 'card_references']) {
      const group = manifest[bucket];
      if (!group) continue;
      for (const k of Object.keys(group)) {
        if (source[`${bucket}.${k}`] === 'project' && Array.isArray(group[k])) {
          for (const n of group[k]) ownedByProject.add(n);
        }
      }
    }
    return Array.from(ownedByProject).map((n) => ({ filename: n }));
  }, [manifest]);

  return (
    <dialog
      ref={dialogRef}
      className="bg-transparent p-0 backdrop:bg-black/60 max-w-none max-h-none"
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="bg-ink-900 ring-1 ring-ink-700 rounded-lg w-[min(720px,95vw)] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-800">
          <UploadCloud className="w-4 h-4 text-ink-400" />
          <span className="text-sm font-mono text-ink-100">Upload references</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-ink-400 hover:text-ink-100 p-1 disabled:opacity-50"
            title="close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            className={
              'rounded-md border-2 border-dashed p-6 text-center cursor-pointer transition-colors ' +
              (dragOver
                ? 'border-accent bg-accent/5 text-accent'
                : 'border-ink-700 bg-ink-950 text-ink-400 hover:border-ink-600 hover:text-ink-200')
            }
          >
            <UploadCloud className="w-8 h-8 mx-auto mb-2 opacity-70" />
            <p className="text-xs font-medium">Drop PNG files here, or click to select</p>
            <p className="text-[10px] text-ink-500 mt-1">PNG only, 10MB max each, 20 per project</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png"
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
          </div>

          {topError ? (
            <div className="text-[11px] text-red-300 bg-red-900/20 border border-red-800/40 rounded px-2 py-1.5 flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{topError}</span>
            </div>
          ) : null}

          {/* Pending queue */}
          {pending.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] text-ink-500 uppercase tracking-wider flex items-center gap-2">
                Pending ({pending.length})
                {doneCount > 0 ? <span className="text-emerald-400">· {doneCount} done</span> : null}
                {errorCount > 0 ? <span className="text-red-400">· {errorCount} failed</span> : null}
              </div>
              {pending.map((p) => (
                <PendingFileRow
                  key={p.id}
                  entry={p}
                  onAssignmentToggle={toggleAssignment}
                  onRemove={removePending}
                />
              ))}
            </div>
          ) : null}

          {/* Existing per-project references */}
          <div className="space-y-2 pt-2 border-t border-ink-800">
            <div className="text-[10px] text-ink-500 uppercase tracking-wider">
              Project references {manifestLoading ? '' : `(${projectFilenames.length})`}
            </div>
            {manifestLoading ? (
              <div className="flex items-center gap-2 text-ink-500 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" /> loading…
              </div>
            ) : projectFilenames.length === 0 ? (
              <p className="text-[11px] text-ink-500">
                No project-specific uploads yet. The default set is read-only here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {projectFilenames.map((it) => (
                  <ExistingRefRow
                    key={it.filename}
                    projectId={projectId}
                    item={it}
                    onDeleted={removeFromExisting}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-ink-800 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 disabled:opacity-50"
          >
            Close
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={uploadAll}
            disabled={busy || queuedCount === 0}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
            {busy ? 'Uploading…' : `Upload ${queuedCount > 0 ? `(${queuedCount})` : ''}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
