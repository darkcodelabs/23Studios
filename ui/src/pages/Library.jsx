import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, RefreshCw, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { decideStatus, pluralize, STATUS } from '../lib/projectStatus.js';

// Library — design pass 1.
//
// Replaces the original /dashboard for end users (Dashboard.jsx stays as a
// route alias). Fidelity reference: design_handoff_23_studios/screen-library.jsx
// and the .lib-* / .library CSS in styles.css.
//
// Layout:
//   - Header: H1 "Studio" + mono project/scene count + filter pills +
//     primary "+ new project" CTA (routes to /new)
//   - 3-col grid of cards backed by /api/projects, each enriched with
//     /api/projects/:id/card_meta (title_image_url, scene_count,
//     last_build_at, etc). Status badge top-right of cover.
//   - Dashed "+ New project" tile at end.
//   - Recent activity panel below — placeholder (TODO: wire SSE event bus).

const FILTERS = [
  { id: 'all',             label: 'all' },
  { id: 'draft',           label: 'draft' },
  { id: 'building',        label: 'building' },
  { id: 'awaiting_review', label: 'awaiting review' },
  { id: 'shipped',         label: 'shipped' },
  { id: 'broken',          label: 'broken' }
];

// Dot color per status (phase 4.9: stripped pill chrome → dot + muted lowercase).
const BADGE_DOTS = {
  DRAFT:    'var(--text-dim)',
  BUILDING: 'var(--accent)',
  REVIEW:   'var(--accent)',
  SHIPPED:  'var(--ok)',
  BROKEN:   'var(--danger)'
};

// Status badge resolution now lives in ui/src/lib/projectStatus.js so the
// AppShell sidebar pills and Library cards use the same decision tree.
// Library batches the autopilot + gallery probes per project (see `probes`
// state below) and feeds the snapshot into decideStatus per render.
function deriveStatusBadge(project, meta, probe) {
  return decideStatus({
    project,
    cardMeta: meta,
    autopilot: probe && probe.autopilot,
    gallery:   probe && probe.gallery
  });
}

// Map badge label → filter id for the pills.
function badgeToFilter(badge) {
  if (badge === 'DRAFT') return 'draft';
  if (badge === 'BUILDING') return 'building';
  if (badge === 'REVIEW') return 'awaiting_review';
  if (badge === 'SHIPPED') return 'shipped';
  if (badge === 'BROKEN') return 'broken';
  return 'draft';
}

