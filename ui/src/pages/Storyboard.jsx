import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  RefreshCw, Loader2, AlertTriangle, Search, Filter as FilterIcon,
  Image as ImageIcon, Layers, BookOpen
} from 'lucide-react';
import LinkedDocPane from '../components/LinkedDocPane.jsx';
import { api } from '../lib/api.js';

// Phase 6 B1 — Storyboard.
// Reads /api/projects/:id/storyboard, renders a card grid. Clicking a card
// routes to the per-scene drilldown (B2).

const STATUS_STYLES = {
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  in_progress: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pending: 'bg-ink-700 text-ink-400 border-ink-600',
  failed: 'bg-red-500/15 text-red-300 border-red-500/30'
};

function rawAssetUrl(projectId, relPath) {
  if (!relPath) return null;
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

function StatusPill({ status }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function SceneCard({ projectId, scene, onClick }) {
  const thumb = rawAssetUrl(projectId, scene.thumbnail_path);
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-ink-800 hover:bg-ink-700 border border-ink-700 hover:border-ink-500 rounded-lg overflow-hidden flex flex-col transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      <div className="aspect-[5/3] bg-ink-900 border-b border-ink-700 relative flex items-center justify-center text-ink-500">
        {thumb ? (
          <img
            src={thumb}
            alt={scene.title}
            className="absolute inset-0 w-full h-full object-cover image-render-pixel"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <ImageIcon className="w-6 h-6 opacity-40" />
        )}
        <div className="absolute top-1 right-1">
          <StatusPill status={scene.status} />
        </div>
      </div>
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        <div className="text-[10px] text-ink-500 font-mono truncate">{scene.scene_id}</div>
        <div className="text-sm text-ink-100 truncate" title={scene.title}>{scene.title}</div>
        {scene.summary ? (
          <div className="text-xs text-ink-400 line-clamp-2">{scene.summary}</div>
        ) : null}
        <div className="mt-auto pt-1 flex flex-wrap gap-1 text-[10px]">
          {scene.mechanic ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
              {scene.mechanic}
            </span>
          ) : null}
          {(scene.characters_present || []).slice(0, 3).map((c) => (
            <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded bg-ink-700 text-ink-300 border border-ink-600">
              {c}
            </span>
          ))}
          {(scene.characters_present || []).length > 3 ? (
            <span className="text-ink-500">+{scene.characters_present.length - 3}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function Storyboard() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [board, setBoard] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [characterFilter, setCharacterFilter] = useState('all');
  const [mechanicFilter, setMechanicFilter] = useState('all');
  const [docPaneOpen, setDocPaneOpen] = useState(false);
  const [focusedScene, setFocusedScene] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/storyboard`);
      setBoard(r);
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const scenes = board?.scenes || [];

  const { characters, mechanics } = useMemo(() => {
    const cset = new Set();
    const mset = new Set();
    for (const s of scenes) {
      for (const c of (s.characters_present || [])) cset.add(c);
      if (s.mechanic) mset.add(s.mechanic);
    }
    return {
      characters: Array.from(cset).sort(),
      mechanics: Array.from(mset).sort()
    };
  }, [scenes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scenes.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (characterFilter !== 'all' && !(s.characters_present || []).includes(characterFilter)) return false;
      if (mechanicFilter !== 'all' && s.mechanic !== mechanicFilter) return false;
      if (q) {
        const hay = `${s.scene_id} ${s.title} ${s.summary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scenes, search, statusFilter, characterFilter, mechanicFilter]);

  const counts = board?.counts?.by_status || {};

  return (
    <div className="flex flex-col bg-ink-900 text-ink-100">
      <div className="border-b border-ink-800 px-3 py-2 flex items-center gap-2 flex-wrap">
        <Link
          to={`/project/${id}`}
          className="text-xs text-ink-400 hover:text-ink-200"
        >
          ← back to project
        </Link>

        <div className="ml-2 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search scene id, title, summary"
            className="pl-7 pr-2 py-1 text-xs bg-ink-800 border border-ink-700 rounded text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-accent w-72"
          />
        </div>

        <div className="flex items-center gap-1 text-xs">
          <FilterIcon className="w-3.5 h-3.5 text-ink-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-ink-800 border border-ink-700 rounded px-1.5 py-1 text-xs"
            aria-label="status filter"
          >
            <option value="all">all status</option>
            <option value="pending">pending</option>
            <option value="in_progress">in progress</option>
            <option value="done">done</option>
            <option value="failed">failed</option>
          </select>
          <select
            value={characterFilter}
            onChange={(e) => setCharacterFilter(e.target.value)}
            className="bg-ink-800 border border-ink-700 rounded px-1.5 py-1 text-xs"
            aria-label="character filter"
          >
            <option value="all">all characters</option>
            {characters.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={mechanicFilter}
            onChange={(e) => setMechanicFilter(e.target.value)}
            className="bg-ink-800 border border-ink-700 rounded px-1.5 py-1 text-xs"
            aria-label="mechanic filter"
          >
            <option value="all">all mechanics</option>
            {mechanics.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <button
          type="button"
          onClick={load}
          className="btn-icon ml-1"
          title="refresh"
          aria-label="refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>

        <div className="ml-auto text-xs text-ink-400 flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> {filtered.length} / {scenes.length}</span>
          <span><span className="text-emerald-300">{counts.done || 0}</span> done</span>
          <span><span className="text-amber-300">{counts.in_progress || 0}</span> in progress</span>
          <span><span className="text-ink-300">{counts.pending || 0}</span> pending</span>
          {counts.failed ? <span><span className="text-red-300">{counts.failed}</span> failed</span> : null}
          <button
            type="button"
            onClick={() => setDocPaneOpen((v) => !v)}
            className={
              'inline-flex items-center gap-1 px-2 py-1 rounded text-xs ' +
              (docPaneOpen ? 'bg-ink-700 text-ink-100' : 'bg-ink-800 hover:bg-ink-700 text-ink-200')
            }
            title="toggle linked-doc pane (bible / canon / SKILL.md)"
          >
            <BookOpen className="w-3 h-3" /> docs
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 overflow-auto p-3">
        {loading && !board ? (
          <div className="h-full flex items-center justify-center text-ink-400 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> loading scenes…
          </div>
        ) : err ? (
          <div className="text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {err?.detail || err?.message || 'failed to load storyboard'}
          </div>
        ) : scenes.length === 0 ? (
          <div className="text-ink-500 text-sm">
            No scenes yet. Run the SDK autopilot or drop Lua scenes into <code className="text-ink-300">source/scenes/</code>.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-ink-500 text-sm">No scenes match the current filters.</div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
          >
            {filtered.map((s) => (
              <SceneCard
                key={s.scene_id}
                projectId={id}
                scene={s}
                onClick={() => {
                  setFocusedScene(s);
                  navigate(`/project/${id}/scenes/${encodeURIComponent(s.scene_id)}`);
                }}
              />
            ))}
          </div>
        )}
        </div>
        {docPaneOpen && (
          <div className="w-[28rem] flex-shrink-0 min-h-0">
            <LinkedDocPane
              projectId={id}
              sceneId={focusedScene?.scene_id || null}
              sceneTitle={focusedScene?.title || null}
              onCloseDock={() => setDocPaneOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
