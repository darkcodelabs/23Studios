import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';

// ShipButton — Phase 6 B11.
// Click → preflight modal (lint, drift, approvals). Confirm → POST /ship and
// navigate to /project/:id/ship for live progress.

export default function ShipButton({ projectId }) {
  const [open, setOpen] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  async function openModal() {
    setOpen(true);
    setPreflight(null); setErr(null);
    setLoading(true);
    try {
      const r = await api.get(`/api/projects/${projectId}/ship/preflight`);
      setPreflight(r);
    } catch (e) { setErr(e?.detail || e?.message || 'preflight failed'); }
    finally { setLoading(false); }
  }

  async function confirm() {
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${projectId}/ship`, {});
      setOpen(false);
      navigate(`/project/${projectId}/ship?ship_id=${encodeURIComponent(r.ship_id)}`);
    } catch (e) { setErr(e?.detail || e?.message || 'ship failed to start'); }
  }

  return (
    <>
      <button type="button" onClick={openModal}
              className="btn-primary text-xs flex items-center gap-1.5">
        <Rocket className="w-3 h-3" /> Ship
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
             onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="bg-ink-900 ring-1 ring-ink-800 rounded-lg p-5 max-w-lg w-full space-y-4">
            <header className="flex items-center gap-2 text-sm text-ink-100">
              <Rocket className="w-4 h-4 text-accent" /> Ship pre-flight
            </header>
            {loading && <div className="text-xs text-ink-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> running checks…</div>}
            {err && <div className="text-xs text-red-400 flex items-center gap-2"><AlertCircle className="w-3 h-3" /> {err}</div>}
            {preflight && (
              <>
                <ul className="space-y-1.5">
                  {(preflight.checks || []).filter((c) => c.status !== 'running').map((c, i) => (
                    <li key={i} className="text-xs flex items-center gap-2">
                      <StatusIcon status={c.status} />
                      <span className="w-24 font-mono text-ink-400">{c.step}</span>
                      <span className="text-ink-200">{c.detail || c.status}</span>
                    </li>
                  ))}
                </ul>
                <footer className="flex gap-2 pt-2 border-t border-ink-800">
                  <button onClick={() => setOpen(false)} className="btn text-xs flex-1">Cancel</button>
                  <button onClick={confirm}
                          disabled={!preflight.ok}
                          className={`btn-primary text-xs flex-1 ${!preflight.ok ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <Rocket className="w-3 h-3" /> Ship it
                  </button>
                </footer>
                {!preflight.ok && <div className="text-[11px] text-red-300">Fix failing checks before shipping.</div>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StatusIcon({ status }) {
  if (status === 'pass') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'fail') return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'skip') return <span className="w-3.5 h-3.5 inline-block rounded-full bg-ink-700" />;
  return <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-400" />;
}
