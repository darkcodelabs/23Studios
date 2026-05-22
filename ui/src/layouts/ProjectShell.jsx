import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Pencil, Hammer, PlayCircle, Rocket, MoreHorizontal,
  FileText, BookOpen, Image as ImageIcon,
  Film, FolderOpen, Boxes, Milestone, ClipboardCheck,
  ShieldCheck, Gauge, Bug, Send, History, Lock,
  Menu, X as XIcon, Loader2, Download,
  Settings, Trash2, Upload as UploadIcon, ToggleLeft,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import FloatingComposer from '../components/FloatingComposer.jsx';
import FooterStrip from '../components/FooterStrip.jsx';
import GateBanner from '../components/GateBanner.jsx';
import ReleasesDropdown from '../components/ReleasesDropdown.jsx';
import GameTypeToggle from '../components/GameTypeToggle.jsx';
import { api } from '../lib/api.js';

// ProjectShell — design pass 1.
//
// Visual upgrade from the Phase 4.5 Part 0 ad-hoc Tailwind ink-* chrome
// to the 23 Studios OKLCH amber design tokens (see src/styles/tokens.css).
// Functionality preserved 1:1 — sidebar groups, action cluster, overflow
// menu, footer cost rollup, nested <Outlet /> routing all unchanged.
// Only the surface paint, fonts, spacing and accent treatment moved.

// ----------------------------------------------------------------------------
// Status badge — uses --accent / --ok / --danger tokens
// ----------------------------------------------------------------------------

const STATUS_STYLES = {
  active:   { label: 'ACTIVE',   fg: 'var(--accent)',   bg: 'var(--accent-soft)',           bd: 'var(--accent-dim)' },
  building: { label: 'BUILDING', fg: 'var(--accent)',   bg: 'var(--accent-soft)',           bd: 'var(--accent-dim)' },
  broken:   { label: 'BROKEN',   fg: 'var(--danger)',   bg: 'oklch(64% 0.18 25 / .12)',     bd: 'oklch(50% 0.15 25)' },
  shipped:  { label: 'SHIPPED',  fg: 'var(--ok)',       bg: 'oklch(74% 0.14 145 / .10)',    bd: 'oklch(50% 0.10 145)' }
};

function StatusBadge({ status }) {
  const key = (status || 'active').toLowerCase();
  const meta = STATUS_STYLES[key] || STATUS_STYLES.active;
  return (
    <span
      className="inline-flex items-center font-mono uppercase"
      style={{
        fontSize: 10,
        letterSpacing: '.08em',
        padding: '3px 7px',
        borderRadius: 99,
        color: meta.fg,
        background: meta.bg,
        border: `1px solid ${meta.bd}`
      }}
      title={`project status: ${meta.label.toLowerCase()}`}
    >
      {meta.label}
    </span>
  );
}

// ----------------------------------------------------------------------------
// Sidebar — token-tinted, sticky, with the same grouped nav
// ----------------------------------------------------------------------------

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
      { path: 'review/board',  label: 'Board',           icon: ClipboardCheck, badgeKey: 'board' },
      { path: 'review/design', label: 'Design Validate', icon: ShieldCheck },
      { path: 'review/perf',   label: 'Perf Audit',      icon: Gauge },
      { path: 'review/qa',     label: 'QA Critic',       icon: Bug }
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

