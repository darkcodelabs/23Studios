import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  Pencil, Hammer, PlayCircle, Rocket, MoreHorizontal,
  ChevronDown, FileText, BookOpen, Image as ImageIcon,
  Film, FolderOpen, Boxes, Milestone, ClipboardCheck,
  ShieldCheck, Gauge, Bug, Send, History, Lock,
  Menu, X as XIcon, Loader2, AlertTriangle, Download,
  Settings, Trash2, Upload as UploadIcon, ToggleLeft
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import GateBanner from '../components/GateBanner.jsx';
import ReleasesDropdown from '../components/ReleasesDropdown.jsx';
import GameTypeToggle from '../components/GameTypeToggle.jsx';
import { api } from '../lib/api.js';

// ProjectShell — Phase 4.5 Part 0.
//
// Owns the chrome that wraps every project surface:
//   * top header: logo (via <Nav/>), breadcrumb, status badge, 5 action
//     buttons (Edit / Build .pdx / Download / Simulator / Ship), overflow menu
//   * left sidebar: 4 grouped sections (AUTHOR / BUILD / REVIEW / RELEASE)
//     with badges sourced from existing endpoints
//   * footer with cost roll-up
//   * <Outlet /> renders the active nested route
//
// The shell exists so per-stage pages can be plain content components —
// they no longer have to render their own Nav / build bar / siderail.

