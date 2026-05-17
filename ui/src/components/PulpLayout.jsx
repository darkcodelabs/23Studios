import { useEffect, useState } from 'react';
import { useParams, Outlet, useNavigate } from 'react-router-dom';
import Nav from './Nav.jsx';
import PulpNav from './PulpNav.jsx';
import { api } from '../lib/api.js';

export default function PulpLayout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/api/projects/${id}`);
        if (!alive) return;
        if (r.project.game_type !== 'pulp') {
          navigate(`/project/${id}`, { replace: true });
          return;
        }
        setProject(r.project);
      } catch (_e) { if (alive) setErr('failed to load project'); }
    })();
    return () => { alive = false; };
  }, [id, navigate]);

  return (
    <div className="h-screen flex flex-col">
      <Nav subtitle={project?.name || id} />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <PulpNav />
        <main className="flex-1 min-w-0 overflow-hidden">
          {err ? (
            <div className="p-6 text-sm text-red-400">{err}</div>
          ) : !project ? (
            <div className="p-6 text-sm text-ink-400">loading…</div>
          ) : (
            <Outlet context={{ project }} />
          )}
        </main>
      </div>
    </div>
  );
}
