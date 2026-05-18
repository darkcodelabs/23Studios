import { Link } from 'react-router-dom';
import { Gamepad2, GitBranch, Download, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Status colour applies ONLY to the leading 6px dot inside the pill —
// the pill body itself stays muted gray. No accent fills, no border.
const STATUS_DOT = {
  active: 'bg-accent',
  paused: 'bg-yellow-300',
  archived: 'bg-ink-500'
};
const STATE_DOT = {
  ready: 'bg-accent',
  failed: 'bg-red-400',
  pending: 'bg-amber-400'
};

export default function ProjectCard({ project }) {
  const dot = STATUS_DOT[project.status] || 'bg-ink-400';
  const href = project.game_type === 'pulp'
    ? `/project/${project.id}/edit`
    : `/project/${project.id}`;
  const isPlaydate = (project.platform || 'playdate') === 'playdate';

  return (
    <div className="card group block">
      <Link to={href} className="block">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-ink-800 flex items-center justify-center shrink-0">
            <Gamepad2 className="w-4 h-4 text-ink-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm text-ink-100 truncate tracking-tight">{project.name}</h3>
              <span className="pill">
                <span className={`pill-dot ${dot}`} />
                {project.status || 'active'}
              </span>
            </div>
            {project.description ? (
              <p className="mt-1 text-xs text-ink-400 line-clamp-2 leading-relaxed">{project.description}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {/* Playdate identifier uses the PWA icon as a 14x14 prefix */}
              <span className="pill">
                {isPlaydate ? (
                  <img
                    src={((typeof window !== 'undefined' && window.__APP_BASE__) || '') + '/icons/icon-192.png'}
                    alt=""
                    width={14}
                    height={14}
                    className="pixelated inline-block mr-1 rounded-sm"
                  />
                ) : null}
                {project.platform || 'unknown'}
              </span>
              {project.game_type ? <span className="pill">{project.game_type}</span> : null}
              {project.developer ? <span className="pill">dev: {project.developer}</span> : null}
              {project.publisher ? <span className="pill">pub: {project.publisher}</span> : null}
            </div>
            {project.repo ? (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-ink-500 truncate font-mono">
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
  const [launchMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    const fetch = () => api.get(`/api/projects/${project.id}/sdk/build/status`)
      .then((r) => { if (alive) setBuild(r); })
      .catch((e) => { if (alive) setErr(e); });
    fetch();
    const t = setInterval(fetch, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [project.id]);

  function launchSim() {
    window.location.href = `/project/${project.id}/sdk/play`;
  }

  if (err) return null;
  if (!build) return <div className="mt-2 text-[10px] text-ink-500">checking build…</div>;

  const ready = build.has_build && build.pdx_exists;
  const stateKey = ready ? 'ready' : build.status === 'failed' ? 'failed' : 'pending';
  const stateDot = STATE_DOT[stateKey];
  const stateLabel = !build.has_build ? 'never built' :
    !build.pdx_exists ? 'pdx missing' :
    `ready · ${formatBytesMB(build.cached_tar_bytes)}`;

  return (
    <div className="mt-2 flex items-center gap-2 text-[11px]">
      <span className="inline-flex items-center text-ink-300">
        <span className={`pill-dot ${stateDot}`} />
        {stateLabel}
      </span>
      <div className="flex-1" />
      {ready ? (
        <a
          href={build.download_url}
          className="btn text-xs"
          download={`${project.id}.pdx.zip`}
          onClick={(e) => e.stopPropagation()}
          title={`download ${formatBytesMB(build.cached_tar_bytes)}`}
        >
          <Download className="w-3 h-3" /> .pdx
        </a>
      ) : null}
      <button
        type="button"
        className="btn text-xs"
        disabled={launching || !ready}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); launchSim(); }}
        title={ready ? 'open in Playdate Simulator (in-browser)' : 'build first'}
      >
        <PlayCircle className="w-3 h-3" /> simulator
      </button>
      {launchMsg ? <span className="text-ink-500 truncate">{launchMsg}</span> : null}
    </div>
  );
}

function formatBytesMB(n) {
  if (!Number.isFinite(n) || n <= 0) return '?';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
