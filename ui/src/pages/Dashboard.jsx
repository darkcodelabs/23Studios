import { safeErr } from '../lib/format_err.js';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, RefreshCw, ArrowRight, Loader2,
  LayoutGrid, FolderKanban, Settings
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import Siderail from '../components/Siderail.jsx';
import StudioShelfCard from '../components/StudioShelfCard.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import IntakeForm from '../components/IntakeForm.jsx';
import StudioLogo from '../components/StudioLogo.jsx';
import PulpAutopilotProgress from '../components/PulpAutopilotProgress.jsx';
import { api } from '../lib/api.js';
import { quickCreateProject } from '../lib/pulp_autopilot_client.js';
import { useSiderail } from '../lib/use_siderail.js';

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showIntake, setShowIntake] = useState(false);
  const { collapsed } = useSiderail();

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

  const railItems = [
    { to: '/dashboard', icon: LayoutGrid, label: 'Dashboard', matchEnd: true },
    { to: '/dashboard', icon: FolderKanban, label: 'Projects', matchEnd: true },
    { divider: true },
    { onClick: () => setShowForm(true), icon: Plus, label: 'New project' }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav />
      <div className="flex-1 min-h-0 flex">
        <Siderail
          items={railItems}
          collapsed={collapsed}
          footer={
            <div className="text-[11px] text-ink-500 leading-relaxed">
              <div className="flex items-center gap-1.5">
                <Settings className="w-3 h-3" />
                <span>preferences</span>
              </div>
            </div>
          }
        />

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="w-full px-4 sm:px-6 lg:px-10 py-8 space-y-8">
            <MakeAGameCard
              onCreated={(p) => {
                navigate(`/project/${p.id}/edit?tab=workflow`);
              }}
              onDetailed={() => setShowIntake(true)}
            />

            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <h1 className="text-base text-ink-100 tracking-tight">Projects</h1>
                {projects ? (
                  <span className="text-xs text-ink-500">{projects.length}</span>
                ) : null}
                <div className="flex-1" />
                <button className="btn-icon" onClick={load} title="refresh" aria-label="refresh">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button className="btn-primary" onClick={() => setShowForm(true)}>
                  <Plus className="w-4 h-4" /> New project
                </button>
              </div>

              {err ? <div className="text-xs text-red-400">{safeErr(err)}</div> : null}

              {projects === null ? (
                <div className="text-ink-500 text-sm">loading…</div>
              ) : projects.length === 0 ? (
                <div className="card text-center text-ink-400 text-sm">
                  No projects yet. Type a pitch above or click <span className="text-ink-200">new project</span>.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                  {projects.map((p) => <StudioShelfCard key={p.id} project={p} />)}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      {showForm ? (
        <ProjectForm
          onClose={() => setShowForm(false)}
          onCreated={() => load()}
        />
      ) : null}

      {showIntake ? (
        <IntakeForm
          onClose={() => setShowIntake(false)}
          onCreated={() => load()}
        />
      ) : null}
    </div>
  );
}

// ChatGPT-style composer: a single rounded textarea with the GO button inset
// on the right. No separate header box. The placeholder carries the prompt.
function MakeAGameCard({ onCreated, onDetailed }) {
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

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onGo(e);
    }
  }

  if (project) {
    return (
      <div className="rounded-xl bg-ink-900 ring-1 ring-ink-800 p-4 space-y-2">
        <div className="text-xs text-ink-300">
          Building <span className="text-ink-100">{project.name || project.id}</span>…
        </div>
        <PulpAutopilotProgress
          projectId={project.id}
          pitch={pitch.trim()}
          onClose={onClose}
        />
      </div>
    );
  }

  const ready = !!pitch.trim() && !busy;

  return (
    <section className="space-y-3">
      <div className="flex flex-col items-center gap-2">
        {/* Cyber-glove brand mark replaces the heading. Renders at native
            intrinsic dims via StudioLogo; max-w cap keeps it from going
            full-width on wide viewports. */}
        <StudioLogo size="lg" className="max-w-md w-full h-auto" />
        <p className="text-sm text-ink-400 tracking-wide">23 Studios</p>
      </div>
      <form
        onSubmit={onGo}
        className="relative rounded-2xl bg-ink-800/70 ring-1 ring-ink-800 focus-within:ring-ink-700 transition-shadow"
      >
        <textarea
          rows={2}
          className="block w-full resize-none bg-transparent border-0 outline-none text-ink-100 placeholder-ink-500 pl-4 pr-14 py-3.5 text-sm leading-relaxed"
          maxLength={4000}
          placeholder="a noir detective explores a haunted carnival to find their missing partner"
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button
          type="submit"
          aria-label="generate game"
          title="generate (enter)"
          className={`absolute right-2 bottom-2 w-9 h-9 rounded-lg inline-flex items-center justify-center transition-colors ${
            ready
              ? 'bg-accent text-ink-900 hover:bg-accent/90'
              : 'bg-ink-800 text-ink-500'
          }`}
          disabled={!ready}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onDetailed}
          className="text-xs text-ink-400 hover:text-ink-200 inline-flex items-center gap-1"
        >
          Detailed intake <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {err ? <div className="text-xs text-red-400 px-1">{err}</div> : null}
    </section>
  );
}
