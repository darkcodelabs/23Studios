import { Link } from 'react-router-dom';
import { Gamepad2, GitBranch } from 'lucide-react';

const STATUS_COLOR = {
  active: 'text-accent',
  paused: 'text-yellow-300',
  archived: 'text-ink-400'
};

export default function ProjectCard({ project }) {
  const sc = STATUS_COLOR[project.status] || 'text-ink-300';
  return (
    <Link to={`/project/${project.id}`} className="card group block">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-ink-900 border border-ink-700 flex items-center justify-center">
          <Gamepad2 className="w-4 h-4 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-sm text-ink-100 truncate">{project.name}</h3>
            <span className={`pill ${sc}`}>{project.status || 'active'}</span>
          </div>
          {project.description ? (
            <p className="mt-1 text-xs text-ink-400 line-clamp-2">{project.description}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-400">
            <span className="pill">{project.platform || 'unknown'}</span>
            {project.developer ? <span className="pill">dev: {project.developer}</span> : null}
            {project.publisher ? <span className="pill">pub: {project.publisher}</span> : null}
          </div>
          {project.repo ? (
            <div className="mt-2 flex items-center gap-1 text-[10px] text-ink-500 truncate">
              <GitBranch className="w-3 h-3" />
              <span className="truncate">{project.repo}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
