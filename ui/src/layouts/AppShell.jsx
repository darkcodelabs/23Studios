import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { derivedStatus, STATUS } from '../lib/projectStatus.js';

// AppShell — design pass 1.5.
//
// Top-level chrome for the studio home routes (Landing at "/" + "/dashboard",
// Library at "/library"). Mirrors the prototype shell in
// design_handoff_23_studios/app.jsx — 220px sidebar with a FLOW group
// (6 fixed flat items) + PROJECT group (list of all projects from
// /api/projects) + sticky daemon-telemetry footer + 52px topbar with
// breadcrumb on the left and status chips on the right.
//
// Note: ProjectShell.jsx is the project-scoped shell mounted at
// /projects/:id/* — different scope, different sidebar. AppShell does NOT
// replace it; the two co-exist.

// ----------------------------------------------------------------------------
// Brand mark
// ----------------------------------------------------------------------------

// Sidebar brand glyph. The PNG at /assets/studio-logo.png is the wired-glove
// mark; some browsers (and some proxy paths) intermittently fail to load
// it before React paints — the result was a broken-image placeholder in the
// 32×32 square. onError swaps in a CSS-rendered "23" wordmark so the slot
// never reads as broken. width/height + loading="eager" + decoding="async"
// keep layout stable while the bytes arrive.
function BrandLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        aria-label="23"
        className="font-mono"
        style={{
          width: '100%', height: '100%',
          display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: '-.02em',
          lineHeight: 1
        }}
      >
        23
      </span>
    );
  }
  return (
    <img
      src="assets/studio-logo.png?v=20260522b"
      alt="23"
      width={32}
      height={32}
      loading="eager"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}

// ----------------------------------------------------------------------------
// FLOW items — fixed 6-item flat nav per design
// ----------------------------------------------------------------------------

// Each entry resolves to a destination path. Some need an active project id;
// the resolver below substitutes <id> when one is available, or marks the
// item disabled when no project exists yet.
const FLOW_ITEMS = [
  { id: 'landing',   num: '01', label: 'Landing',      to: () => '/dashboard' },
  { id: 'building',  num: '02', label: 'Building',     to: (pid) => pid ? `/projects/${pid}/build/milestones` : null },
  { id: 'workspace', num: '03', label: 'Workspace',    to: (pid) => pid ? `/projects/${pid}/author/gallery` : null },
  { id: 'editor',    num: '04', label: 'Scene editor', to: (pid) => pid ? `/projects/${pid}/author/gallery` : null },
  { id: 'sideload',  num: '05', label: 'Sideload',     to: (pid) => pid ? `/projects/${pid}/release/ship` : null },
  { id: 'library',   num: '06', label: 'Library',      to: () => '/library' }
];

// Returns the FLOW item id that best matches the current pathname so we can
// paint the active rail correctly regardless of which project/route a user
// drilled into.
function pickActiveFlow(pathname) {
  if (!pathname) return 'landing';
  if (pathname === '/' || pathname.startsWith('/dashboard') || pathname.startsWith('/new')) return 'landing';
  if (pathname.startsWith('/library')) return 'library';
  // Project-scoped — /projects/:id/<section>/...
  const m = pathname.match(/^\/projects\/[^/]+\/([^/]+)(?:\/([^/]+))?/);
  if (m) {
    const section = m[1];
    const sub = m[2];
    if (section === 'build') return 'building';
    if (section === 'release') return 'sideload';
    if (section === 'author') {
      if (sub === 'gallery' && pathname.includes('/edit')) return 'editor';
      return 'workspace';
    }
  }
  return 'landing';
}

