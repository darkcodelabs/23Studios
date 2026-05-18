import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, AlertTriangle, ShieldCheck, ShieldAlert,
  Image as ImageIcon, Map as MapIcon, User as UserIcon, Play,
  Wand2, X, ServerCrash
} from 'lucide-react';
import { safeErr } from '../lib/format_err.js';
import { getPatrol, runPatrolRegen } from '../lib/pulp_patrol_client.js';

const MAX_LOG_LINES = 200;

// Public: asset-coverage panel.
// Props:
//   project — { id } (required)
//   onRefreshHint?: () => void — fired after a successful re-fetch so the
//     badge / parent can re-poll without an extra round-trip.
export default function PulpCoveragePanel({ project, onRefreshHint }) {
  const projectId = project?.id;

  const [punch, setPunch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [regening, setRegening] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, lastId: null });
  const [log, setLog] = useState([]);
  const [activeRowKey, setActiveRowKey] = useState(null);

  const ctrlRef = useRef(null);
  const logRef = useRef(null);

  const fetchPunch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await getPatrol(projectId);
      setPunch(data || {});
      onRefreshHint?.();
    } catch (e) {
      setErr(e);
      setPunch(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, onRefreshHint]);

  useEffect(() => { fetchPunch(); }, [fetchPunch]);

  // Cancel any in-flight stream on unmount.
  useEffect(() => () => { try { ctrlRef.current?.abort(); } catch (_e) { /* ignore */ } }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  function pushLog(text) {
    setLog((prev) => {
      const next = prev.concat([String(text)]);
      if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES);
      return next;
    });
  }

  function startRegen(body, rowKey) {
    if (regening || !projectId) return;
    setRegening(true);
    setActiveRowKey(rowKey || null);
    setProgress({ current: 0, total: 0, lastId: null });
    setLog([]);
    pushLog(rowKey ? `▶ regen ${rowKey}` : '▶ regen all');
    ctrlRef.current = runPatrolRegen(projectId, body, {
      onProgress: (d) => {
        setProgress((prev) => ({
          current: typeof d.current === 'number' ? d.current : prev.current,
          total: typeof d.total === 'number' ? d.total : prev.total,
          lastId: d.id || prev.lastId
        }));
        if (d.message) pushLog(d.message);
        else if (d.id) pushLog(`… ${d.kind || 'asset'}: ${d.id} (${d.current ?? '?'}/${d.total ?? '?'})`);
      },
      onFixed: (d) => {
        pushLog(`+ fixed ${d.kind || 'asset'}: ${d.id || ''}${d.action ? ` (${d.action})` : ''}`);
      },
      onLog: (d) => { if (d?.text) pushLog(d.text); },
      onError: (d) => { pushLog(`! error: ${safeErr(d?.message) || 'stream_failed'}`); },
      onDone: (d) => {
        const s = d?.summary || {};
        const parts = [];
        if (typeof s.fixed === 'number')  parts.push(`fixed=${s.fixed}`);
        if (typeof s.failed === 'number') parts.push(`failed=${s.failed}`);
        if (typeof s.skipped === 'number') parts.push(`skipped=${s.skipped}`);
        pushLog(parts.length ? `done — ${parts.join(' ')}` : 'done');
      },
      onClose: () => {
        setRegening(false);
        setActiveRowKey(null);
        // Re-fetch so totals reflect server truth.
        fetchPunch();
      }
    });
  }

  function cancelRegen() {
    try { ctrlRef.current?.abort(); } catch (_e) { /* ignore */ }
    setRegening(false);
    setActiveRowKey(null);
  }

  // ----- empty / error states -----------------------------------------------

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-ink-500 text-xs font-mono">
        no project loaded.
      </div>
    );
  }

  if (err) {
    const status = err?.status;
    // 404 means the pipeline agent hasn't shipped the endpoint yet — be
    // explicit instead of guessing fake numbers.
    const isNotReady = status === 404 || status === 501;
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="card max-w-md text-center">
          <div className="flex justify-center mb-2 text-amber-300">
            <ServerCrash className="w-6 h-6" />
          </div>
          <div className="text-sm text-ink-100 font-mono mb-1">
            {isNotReady ? 'patrol endpoint not yet available' : 'patrol failed'}
          </div>
          <div className="text-[11px] text-ink-400 mb-3">
            {isNotReady
              ? 'the asset-coverage pipeline is still being built. try again in a moment.'
              : safeErr(err)}
          </div>
          <button type="button" onClick={fetchPunch} className="btn text-xs" disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            retry
          </button>
        </div>
      </div>
    );
  }

  if (loading && !punch) {
    return (
      <div className="h-full flex items-center justify-center text-ink-400 text-xs font-mono">
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> running patrol…
      </div>
    );
  }

  const totals  = punch?.totals || {};
  const issues  = Array.isArray(punch?.issues) ? punch.issues : [];
  const tiles   = totals.tiles      || { real: 0, total: 0 };
  const scenes  = totals.scenes     || { with_bg: 0, total: 0 };
  const chars   = totals.characters || { with_portrait: 0, total: 0 };

  const criticalCount = issues.filter((i) => i?.critical).length;
  const allClean      = issues.length === 0;

  const pctTotal  = progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : (regening ? 5 : 0);

  return (
    <div className="h-full flex flex-col text-ink-200">

      {/* Header bar */}
      <div className="px-4 py-3 border-b border-ink-700 flex items-start gap-3 shrink-0">
        <div className="w-9 h-9 rounded-lg border border-ink-700 bg-ink-800 grid place-items-center text-accent shrink-0">
          {allClean ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5 text-amber-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono text-ink-50">asset coverage</div>
          <div className="text-[11px] text-ink-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <Totals
              icon={<ImageIcon className="w-3 h-3" />}
              label="tiles real"
              good={tiles.real}
              total={tiles.total}
            />
            <Totals
              icon={<MapIcon className="w-3 h-3" />}
              label="scenes w/ bg"
              good={scenes.with_bg}
              total={scenes.total}
              critical
            />
            <Totals
              icon={<UserIcon className="w-3 h-3" />}
              label="characters w/ portrait"
              good={chars.with_portrait}
              total={chars.total}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchPunch}
            disabled={loading || regening}
            title="re-run patrol"
            className="btn !py-1.5 text-xs"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            re-scan
          </button>
          {regening ? (
            <button type="button" onClick={cancelRegen} className="btn !py-1.5 text-xs">
              <X className="w-3.5 h-3.5" /> cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startRegen({}, null)}
              disabled={allClean}
              className="btn-primary !py-1.5 text-xs"
              title={allClean ? 'nothing to regen' : 'regen every issue'}
            >
              <Wand2 className="w-3.5 h-3.5" /> regen all
            </button>
          )}
        </div>
      </div>

      {/* Progress + log (only while regening, or briefly after) */}
      {(regening || log.length > 0) ? (
        <div className="px-4 py-2 border-b border-ink-700 shrink-0 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-ink-400">progress</span>
            <span className="text-ink-200">
              {progress.current}{progress.total ? ` / ${progress.total}` : ''}
            </span>
            {progress.lastId ? (
              <span className="text-ink-500 truncate">— last: {progress.lastId}</span>
            ) : null}
            <div className="flex-1" />
            {regening ? <Loader2 className="w-3 h-3 animate-spin text-accent" /> : null}
          </div>
          <div className="h-1.5 w-full bg-ink-900 border border-ink-700 rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pctTotal}%` }}
            />
          </div>
          <div
            ref={logRef}
            className="border border-ink-700 rounded bg-ink-900 p-2 h-24 overflow-y-auto font-mono text-[10px] text-ink-300 whitespace-pre-wrap"
          >
            {log.length === 0
              ? <div className="text-ink-500">connecting…</div>
              : log.map((ln, i) => <div key={i}>{ln}</div>)}
          </div>
        </div>
      ) : null}

      {/* Issues table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {issues.length === 0 ? (
          <div className="h-full flex items-center justify-center text-emerald-300 text-xs font-mono">
            <ShieldCheck className="w-4 h-4 mr-2" /> assets look good — no gaps detected.
          </div>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead className="text-[10px] uppercase tracking-wider text-ink-500 sticky top-0 bg-ink-900 z-10">
              <tr className="border-b border-ink-700">
                <th className="text-left px-3 py-2 w-20">kind</th>
                <th className="text-left px-3 py-2 w-44">id</th>
                <th className="text-left px-3 py-2">problem</th>
                <th className="text-left px-3 py-2 w-40">action</th>
                <th className="text-right px-3 py-2 w-24"> </th>
              </tr>
            </thead>
            <tbody>
              {issues.map((iss, i) => <IssueRow
                key={`${iss?.kind}:${iss?.id}:${i}`}
                issue={iss}
                regening={regening}
                isActive={activeRowKey === `${iss?.kind}:${iss?.id}`}
                onRegen={() => startRegen(
                  { only: [{ kind: iss.kind, id: iss.id }] },
                  `${iss.kind}:${iss.id}`
                )}
              />)}
            </tbody>
          </table>
        )}
      </div>

      {criticalCount > 0 ? (
        <div className="px-3 py-2 border-t border-ink-700 text-[11px] text-amber-300 flex items-center gap-2 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5" />
          {criticalCount} critical issue{criticalCount === 1 ? '' : 's'} —
          scenes without a background can't render in play.
        </div>
      ) : null}
    </div>
  );
}

function Totals({ icon, label, good, total, critical = false }) {
  const safeTotal = Number(total) || 0;
  const safeGood  = Number(good)  || 0;
  const ratio = safeTotal > 0 ? safeGood / safeTotal : 1;
  let color = 'text-emerald-300';
  if (ratio < 1) color = 'text-amber-300';
  if (critical && safeGood < safeTotal) color = 'text-red-300';
  if (safeTotal === 0) color = 'text-ink-500';
  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      {icon}
      <span className="font-mono">{safeGood} of {safeTotal}</span>
      <span className="text-ink-500">{label}</span>
    </span>
  );
}

function IssueRow({ issue, regening, isActive, onRegen }) {
  const k = issue?.kind || 'asset';
  const id = issue?.id || '(unknown)';
  const problem = issue?.problem || '(no description)';
  const action  = issue?.action  || 'regen';
  const Icon = ({ tile: ImageIcon, scene: MapIcon, character: UserIcon })[k] || ImageIcon;
  const kindColor = issue?.critical ? 'text-red-300' : 'text-ink-300';
  return (
    <tr className={`border-b border-ink-800/60 ${isActive ? 'bg-ink-800/40' : 'hover:bg-ink-800/20'}`}>
      <td className={`px-3 py-1.5 ${kindColor}`}>
        <span className="inline-flex items-center gap-1.5">
          <Icon className="w-3 h-3" /> {k}
        </span>
      </td>
      <td className="px-3 py-1.5 text-ink-100 truncate" title={id}>{id}</td>
      <td className="px-3 py-1.5 text-ink-300">{problem}</td>
      <td className="px-3 py-1.5 text-ink-400">{action}</td>
      <td className="px-3 py-1.5 text-right">
        <button
          type="button"
          onClick={onRegen}
          disabled={regening}
          className="btn !py-0.5 !px-1.5 text-[10px]"
          title="regen this row"
        >
          {isActive
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Play className="w-3 h-3" />}
          regen
        </button>
      </td>
    </tr>
  );
}
