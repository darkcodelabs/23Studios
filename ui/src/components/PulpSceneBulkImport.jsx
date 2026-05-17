import { safeErr } from '../lib/format_err.js';
import { useCallback, useRef, useState } from 'react';
import {
  X, Loader2, Upload, AlertTriangle, Check, Image as ImageIcon, FolderOpen
} from 'lucide-react';
import {
  bulkImportScenes,
  validateSceneFiles,
  SCENE_LIMITS
} from '../lib/pulp_scenes.js';

// PulpSceneBulkImport
//
// Bulk scene drop modal. Mirrors PulpAssetImportModal's structure but only
// hits one endpoint (server auto-assigns by filename → room_id).
//
// Props:
//   projectId
//   onClose()
//   onImported()  fired on a successful response so the parent can refresh
//
// Server contract:
//   POST /api/projects/:id/pulp/import-scenes  multipart files[] (+ mode=auto)
//     → { assigned:[{room_id, path, dim}], skipped:[{filename, reason}], stats }
export default function PulpSceneBulkImport({ projectId, onClose, onImported }) {
  const limit = SCENE_LIMITS.bulk;

  const [files, setFiles] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null); // { assigned, skipped, stats }
  const inputRef = useRef(null);

  const addFiles = useCallback((incoming) => {
    const { accepted, skipped } = validateSceneFiles(incoming, 'bulk');
    setFiles((prev) => {
      const key = (f) => `${f.name}:${f.size}`;
      const seen = new Set(prev.map(key));
      const merged = [...prev];
      for (const f of accepted) if (!seen.has(key(f))) merged.push(f);
      if (merged.length > limit.maxFiles) {
        skipped.push(...merged.slice(limit.maxFiles).map((f) => ({
          filename: f.name, reason: `over ${limit.maxFiles}-file limit`
        })));
        return merged.slice(0, limit.maxFiles);
      }
      return merged;
    });
    if (skipped.length) setWarnings((prev) => [...prev, ...skipped]);
  }, [limit.maxFiles]);

  function onPick(e) {
    addFiles(e.target.files || []);
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files || []);
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearWarnings() { setWarnings([]); }

  async function submit() {
    if (busy || !files.length) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await bulkImportScenes(projectId, files, { mode: 'auto' });
      setResult({
        assigned: r?.assigned || [],
        skipped: r?.skipped || [],
        stats: r?.stats || null
      });
      onImported?.();
    } catch (e) {
      setErr(e.detail?.error || e.message || 'import failed');
    } finally {
      setBusy(false);
    }
  }

  function onOverlayClick() {
    if (busy) return;
    onClose?.();
  }

  return (
    <div
      className="fixed inset-0 z-30 bg-ink-900/80 flex items-center justify-center p-4"
      onClick={onOverlayClick}
    >
      <div
        className="w-full max-w-2xl bg-ink-800 border border-ink-600 rounded-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-base text-ink-100 flex items-center gap-2">
            <Upload className="w-4 h-4 text-accent" />
            bulk import scenes
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-ink-400 hover:text-ink-200 disabled:opacity-40"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-ink-500">
          drop scene PNGs (400×240). filenames matching <code className="text-ink-300">room_id.png</code> auto-assign to that room.
          max {limit.maxFiles} files, {(limit.maxBytes / 1024 / 1024).toFixed(0)} MB each.
        </p>

        {/* ---- dropzone ---- */}
        <div
          className={`border-2 border-dashed rounded-md p-6 text-center text-xs ${dragOver ? 'border-accent bg-accent/5' : 'border-ink-600 bg-ink-900/40'}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {files.length === 0 ? (
            <div className="space-y-2">
              <div className="text-ink-300">drag and drop scene images here</div>
              <button type="button" className="btn text-[11px]" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Upload className="w-3 h-3" /> choose files
              </button>
              <div className="text-[10px] text-ink-500 flex items-center justify-center gap-1 pt-1">
                <FolderOpen className="w-3 h-3" />
                tip: browse <code className="text-ink-400">/home/hakcer/projects/personal/hakcd/hakcd_pixel_collection</code> for concept art
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-ink-400">{files.length} file{files.length === 1 ? '' : 's'} queued</div>
              <button type="button" className="btn text-[11px]" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Upload className="w-3 h-3" /> add more
              </button>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={onPick}
          />
        </div>

        {/* ---- file list ---- */}
        {files.length ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-ink-500">queued ({files.length})</span>
              <button type="button" className="text-[10px] text-ink-400 hover:text-ink-200" onClick={() => setFiles([])} disabled={busy}>
                clear
              </button>
            </div>
            <ul className="max-h-48 overflow-y-auto border border-ink-700 rounded bg-ink-900/40 divide-y divide-ink-800">
              {files.map((f, i) => (
                <li key={`${f.name}:${i}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <div className="w-6 h-6 rounded border border-ink-700 bg-ink-900 grid place-items-center">
                    <ImageIcon className="w-3 h-3 text-ink-500" />
                  </div>
                  <span className="flex-1 truncate text-ink-200 font-mono">{f.name}</span>
                  <span className="text-[10px] text-ink-500">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className="text-ink-500 hover:text-ink-200"
                    onClick={() => removeFile(i)}
                    disabled={busy}
                    aria-label="remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ---- warnings (client-side rejects) ---- */}
        {warnings.length ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> warnings ({warnings.length})
              </span>
              <button type="button" className="text-[10px] text-ink-400 hover:text-ink-200" onClick={clearWarnings}>
                dismiss
              </button>
            </div>
            <ul className="max-h-24 overflow-y-auto border border-amber-900/40 rounded bg-amber-900/10 divide-y divide-amber-900/30">
              {warnings.map((w, i) => (
                <li key={i} className="px-2 py-1 text-[11px] flex gap-2">
                  <span className="font-mono text-amber-300 truncate">{w.filename}</span>
                  <span className="text-amber-400 flex-1 text-right truncate">{w.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ---- server response ---- */}
        {result ? (
          <div className="space-y-2">
            {result.assigned.length ? (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> assigned ({result.assigned.length})
                </div>
                <ul className="max-h-32 overflow-y-auto border border-emerald-900/40 rounded bg-emerald-900/10 divide-y divide-emerald-900/30">
                  {result.assigned.map((a, i) => (
                    <li key={i} className="px-2 py-1 text-[11px] flex gap-2">
                      <span className="font-mono text-emerald-300 truncate">{a.room_id}</span>
                      <span className="text-emerald-500 flex-1 text-right truncate font-mono">
                        {a.dim ? `${a.dim[0]}×${a.dim[1]}` : ''} {a.path ? `· ${a.path}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result.skipped.length ? (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> server-skipped ({result.skipped.length})
                </div>
                <ul className="max-h-32 overflow-y-auto border border-amber-900/40 rounded bg-amber-900/10 divide-y divide-amber-900/30">
                  {result.skipped.map((s, i) => (
                    <li key={i} className="px-2 py-1 text-[11px] flex gap-2">
                      <span className="font-mono text-amber-300 truncate">{s.filename}</span>
                      <span className="text-amber-400 flex-1 text-right truncate">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {err ? <div className="text-xs text-red-400">{safeErr(err)}</div> : null}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-700">
          <button type="button" className="btn text-xs" onClick={onClose} disabled={busy}>
            {result ? 'close' : 'cancel'}
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={submit}
            disabled={busy || !files.length}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            import {files.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