function FlowItem({ item, activeId, projectId, pill, onNavigate, collapsed }) {
  const target = item.to(projectId);
  const isActive = item.id === activeId;
  const disabled = !target;
  const navigate = useNavigate();

  const handleClick = (e) => {
    e.preventDefault();
    if (disabled) return;
    onNavigate?.();
    navigate(target);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={disabled ? 'no project yet — create one from Landing' : item.label}
      className="relative w-full flex items-center text-left"
      style={{
        appearance: 'none',
        border: 0,
        background: isActive ? 'var(--surface)' : 'transparent',
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        color: disabled ? 'var(--text-faint)' : isActive ? 'var(--text)' : 'var(--text-soft)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-ui)',
        gap: 10,
        opacity: disabled ? 0.55 : 1
      }}
      onMouseEnter={(e) => {
        if (disabled || isActive) return;
        e.currentTarget.style.background = 'var(--surface)';
        e.currentTarget.style.color = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        if (disabled || isActive) return;
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-soft)';
      }}
    >
      {isActive ? (
        <span
          aria-hidden
          className="absolute"
          style={{
            left: -18, top: 8, bottom: 8,
            width: 2, background: 'var(--accent)',
            borderRadius: '0 2px 2px 0'
          }}
        />
      ) : null}
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          width: 18,
          color: isActive ? 'var(--accent)' : 'var(--text-dim)'
        }}
      >
        {item.num}
      </span>
      {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
      {pill && !collapsed ? (
        <span
          className="font-mono uppercase"
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            letterSpacing: '.08em',
            padding: '2px 6px',
            borderRadius: 99,
            background: pill.tone === 'accent' ? 'var(--accent-soft)' : 'var(--surface-2)',
            color: pill.tone === 'accent' ? 'var(--accent)' : 'var(--text-muted)',
            border: pill.tone === 'accent'
              ? '1px solid var(--accent-dim)'
              : '1px solid var(--border)'
          }}
        >
          {pill.label}
        </span>
      ) : null}
    </button>
  );
}

// ----------------------------------------------------------------------------
// PROJECT list — every project from /api/projects, status pill, click → workspace
// ----------------------------------------------------------------------------

// Pill rendering keyed by the derivedStatus code (not project.status, which
// is always 'active' on the server side). Library card grid uses the same
// codes — see ui/src/lib/projectStatus.js.
const STATUS_PILL = {
  [STATUS.DRAFT]:    { label: 'draft',    tone: 'default' },
  [STATUS.BUILDING]: { label: 'building', tone: 'accent' },
  [STATUS.REVIEW]:   { label: 'review',   tone: 'accent' },
  [STATUS.BROKEN]:   { label: 'broken',   tone: 'danger' },
  [STATUS.SHIPPED]:  { label: 'shipped',  tone: 'ok' }
};

function ProjectRow({ project, status, activeProjectId, onNavigate, collapsed }) {
  const navigate = useNavigate();
  const pill = STATUS_PILL[status] || STATUS_PILL[STATUS.DRAFT];
  const isActive = activeProjectId && project.id === activeProjectId;

  const toneColor = pill.tone === 'accent' ? 'var(--accent)'
                  : pill.tone === 'ok'     ? 'var(--ok)'
                  : pill.tone === 'danger' ? 'var(--danger)'
                  : 'var(--text-muted)';
  const toneBg = pill.tone === 'accent' ? 'var(--accent-soft)'
                : pill.tone === 'ok'     ? 'oklch(74% 0.14 145 / .10)'
                : pill.tone === 'danger' ? 'oklch(64% 0.18 25 / .12)'
                : 'var(--surface-2)';
  const toneBd = pill.tone === 'accent' ? 'var(--accent-dim)'
                : pill.tone === 'ok'     ? 'oklch(50% 0.10 145)'
                : pill.tone === 'danger' ? 'oklch(50% 0.15 25)'
                : 'var(--border)';

  return (
    <button
      type="button"
      onClick={() => { onNavigate?.(); navigate(`/projects/${project.id}/author/gallery`); }}
      title={project.name}
      className="relative w-full flex items-center text-left"
      style={{
        appearance: 'none',
        border: 0,
        background: isActive ? 'var(--surface)' : 'transparent',
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        color: 'var(--text-soft)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        gap: 10
      }}
      onMouseEnter={(e) => {
        if (isActive) return;
        e.currentTarget.style.background = 'var(--surface)';
      }}
      onMouseLeave={(e) => {
        if (isActive) return;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          width: 18,
          color: 'var(--text-dim)',
          display: 'inline-block',
          textAlign: 'center'
        }}
        aria-hidden
      >
        {/* Filled small square as bullet — matches design's ▤ glyph */}
        ▤
      </span>
      {!collapsed ? <span className="flex-1 truncate" style={{ color: 'var(--text-soft)' }}>{project.name}</span> : null}
      {!collapsed ? (
        <span
          className="font-mono uppercase"
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            letterSpacing: '.08em',
            padding: '2px 6px',
            borderRadius: 99,
            color: toneColor,
            background: toneBg,
            border: `1px solid ${toneBd}`
          }}
        >
          {pill.label}
        </span>
      ) : null}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Telemetry footer — sticky bottom, mono 10px, hardcoded for now
