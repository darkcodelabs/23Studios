import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import FileTree from './FileTree.jsx';
import FileViewer from './FileViewer.jsx';
import ChatPanel from './ChatPanel.jsx';

const MIN_PX = 160;
const MAX_PX = 720;

export default function PulpAccessoryDrawer({ kind, project, onClose }) {
  const [height, setHeight] = useState(320);
  const draggingRef = useRef(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current) return;
      const next = window.innerHeight - e.clientY;
      setHeight(Math.max(MIN_PX, Math.min(MAX_PX, next)));
    }
    function onUp() { draggingRef.current = false; document.body.style.userSelect = ''; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  if (!kind) return null;

  return (
    <div
      className="absolute left-0 right-0 bottom-8 z-20 border-t border-ink-700 bg-ink-900 shadow-2xl flex flex-col"
      style={{ height }}
    >
      <div
        className="h-1.5 w-full cursor-row-resize hover:bg-accent/40 transition"
        onMouseDown={(e) => { e.preventDefault(); draggingRef.current = true; document.body.style.userSelect = 'none'; }}
      />
      <div className="flex items-center px-3 py-1.5 border-b border-ink-700 text-xs font-mono text-ink-300">
        <span className="uppercase tracking-wide">{kind}</span>
        <div className="flex-1" />
        <button onClick={onClose} className="text-ink-500 hover:text-ink-200" aria-label="close drawer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {kind === 'files' ? <FilesPanel project={project} /> : null}
        {kind === 'logs'  ? <LogsPanel project={project} /> : null}
        {kind === 'chat'  ? <ChatPanel project={project} model={null} /> : null}
      </div>
    </div>
  );
}

function FilesPanel({ project }) {
  const [path, setPath] = useState(null);
  if (!project) return null;
  return (
    <div className="h-full grid grid-cols-[260px_1fr]">
      <aside className="border-r border-ink-700 overflow-y-auto">
        <FileTree projectId={project.id} selectedPath={path} onSelect={setPath} />
      </aside>
      <section className="overflow-hidden">
        <FileViewer projectId={project.id} filePath={path} />
      </section>
    </div>
  );
}

function LogsPanel({ project }) {
  return (
    <div className="h-full flex items-center justify-center text-ink-500 text-xs">
      build + AI generation logs (Phase 3 fills this in for project {project?.id})
    </div>
  );
}
