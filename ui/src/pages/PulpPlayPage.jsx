import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PulpProjectContext } from '../lib/pulp_workspace.js';
import PulpPlay from './PulpPlay.jsx';

export default function PulpPlayPage() {
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
      } catch (e) {
        if (alive) setErr(e.status === 404 ? 'not_found' : 'failed');
      }
    })();
    return () => { alive = false; };
  }, [id, navigate]);

  if (err === 'not_found') {
    return <div className="h-screen flex items-center justify-center text-ink-400 text-sm">project not found.</div>;
  }
  if (err) {
    return <div className="h-screen flex items-center justify-center text-red-400 text-sm">failed to load project.</div>;
  }
  if (!project) {
    return <div className="h-screen flex items-center justify-center text-ink-400 text-sm">loading project…</div>;
  }

  return (
    <PulpProjectContext.Provider value={{ project }}>
      <div className="h-screen w-screen bg-ink-900 overflow-auto">
        <PulpPlay />
      </div>
    </PulpProjectContext.Provider>
  );
}