// ----------------------------------------------------------------------------

function Telemetry() {
  return (
    <div
      className="mt-auto font-mono flex flex-col"
      style={{
        borderTop: '1px dashed var(--border)',
        padding: '12px 4px',
        gap: 6,
        fontSize: 10,
        color: 'var(--text-dim)'
      }}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center" style={{ gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--ok)',
              boxShadow: '0 0 6px oklch(74% 0.14 145 / .5)',
              display: 'inline-block'
            }}
          />
          23s daemon
        </span>
        <span>v2.1.4</span>
      </div>
      <div className="flex items-center justify-between">
        <span>device</span>
        <span>connected</span>
      </div>
      <div className="flex items-center justify-between">
        <span>build queue</span>
        <span>1 active</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sidebar — full assembly
// ----------------------------------------------------------------------------

function Sidebar({ projects, activeProjectId, activeFlow, flowPills, statusById, drawerOpen, onClose, collapsed, onToggleCollapse }) {
  return (
    <aside
      className={'shell-rail shrink-0 flex flex-col overflow-hidden sticky top-0 ' + (drawerOpen ? 'shell-drawer-open' : '')}
      style={{
        width: collapsed ? 56 : 220,
        transition: 'width .2s ease',
        height: '100vh',
        background: 'var(--bg-2)',
        borderRight: '1px solid var(--border)',
        padding: collapsed ? '18px 6px' : '18px 14px 18px 18px',
        gap: 4
      }}
    >
      {/* Brand row — when collapsed, the WHOLE row is the expand-trigger.
          Click anywhere on it to re-expand. The small chevron stays as a
          visual hint. */}
      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="shrink-0 flex flex-col items-center"
          style={{
            appearance: 'none',
            background: 'transparent',
            border: 0,
            padding: '6px 0 12px',
            borderBottom: '1px dashed var(--border)',
            marginBottom: 12,
            gap: 6,
            cursor: 'pointer',
            width: '100%'
          }}
        >
          <span
            className="shrink-0 relative overflow-hidden grid place-items-center shell-brand-mark"
            style={{
              width: 32, height: 32,
              borderRadius: 5,
              background: 'oklch(15% 0.01 75)',
              border: '1px solid var(--border-2)',
              pointerEvents: 'none'
            }}
          >
            <BrandLogo />
          </span>
          <span
            aria-hidden
            className="grid place-items-center font-mono"
            style={{
              width: 22, height: 18, borderRadius: 4,
              background: 'var(--surface)',
              border: '1px solid var(--border-2)',
              color: 'var(--accent)',
              fontSize: 13, lineHeight: 1, fontWeight: 600,
              pointerEvents: 'none'
            }}
          >›</span>
        </button>
      ) : (
        <div
          className="flex items-center"
          style={{
            gap: 10,
            padding: '6px 4px 18px',
            borderBottom: '1px dashed var(--border)',
            marginBottom: 14
          }}
        >
          <Link
            to="/dashboard"
            onClick={() => onClose?.()}
            className="shrink-0 relative overflow-hidden grid place-items-center shell-brand-mark"
            style={{
              width: 32, height: 32,
              borderRadius: 5,
              background: 'oklch(15% 0.01 75)',
              border: '1px solid var(--border-2)'
            }}
            title="23 Studios"
          >
            <BrandLogo />
          </Link>
          <div className="flex flex-col leading-tight">
            <b className="font-ui" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>23 STUDIOS</b>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>rev 1.0 · hakcers</span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="ml-auto shrink-0 grid place-items-center"
            style={{
              appearance: 'none', cursor: 'pointer',
              width: 22, height: 22, borderRadius: 4,
              background: 'var(--surface)',
              border: '1px solid var(--border-2)',
              color: 'var(--accent)', fontSize: 13, fontWeight: 600,
              lineHeight: 1
            }}
          >‹</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col" style={{ gap: 2 }}>
        {/* FLOW group */}
        {!collapsed ? (
          <div
            className="font-mono uppercase"
            style={{
              padding: '14px 4px 6px',
              fontSize: 10,
              letterSpacing: '.12em',
              color: 'var(--text-dim)'
            }}
          >
            flow
          </div>
        ) : <div style={{ height: 8 }} />}
        {FLOW_ITEMS.map((item) => (
          <FlowItem
            key={item.id}
            item={item}
            activeId={activeFlow}
            projectId={activeProjectId}
            pill={collapsed ? null : flowPills[item.id]}
            onNavigate={onClose}
            collapsed={collapsed}
          />
        ))}

        {/* PROJECT group */}
        {!collapsed ? (
          <div
            className="font-mono uppercase"
            style={{
              padding: '14px 4px 6px',
              fontSize: 10,
              letterSpacing: '.12em',
              color: 'var(--text-dim)'
            }}
          >
            project
          </div>
        ) : <div style={{ height: 12 }} />}
        {projects && projects.length > 0 ? (
          projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              status={statusById ? statusById[p.id] : STATUS.DRAFT}
              activeProjectId={activeProjectId}
              onNavigate={onClose}
              collapsed={collapsed}
            />
          ))
        ) : !collapsed ? (
          <div
            className="font-mono"
            style={{
              padding: '8px 10px',
              fontSize: 11,
              color: 'var(--text-dim)'
            }}
          >
            no projects yet
          </div>
        ) : null}
      </div>

      {!collapsed ? <Telemetry /> : null}
    </aside>
  );
}

