import { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, Loader2, AlertTriangle, Package } from 'lucide-react';
import { api } from '../lib/api.js';

// Replaces the legacy single-asset download button. Fetches the project's
// GitHub releases via /api/projects/:id/releases (the backend resolves the
// repo + tags + assets via `gh` and returns a flat list with direct CDN
// URLs that bypass CF Access).
//
// Renders as: [ Download (vX.Y.Z) ▾ ]  opening a panel listing each release
// with tag / date / size / optional prerelease pill. Click a row → opens
// the asset in a new tab (download direct from github.com).
export default function ReleasesDropdown({ projectId }) {
  const [state, setState] = useState({ loading: true, releases: [], repo: null, err: null });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/api/projects/${projectId}/releases`);
        if (!alive) return;
        setState({ loading: false, releases: r.releases || [], repo: r.repo || null, err: null });
      } catch (e) {
        if (!alive) return;
        setState({ loading: false, releases: [], repo: null, err: e?.detail || e?.message || 'failed' });
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const latest = state.releases.find((r) => r.is_latest) || state.releases[0] || null;
  const label = state.loading ? 'releases'
    : latest ? `Download (${latest.tag})`
    : 'No releases';

  return (
    <div className="relative inline-flex" ref={wrapRef}>
      <button
        type="button"
        className="btn text-xs"
        onClick={() => setOpen((v) => !v)}
        disabled={state.loading}
        title={state.repo ? `releases for ${state.repo}` : 'releases'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {state.loading
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <Download className="w-3 h-3" />}
        <span className="truncate max-w-[140px]">{label}</span>
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full mt-1 w-[360px] max-h-[70vh] overflow-y-auto z-30 rounded border border-ink-700 bg-ink-900 shadow-xl"
          role="menu"
        >
          {state.err ? (
            <div className="p-3 text-xs text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">failed to load releases</div>
                <div className="text-ink-500 font-mono mt-1 break-all">{String(state.err)}</div>
              </div>
            </div>
          ) : state.releases.length === 0 ? (
            <div className="p-3 text-xs text-ink-400">
              <div className="font-medium text-ink-300 mb-1">No releases yet</div>
              <div>
                Push <span className="font-mono text-ink-200">pdx.zip</span>
                {state.repo ? <> to <span className="font-mono text-ink-200">{state.repo}</span></> : null}
                {' '}to publish a downloadable build.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-ink-800">
              {state.releases.map((rel) => (
                <ReleaseRow key={rel.tag} release={rel} onPick={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReleaseRow({ release, onPick }) {
  const assets = release.assets || [];
  const primary = assets[0] || null;
  const date = formatDate(release.published_at);
  const size = primary ? formatBytes(primary.size) : null;

  return (
    <li className="text-xs">
      {primary ? (
        <a
          href={primary.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onPick}
          className="flex items-start gap-2 px-3 py-2 hover:bg-ink-800 transition-colors"
          role="menuitem"
        >
          <Package className="w-3.5 h-3.5 mt-0.5 text-ink-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-ink-100 truncate">{release.tag}</span>
              {release.is_latest ? <span className="pill text-[10px]">latest</span> : null}
              {release.is_prerelease ? <span className="pill text-[10px] bg-amber-900/40 text-amber-300">pre</span> : null}
            </div>
            <div className="text-ink-500 mt-0.5 truncate">
              {release.name && release.name !== release.tag ? release.name : primary.name}
            </div>
            <div className="text-[10px] text-ink-600 font-mono mt-0.5">
              {date}{size ? <> · {size}</> : null}
            </div>
          </div>
        </a>
      ) : (
        <div className="px-3 py-2 text-ink-500">
          <div className="font-mono">{release.tag}</div>
          <div className="text-[10px] mt-0.5">no .pdx asset attached</div>
        </div>
      )}
    </li>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch (_e) { return ''; }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