function formatBuiltAt(ms) {
  if (!ms) return 'never built';
  const d = new Date(ms);
  const now = Date.now();
  const ago = now - ms;
  const min = Math.round(ago / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

function StatusBadge({ kind }) {
  const dot = BADGE_DOTS[kind] || BADGE_DOTS.DRAFT;
  const pulsing = kind === 'REVIEW';
  const label = (kind || 'draft').toLowerCase();
  return (
    <span
      className={'font-mono inline-flex items-center ' + (pulsing ? 'animate-pulse-accent' : '')}
      style={{
        position: 'absolute',
        top: 10, right: 10,
        zIndex: 2,
        fontSize: 11,
        color: 'var(--text-muted)',
        gap: 6
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dot
        }}
      />
      {label}
    </span>
  );
}

function GameCard({ project, meta, probe, onOpen }) {
  const badge = deriveStatusBadge(project, meta, probe);
  const cover = meta && meta.title_image_url ? meta.title_image_url : null;
  const sub = useMemo(() => {
    const parts = [];
    const desc = (project.description || '').trim();
    if (desc) parts.push(desc.split(/\s+/).slice(0, 2).join(' '));
    if (meta && meta.scene_count != null) parts.push(pluralize(meta.scene_count, 'scene'));
    parts.push((project.game_type || 'sdk').toLowerCase());
    return parts.join(' · ');
  }, [project, meta]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left flex flex-col overflow-hidden"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        padding: 0
      }}
    >
      {/* Cover */}
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: '16 / 10',
          background: 'oklch(85% 0.03 80)',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <StatusBadge kind={badge} />
        {cover ? (
          <img
            src={cover}
            alt={project.name}
            className="pixelated"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div
            className="absolute inset-0 grid place-items-center font-mono"
            style={{ color: 'var(--text-dim)', fontSize: 11, background: 'var(--bg-2)' }}
          >
            no cover yet
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col" style={{ padding: 14, gap: 8 }}>
        <div className="font-ui" style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-.005em', color: 'var(--text)' }}>
          {project.name || project.id}
        </div>
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
      </div>

      {/* Meta footer */}
      <div
        className="flex justify-between font-mono"
        style={{
          padding: '10px 14px',
          borderTop: '1px dashed var(--border)',
          fontSize: 11,
          color: 'var(--text-dim)'
        }}
      >
        <span>{formatBuiltAt(meta?.last_build_at)}</span>
        <span>{meta?.last_build_size ? `${Math.round(meta.last_build_size / 1024)} KB` : 'no build'}</span>
      </div>
    </button>
  );
}

function NewProjectTile({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid place-items-center"
      style={{
        background: 'transparent',
        border: '1px dashed var(--border-2)',
        borderRadius: 'var(--radius)',
        minHeight: 280,
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-dim)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-2)'; }}
    >
      <div className="flex flex-col items-center" style={{ gap: 8, padding: 24 }}>
        <div
          className="font-mono"
          style={{ fontSize: 28, color: 'var(--accent)', fontWeight: 300, lineHeight: 1 }}
        >
          +
        </div>
        <div className="font-ui" style={{ fontWeight: 500, color: 'var(--text)' }}>New project</div>
        <p
          className="font-mono"
          style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}
        >
          Describe a game. Sideload by sundown.
        </p>
      </div>
    </button>
  );
}

function ActivityPanel() {
  // Placeholder activity until SSE event bus surface lands.
  // Spec says "fetched from existing activity endpoint if exists, otherwise
  // placeholder" — there is no such endpoint today.
  const rows = [
    { t: '—', a: '—', d: 'no recent activity yet', lvl: 'dim' }
  ];
  return (
    <div
      className="mt-7"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)'
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
        recent activity
      </div>
      <div style={{ padding: 0 }}>
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-center"
            style={{
              padding: '10px 16px',
              gap: 14,
              borderTop: i === 0 ? 0 : '1px solid var(--border)'
            }}
          >
            <span
              className="font-mono"
              style={{ width: 90, color: 'var(--text-dim)', fontSize: 11 }}
            >
              {row.t}
            </span>
            <span
              className="font-mono"
              style={{
                color: 'var(--text-muted)',
                fontSize: 10,
                letterSpacing: '.06em',
                textTransform: 'uppercase'
              }}
            >
              {row.lvl}
            </span>
            <span style={{ fontWeight: 500, color: 'var(--text)' }}>{row.a}</span>
            <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {row.d}
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }} className="font-mono">→</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [metaById, setMetaById] = useState({});
  // probes[id] = { autopilot, gallery } — keyed by project id, refreshed by
  // the polling effect below. Decoupled from metaById so the cover image
  // doesn't repaint every 10s.
  const [probesById, setProbesById] = useState({});

  // No body bg override anymore — AppShell paints the page background.
  // Library used to mount full-bleed at /dashboard and would smash the body
  // bg to var(--bg); now it lives inside AppShell's content area so the
  // shell handles colors. Keeping the effect here would double-paint and
  // bleed into other AppShell-wrapped routes after unmount.

  // Fan out card_meta + the two status probes (autopilot, gallery) for every
  // project. Probes have to refresh on a tick because hakcd-v3 is generating
  // PNGs live — scene_count crawls upward, awaiting_review enters/leaves —
  // and the user would see stale "0 scenes / DRAFT" without polling.
  const fetchProbes = useCallback(async (list) => {
    const entries = await Promise.all(list.map(async (p) => {
      const [autopilot, gallery] = await Promise.all([
        api.get(`/api/projects/${p.id}/sdk/autopilot/status`).catch(() => null),
        api.get(`/api/projects/${p.id}/gallery`).catch(() => null)
      ]);
      return [p.id, { autopilot, gallery }];
    }));
    const next = {};
    for (const [id, payload] of entries) { next[id] = payload; }
    return next;
  }, []);

  const fetchMetas = useCallback(async (list) => {
    const pairs = await Promise.all(list.map(async (p) => {
      try {
        const m = await api.get(`/api/projects/${p.id}/card_meta`);
        return [p.id, m];
      } catch (_e) {
        return [p.id, null];
      }
    }));
    const next = {};
    for (const [id, m] of pairs) { if (m) next[id] = m; }
    return next;
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get('/api/projects');
      const list = (r && r.projects) || [];
      setProjects(list);
      const [metas, probes] = await Promise.all([
        fetchMetas(list),
        fetchProbes(list)
      ]);
      setMetaById(metas);
      setProbesById(probes);
    } catch (_e) {
      setErr('failed to load projects');
    }
  }, [fetchMetas, fetchProbes]);

  useEffect(() => { load(); }, [load]);

  // Live refresh — every 10s re-pull card_meta (scene_count grows as PNGs
  // land) and the autopilot+gallery probes (badge transitions BUILDING →
  // REVIEW → SHIPPED in real time). Bail when no projects yet; no-op when
  // the tab is hidden so we don't burn API on a backgrounded tab.
  useEffect(() => {
    if (!projects || projects.length === 0) return undefined;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const [metas, probes] = await Promise.all([
          fetchMetas(projects),
          fetchProbes(projects)
        ]);
        setMetaById(metas);
        setProbesById(probes);
      } catch (_e) { /* keep last good snapshot */ }
    };
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [projects, fetchMetas, fetchProbes]);

  const filtered = useMemo(() => {
    if (!projects) return null;
    if (filter === 'all') return projects;
    return projects.filter((p) =>
      badgeToFilter(deriveStatusBadge(p, metaById[p.id], probesById[p.id])) === filter
    );
  }, [projects, metaById, probesById, filter]);

  const totalScenes = useMemo(() => {
    if (!projects) return 0;
    return projects.reduce((acc, p) => acc + (metaById[p.id]?.scene_count || 0), 0);
  }, [projects, metaById]);

  const goNew = () => navigate('/new');
  const openProject = (p) => navigate(`/projects/${p.id}/author/gallery`);

  return (
    <div
      className="font-ui"
      style={{ color: 'var(--text)' }}
    >
      <div className="lib-pad" style={{ padding: '24px 32px 56px' }}>
        {/* ─── Header ─── */}
        <div className="lib-header flex flex-wrap items-center" style={{ gap: 14, marginBottom: 24 }}>
          <h1
            className="font-ui"
            style={{ margin: 0, fontSize: 26, fontWeight: 500, letterSpacing: '-.02em', color: 'var(--text)' }}
          >
            Studio
          </h1>
          <span
            className="font-mono"
            style={{ fontSize: 12, color: 'var(--text-dim)' }}
          >
            {projects ? `${pluralize(projects.length, 'project')} · ${pluralize(totalScenes, 'scene')}` : 'loading…'}
          </span>

          <div className="lib-filter-pills flex" style={{ marginLeft: 'auto', gap: 6 }}>
            {FILTERS.map((f) => {
              const active = f.id === filter;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className="font-mono uppercase"
                  style={{
                    appearance: 'none',
                    border: '1px solid var(--border-2)',
                    background: active ? 'var(--accent-soft)' : 'var(--surface)',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    borderColor: active ? 'var(--accent-dim)' : 'var(--border-2)',
                    padding: '6px 12px',
                    borderRadius: 99,
                    fontSize: 11,
                    letterSpacing: '.06em',
                    cursor: 'pointer'
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => load()}
            title="refresh"
            className="grid place-items-center"
            style={{
              width: 30, height: 30,
              background: 'transparent',
              border: '1px solid var(--border-2)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)',
              cursor: 'pointer'
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={goNew}
            className="font-ui inline-flex items-center"
            style={{
              marginLeft: 4,
              background: 'var(--accent)',
              color: 'var(--accent-ink)',
              border: '1px solid var(--accent)',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              fontWeight: 600,
              gap: 8,
              cursor: 'pointer'
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            new project
          </button>
        </div>

        {err ? (
          <div
            className="font-mono"
            style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 14 }}
          >
            {err}
          </div>
        ) : null}

        {/* ─── Grid ─── */}
        {projects === null ? (
          <div className="flex items-center gap-2 font-mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 className="w-4 h-4 animate-spin" /> loading…
          </div>
        ) : (
          <div className="lib-grid grid" style={{ gap: 18 }}>
            {(filtered || []).map((p) => (
              <GameCard
                key={p.id}
                project={p}
                meta={metaById[p.id]}
                probe={probesById[p.id]}
                onOpen={() => openProject(p)}
              />
            ))}
            <NewProjectTile onClick={goNew} />
          </div>
        )}

        {projects && projects.length > 0 && filtered && filtered.length === 0 ? (
          <div
            className="mt-4 font-mono"
            style={{ color: 'var(--text-dim)', fontSize: 12 }}
          >
            No projects match this filter.
          </div>
        ) : null}

        {/* ─── Recent activity ─── */}
        <ActivityPanel />
      </div>
    </div>
  );
}

// Pure helper exports for ad-hoc test runs (Vite has no test runner here).
export const __TEST__ = { deriveStatusBadge, badgeToFilter, formatBuiltAt, STATUS };