// ----------------------------------------------------------------------------
// Topbar — 52px sticky, breadcrumb + status chips
// ----------------------------------------------------------------------------

function TopbarChip({ tone, children }) {
  const dotBg = tone === 'amber' ? 'var(--accent)' : 'var(--ok)';
  const dotGlow = tone === 'amber'
    ? '0 0 6px oklch(78% 0.13 75 / .5)'
    : '0 0 6px oklch(74% 0.14 145 / .5)';
  return (
    <span
      className="inline-flex items-center font-mono"
      style={{
        fontSize: 11,
        gap: 6,
        padding: '4px 10px',
        borderRadius: 99,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)'
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: dotBg, boxShadow: dotGlow,
          display: 'inline-block'
        }}
      />
      {children}
    </span>
  );
}

// Decide the breadcrumb trail from the pathname. AppShell only wraps
// /, /dashboard, /library — anything else is unreachable here but we still
// handle the project-scoped path defensively.
function deriveCrumbs(pathname, activeProject) {
  if (!pathname || pathname === '/' || pathname.startsWith('/dashboard') || pathname.startsWith('/new')) {
    return ['Studio', 'New project'];
  }
  if (pathname.startsWith('/library')) {
    return ['Studio', 'Library'];
  }
  if (activeProject) {
    return ['Studio', activeProject.name || 'Project'];
  }
  return ['Studio'];
}

