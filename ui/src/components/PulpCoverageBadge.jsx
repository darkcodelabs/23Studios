import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Loader2 } from 'lucide-react';
import { getPatrol } from '../lib/pulp_patrol_client.js';

const POLL_MS = 60_000;

// Tiny coverage indicator for the editor top bar.
// Props:
//   projectId — required
//   onOpen   — () => void; clicking the badge opens the coverage panel
//   refreshHint — change this prop's identity to force a re-fetch
//                 (e.g. bump after a regen elsewhere in the app)
//
// Anti-fake-numbers ethic: on first 404 / failure we surface a quiet
// "patrol n/a" state instead of pretending things are clean.
export default function PulpCoverageBadge({ projectId, onOpen, refreshHint }) {
  const [state, setState] = useState({ loading: true, err: null, data: null });
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await getPatrol(projectId);
      if (!aliveRef.current) return;
      setState({ loading: false, err: null, data });
    } catch (e) {
      if (!aliveRef.current) return;
      setState({ loading: false, err: e, data: null });
    }
  }, [projectId]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    function onVis() { if (!document.hidden) refresh(); }
    document.addEventListener('visibilitychange', onVis);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  // External refresh hint.
  useEffect(() => {
    if (refreshHint === undefined) return;
    refresh();
  }, [refreshHint, refresh]);

  if (!projectId) return null;

  const { loading, err, data } = state;

  // First-load skeleton — keep tiny + non-jumpy.
  if (loading && !data && !err) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="checking asset coverage…"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-ink-700 text-ink-500 text-[11px] font-mono hover:border-accent transition"
      >
        <Loader2 className="w-3 h-3 animate-spin" /> coverage
      </button>
    );
  }

  // Endpoint not yet live (pipeline agent racing us) or hard failure:
  // tell the truth, don't fabricate green.
  if (err) {
    const notReady = err?.status === 404 || err?.status === 501;
    return (
      <button
        type="button"
        onClick={onOpen}
        title={notReady ? 'patrol endpoint not yet available' : 'patrol failed — click for details'}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-ink-700 text-ink-500 text-[11px] font-mono hover:border-accent transition"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink-500" />
        patrol n/a
      </button>
    );
  }

  const issues = Array.isArray(data?.issues) ? data.issues : [];
  const critical = issues.filter((i) => i?.critical).length;
  const total = issues.length;

  if (total === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="all assets covered"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-emerald-700/60 bg-emerald-900/10 text-emerald-300 text-[11px] font-mono hover:border-emerald-400 transition"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <ShieldCheck className="w-3 h-3" />
        assets ok
      </button>
    );
  }

  if (critical > 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={`${critical} critical issue${critical === 1 ? '' : 's'} — click to fix`}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-red-700/60 bg-red-900/20 text-red-300 text-[11px] font-mono hover:border-red-400 transition"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
        <ShieldX className="w-3 h-3" />
        {critical} critical
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${total} asset issue${total === 1 ? '' : 's'} — click to fix`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-700/60 bg-amber-900/10 text-amber-300 text-[11px] font-mono hover:border-amber-400 transition"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
      <ShieldAlert className="w-3 h-3" />
      {total} issue{total === 1 ? '' : 's'}
    </button>
  );
}
