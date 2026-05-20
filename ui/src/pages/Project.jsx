import { useEffect, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import {
  FolderTree, MessageSquare, ScrollText,
  PlayCircle, Hammer, Loader2, Pencil, Image as ImageIcon,
  ClipboardList
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import Siderail from '../components/Siderail.jsx';
import FileTree from '../components/FileTree.jsx';
import FileViewer from '../components/FileViewer.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ModelSelector, { CLAUDE_OPTION } from '../components/ModelSelector.jsx';
import GameTypeToggle from '../components/GameTypeToggle.jsx';
import ShipButton from '../components/ShipButton.jsx';
import ReleasesDropdown from '../components/ReleasesDropdown.jsx';
import { api } from '../lib/api.js';
import { useSiderail } from '../lib/use_siderail.js';

const TABS = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'chat',  label: 'Chat',  icon: MessageSquare },
  { id: 'logs',  label: 'Logs',  icon: ScrollText }
];

export default function Project() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('files');
  const [selectedPath, setSelectedPath] = useState(null);
  const [model, setModel] = useState(CLAUDE_OPTION);
  const { collapsed } = useSiderail();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/api/projects/${id}`);
        if (alive) setProject(r.project);
      } catch (e) {
        if (alive) setErr(e.status === 404 ? 'not_found' : 'failed');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (err === 'not_found') return <Navigate to="/dashboard" replace />;
  // Pulp projects belong in the editor shell; redirect deep-link visits.
  if (project?.game_type === 'pulp') return <Navigate to={`/project/${id}/edit`} replace />;

  const railItems = TABS.map((t) => ({
    icon: t.icon,
    label: t.label,
    onClick: () => setTab(t.id),
    active: tab === t.id
  }));

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={project?.name || id} />
      <div className="flex-1 min-h-0 flex">
        <Siderail items={railItems} collapsed={collapsed} />

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* slim hairline action strip — page title in regular weight */}
          <div className="bg-ink-900 border-b border-ink-800">
            <div className="px-4 h-10 flex items-center gap-2">
              <h2 className="text-sm text-ink-200 tracking-tight">
                {TABS.find((t) => t.id === tab)?.label || ''}
              </h2>
              <div className="flex-1" />
              <Link
                to={`/project/${id}/references`}
                className="btn text-xs"
                title="reference image library"
              >
                <ImageIcon className="w-3 h-3" /> references
              </Link>
              {project?.game_type === 'sdk' ? <SdkBuildBar project={project} /> : null}
              {project?.game_type === 'sdk' ? <ReviewBadge projectId={id} /> : null}
              <ShipButton projectId={id} variant="slim" />
              <GameTypeToggle project={project} onChange={setProject} />
              {tab === 'chat' ? <ModelSelector value={model} onChange={setModel} /> : null}
            </div>
          </div>

          {/* Hero card + stage tab strip — gives the project page a single
              navigable map across all autopilot surfaces. SDK projects only;
              Pulp keeps the legacy tabs. */}
          {project && project.game_type === 'sdk' ? (
            <ProjectHero project={project} />
          ) : null}

          <main className="flex-1 min-h-0 overflow-hidden">
            {!project ? (
              <div className="p-6 text-ink-400 text-sm">loading…</div>
            ) : tab === 'files' ? (
              <div className="h-full grid grid-cols-[260px_1fr]">
                <aside className="border-r border-ink-800 overflow-y-auto bg-ink-900">
                  <FileTree projectId={project.id} selectedPath={selectedPath} onSelect={setSelectedPath} />
                </aside>
                <section className="overflow-hidden bg-ink-900">
                  <FileViewer projectId={project.id} filePath={selectedPath} />
                </section>
              </div>
            ) : tab === 'chat' ? (
              <ChatPanel key={model.id} project={project} model={model} />
            ) : (
              <div className="h-full flex items-center justify-center text-ink-500 text-sm">
                logs panel placeholder
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function SdkBuildBar({ project }) {
  const [build, setBuild] = useState(null);     // status snapshot
  const [building, setBuilding] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [msg, setMsg] = useState(null);

  const refresh = async () => {
    try {
      const r = await api.get(`/api/projects/${project.id}/sdk/build/status`);
      setBuild(r);
    } catch (_e) { setBuild(null); }
  };
  useEffect(() => {
    if (!project?.id) return;
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [project?.id]);

  async function doExport() {
    setBuilding(true); setMsg('starting pdc…');
    try {
      const r = await api.post(`/api/projects/${project.id}/sdk/export`, {});
      const status = r.status_url;
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          const s = await api.get(status);
          if (s.status === 'done') { setMsg('built'); break; }
          if (s.status === 'failed') { setMsg('build failed: ' + (s.error || '')); break; }
          setMsg('building (' + (s.status || '?') + ')');
        } catch (_e) { /* keep polling */ }
      }
      await refresh();
    } catch (e) {
      setMsg('export error: ' + (e?.detail || e?.message || 'unknown'));
    } finally {
      setBuilding(false);
    }
  }

  function doSim() {
    window.location.href = `/project/${project.id}/sdk/play`;
  }

  const ready = build && build.has_build && build.pdx_exists;
  const stateDot = !build ? 'bg-ink-500' :
    ready ? 'bg-accent' :
    build.status === 'failed' ? 'bg-red-400' :
    'bg-amber-400';
  const stateLabel = !build ? 'checking' :
    !build.has_build ? (build.status || 'never built') :
    !build.pdx_exists ? 'pdx missing on disk' :
    `ready · ${formatBytes(build.cached_tar_bytes)}`;

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="inline-flex items-center gap-1 text-ink-300 mr-1" title="latest pdx build status">
        <span className={`pill-dot ${stateDot}`} />
        <span className="font-mono">{stateLabel}</span>
      </span>
      <a href={`/project/${project.id}/sdk/edit`} className="btn text-xs"
         title="edit scenes, characters, prompts; regenerate assets">
        <Pencil className="w-3 h-3" /> edit
      </a>
      <button type="button" className="btn text-xs" onClick={doExport} disabled={building}>
        {building ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hammer className="w-3 h-3" />}
        {building ? 'building' : 'build .pdx'}
      </button>
      <ReleasesDropdown projectId={project.id} />
      <button type="button" className="btn text-xs" onClick={doSim} disabled={launching || !ready}>
        {launching ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
        simulator
      </button>
      {msg ? <span className="text-ink-500 truncate max-w-xs ml-1 font-mono">{msg}</span> : null}
    </div>
  );
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '?';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// Small badge linking to the review board. Fetches pending count once on mount.
function ReviewBadge({ projectId }) {
  const [pending, setPending] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/api/projects/${projectId}/review`)
      .then((r) => { if (alive) setPending(r && r.counts && r.counts.pending != null ? r.counts.pending : null); })
      .catch(() => { /* silent — badge is non-critical */ });
    return () => { alive = false; };
  }, [projectId]);

  const hasPending = typeof pending === 'number' && pending > 0;

  return (
    <a
      href={`/project/${projectId}/review`}
      className={`btn text-xs relative ${hasPending ? 'text-yellow-300' : ''}`}
      title={`Review board${hasPending ? ` — ${pending} pending` : ''}`}
    >
      <ClipboardList className="w-3 h-3" />
      review
      {hasPending && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-yellow-500 text-black text-[10px] font-bold leading-none">
          {pending > 99 ? '99+' : pending}
        </span>
      )}
    </a>
  );
}

