import { Link } from 'react-router-dom';
import { Gamepad2, GitBranch, Download, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const STATUS_COLOR = {
  active: 'text-accent',
  paused: 'text-yellow-300',
  archived: 'text-ink-400'
};

export default function ProjectCard({ project }) {
  const sc = STATUS_COLOR[project.status] || 'text-ink-300';
  const href = project.game_type === 'pulp'
    ? `/project/${project.id}/edit`
    : `/project/${project.id}`;
  return (
    <div className="card group block">
      <Link to={href} className="block">
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
              {project.game_type ? <span className="pill">{project.game_type}</span> : null}
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
      {project.game_type === 'sdk' ? <SdkActions project={project} /> : null}
    </div>
  );
}

function SdkActions({ project }) {
  const [build, setBuild] = useState(null);
  const [err, setErr] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/api/projects/${project.id}/sdk/build/latest`)
      .then((r) => { if (alive) setBuild(r); })
      .catch((e) => { if (alive) setErr(e); });
    return () => { alive = false; };
  }, [project.id]);

  async function launchSim() {
    setLaunching(true);
    setLaunchMsg(null);
    try {
      const r = await api.post(`/api/projects/${project.id}/sdk/simulator`, {});
      setLaunchMsg(r.launched ? `launched (pid ${r.pid})` : 'no response');
    } catch (e) {
      setLaunchMsg(e?.detail || e?.message || 'launch failed');
    } finally {
      setLaunching(false);
    }
  }

  if (err) return null; // no build yet — silent
  if (!build) {
    return <div className="mt-2 text-[10px] text-ink-500">no SDK build yet</div>;
  }
  return (
    <div className="mt-2 flex items-center gap-2 text-[11px]">
      <a
        href={build.download_url}
        className="btn text-[11px]"
        download
        onClick={(e) => e.stopPropagation()}
        title="download latest .pdx"
      >
        <Download className="w-3 h-3" /> .pdx
      </a>
      <button
        type="button"
        className="btn text-[11px]"
        disabled={launching}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); launchSim(); }}
        title="open in Playdate Simulator"
      >
        <PlayCircle className="w-3 h-3" /> simulator
      </button>
      {launchMsg ? <span className="text-ink-500 truncate">{launchMsg}</span> : null}
    </div>
  );
}
