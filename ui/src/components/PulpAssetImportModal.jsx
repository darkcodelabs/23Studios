import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, Upload, AudioLines, FileMusic, Image as ImageIcon, AlertTriangle, Check } from 'lucide-react';
import {
  importTiles,
  importSounds,
  validateFiles,
  ASSET_LIMITS
} from '../lib/pulp_upload.js';
import { pulpApi, TILE_TYPES } from '../lib/pulp_api.js';

// Reusable bulk-import modal for tiles | sounds | songs.
//
//   tiles:  multipart → /import-tiles → persists each returned tile via POST /tiles
//   sounds: multipart → /import-sounds → POST /sounds for each
//   songs:  client-side parse of pulp song JSON → POST /songs for each
//
// onImported(items) is called with the list of persisted records on success.
export default function PulpAssetImportModal({ kind, projectId, onClose, onImported }) {
  const limit = ASSET_LIMITS[kind === 'songs' ? 'songs' : kind] || ASSET_LIMITS.tiles;
  const accept = kind === 'songs'
    ? '.json,application/json'
    : kind === 'sounds'
      ? 'audio/*'
      : 'image/*';

  const [files, setFiles] = useState([]); // accepted File[]
  const [warnings, setWarnings] = useState([]); // [{filename, reason}]
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [tileType, setTileType] = useState('world');
  const [tileSolid, setTileSolid] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [perFileStatus, setPerFileStatus] = useState({}); // {name: 'ok'|'fail'|reason}
  const inputRef = useRef(null);

  const addFiles = useCallback((incoming) => {
    const { accepted, skipped } = validateFiles(kind === 'songs' ? 'songs' : kind, incoming);
    setFiles((prev) => {
      // de-dupe by name+size
      const key = (f) => `${f.name}:${f.size}`;
      const seen = new Set(prev.map(key));
      const merged = [...prev];
      for (const f of accepted) if (!seen.has(key(f))) merged.push(f);
      // re-trim to limit after merge
      if (merged.length > limit.maxFiles) {
        skipped.push(...merged.slice(limit.maxFiles).map((f) => ({
          filename: f.name, reason: `over ${limit.maxFiles}-file limit`
        })));
        return merged.slice(0, limit.maxFiles);
      }
      return merged;
    });
    if (skipped.length) setWarnings((prev) => [...prev, ...skipped]);
  }, [kind, limit.maxFiles]);

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

  function clearWarnings() {
    setWarnings([]);
  }

  async function submit() {
    if (busy || !files.length) return;
    setBusy(true);
    setErr(null);
    setPerFileStatus({});
    try {
      const persisted = [];
      if (kind === 'tiles') {
        const { tiles = [], skipped = [] } = await importTiles(projectId, files, { type: tileType, solid: tileSolid });
        for (const s of skipped) {
          setPerFileStatus((prev) => ({ ...prev, [s.filename]: s.reason || 'skipped' }));
        }
        for (const tile of tiles) {
          try {
            const r = await pulpApi.createTile(projectId, tile);
            const out = r?.tile || tile;
            persisted.push(out);
            if (tile.source_filename) {
              setPerFileStatus((prev) => ({ ...prev, [tile.source_filename]: 'ok' }));
            }
          } catch (e) {
            const key = tile.source_filename || tile.name || 'tile';
            setPerFileStatus((prev) => ({ ...prev, [key]: e.detail?.error || 'persist failed' }));
          }
        }
      } else if (kind === 'sounds') {
        const { sounds = [], skipped = [] } = await importSounds(projectId, files);
        for (const s of skipped) {
          setPerFileStatus((prev) => ({ ...prev, [s.filename]: s.reason || 'skipped' }));
        }
        for (const snd of sounds) {
          try {
            const r = await pulpApi.createSound(projectId, snd);
            const out = r?.sound || snd;
            persisted.push(out);
            if (snd.source_filename) {
              setPerFileStatus((prev) => ({ ...prev, [snd.source_filename]: 'ok' }));
            }
          } catch (e) {
            const key = snd.source_filename || snd.name || 'sound';
            setPerFileStatus((prev) => ({ ...prev, [key]: e.detail?.error || 'persist failed' }));
          }
        }
      } else if (kind === 'songs') {
        // Client-side parse: each JSON file is a pulp song spec.
        for (const f of files) {
          try {
            const text = await f.text();
            const parsed = JSON.parse(text);
            const r = await pulpApi.createSong(projectId, parsed);
            const out = r?.song || parsed;
            persisted.push(out);
            setPerFileStatus((prev) => ({ ...prev, [f.name]: 'ok' }));
          } catch (e) {
            setPerFileStatus((prev) => ({ ...prev, [f.name]: e.message || 'invalid json' }));
          }
        }
      }
      onImported?.(persisted);
      // brief pause so users can see the per-file results, then close
      setTimeout(() => onClose?.(), 400);
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

  const title = `import ${kind}`;

  return (
    <div className="fixed inset-0 z-30 bg-ink-900/80 flex items-center justify-center p-4" onClick={onOverlayClick}>
      <div
        className="w-full max-w-2xl bg-ink-800 border border-ink-600 rounded-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-base text-ink-100 flex items-center gap-2">
            <Upload className="w-4 h-4 text-accent" />
            {title}
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
          {kind === 'tiles'  ? `images (16×16 1-bit). max ${ASSET_LIMITS.tiles.maxFiles} files, 4 MB each.` : null}
          {kind === 'sounds' ? `short audio clips. max ${ASSET_LIMITS.sounds.maxFiles} files, 4 MB each.` : null}
          {kind === 'songs'  ? `pulp song JSON files (parsed client-side, no conversion).` : null}
        </p>

        {/* ---- dropzone ---- */}
        <div
          className={`border-2 border-dashed rounded-md p-6 text-center text-xs ${dragOver ? 'border-accent bg-accent/5' : 'border-ink-600 bg-ink-900/40'}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="text-ink-300 mb-2">
            drag and drop files here
          </div>
          <button type="button" className="btn text-[11px]" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Upload className="w-3 h-3" /> choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={onPick}
          />
        </div>

        {/* ---- tile-specific options ---- */}
        {kind === 'tiles' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="block text-[10px] uppercase tracking-wide text-ink-500">type (applies to all)</span>
              <select
                className="input text-xs font-mono"
                value={tileType}
                onChange={(e) => setTileType(e.target.value)}
                disabled={busy}
              >
                {TILE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 text-xs text-ink-200 pb-2">
              <input
                type="checkbox"
                checked={tileSolid}
                onChange={(e) => setTileSolid(e.target.checked)}
                disabled={busy}
              />
              <span>solid</span>
            </label>
          </div>
        ) : null}

        {/* ---- file list ---- */}
        {files.length ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-ink-500">queued ({files.length})</span>
              <button type="button" className="text-[10px] text-ink-400 hover:text-ink-200" onClick={() => setFiles([])} disabled={busy}>
                clear
              </button>
            </div>
            <ul className="max-h-56 overflow-y-auto border border-ink-700 rounded bg-ink-900/40 divide-y divide-ink-800">
              {files.map((f, i) => (
                <li key={`${f.name}:${i}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <FilePreview kind={kind} file={f} />
                  <span className="flex-1 truncate text-ink-200 font-mono">{f.name}</span>
                  <span className="text-[10px] text-ink-500">{formatBytes(f.size)}</span>
                  <StatusGlyph status={perFileStatus[f.name]} />
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

        {/* ---- warnings ---- */}
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
            <ul className="max-h-32 overflow-y-auto border border-amber-900/40 rounded bg-amber-900/10 divide-y divide-amber-900/30">
              {warnings.map((w, i) => (
                <li key={i} className="px-2 py-1 text-[11px] flex gap-2">
                  <span className="font-mono text-amber-300 truncate">{w.filename}</span>
                  <span className="text-amber-400 flex-1 text-right truncate">{w.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {err ? <div className="text-xs text-red-400">{safeErr(err)}</div> : null}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-700">
          <button type="button" className="btn text-xs" onClick={onClose} disabled={busy}>
            cancel
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

// ----- per-file inline preview -----

function FilePreview({ kind, file }) {
  if (kind === 'tiles') return <ImageThumb file={file} />;
  if (kind === 'sounds') return <AudioGlyph />;
  return <SongGlyph />;
}

function ImageThumb({ file }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!/^image\//.test(file.type)) return;
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (cancelled) return;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        // Rasterize to 16x16 client-side for a fast thumbnail. This mirrors
        // the server's eventual conversion and gives the user a sanity check
        // before they upload.
        const c = document.createElement('canvas');
        c.width = 16; c.height = 16;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, 16, 16);
        setUrl(c.toDataURL());
      };
      img.onerror = () => setUrl(null);
      img.src = reader.result;
    };
    reader.onerror = () => setUrl(null);
    reader.readAsDataURL(file);
    return () => { cancelled = true; };
  }, [file]);
  if (!url) {
    return (
      <div className="w-6 h-6 rounded border border-ink-700 bg-ink-900 grid place-items-center">
        <ImageIcon className="w-3 h-3 text-ink-500" />
      </div>
    );
  }
  return (
    <img
      src={url}
      width={24}
      height={24}
      alt=""
      className="rounded border border-ink-700 bg-ink-900"
      style={{ imageRendering: 'pixelated', width: 24, height: 24 }}
    />
  );
}

function AudioGlyph() {
  // Lightweight waveform-style glyph (no decode — Web Audio decode would
  // pull the whole file before upload and isn't worth the cost here).
  return (
    <div className="w-6 h-6 rounded border border-ink-700 bg-ink-900 grid place-items-center">
      <AudioLines className="w-3.5 h-3.5 text-ink-300" />
    </div>
  );
}

function SongGlyph() {
  return (
    <div className="w-6 h-6 rounded border border-ink-700 bg-ink-900 grid place-items-center">
      <FileMusic className="w-3.5 h-3.5 text-ink-300" />
    </div>
  );
}

function StatusGlyph({ status }) {
  if (!status) return null;
  if (status === 'ok') return <Check className="w-3 h-3 text-accent" title="imported" />;
  return <span className="text-[10px] text-red-400 truncate max-w-[10rem]" title={status}>{status}</span>;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
