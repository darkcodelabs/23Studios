import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../lib/pulp_workspace.js';
import { Package, Download, Play, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';

const STEP_ORDER = [
  'validate', 'stage', 'runtime', 'data', 'tiles', 'transpile', 'main', 'pdc', 'publish', 'done',
];

function StepBadge({ name, active, complete }) {
  return (
    <div
      className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border ${
        complete
          ? 'border-emerald-700 text-emerald-300 bg-emerald-900/20'
          : active
            ? 'border-accent text-accent bg-ink-800/60'
            : 'border-ink-700 text-ink-500 bg-ink-900/30'
      }`}
    >
      {name}
    </div>
  );
}

export default function PulpExport() {
  const project = useProject();
  const [job, setJob] = useState(null);          // { id, ws_url, download_url }
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState('');
  const [stepMsg, setStepMsg] = useState('');
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [logs, setLogs] = useState([]);
  const [doneUrl, setDoneUrl] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const logScrollRef = useRef(null);

  const appendLog = useCallback((line) => {
    setLogs((prev) => {
      const next = prev.concat(line);
      if (next.length > 200) next.splice(0, next.length - 200);
      return next;
    });
  }, []);

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Tear down any live WS on unmount.
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_e) { /* ignore */ }
      }
    };
  }, []);

  const startBuild = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDoneUrl(null);
    setLogs([]);
    setCompletedSteps(new Set());
    setPct(0);
    setStep('');
    setStepMsg('');

    let resp;
    try {
      resp = await api.post(`/api/projects/${project.id}/pulp/export`, { target: 'pdx' });
    } catch (e) {
      setBusy(false);
      setError(e.detail?.error || e.message || 'failed to start export');
      return;
    }

    const ws_url = resp.ws_url;
    const job_id = resp.job_id;
    setJob({ id: job_id, ws_url, download_url: resp.download_url });
    appendLog(`> kicked off export job ${job_id}`);

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const appBase = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
    const url = `${proto}://${window.location.host}${appBase}${ws_url}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => appendLog('> ws connected');
    ws.onerror = () => appendLog('> ws error');
    ws.onclose = () => {
      appendLog('> ws closed');
      setBusy(false);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); }
      catch (_e) { return; }

      if (msg.type === 'progress') {
        setStep(msg.step || '');
        if (typeof msg.pct === 'number') setPct(msg.pct);
        if (msg.msg) setStepMsg(msg.msg);
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          const idx = STEP_ORDER.indexOf(msg.step);
          if (idx > 0) {
            for (let i = 0; i < idx; i++) next.add(STEP_ORDER[i]);
          }
          if (msg.step === 'done') next.add('done');
          return next;
        });
        appendLog(`[${msg.step}] ${msg.pct}% ${msg.msg || ''}`.trim());
      } else if (msg.type === 'log') {
        appendLog(msg.text);
      } else if (msg.type === 'done') {
        setPct(100);
        setStep('done');
        setCompletedSteps((prev) => new Set([...prev, ...STEP_ORDER]));
        setDoneUrl(msg.download_url || resp.download_url);
        setBusy(false);
        appendLog('> export complete');
      } else if (msg.type === 'error') {
        setError(msg.message || 'export failed');
        setBusy(false);
        appendLog(`> ERROR: ${msg.message}`);
      } else if (msg.type === 'ready') {
        appendLog(`> ready (job ${msg.job_id})`);
      }
    };
  }, [project.id, appendLog]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-mono text-ink-100 flex items-center gap-2">
              <Package className="w-4 h-4 text-accent" />
              export pulp game
            </h1>
            <p className="text-xs text-ink-400 mt-1">
              transpile scripts, render tiles, run pdc, and produce a .pdx bundle
              suitable for the Playdate Simulator.
            </p>
          </div>
          <button
            onClick={startBuild}
            disabled={busy}
            className={`flex items-center gap-2 px-4 py-2 rounded font-mono text-xs uppercase tracking-wider transition ${
              busy
                ? 'bg-ink-800 text-ink-500 cursor-not-allowed'
                : 'bg-accent text-ink-950 hover:opacity-90'
            }`}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {busy ? 'building…' : 'build .pdx'}
          </button>
        </header>

        {error && (
          <div className="border border-red-700 bg-red-900/30 text-red-200 px-4 py-3 rounded text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-mono text-xs uppercase tracking-wider mb-1">build failed</div>
              <pre className="whitespace-pre-wrap text-xs font-mono">{safeErr(error)}</pre>
            </div>
          </div>
        )}

        {doneUrl && !error && (
          <div className="border border-emerald-700 bg-emerald-900/20 text-emerald-100 px-4 py-3 rounded">
            <div className="font-mono text-xs uppercase tracking-wider text-emerald-300 mb-2">
              build succeeded
            </div>
            <a
              href={(typeof window !== 'undefined' && window.__APP_BASE__ && doneUrl?.startsWith('/'))
                ? `${window.__APP_BASE__}${doneUrl}`
                : doneUrl}
              download
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-emerald-600 text-ink-950 font-mono text-xs uppercase tracking-wider hover:bg-emerald-500 transition"
            >
              <Download className="w-4 h-4" />
              download .pdx
            </a>
          </div>
        )}

        {job && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {STEP_ORDER.map((s) => (
                <StepBadge
                  key={s}
                  name={s}
                  active={step === s && !completedSteps.has(s)}
                  complete={completedSteps.has(s)}
                />
              ))}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-mono text-ink-400">
                <span>{step || 'pending'} {stepMsg ? `— ${stepMsg}` : ''}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 bg-ink-800 rounded overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-mono mb-1">
            log
          </div>
          <div
            ref={logScrollRef}
            className="h-72 overflow-y-auto bg-ink-950 border border-ink-700 rounded p-2 font-mono text-[11px] text-ink-300 whitespace-pre-wrap"
          >
            {logs.length === 0 ? (
              <div className="text-ink-600">no output yet</div>
            ) : (
              logs.map((l, i) => <div key={i}>{l}</div>)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
