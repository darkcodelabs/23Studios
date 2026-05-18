import { safeErr } from '../lib/format_err.js';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Rocket, Loader2 } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import ProjectCard from '../components/ProjectCard.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import PulpAutopilotProgress from '../components/PulpAutopilotProgress.jsx';
import { api } from '../lib/api.js';
import { quickCreateProject } from '../lib/pulp_autopilot_client.js';

export default function Dashboard() {
  const navigate = useNavigate();
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
        <MakeAGameCard onCreated={(p) => {
          // Land directly in the workflow tab; autopilot keeps streaming as a
          // background job (server doesn't tie SSE to the editor page).
          navigate(`/project/${p.id}/edit?tab=workflow`);
        }} />

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
            no projects yet. type a pitch above or click <span className="text-accent">new project</span>.
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

// Top-of-dashboard "MAKE A GAME" card. One textarea + GO button. On submit:
//   1. POST /api/projects/quick  → creates a pulp scaffold project
//   2. Inline-mount PulpAutopilotProgress against the new project id
//   3. On done (or user opens editor), navigate to the workflow tab.
function MakeAGameCard({ onCreated }) {
  const [pitch, setPitch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [project, setProject] = useState(null);

  async function onGo(e) {
    e?.preventDefault?.();
    const cleaned = pitch.trim();
    if (!cleaned || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await quickCreateProject(cleaned);
      setProject(r.project);
    } catch (e2) {
      setErr(safeErr(e2.detail || e2.message || 'create failed'));
    } finally {
      setBusy(false);
    }
  }

  function onClose() {
    if (project) onCreated?.(project);
    setProject(null);
    setPitch('');
  }

  if (project) {
    return (
      <div className="border border-accent/40 rounded-lg bg-ink-800/60 p-4 space-y-2">
        <div className="text-xs text-ink-300 font-mono">
          building <span className="text-accent">{project.name || project.id}</span>…
        </div>
        <PulpAutopilotProgress
          projectId={project.id}
          pitch={pitch.trim()}
          onClose={onClose}
        />
      </div>
    );
  }

  return (
    <form onSubmit={onGo} className="border border-accent/30 rounded-lg bg-ink-800/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Rocket className="w-4 h-4 text-accent" />
        <h2 className="font-mono text-base text-ink-100">MAKE A GAME</h2>
        <span className="text-xs text-ink-400">type a sentence. get a game.</span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className="input font-mono flex-1"
          maxLength={4000}
          placeholder="a noir detective explores a haunted carnival to find their missing partner"
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="rounded-md font-mono text-sm tracking-wide bg-accent text-ink-900 hover:bg-accent/90 disabled:opacity-50 px-6 py-2 flex items-center justify-center gap-2 shrink-0"
          disabled={!pitch.trim() || busy}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
          GO
        </button>
      </div>
      {err ? <div className="text-xs text-red-400">{err}</div> : null}
    </form>
  );
}
