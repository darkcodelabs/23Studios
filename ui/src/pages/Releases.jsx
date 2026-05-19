import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, Package, Tag, Calendar, File, Download, AlertTriangle,
  CheckCircle, RefreshCw, ChevronDown, ChevronRight
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

function fmtBytes(n) {
  if (!n || n <= 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_e) { return iso; }
}

function FileList({ files }) {
  if (!files || files.length === 0) return null;
  const kindColor = {
    pdx: 'text-accent',
    readme: 'text-sky-400',
    changelog: 'text-purple-400',
    license: 'text-yellow-400',
    build_script: 'text-green-400',
    screenshot: 'text-pink-400',
    presskit: 'text-orange-400',
    other: 'text-ink-400'
  };
  return (
    <ul className="mt-2 space-y-0.5">
      {files.map((f, i) => (
        <li key={i} className="flex items-center gap-2 text-[11px] font-mono">
          <File className={`w-3 h-3 flex-shrink-0 ${kindColor[f.kind] || kindColor.other}`} />
          <span className="text-ink-300 truncate flex-1" title={f.path || f.rel}>
            {f.rel || (f.path ? f.path.split('/').slice(-2).join('/') : '—')}
          </span>
          <span className="text-ink-500 whitespace-nowrap">{fmtBytes(f.bytes)}</span>
        </li>
      ))}
    </ul>
  );
}

function PackPanel({ projectId, tag }) {
  const [packing, setPacking] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);

  const doPack = useCallback(async () => {
    setPacking(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post(`/api/projects/${projectId}/releases/pack`, {
        tag,
        include_screenshots: true,
        force: true
      });
      setResult(r);
      setOpen(true);
    } catch (e) {
      setErr(e?.message || e?.detail || 'pack failed');
    } finally {
      setPacking(false);
    }
  }, [projectId, tag]);

  return (
    <div className="mt-2">
      {!result && (
        <button
          type="button"
          onClick={doPack}
          disabled={packing}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs border border-accent/30 disabled:opacity-50"
        >
          {packing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3 h-3" />}
          {packing ? 'Packaging…' : 'Pack release'}
        </button>
      )}
      {err && (
        <div className="mt-1.5 flex items-center gap-1.5 text-red-400 text-xs">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {err}
        </div>
      )}
      {result && (
        <div className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/10 p-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-emerald-300 text-xs w-full text-left"
          >
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1">Packaged {result.files?.length || 0} files → {result.release_dir?.split('/').slice(-2).join('/')}</span>
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {open && <FileList files={result.files} />}
        </div>
      )}
    </div>
  );
}

function ReleaseRow({ release, projectId }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-ink-800 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-ink-800/50 text-left"
      >
        <Tag className="w-3.5 h-3.5 text-ink-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink-100 font-mono">{release.tag}</span>
            {release.name && release.name !== release.tag && (
              <span className="text-xs text-ink-400 truncate">{release.name}</span>
            )}
            {release.is_latest && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase tracking-wide">latest</span>
            )}
            {release.is_prerelease && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 uppercase tracking-wide">pre-release</span>
            )}
          </div>
          {release.published_at && (
            <div className="flex items-center gap-1 mt-0.5 text-[11px] text-ink-500">
              <Calendar className="w-3 h-3" />
              {fmtDate(release.published_at)}
              {release.assets && release.assets.length > 0 && (
                <span className="ml-2">{release.assets.length} asset{release.assets.length !== 1 ? 's' : ''}</span>
              )}
            </div>
          )}
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-ink-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-ink-500 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {release.assets && release.assets.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Downloads</div>
              <div className="space-y-1">
                {release.assets.map((a, i) => (
                  <a
                    key={i}
                    href={a.url}
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-sky-400 hover:text-sky-300"
                  >
                    <Download className="w-3 h-3 flex-shrink-0" />
                    <span className="font-mono">{a.name}</span>
                    {a.size > 0 && <span className="text-ink-500">{fmtBytes(a.size)}</span>}
                  </a>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Local Release Package</div>
            <PackPanel projectId={projectId} tag={release.tag} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Releases() {
  const { id: projectId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [latestPack, setLatestPack] = useState(null);
  const [latestPackOpen, setLatestPackOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/releases`);
      setData(r);
    } catch (e) {
      setErr(e?.message || 'failed to load releases');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadLatestPack = useCallback(async () => {
    try {
      const r = await api.get(`/api/projects/${projectId}/releases/pack/latest`);
      setLatestPack(r);
    } catch (_e) {
      setLatestPack(null);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    loadLatestPack();
  }, [load, loadLatestPack]);

  const releases = (data && data.releases) || [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <Nav subtitle="Releases" />
      <div className="px-4 py-2 border-b border-ink-800 bg-ink-900 flex items-center gap-3 text-sm flex-wrap">
        <Link to={`/project/${projectId}`} className="text-ink-400 hover:text-ink-200">← project</Link>
        <span className="text-ink-500">·</span>
        {data?.repo && (
          <a
            href={`https://github.com/${data.repo}/releases`}
            rel="noopener noreferrer"
            className="text-ink-400 hover:text-ink-200 font-mono text-xs"
          >
            {data.repo}
          </a>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => { load(); loadLatestPack(); }}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs"
        >
          <RefreshCw className="w-3 h-3" /> refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Latest local pack summary */}
          {latestPack && (
            <div className="bg-ink-800 border border-ink-700 rounded-lg">
              <button
                type="button"
                onClick={() => setLatestPackOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 border-b border-ink-700 text-left"
              >
                <Package className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs text-ink-300 flex-1">Last local pack: <span className="font-mono text-ink-100">{latestPack.tag}</span></span>
                {latestPackOpen ? <ChevronDown className="w-3.5 h-3.5 text-ink-500" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-500" />}
              </button>
              {latestPackOpen && (
                <div className="px-3 py-2">
                  <FileList files={latestPack.files} />
                </div>
              )}
            </div>
          )}

          {/* GitHub releases */}
          <div className="bg-ink-800 border border-ink-700 rounded-lg">
            <div className="px-3 py-2 border-b border-ink-700 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-ink-400" />
              <span className="text-xs uppercase tracking-wide text-ink-400">
                GitHub releases
                {!loading && ` — ${releases.length}`}
              </span>
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-2 p-6 text-ink-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> loading…
              </div>
            )}

            {err && !loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{err}</span>
              </div>
            )}

            {!loading && !err && releases.length === 0 && (
              <div className="px-3 py-6 text-center text-ink-500 text-sm">
                No GitHub releases found.
                {!data?.repo && (
                  <div className="mt-1 text-[11px]">Add a GitHub repo URL to the project to see releases here.</div>
                )}
              </div>
            )}

            {!loading && releases.map((r) => (
              <ReleaseRow key={r.tag} release={r} projectId={projectId} />
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