// Hero card + horizontal stage navigator. Lets the user jump between
// every autopilot surface without going back to the dashboard. The card
// reuses StudioShelfCard data for visual consistency.
const STAGE_TABS = [
  { path: '',                  label: 'Files / Chat' },
  { path: '/concepts',         label: 'Concepts' },
  { path: '/bible',            label: 'Bible' },
  { path: '/batches',          label: 'Asset Batches' },
  { path: '/storyboard',       label: 'Storyboard' },
  { path: '/milestones',       label: 'Milestones' },
  { path: '/design-validate',  label: 'Design Validate' },
  { path: '/perf',             label: 'Perf Audit' },
  { path: '/qa-critic',        label: 'QA Critic' },
  { path: '/architecture',     label: 'Architecture' },
  { path: '/review',           label: 'Review Board' },
  { path: '/ship',             label: 'Ship' },
  { path: '/releases',         label: 'Releases' },
  { path: '/sdk/play',         label: 'Simulator' },
  { path: '/mvp',              label: 'MVP Lock' }
];

function ProjectHero({ project }) {
  const [autopilot, setAutopilot] = useState(null);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/api/projects/${project.id}/card_meta`)
      .then((r) => { if (alive) setMeta(r); }).catch(() => {});
    return () => { alive = false; };
  }, [project.id]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.get(`/api/projects/${project.id}/sdk/autopilot/status`);
        if (alive) setAutopilot(r);
      } catch (_e) { /* */ }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [project.id]);

  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  const hereSuffix = (typeof window !== 'undefined') ? window.location.pathname.replace(base, '').replace(`/project/${project.id}`, '') : '';

  return (
    <div className="bg-ink-900 border-b border-ink-800">
      <div className="px-4 py-3 flex items-start gap-4">
        {/* Hero thumbnail */}
        <div className="w-28 h-20 flex-shrink-0 rounded ring-1 ring-ink-700 overflow-hidden bg-ink-800">
          {meta && meta.title_image_url ? (
            // eslint-disable-next-line jsx-a11y/img-redundant-alt
            <img
              src={base + meta.title_image_url}
              alt="title"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-600 text-[10px]">
              no title art
            </div>
          )}
        </div>
        {/* Title + bylines + live autopilot pill */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base text-ink-100 font-medium truncate">
              {project.name}
            </h1>
            {meta && meta.version && (
              <span className="text-[10px] font-mono text-ink-500">v{meta.version}</span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${
              project.status === 'active' ? 'bg-accent/15 text-accent' :
              project.status === 'paused' ? 'bg-amber-500/15 text-amber-300' :
              'bg-ink-700 text-ink-400'
            }`}>{project.status || 'active'}</span>
            {autopilot && (autopilot.running || autopilot.awaiting_gate) && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                autopilot.awaiting_gate ? 'bg-amber-300/15 text-amber-300' : 'bg-accent/15 text-accent'
              }`}>
                {autopilot.awaiting_gate
                  ? `gate: ${autopilot.awaiting_gate}`
                  : `${autopilot.phase || 'starting'} · ${autopilot.percent}%`}
              </span>
            )}
          </div>
          {project.description && (
            <p className="text-xs text-ink-400 mt-1 line-clamp-2">{project.description}</p>
          )}
          {autopilot && (autopilot.running || autopilot.awaiting_gate) && (
            <div className="mt-2 w-full max-w-md h-1 bg-ink-800 rounded overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  autopilot.awaiting_gate ? 'bg-amber-300' : 'bg-accent'
                }`}
                style={{ width: autopilot.percent + '%' }}
              />
            </div>
          )}
        </div>
      </div>
      {/* Stage nav strip — horizontal scroll on narrow viewports */}
      <nav className="border-t border-ink-800 overflow-x-auto">
        <ul className="flex items-stretch text-[11px] font-mono whitespace-nowrap px-2">
          {STAGE_TABS.map((t) => {
            const isActive = hereSuffix === t.path
              || (t.path === '' && (hereSuffix === '' || hereSuffix === '/files'));
            return (
              <li key={t.path}>
                <Link
                  to={`/project/${project.id}${t.path}`}
                  className={
                    'inline-flex items-center px-3 py-2 border-b-2 transition-colors ' +
                    (isActive
                      ? 'border-accent text-accent'
                      : 'border-transparent text-ink-400 hover:text-ink-100 hover:bg-ink-800/40')
                  }
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