function Topbar({ crumbs, seed, onToggleDrawer, drawerOpen }) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center"
      style={{
        height: 52,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        gap: 14
      }}
    >
      <button
        type="button"
        className="shell-hamburger"
        aria-label={drawerOpen ? 'close menu' : 'open menu'}
        onClick={onToggleDrawer}
      >
        {drawerOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </button>
      <nav className="flex items-center font-mono" style={{ fontSize: 11, gap: 8, color: 'var(--text-muted)' }}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="inline-flex items-center" style={{ gap: 8 }}>
              {last
                ? <b style={{ color: 'var(--text)', fontWeight: 500 }}>{c}</b>
                : <span>{c}</span>}
              {!last ? <span style={{ color: 'var(--text-faint)' }}>/</span> : null}
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center" style={{ gap: 14 }}>
        <ThemeSwitcher />
        <TopbarChip tone="ok">device ready</TopbarChip>
        <TopbarChip tone="amber">build queue: 1</TopbarChip>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {seed}
        </span>
      </div>
    </header>
  );
}

// ----------------------------------------------------------------------------
// Theme switcher — cycles document.documentElement.dataset.accent across
// amber → orange → phosphor → steel. Tokens.css owns the [data-accent="..."]
// overrides. Persisted to localStorage so the choice survives reloads.
// ----------------------------------------------------------------------------

const ACCENTS = ['amber', 'orange', 'phosphor', 'steel'];
const ACCENT_HUES = { amber: '78% 0.13 75', orange: '70% 0.18 45', phosphor: '82% 0.20 145', steel: '78% 0.04 240' };

function ThemeSwitcher() {
  const [accent, setAccent] = useState(() => {
    if (typeof localStorage === 'undefined') return 'amber';
    return localStorage.getItem('studio.accent') || 'amber';
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.accent = accent;
    try { localStorage.setItem('studio.accent', accent); } catch (_e) {}
  }, [accent]);

  const cycle = () => {
    const idx = ACCENTS.indexOf(accent);
    setAccent(ACCENTS[(idx + 1) % ACCENTS.length]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={`theme: ${accent} (click to cycle)`}
      aria-label="cycle accent theme"
      className="inline-flex items-center font-mono uppercase"
      style={{
        appearance: 'none', cursor: 'pointer',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--surface)',
        border: '1px solid var(--border-2)',
        borderRadius: 99,
        fontSize: 10,
        letterSpacing: '.08em',
        color: 'var(--text-muted)'
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8, height: 8, borderRadius: '50%',
          background: `oklch(${ACCENT_HUES[accent]})`,
          boxShadow: `0 0 6px oklch(${ACCENT_HUES[accent]} / .5)`
        }}
      />
      {accent}
    </button>
  );
}

// ----------------------------------------------------------------------------
// AppShell — main export
// ----------------------------------------------------------------------------

// Sort helper — pick the most recently updated project as the "active" one
// the FLOW destinations should resolve against. Falls back to created_at,
// then id, so deterministic when timestamps are missing.
function pickActiveProject(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const sorted = list.slice().sort((a, b) => {
    const ax = new Date(a.updated_at || a.created_at || 0).getTime();
    const bx = new Date(b.updated_at || b.created_at || 0).getTime();
    return bx - ax;
  });
  // Prefer hakcd-v2 by id/slug if present (matches design intent), otherwise
  // most-recent.
  const preferred = sorted.find((p) => p && (p.id === 'hakcd-v2' || p.slug === 'hakcd-v2'));
  return preferred || sorted[0];
}

