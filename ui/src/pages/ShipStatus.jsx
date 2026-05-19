import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Rocket, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// ShipStatus — Phase 6 B11.
// Polls /api/projects/:id/ship/:shipId for per-step progress.

export default function ShipStatus() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const shipId = params.get('ship_id');
  const [state, setState] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!shipId) return;
    let cancelled = false;
    async function tick() {
      try {
        const r = await api.get(`/api/projects/${id}/ship/${shipId}`);
        if (cancelled) return;
        setState(r);
        if (r.done) return;
      } catch (e) {
        if (cancelled) return;
        setErr(e?.detail || e?.message || 'poll failed');
        return;
      }
      setTimeout(tick, 1500);
    }
    tick();
    return () => { cancelled = true; };
  }, [id, shipId]);

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={`ship · ${id}`} showSiderailToggle={false} />
      <div className="flex-1 overflow-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <header className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-accent" />
            <h1 className="text-sm text-ink-200">Ship</h1>
            {state?.done && (state.ok
              ? <span className="pill pill-ok ml-2">shipped</span>
              : <span className="pill" style={{ background: '#3f0d0d', color: '#fca5a5' }}>failed</span>)}
            <Link to={`/project/${id}`} className="ml-auto text-[11px] text-ink-400 hover:text-ink-200">← back</Link>
          </header>

          {!shipId && <div className="text-xs text-amber-300">No ship_id in URL. Trigger ship from the project page.</div>}
          {err && <div className="text-xs text-red-400 flex items-center gap-2"><AlertCircle className="w-3 h-3" /> {err}</div>}

          {state && (
            <ul className="space-y-2">
              {(state.events || []).map((e, i) => (
                <li key={i} className="bg-ink-800/40 ring-1 ring-ink-800 rounded px-3 py-2 text-xs flex items-center gap-2">
                  <StatusIcon status={e.status} />
                  <span className="w-28 font-mono text-ink-400">{e.step}</span>
                  <span className="flex-1 text-ink-200">{e.detail || e.status}</span>
                  {e.finished_at && e.started_at && (
                    <span className="text-[10px] text-ink-500 font-mono">
                      {((e.finished_at - e.started_at) / 1000).toFixed(1)}s
                    </span>
                  )}
                </li>
              ))}
              {!state.done && (
                <li className="text-xs text-ink-500 flex items-center gap-2 px-3">
                  <Loader2 className="w-3 h-3 animate-spin" /> shipping…
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === 'pass') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'fail') return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'skip') return <span className="w-3.5 h-3.5 inline-block rounded-full bg-ink-700" title="skipped" />;
  return <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-400" />;
}
