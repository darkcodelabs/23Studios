import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Image as ImageIcon, Loader2, Hammer, UploadCloud } from 'lucide-react';
import { api } from '../lib/api.js';

// ProjectGallery — Phase 4.5 Part 0 stub.
//
// Renders the per-asset gallery for a project. The real Patch A backend
// (/api/projects/:id/gallery) hasn't landed yet, so this component:
//   1. Tries /gallery first. If it returns an asset list, render the grid.
//   2. Falls back to /card_meta + /file/raw to surface whatever PNGs are
//      already on disk in <local_path>/sdk_data/{scenes,characters}/.
//   3. Empty state matches the Phase 4.5 spec copy.
//
// Phase 4.5 Patch C will replace the fallback path with the proper
// gallery_state.json-backed read.

function rawUrl(projectId, filePath) {
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(filePath)}`;
}

function AssetCard({ projectId, asset }) {
  const stateCls = {
    pending:      'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    approved:     'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    rejected:     'bg-red-500/15 text-red-300 ring-red-500/30',
    regenerating: 'bg-blue-500/15 text-blue-300 ring-blue-500/30'
  }[asset.state || 'pending'] || 'bg-ink-700 text-ink-300 ring-ink-600';

  const src = asset.imageUrl
    ? ((typeof window !== 'undefined' && window.__APP_BASE__) || '') + asset.imageUrl
    : rawUrl(projectId, asset._rawPath);

  return (
    <div className="rounded-lg ring-1 ring-ink-800 bg-ink-900 overflow-hidden flex flex-col">
      <div className="bg-ink-950 aspect-[5/3] flex items-center justify-center">
        {src ? (
          <img
            src={src}
            alt={asset.name}
            className="max-w-full max-h-full object-contain image-render-pixel"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <ImageIcon className="w-8 h-8 text-ink-700" />
        )}
      </div>
      <div className="px-3 py-2 border-t border-ink-800 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-100 truncate font-mono">{asset.name}</div>
          <div className="text-[10px] text-ink-500 uppercase tracking-wide">{asset.type}</div>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ring-1 ${stateCls}`}>
          {asset.state || 'pending'}
        </span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4 text-ink-400">
      <ImageIcon className="w-10 h-10 opacity-30" />
      <div className="space-y-1">
        <p className="text-ink-200 font-medium text-base">No assets generated yet</p>
        <p className="text-ink-500 text-sm max-w-md">
          Click Build .pdx to start the pipeline, or upload assets manually.
        </p>
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" className="btn text-xs" disabled title="run build from the header">
          <Hammer className="w-3 h-3" /> build .pdx
        </button>
        <button type="button" className="btn text-xs" disabled title="upload arrives in Patch D">
          <UploadCloud className="w-3 h-3" /> upload
        </button>
      </div>
    </div>
  );
}

// Walk card_meta to derive a best-effort asset list when /gallery 404s.
// We only have a count + title image; richer per-asset listing needs a
// directory enumeration endpoint, which Patch A will deliver. For now we
// surface the title image so the gallery is not completely blank.
function deriveFallbackAssets(meta) {
  if (!meta) return [];
  const out = [];
  if (meta.title_image_url) {
    out.push({
      id: 'launcher:card',
      type: 'launcher',
      name: 'card',
      imageUrl: meta.title_image_url,
      state: 'pending'
    });
  }
  return out;
}

export default function ProjectGallery() {
  const { id } = useParams();
  const [assets, setAssets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);

    (async () => {
      // Try the real gallery endpoint first (Patch A).
      try {
        const r = await api.get(`/api/projects/${id}/gallery`);
        if (!alive) return;
        if (r && Array.isArray(r.assets)) {
          setAssets(r.assets);
          setUsingFallback(false);
          setLoading(false);
          return;
        }
      } catch (_e) { /* fall through to fallback */ }

      // Fallback: derive from card_meta. Best-effort, gives the user
      // something to look at before Patch A lands.
      try {
        const meta = await api.get(`/api/projects/${id}/card_meta`);
        if (!alive) return;
        setAssets(deriveFallbackAssets(meta));
        setUsingFallback(true);
      } catch (e) {
        if (!alive) return;
        setErr(e?.detail || e?.message || 'failed to load gallery');
        setAssets([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-ink-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> loading gallery…
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6 text-sm text-red-300 bg-red-900/20 ring-1 ring-red-800/40 rounded m-4">
        {String(err)}
      </div>
    );
  }

  if (!assets || assets.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="p-4 space-y-3">
      {usingFallback ? (
        <p className="text-[11px] text-amber-400 font-mono">
          gallery backend not deployed — showing best-effort listing
        </p>
      ) : null}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {assets.map((a) => (
          <AssetCard key={a.id || `${a.type}:${a.name}`} projectId={id} asset={a} />
        ))}
      </div>
    </div>
  );
}
