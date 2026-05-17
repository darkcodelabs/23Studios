import { useEffect, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { FolderTree, MessageSquare, ScrollText, Gamepad2 } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import FileTree from '../components/FileTree.jsx';
import FileViewer from '../components/FileViewer.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ModelSelector, { CLAUDE_OPTION } from '../components/ModelSelector.jsx';
import GameTypeToggle from '../components/GameTypeToggle.jsx';
import { api } from '../lib/api.js';

const TABS = [
  { id: 'files', label: 'files', icon: FolderTree },
  { id: 'chat', label: 'chat', icon: MessageSquare },
  { id: 'logs', label: 'logs', icon: ScrollText }
];

export default function Project() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('files');
  const [selectedPath, setSelectedPath] = useState(null);
  const [model, setModel] = useState(CLAUDE_OPTION);

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

  return (
    <div className="h-screen flex flex-col">
      <Nav subtitle={project?.name || id} />
      <div className="border-b border-ink-700 bg-ink-900/50">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono border-b-2 transition ${active ? 'border-accent text-accent' : 'border-transparent text-ink-400 hover:text-ink-200'}`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
          <div className="flex-1" />
          <GameTypeToggle project={project} onChange={setProject} />
          {tab === 'chat' ? <ModelSelector value={model} onChange={setModel} /> : null}
        </div>
      </div>

      <main className="flex-1 min-h-0 overflow-hidden">
        {!project ? (
          <div className="p-6 text-ink-400 text-sm">loading…</div>
        ) : tab === 'files' ? (
          <div className="h-full grid grid-cols-[280px_1fr]">
            <aside className="border-r border-ink-700 overflow-y-auto bg-ink-900/40">
              <FileTree projectId={project.id} selectedPath={selectedPath} onSelect={setSelectedPath} />
            </aside>
            <section className="overflow-hidden">
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
  );
}