export default function AppShell({ children }) {
  const location = useLocation();
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // statusById[projectId] = STATUS code, derived from autopilot + gallery +
  // card_meta. Repopulated on a 15s tick so sidebar pills track live state
  // (the slightly slower cadence vs Library's 10s avoids hammering the API
  // when both are mounted; the projectStatus cache absorbs the overlap).
  const [statusById, setStatusById] = useState({});
  // Mobile drawer — closed by default. Toggled by the topbar hamburger.
  // Auto-closes on route change so navigating doesn't strand the drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Sidebar collapse — persists across reloads via localStorage.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('studio.sidebarCollapsed') === '1';
  });
  useEffect(() => {
    try { localStorage.setItem('studio.sidebarCollapsed', collapsed ? '1' : '0'); } catch (_e) {}
  }, [collapsed]);

  useEffect(() => {
    let alive = true;
    api.get('/api/projects')
      .then((r) => {
        if (!alive) return;
        const list = Array.isArray(r && r.projects) ? r.projects
                   : Array.isArray(r) ? r
                   : [];
        setProjects(list);
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Resolve status for every project. Fans out the derivedStatus helper
  // (which is itself cached by id with a short TTL so this is cheap when
  // the Library page is also mounted). Refreshes on a 15s interval.
  useEffect(() => {
    if (!projects || projects.length === 0) { setStatusById({}); return undefined; }
    let alive = true;
    const refresh = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      // card_meta is fetched once per refresh so SHIPPED transitions catch.
      const entries = await Promise.all(projects.map(async (p) => {
        const meta = await api.get(`/api/projects/${p.id}/card_meta`).catch(() => null);
        const code = await derivedStatus(p, meta, { skipCache: true });
        return [p.id, code];
      }));
      if (!alive) return;
      const next = {};
      for (const [id, code] of entries) { next[id] = code; }
      setStatusById(next);
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [projects]);

  // Close the drawer whenever the route changes — clicking a nav item
  // should always dismiss the overlay on mobile.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  const activeProject = useMemo(() => pickActiveProject(projects), [projects]);
  const activeProjectId = activeProject ? activeProject.id : null;
  const activeFlow = useMemo(() => pickActiveFlow(location.pathname), [location.pathname]);
  const crumbs = useMemo(() => deriveCrumbs(location.pathname, activeProject), [location.pathname, activeProject]);

  // FLOW pills — Building shows "live" when an autopilot looks recent (we
  // proxy that as: has any project at all); Workspace shows total gallery
  // pending count (cheap placeholder: project count); Library shows total
  // project count. These will be wired to real telemetry in a follow-up.
  const flowPills = useMemo(() => ({
    building: activeProjectId ? { label: 'live', tone: 'accent' } : null,
    workspace: projects.length > 0 ? { label: String(projects.length), tone: 'default' } : null,
    library: projects.length > 0 ? { label: String(projects.length), tone: 'default' } : null
  }), [activeProjectId, projects.length]);

  // Seed string — pull from active project if it has one, else placeholder.
  const seed = (activeProject && (activeProject.seed || activeProject.build_seed)) || '0xR23-G23S';

  return (
    <div
      className="flex font-ui"
      style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }}
    >
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        activeFlow={activeFlow}
        flowPills={flowPills}
        statusById={statusById}
        drawerOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      {/* Backdrop only renders + is visible under the mobile breakpoint —
          .shell-backdrop is display:none above 1024px. Clicking it closes
          the drawer; tap-outside-to-dismiss is the expected mobile UX. */}
      {drawerOpen ? (
        <div
          className="shell-backdrop"
          aria-hidden
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <main className="flex-1 min-w-0 flex flex-col">
        <Topbar
          crumbs={crumbs}
          seed={seed}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
        />
        <div className="flex-1 min-h-0 overflow-auto" style={{ background: 'var(--bg)' }}>
          {/* When mounted as a layout route, children come via Outlet.
              When mounted as a wrapper, children come as JSX. Support both. */}
          {children ?? <Outlet />}
        </div>
      </main>
    </div>
  );
}

// Tiny exported helpers for tests — kept light because Vite doesn't run a
// test runner here.
export const __TEST__ = { pickActiveFlow, deriveCrumbs, pickActiveProject, FLOW_ITEMS };
