import { safeErr } from '../lib/format_err.js';
import { useEffect, useState, useCallback } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import ProjectCard from '../components/ProjectCard.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import { api } from '../lib/api.js';

export default function Dashboard() {
  const [projects, setProjects] = useState(null);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get('/api/projects');
      setProjects(r.projects || []);
    } catch (_e) {
      setErr('failed to load projects');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-lg text-ink-100">projects</h1>
          <div className="flex-1" />
          <button className="btn" onClick={load} title="refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> new project
          </button>
        </div>

        {err ? <div className="text-xs text-red-400">{safeErr(err)}</div> : null}

        {projects === null ? (
          <div className="text-ink-400 text-sm">loading…</div>
        ) : projects.length === 0 ? (
          <div className="card text-center text-ink-400 text-sm">
            no projects yet. click <span className="text-accent">new project</span> to add one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}
      </main>

      {showForm ? (
        <ProjectForm
          onClose={() => setShowForm(false)}
          onCreated={() => load()}
        />
      ) : null}
    </div>
  );
}