function SidebarItem({ to, label, icon: Icon, badge, collapsed, disabled, disabledReason }) {
  // Disabled mode — render a non-interactive row with muted styling and a
  // tooltip explaining why. Used in noProjectMode where every project-scoped
  // path needs a project id to resolve.
  if (disabled) {
    const tip = collapsed
      ? (disabledReason ? `${label} — ${disabledReason}` : label)
      : disabledReason || undefined;
    return (
      <div
        aria-disabled="true"
        title={tip}
        className={
          'sb-item relative flex items-center rounded-tk-sm font-ui ' +
          (collapsed
            ? 'justify-center px-1 py-1.5 '
            : 'gap-2.5 px-2.5 py-2 ')
        }
        style={{
          fontSize: 13,
          color: 'var(--text-faint)',
          cursor: 'not-allowed',
          opacity: 0.55
        }}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        {collapsed ? null : (
          <span className="flex-1 truncate">{label}</span>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      end={false}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        'sb-item relative flex items-center rounded-tk-sm font-ui ' +
        (collapsed
          ? 'justify-center px-1 py-1.5 '
          : 'gap-2.5 px-2.5 py-2 ') +
        (isActive
          ? 'text-text bg-surface '
          : 'text-text-soft hover:text-text hover:bg-surface ')
      }
      style={{ fontSize: 13 }}
    >
      {({ isActive }) => (
        <>
          {/* Active 2px amber rail */}
          {isActive ? (
            <span
              aria-hidden
              className="absolute"
              style={{
                left: collapsed ? 0 : -10,
                top: 8,
                bottom: 8,
                width: 2,
                background: 'var(--accent)',
                borderRadius: '0 2px 2px 0'
              }}
            />
          ) : null}
          <Icon className="w-3.5 h-3.5 shrink-0" />
          {collapsed ? null : (
            <>
              <span className="flex-1 truncate">{label}</span>
              {badge > 0 ? (
                <span
                  className="font-mono"
                  style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    letterSpacing: '.08em',
                    padding: '2px 6px',
                    borderRadius: 99,
                    background: 'var(--surface-2)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)'
                  }}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              ) : null}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

function SidebarTelemetry({ cost, hasBuild, badges }) {
  // Sticky-bottom telemetry footer per spec — daemon ver, device status,
  // build queue, cumulative cost. Cost is null while loading and shows
  // '—' if no spend ledger yet.
  const queue = (badges && badges.board > 0) ? `${badges.board} pending` : 'idle';
  return (
    <div
      className="mt-auto pt-3 font-mono flex flex-col gap-1.5"
      style={{
        borderTop: '1px dashed var(--border)',
        fontSize: 10,
        color: 'var(--text-dim)',
        padding: '12px 4px 4px'
      }}
    >
      <div className="flex justify-between items-center">
        <span className="inline-flex items-center gap-1.5">
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
      <div className="flex justify-between">
        <span>device</span>
        <span>{hasBuild ? 'ready' : 'no build'}</span>
      </div>
      <div className="flex justify-between">
        <span>build queue</span>
        <span>{queue}</span>
      </div>
      <div className="flex justify-between">
        <span>spend</span>
        <span style={{ color: 'var(--text-soft)' }}>
          {cost == null ? '—' : `$${cost.toFixed(2)}`}
        </span>
      </div>
    </div>
  );
}

function Sidebar({ projectId, badges, collapsed, onCollapse, cost, hasBuild, onItemClick, noProjectMode }) {
  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden sticky top-0"
      style={{
        width: collapsed ? 56 : 220,
        height: '100vh',
        background: 'var(--bg-2)',
        borderRight: '1px solid var(--border)',
        padding: collapsed ? '18px 8px' : '18px 14px 18px 18px',
        transition: 'width .25s ease'
      }}
    >
      {/* Brand row */}
      <div
        className={'flex items-center mb-3.5 pb-3.5 ' + (collapsed ? 'justify-center' : 'gap-2.5')}
        style={{ borderBottom: '1px dashed var(--border)', padding: collapsed ? '6px 0 14px' : '6px 4px 14px' }}
      >
        <Link
          to="/library"
          className="shrink-0 relative overflow-hidden grid place-items-center"
          style={{
            width: 28, height: 28,
            borderRadius: 5,
            background: 'oklch(15% 0.01 75)',
            border: '1px solid var(--border-2)'
          }}
          title="Library"
        >
          <img src="assets/studio-logo.png?v=20260522b" alt="23" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Link>
        {collapsed ? null : (
          <>
            <div className="flex flex-col leading-tight">
              <b className="font-ui" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>23 STUDIOS</b>
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {noProjectMode ? 'rev 1.0 · studio' : 'rev 1.0 · hakcers'}
              </span>
            </div>
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse"
              className="ml-auto grid place-items-center"
              style={{
                width: 22, height: 22, borderRadius: 4,
                background: 'transparent',
                color: 'var(--text-dim)',
                border: 0,
                cursor: 'pointer'
              }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Groups */}
      <div className={collapsed ? 'flex-1 overflow-y-auto flex flex-col gap-1' : 'flex-1 overflow-y-auto'} onClick={onItemClick}>
        {SIDEBAR_GROUPS.map((group) => (
          <div key={group.label} className={collapsed ? 'flex flex-col gap-0.5' : ''}>
            {collapsed ? null : (
              <div
                className="font-mono uppercase"
                style={{
                  padding: '14px 4px 6px',
                  fontSize: 10,
                  letterSpacing: '.12em',
                  color: 'var(--text-dim)'
                }}
              >
                {group.label}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((it) => (
                <SidebarItem
                  key={it.path}
                  to={projectId ? `/projects/${projectId}/${it.path}` : '#'}
                  label={it.label}
                  icon={it.icon}
                  badge={it.badgeKey ? badges[it.badgeKey] : 0}
                  collapsed={collapsed}
                  disabled={noProjectMode}
                  disabledReason={noProjectMode ? 'Select a project from Library' : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Telemetry footer (hidden when collapsed to rail) */}
      {collapsed ? null : (
        <SidebarTelemetry cost={cost} hasBuild={hasBuild} badges={badges} />
      )}
    </aside>
  );
}

// ----------------------------------------------------------------------------
// Topbar — 52px sticky, mono breadcrumbs, status chips, action cluster
// ----------------------------------------------------------------------------

function TopbarChip({ tone, children }) {
  // tone: 'ok' (default), 'amber'
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
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: dotBg, boxShadow: dotGlow }} />
      {children}
    </span>
  );
}

function Crumbs({ projectName, sectionLabel, noProjectMode, noProjectLabel }) {
  // noProjectMode collapses to a 2-crumb trail: "Studio / <route label>" —
  // there is no project to thread through. The route label comes from the
  // pathname mapping done in the parent (Library, New project, Studio…).
  if (noProjectMode) {
    return (
      <nav className="flex items-center font-mono" style={{ fontSize: 11, gap: 8, color: 'var(--text-muted)' }}>
        <Link to="/library" style={{ color: 'var(--text-muted)' }}>Studio</Link>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <b style={{ color: 'var(--text)', fontWeight: 500 }}>{noProjectLabel || 'Library'}</b>
      </nav>
    );
  }
  return (
    <nav className="flex items-center font-mono" style={{ fontSize: 11, gap: 8, color: 'var(--text-muted)' }}>
      <Link to="/library" style={{ color: 'var(--text-muted)' }}>Studio</Link>
      <span style={{ color: 'var(--text-faint)' }}>/</span>
      <span>{projectName}</span>
      {sectionLabel ? (
        <>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <b style={{ color: 'var(--text)', fontWeight: 500 }}>{sectionLabel}</b>
        </>
      ) : null}
    </nav>
  );
}

// Derive the breadcrumb tail for noProjectMode based on the current pathname.
function deriveNoProjectLabel(pathname) {
  if (!pathname) return 'Library';
  if (pathname.startsWith('/library')) return 'Library';
  if (pathname === '/new' || pathname.startsWith('/new')) return 'New project';
  if (pathname === '/' || pathname.startsWith('/dashboard')) return 'Studio';
  return 'Library';
}

// Map URL pathname suffix → label for the breadcrumb tail. Cheap routing
// peek so we don't have to thread state through Outlet just for crumbs.
function deriveSectionLabel(pathname, projectId) {
  const tail = pathname.replace(new RegExp(`^.*?/projects/${projectId}/?`), '');
  if (!tail) return null;
  const [section, item] = tail.split('/');
  const map = {
    'author/brief': 'Brief',
    'author/bible': 'Bible',
    'author/storyboard': 'Storyboard',
    'author/gallery': 'Gallery',
    'author/references': 'References',
    'build/files': 'Files',
    'build/architecture': 'Architecture',
    'build/milestones': 'Milestones',
    'build/simulator': 'Simulator',
    'review/board': 'Board',
    'review/design': 'Design Validate',
    'review/perf': 'Perf Audit',
    'review/qa': 'QA Critic',
    'release/ship': 'Ship',
    'release/history': 'History',
    'release/mvp': 'MVP Lock'
  };
  return map[`${section}/${item}`] || (section ? section[0].toUpperCase() + section.slice(1) : null);
}

// ----------------------------------------------------------------------------
// Action cluster — kept from Part 0, restyled with token palette
// ----------------------------------------------------------------------------

const tkBtnBase = {
  appearance: 'none',
  border: '1px solid var(--border-2)',
  background: 'transparent',
  color: 'var(--text)',
  padding: '6px 10px',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  lineHeight: 1
};
const tkBtnPrimary = {
  ...tkBtnBase,
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  border: '1px solid var(--accent)',
  fontWeight: 600
};

function EditButton({ projectId }) {
  return (
    <Link to={`/project/${projectId}/sdk/edit`} style={tkBtnBase} title="edit scenes, characters, prompts">
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
      <button type="button" style={tkBtnBase} onClick={doExport} disabled={busy}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hammer className="w-3 h-3" />}
        {busy ? 'building' : 'build .pdx'}
      </button>
      {msg ? (
        <span className="font-mono truncate" style={{ color: 'var(--text-dim)', fontSize: 11, maxWidth: 140 }}>{msg}</span>
      ) : null}
    </>
  );
}

function SimulatorButton({ projectId, disabled, disabledReason }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      style={{ ...tkBtnBase, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
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
        style={{ ...tkBtnPrimary, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md shadow-2xl"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <Rocket className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, color: 'var(--text)' }}>Ship release</span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} style={{ color: 'var(--text-dim)', background: 'transparent', border: 0, cursor: 'pointer' }}>
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3" style={{ fontSize: 13, color: 'var(--text-soft)' }}>
          <p>This opens the dedicated ship workflow. Pre-flight gates (lint, drift, approvals) run there.</p>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>TODO — full inline pre-flight ships in a follow-up patch.</p>
        </div>
        <div className="px-4 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button type="button" onClick={onClose} style={tkBtnBase}>cancel</button>
          <button type="button" onClick={onConfirm} style={tkBtnPrimary}>
            <Rocket className="w-3 h-3" /> open ship page
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Overflow menu — restyled
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
        onClick={() => setOpen((v) => !v)}
        title="more"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          ...tkBtnBase,
          padding: 6,
          width: 30,
          height: 30,
          justifyContent: 'center'
        }}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full mt-1 z-40 shadow-xl p-1"
          role="menu"
          style={{
            width: 256,
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)',
            fontSize: 12
          }}
        >
          <MenuRow icon={Settings} label="Project settings" disabled note="TODO" />
          <MenuRow icon={UploadIcon} label="Export project state" disabled note="TODO" />
          <div className="px-3 py-2 flex items-center gap-2">
            <ToggleLeft className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            <span className="flex-1" style={{ color: 'var(--text)' }}>Game type</span>
            <GameTypeToggle project={project} onChange={onProjectChange} />
          </div>
          <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
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
      className="w-full flex items-center gap-2 text-left"
      role="menuitem"
      style={{
        padding: '6px 12px',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        border: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        color: danger ? 'var(--danger)' : 'var(--text)',
        fontSize: 12
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="flex-1">{label}</span>
      {note ? (
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{note}</span>
      ) : null}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Main shell
// ----------------------------------------------------------------------------

export default function ProjectShell({ noProjectMode = false }) {
  const { id: routeId } = useParams();
  // In noProjectMode there is no :id segment in the URL — useParams returns
  // undefined and every project-scoped fetch is suppressed. Library, /new and
  // /dashboard mount in this mode so they share the same chrome.
  const id = noProjectMode ? null : routeId;
  const location = useLocation();
  const [project, setProject] = useState(null);
  const [err, setErr] = useState(null);
  const [meta, setMeta] = useState(null);
  const [badges, setBadges] = useState({ gallery: 0, references: 0, board: 0 });
  const [cost, setCost] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      // One-shot migration: anyone with the legacy stuck `'1'` value (icon-
      // only rail by default) gets flipped back to expanded ONCE, then their
      // future intentional collapses are preserved. The migration flag
      // (`studio.shell.collapsed.migrated.v1`) is set the first time we run
      // so subsequent reloads honor whatever the user picked next.
      const raw = localStorage.getItem('23s.shell.collapsed');
      const migrated = localStorage.getItem('studio.shell.collapsed.migrated.v1');
      if (raw === '1' && !migrated) {
        localStorage.setItem('23s.shell.collapsed', '0');
        localStorage.setItem('studio.shell.collapsed.migrated.v1', '1');
        return false;
      }
      if (raw === null) {
        // No key set yet — fresh visit. Default to expanded.
        return false;
      }
      return raw === '1';
    } catch (_e) {
      return false;
    }
  });

  // Persist collapse pref
  useEffect(() => {
    try { localStorage.setItem('23s.shell.collapsed', collapsed ? '1' : '0'); } catch (_e) {}
  }, [collapsed]);

  // Project record — guarded by id so noProjectMode skips the fetch entirely.
  useEffect(() => {
    if (!id) return undefined;
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
    if (!id) return undefined;
    let alive = true;
    api.get(`/api/projects/${id}/card_meta`)
      .then((r) => { if (alive) setMeta(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Cost rollup for sidebar footer. Endpoint returns a summary object with
  // total_cost_usd (see server/routes/cost.js). Silent failure → '—'.
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    api.get(`/api/projects/${id}/cost`)
      .then((r) => {
        if (!alive) return;
        const usd = r && (r.total_cost_usd != null ? r.total_cost_usd : (r.summary && r.summary.total_cost_usd));
        setCost(typeof usd === 'number' ? usd : null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Badge counts — fire-and-forget; missing endpoints render 0 silently.
  const refreshBadges = useCallback(() => {
    if (!id) return undefined;
    let alive = true;
    api.get(`/api/projects/${id}/gallery`)
      .then((r) => {
        if (!alive) return;
        const pending = Array.isArray(r && r.assets)
          ? r.assets.filter((a) => a && a.state === 'pending').length
          : 0;
        setBadges((b) => ({ ...b, gallery: pending }));
      })
      .catch(() => {});
    api.get(`/api/projects/${id}/references`)
      .then((r) => {
        if (!alive) return;
        const count = Array.isArray(r && r.items) ? r.items.length : 0;
        setBadges((b) => ({ ...b, references: count }));
      })
      .catch(() => {});
    api.get(`/api/projects/${id}/review`)
      .then((r) => {
        if (!alive) return;
        const pending = r && r.counts && typeof r.counts.pending === 'number'
          ? r.counts.pending : 0;
        setBadges((b) => ({ ...b, board: pending }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const cleanup = refreshBadges();
    return cleanup;
  }, [refreshBadges]);

  if (err === 'not_found') {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)', color: 'var(--text-soft)', fontSize: 13 }}
      >
        Project not found.
        <Link to="/library" style={{ marginLeft: 8, color: 'var(--accent)' }}>library</Link>
      </div>
    );
  }

  const hasBuild = meta && meta.last_build_at != null;
  const shipDisabled = !hasBuild;
  const shipReason = shipDisabled ? 'no build exists — run build .pdx first' : null;
  const simDisabled = !hasBuild;
  const simReason = simDisabled ? 'no build exists yet' : null;

  const sectionLabel = noProjectMode
    ? null
    : deriveSectionLabel(
        typeof window !== 'undefined' ? window.location.pathname : '',
        id
      );

  const noProjectLabel = noProjectMode
    ? deriveNoProjectLabel(location.pathname)
    : null;

  // Build queue chip count — reuse review pending as a proxy until the
  // SSE queue surface lands. 1+ = amber dot, else green.
  const queueCount = badges.board || 0;

  return (
    <div
      className="h-screen flex font-ui"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          projectId={id}
          badges={badges}
          collapsed={collapsed}
          onCollapse={() => setCollapsed(true)}
          cost={cost}
          hasBuild={!!hasBuild}
          noProjectMode={noProjectMode}
        />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileNavOpen(false)}>
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.6)' }} />
          <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
            <Sidebar
              projectId={id}
              badges={badges}
              collapsed={false}
              onCollapse={() => setMobileNavOpen(false)}
              cost={cost}
              hasBuild={!!hasBuild}
              onItemClick={() => setMobileNavOpen(false)}
              noProjectMode={noProjectMode}
            />
          </div>
        </div>
      ) : null}

      <main className="flex-1 min-w-0 flex flex-col relative">
        {/* Floating rail-expand button when sidebar is collapsed */}
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand"
            className="hidden lg:grid place-items-center absolute"
            style={{
              top: 14, left: 14, zIndex: 4,
              width: 22, height: 22, borderRadius: 4,
              background: 'var(--surface)',
              color: 'var(--text-dim)',
              border: '1px solid var(--border-2)',
              cursor: 'pointer'
            }}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : null}

        {/* Topbar — 52px sticky */}
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
          {/* Mobile sidebar toggle */}
          <button
            type="button"
            className="lg:hidden grid place-items-center"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="toggle sidebar"
            title="toggle sidebar"
            style={{
              width: 28, height: 28, borderRadius: 4,
              background: 'transparent', color: 'var(--text-muted)', border: 0, cursor: 'pointer'
            }}
          >
            <Menu className="w-4 h-4" />
          </button>

          <Crumbs
            projectName={project?.name || id}
            sectionLabel={sectionLabel}
            noProjectMode={noProjectMode}
            noProjectLabel={noProjectLabel}
          />

          {noProjectMode ? null : <StatusBadge status={project?.status} />}

          <div className="flex-1" />

          {/* Project-scoped action cluster only when a project is loaded. */}
          {noProjectMode ? null : (
            <div className="hidden md:flex items-center gap-1.5">
              <EditButton projectId={id} />
              <BuildButton projectId={id} onStarted={refreshBadges} />
              <ReleasesDropdown projectId={id} />
              <SimulatorButton projectId={id} disabled={simDisabled} disabledReason={simReason} />
              <ShipHeaderButton projectId={id} disabled={shipDisabled} disabledReason={shipReason} />
            </div>
          )}

          {noProjectMode ? null : <OverflowMenu project={project} onProjectChange={setProject} />}
        </header>

        {/* Status chips strip */}
        <div
          className="flex items-center gap-2 flex-wrap"
          style={{
            padding: '8px 24px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)'
          }}
        >
          <TopbarChip tone="ok">device ready</TopbarChip>
          <TopbarChip tone={queueCount > 0 ? 'amber' : 'ok'}>build queue: {queueCount}</TopbarChip>
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>seed 0xR23-G23S</span>
        </div>

        {/* Project gate banner — only meaningful when a project is loaded. */}
        {noProjectMode ? null : <GateBanner />}

        {/* Main content area. In noProjectMode there is no project to wait
            on — the route's own component (Library, Landing, …) renders
            immediately. */}
        <div className="flex-1 min-h-0 overflow-auto" style={{ background: 'var(--bg)' }}>
          {noProjectMode ? (
            <div style={{ paddingBottom: 38 }}>
              <Outlet />
            </div>
          ) : !project ? (
            <div className="p-6 flex items-center gap-2" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              <Loader2 className="w-4 h-4 animate-spin" /> loading project…
            </div>
          ) : (
            <div style={{ paddingBottom: 38 }}>
              <Outlet context={{ project, meta, refreshBadges }} />
            </div>
          )}
        </div>
      </main>
      <FloatingComposer />
      <FooterStrip />
    </div>
  );
}