const STATUS_STYLES = {
  active:    { label: 'ACTIVE',   cls: 'bg-accent/15 text-accent ring-accent/30' },
  building:  { label: 'BUILDING', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  broken:    { label: 'BROKEN',   cls: 'bg-red-500/15 text-red-300 ring-red-500/30' },
  shipped:   { label: 'SHIPPED',  cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' }
};

function StatusBadge({ status }) {
  const key = (status || 'active').toLowerCase();
  const meta = STATUS_STYLES[key] || STATUS_STYLES.active;
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-mono ring-1 ${meta.cls}`}
      title={`project status: ${meta.label.toLowerCase()}`}
    >
      {meta.label}
    </span>
  );
}

// Sidebar group definition. Items are NavLinks against the nested router.
const SIDEBAR_GROUPS = [
  {
    label: 'AUTHOR',
    items: [
      { path: 'author/brief',      label: 'Brief',      icon: FileText },
      { path: 'author/bible',      label: 'Bible',      icon: BookOpen },
      { path: 'author/storyboard', label: 'Storyboard', icon: Film },
      { path: 'author/gallery',    label: 'Gallery',    icon: ImageIcon, badgeKey: 'gallery' },
      { path: 'author/references', label: 'References', icon: Boxes,     badgeKey: 'references' }
    ]
  },
  {
    label: 'BUILD',
    items: [
      { path: 'build/files',        label: 'Files',        icon: FolderOpen },
      { path: 'build/architecture', label: 'Architecture', icon: Boxes },
      { path: 'build/milestones',   label: 'Milestones',   icon: Milestone },
      { path: 'build/simulator',    label: 'Simulator',    icon: PlayCircle }
    ]
  },
  {
    label: 'REVIEW',
    items: [
      { path: 'review/board',  label: 'Board',          icon: ClipboardCheck, badgeKey: 'board' },
      { path: 'review/design', label: 'Design Validate', icon: ShieldCheck },
      { path: 'review/perf',   label: 'Perf Audit',     icon: Gauge },
      { path: 'review/qa',     label: 'QA Critic',      icon: Bug }
    ]
  },
  {
    label: 'RELEASE',
    items: [
      { path: 'release/ship',    label: 'Ship',     icon: Send },
      { path: 'release/history', label: 'History',  icon: History },
      { path: 'release/mvp',     label: 'MVP Lock', icon: Lock }
    ]
  }
];

function SidebarItem({ to, label, icon: Icon, badge }) {
  return (
    <NavLink
      to={to}
      end={false}
      className={({ isActive }) =>
        'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors group ' +
        (isActive
          ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
          : 'text-ink-300 hover:bg-ink-800/60 hover:text-ink-100')
      }
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 ? (
        <span className="min-w-[18px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-black text-[10px] font-bold leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function Sidebar({ projectId, badges, onItemClick }) {
  return (
    <nav className="w-56 shrink-0 border-r border-ink-800 bg-ink-950 overflow-y-auto py-3 px-2 flex flex-col gap-4">
      {SIDEBAR_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-3 mb-1 text-[10px] tracking-[0.15em] text-ink-500 font-mono uppercase">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5" onClick={onItemClick}>
            {group.items.map((it) => (
              <SidebarItem
                key={it.path}
                to={`/projects/${projectId}/${it.path}`}
                label={it.label}
                icon={it.icon}
                badge={it.badgeKey ? badges[it.badgeKey] : 0}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ----------------------------------------------------------------------------
// Header action buttons
// ----------------------------------------------------------------------------

function EditButton({ projectId }) {
  return (
    <Link
      to={`/project/${projectId}/sdk/edit`}
      className="btn text-xs"
      title="edit scenes, characters, prompts"
    >
      <Pencil className="w-3 h-3" /> edit
    </Link>
  );
}

function BuildButton({ projectId, onStarted }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function doExport() {
    setBusy(true);
    setMsg('starting pdc…');
    try {
      const r = await api.post(`/api/projects/${projectId}/sdk/export`, {});
      const status = r && r.status_url;
      if (!status) {
        setMsg('build kicked');
        return;
      }
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          const s = await api.get(status);
          if (s.status === 'done')   { setMsg('built');  break; }
          if (s.status === 'failed') { setMsg('failed'); break; }
          setMsg('building…');
        } catch (_e) { /* keep polling */ }
      }
      onStarted && onStarted();
    } catch (e) {
      setMsg('error: ' + (e?.detail || e?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn text-xs" onClick={doExport} disabled={busy}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hammer className="w-3 h-3" />}
        {busy ? 'building' : 'build .pdx'}
      </button>
      {msg ? (
        <span className="text-ink-500 truncate max-w-[140px] text-xs font-mono">{msg}</span>
      ) : null}
    </>
  );
}

function SimulatorButton({ projectId, disabled, disabledReason }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="btn text-xs"
      onClick={() => navigate(`/projects/${projectId}/build/simulator`)}
      disabled={disabled}
      title={disabled ? disabledReason : 'open simulator'}
    >
      <PlayCircle className="w-3 h-3" /> simulator
    </button>
  );
}

function ShipHeaderButton({ projectId, disabled, disabledReason }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs disabled:opacity-50"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledReason : 'open ship flow'}
      >
        <Rocket className="w-3 h-3" /> ship
      </button>
      {open ? (
        <ShipPlaceholderModal
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            navigate(`/projects/${projectId}/release/ship`);
          }}
        />
      ) : null}
    </>
  );
}

function ShipPlaceholderModal({ onClose, onConfirm }) {
  // Lightweight confirmation placeholder. Full pre-flight + SSE handoff lives
  // on the dedicated /release/ship page (ShipStatus.jsx). We just route there.
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-ink-900 ring-1 ring-ink-700 rounded-lg w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ink-800 flex items-center gap-2">
          <Rocket className="w-4 h-4 text-accent" />
          <span className="text-sm text-ink-100">Ship release</span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="text-ink-500 hover:text-ink-200">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm text-ink-300">
          <p>This opens the dedicated ship workflow. Pre-flight gates (lint, drift, approvals) run there.</p>
          <p className="text-xs text-ink-500">TODO — full inline pre-flight ships in a follow-up patch.</p>
        </div>
        <div className="px-4 py-3 border-t border-ink-800 flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs">
            cancel
          </button>
          <button type="button" onClick={onConfirm}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs flex items-center gap-1.5">
            <Rocket className="w-3 h-3" /> open ship page
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Overflow menu — settings, delete, export, sdk/pulp toggle
// ----------------------------------------------------------------------------

function OverflowMenu({ project, onProjectChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

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

  return (
    <div className="relative inline-flex" ref={wrapRef}>
      <button
        type="button"
        className="btn-icon"
        onClick={() => setOpen((v) => !v)}
        title="more"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full mt-1 w-64 z-40 rounded ring-1 ring-ink-700 bg-ink-900 shadow-xl p-1 text-xs"
          role="menu"
        >
          <MenuRow icon={Settings} label="Project settings" disabled note="TODO" />
          <MenuRow icon={UploadIcon} label="Export project state" disabled note="TODO" />
          <div className="px-3 py-2 flex items-center gap-2">
            <ToggleLeft className="w-3.5 h-3.5 text-ink-400" />
            <span className="flex-1 text-ink-200">Game type</span>
            <GameTypeToggle project={project} onChange={onProjectChange} />
          </div>
          <div className="my-1 border-t border-ink-800" />
          <MenuRow icon={Trash2} label="Delete project" danger disabled note="TODO" />
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({ icon: Icon, label, danger, disabled, note, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'w-full flex items-center gap-2 px-3 py-1.5 rounded text-left ' +
        (disabled ? 'opacity-50 cursor-not-allowed ' : 'hover:bg-ink-800 ') +
        (danger ? 'text-red-300' : 'text-ink-200')
      }
      role="menuitem"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="flex-1">{label}</span>
      {note ? <span className="text-[10px] text-ink-500 font-mono">{note}</span> : null}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Footer — cost roll-up
// ----------------------------------------------------------------------------

function CostFooter({ projectId }) {
  const [cost, setCost] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/api/projects/${projectId}/cost`)
      .then((r) => {
        if (!alive) return;
        const usd = r && (r.total_cost_usd != null ? r.total_cost_usd : (r.summary && r.summary.total_cost_usd));
        setCost(typeof usd === 'number' ? usd : null);
      })
      .catch(() => { /* silent — footer is non-critical */ });
    return () => { alive = false; };
  }, [projectId]);

  return (
    <div className="h-7 border-t border-ink-800 bg-ink-950 px-3 flex items-center text-[10px] font-mono text-ink-500 gap-3">
      <span>cost</span>
      <span className="text-ink-300">
        {cost == null ? '—' : `$${cost.toFixed(3)}`}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main shell
// ----------------------------------------------------------------------------

export default function ProjectShell() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [err, setErr] = useState(null);
  const [meta, setMeta] = useState(null);
  const [badges, setBadges] = useState({ gallery: 0, references: 0, board: 0 });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Project record
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/api/projects/${id}`);
        if (alive) setProject(r.project);
      } catch (e) {
        if (alive) setErr(e && e.status === 404 ? 'not_found' : 'failed');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // Card meta — gives us last_build_at to gate Ship + Simulator
  useEffect(() => {
    let alive = true;
    api.get(`/api/projects/${id}/card_meta`)
      .then((r) => { if (alive) setMeta(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Badge counts — fire-and-forget; missing endpoints render 0 silently.
  const refreshBadges = useCallback(() => {
    let alive = true;
    // Gallery: count pending. /api/projects/:id/gallery is the Phase 4.5
    // Patch A endpoint and may not exist yet — swallow 404.
    api.get(`/api/projects/${id}/gallery`)
      .then((r) => {
        if (!alive) return;
        const pending = Array.isArray(r && r.assets)
          ? r.assets.filter((a) => a && a.state === 'pending').length
          : 0;
        setBadges((b) => ({ ...b, gallery: pending }));
      })
      .catch(() => { /* endpoint may not exist yet */ });

    // References: count from /references items[]
    api.get(`/api/projects/${id}/references`)
      .then((r) => {
        if (!alive) return;
        const count = Array.isArray(r && r.items) ? r.items.length : 0;
        setBadges((b) => ({ ...b, references: count }));
      })
      .catch(() => { /* silent */ });

    // Review board: counts.pending
    api.get(`/api/projects/${id}/review`)
      .then((r) => {
        if (!alive) return;
        const pending = r && r.counts && typeof r.counts.pending === 'number'
          ? r.counts.pending : 0;
        setBadges((b) => ({ ...b, board: pending }));
      })
      .catch(() => { /* silent */ });

    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const cleanup = refreshBadges();
    return cleanup;
  }, [refreshBadges]);

  if (err === 'not_found') {
    return (
      <div className="h-screen flex items-center justify-center bg-ink-900 text-ink-300 text-sm">
        Project not found. <Link to="/dashboard" className="ml-2 underline">dashboard</Link>
      </div>
    );
  }

  const hasBuild = meta && meta.last_build_at != null;
  const shipDisabled = !hasBuild;
  const shipReason = shipDisabled ? 'no build exists — run build .pdx first' : null;
  const simDisabled = !hasBuild;
  const simReason = simDisabled ? 'no build exists yet' : null;

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={project?.name || id} />

      {/* Project gate banner — empty/free when no gate is active */}
      <GateBanner />

      {/* Action strip: status + 5 actions + overflow */}
      <div className="bg-ink-900 border-b border-ink-800">
        <div className="px-3 h-10 flex items-center gap-2">
          <button
            type="button"
            className="btn-icon lg:hidden"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="toggle sidebar"
            title="toggle sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
          <StatusBadge status={project?.status} />
          <div className="flex-1 hidden md:flex items-center gap-2 text-xs text-ink-500 font-mono truncate">
            {meta && meta.version ? <span>v{meta.version}</span> : null}
            {meta && meta.scene_count != null ? <span>· {meta.scene_count} scenes</span> : null}
            {meta && meta.character_count != null ? <span>· {meta.character_count} chars</span> : null}
          </div>

          {/* Action cluster — collapses to overflow on narrow viewports */}
          <div className="hidden md:flex items-center gap-1">
            <EditButton projectId={id} />
            <BuildButton projectId={id} onStarted={refreshBadges} />
            <ReleasesDropdown projectId={id} />
            <SimulatorButton projectId={id} disabled={simDisabled} disabledReason={simReason} />
            <ShipHeaderButton projectId={id} disabled={shipDisabled} disabledReason={shipReason} />
          </div>

          <OverflowMenu project={project} onProjectChange={setProject} />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Desktop sidebar */}
        <div className="hidden lg:block">
          <Sidebar projectId={id} badges={badges} />
        </div>

        {/* Mobile sidebar drawer */}
        {mobileNavOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileNavOpen(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative h-full w-56"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar
                projectId={id}
                badges={badges}
                onItemClick={() => setMobileNavOpen(false)}
              />
            </div>
          </div>
        ) : null}

        {/* Main content area — child route renders here */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto bg-ink-900">
          {!project ? (
            <div className="p-6 text-ink-400 text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> loading project…
            </div>
          ) : (
            <Outlet context={{ project, meta, refreshBadges }} />
          )}
        </main>
      </div>

      <CostFooter projectId={id} />
    </div>
  );
}
