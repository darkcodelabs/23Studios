import { useEffect, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import {
  FolderTree, MessageSquare, ScrollText,
  Download, PlayCircle, Hammer, Loader2, Pencil, Image as ImageIcon
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import Siderail from '../components/Siderail.jsx';
import ShipButton from '../components/ShipButton.jsx';
import FileTree from '../components/FileTree.jsx';
import FileViewer from '../components/FileViewer.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ModelSelector, { CLAUDE_OPTION } from '../components/ModelSelector.jsx';
import GameTypeToggle from '../components/GameTypeToggle.jsx';
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
              {project ? <ShipButton projectId={project.id} /> : null}
              <GameTypeToggle project={project} onChange={setProject} />
              {tab === 'chat' ? <ModelSelector value={model} onChange={setModel} /> : null}
            </div>
          </div>

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
      {ready ? (
        <a
          href={build.download_url}
          download={`${project.id}.pdx.zip`}
          className="btn text-xs"
          title={`download ${formatBytes(build.cached_tar_bytes)} pdx tarball`}
        >
          <Download className="w-3 h-3" /> download
        </a>
      ) : null}
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
