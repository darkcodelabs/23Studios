import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, Loader2, Check, X, AlertTriangle, Hammer } from 'lucide-react';
import { api, getCsrfToken } from '../lib/api.js';

// Phase 6 B11 — ShipButton.
//
// Renders a single CTA + a pre-flight modal. The modal hits
// /api/projects/:id/ship/preflight to enumerate lint / drift / approval
// state and only enables the green "ship it" button if all gates pass.
//
// On confirm we kick off /api/projects/:id/ship (SSE) and navigate the
// user to /project/:id/ship — that page resumes the same job by id and
// streams its own progress.

function CheckRow({ label, result }) {
  const pass = result?.pass;
  const Icon = result == null ? Loader2 : (pass ? Check : X);
  const cls = result == null
    ? 'text-ink-400 animate-spin'
    : (pass ? 'text-emerald-400' : 'text-red-400');
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cls}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-100">{label}</div>
        {result && (
          <div className="text-[11px] text-ink-500 mt-0.5">
            {result.summary && `errors=${result.summary.errors} · warnings=${result.summary.warnings}`}
            {result.count != null && `${result.count} item${result.count === 1 ? '' : 's'}`}
            {result.note && <span className="italic"> · {result.note}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function PreflightModal({ projectId, onClose, onConfirm }) {
  const [preflight, setPreflight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [overrides, setOverrides] = useState({ allow_lint_fail: false, allow_drift: false, skip_sim: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.get(`/api/projects/${projectId}/ship/preflight`);
        if (!cancelled) setPreflight(r);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'preflight failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Only the approval gate is hard (a half-baked asset shipping is a no-no).
  // Lint + drift have explicit "allow_*" overrides because experienced ops
  // sometimes want to ship a known-flagged build for ad-hoc playtesting.
  const checks = preflight?.checks || {};
  const lintOk     = checks.lint?.pass     || overrides.allow_lint_fail;
  const driftOk    = checks.drift?.pass    || overrides.allow_drift;
  const approvalOk = checks.approval?.pass; // never overridable
  const canShip = lintOk && driftOk && approvalOk;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-ink-900 border border-ink-700 rounded-lg w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ink-700 flex items-center gap-2">
          <Rocket className="w-4 h-4 text-accent" />
          <span className="text-sm text-ink-100">Pre-flight checks</span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="text-ink-500 hover:text-ink-200 text-xs">close</button>
        </div>
        <div className="p-4">
          {error && (
            <div className="mb-3 px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          )}
          {loading || !preflight ? (
            <div className="text-ink-400 text-sm flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> running checks…
            </div>
          ) : (
            <div className="space-y-1">
              <CheckRow label="Lua lint pass"        result={checks.lint} />
              <CheckRow label="Drift flags clear"    result={checks.drift} />
              <CheckRow label="Approval queue empty" result={checks.approval} />
              <div className="border-t border-ink-800 pt-3 mt-2 space-y-2">
                <label className="flex items-center gap-2 text-[12px] text-ink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrides.allow_lint_fail}
                    disabled={checks.lint?.pass}
                    onChange={(e) => setOverrides((o) => ({ ...o, allow_lint_fail: e.target.checked }))}
                  />
                  override · ship with lint errors
                </label>
                <label className="flex items-center gap-2 text-[12px] text-ink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrides.allow_drift}
                    disabled={checks.drift?.pass}
                    onChange={(e) => setOverrides((o) => ({ ...o, allow_drift: e.target.checked }))}
                  />
                  override · ship with drift flags
                </label>
                <label className="flex items-center gap-2 text-[12px] text-ink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrides.skip_sim}
                    onChange={(e) => setOverrides((o) => ({ ...o, skip_sim: e.target.checked }))}
                  />
                  skip sim walkthrough step
                </label>
                <div className="text-[11px] text-ink-500 pt-1">
                  delivery mode: <span className="text-ink-300">{preflight.has_build_sh ? 'project build.sh' : 'copy to examples/'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-ink-700 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs">
            cancel
          </button>
          <button
            type="button"
            disabled={!canShip}
            onClick={() => onConfirm(overrides)}
            className={
              'px-3 py-1.5 rounded text-xs text-white flex items-center gap-1.5 ' +
              (canShip ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-ink-700 cursor-not-allowed opacity-60')
            }
          >
            <Rocket className="w-3 h-3" /> ship it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShipButton({ projectId, variant = 'default' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = useCallback(async (overrides) => {
    setBusy(true);
    setError(null);
    try {
      // Fire-and-forget the SSE endpoint; we just want the job_id back so the
      // status page can stream it. We don't await the full stream here — the
      // server keeps state and the status page reconnects.
      const r = await fetch(
        (window.__APP_BASE__ || '') + `/api/projects/${projectId}/ship`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'x-csrf-token': getCsrfToken() || ''
          },
          body: JSON.stringify(overrides || {})
        }
      );
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`ship start failed (${r.status}): ${txt.slice(0, 200)}`);
      }
      // Parse just the first SSE 'ship' event to grab job_id, then close.
      const reader = r.body?.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let jobId = null;
      while (reader && jobId == null) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';
        for (const block of lines) {
          const evMatch = block.match(/^event: (\S+)/m);
          const dataMatch = block.match(/^data: (.*)$/m);
          if (evMatch && evMatch[1] === 'ship' && dataMatch) {
            try { jobId = JSON.parse(dataMatch[1]).job_id; } catch (_e) { /* */ }
          }
        }
      }
      // Don't keep the SSE open here — the status page owns the live view.
      try { await reader.cancel(); } catch (_e) { /* */ }
      setOpen(false);
      if (jobId) navigate(`/project/${projectId}/ship?job=${encodeURIComponent(jobId)}`);
      else       navigate(`/project/${projectId}/ship`);
    } catch (e) {
      setError(e?.message || 'failed to start ship');
    } finally {
      setBusy(false);
    }
  }, [projectId, navigate]);

  const slim = variant === 'slim';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className={
          slim
            ? 'inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs disabled:opacity-50'
            : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm shadow disabled:opacity-50'
        }
        title="run pre-flight + ship"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
        ship
      </button>
      {open && (
        <PreflightModal
          projectId={projectId}
          onClose={() => setOpen(false)}
          onConfirm={start}
        />
      )}
      {error && (
        <div className="fixed bottom-3 right-3 z-50 px-3 py-2 rounded bg-red-600 text-white text-xs flex items-center gap-1.5 shadow-lg">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}
    </>
  );
}

// Compact icon used inline (e.g., in build bars).
export function ShipIcon() { return <Hammer className="w-3 h-3" />; }
