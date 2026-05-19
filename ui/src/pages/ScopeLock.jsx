import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2, AlertCircle, Lock, Coins, ListTree, ArrowLeftRight, History
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

export default function ScopeLock() {
  const { id } = useParams();
  const [proposal, setProposal] = useState(null);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [inScope, setInScope] = useState([]); // [{requirement_id, est_cost_usd}]
  const [deferred, setDeferred] = useState([]);
  const [budget, setBudget] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedSide, setSelectedSide] = useState(null); // 'in' | 'def'
  const [selectedIds, setSelectedIds] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const p = await api.get(`/api/projects/${id}/scope/proposal`);
      setProposal(p.proposal);
      setInScope(p.proposal.in_scope);
      setDeferred(p.proposal.deferred);
      try {
        const cur = await api.get(`/api/projects/${id}/scope`);
        setLatest(cur.scope || null);
      } catch (_e) { setLatest(null); }
      try {
        const h = await api.get(`/api/projects/${id}/scope/history`);
        setHistory(h.scopes || []);
      } catch (_e) { setHistory([]); }
    } catch (e) {
      if (e.status === 412) { setProposal(null); setErr(e); }
      else setErr(e);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const inScopeTotal = useMemo(
    () => round(inScope.reduce((s, r) => s + (r.est_cost_usd || 0), 0)),
    [inScope]
  );
  const deferredTotal = useMemo(
    () => round(deferred.reduce((s, r) => s + (r.est_cost_usd || 0), 0)),
    [deferred]
  );
  const budgetNum = useMemo(() => {
    const n = parseFloat(budget);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [budget]);
  const overBudget = budgetNum != null && inScopeTotal > budgetNum;

  function toggleSelect(side, rid) {
    if (selectedSide !== side) {
      setSelectedSide(side);
      setSelectedIds(new Set([rid]));
      return;
    }
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  }

  function moveSelected(direction) {
    if (!selectedSide || selectedIds.size === 0) return;
    if (direction === 'to-deferred' && selectedSide === 'in') {
      const moving = inScope.filter((r) => selectedIds.has(r.requirement_id));
      if (moving.length === 0) return;
      setInScope((cur) => cur.filter((r) => !selectedIds.has(r.requirement_id)));
      setDeferred((cur) => [...cur, ...moving.map((r) => ({
        ...r, reason: r.reason || 'manually deferred at scope lock'
      }))]);
      setSelectedIds(new Set()); setSelectedSide(null);
    } else if (direction === 'to-in' && selectedSide === 'def') {
      const moving = deferred.filter((r) => selectedIds.has(r.requirement_id));
      if (moving.length === 0) return;
      setDeferred((cur) => cur.filter((r) => !selectedIds.has(r.requirement_id)));
      setInScope((cur) => [...cur, ...moving.map(({ reason, ...rest }) => rest)]);
      setSelectedIds(new Set()); setSelectedSide(null);
    }
  }

  async function lock() {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        include_ids: inScope.map((r) => r.requirement_id),
        defer_ids: deferred.map((r) => r.requirement_id),
        notes: notes || undefined,
        budget_usd: budgetNum
      };
      const r = await api.post(`/api/projects/${id}/scope/lock`, body);
      setLatest(r.scope);
      alert(`Locked ${r.scope.file_version} — ${r.scope.totals.in_scope_count} in-scope, ${r.scope.totals.deferred_count} deferred.`);
      await load();
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle={`scope · ${id}`} showSiderailToggle={false} />
      <div className="max-w-7xl mx-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ListTree className="w-5 h-5" /> Scope proposal + lock
          </h1>
          <div className="flex items-center gap-2 text-xs text-ink-300">
            {latest ? (
              <span>latest lock: <span className="font-mono">{latest.file_version}</span> · {latest.totals.in_scope_count} in-scope</span>
            ) : (
              <span className="text-ink-500">no lock yet</span>
            )}
          </div>
        </div>

        {loading && (
          <div className="text-sm text-ink-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> loading proposal…
          </div>
        )}

        {err && (
          <div className="p-3 rounded border border-red-700 bg-red-900/30 mb-3 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>
              {err.message || String(err)}
              {err.code === 'no_candidate' && (
                <div className="text-xs text-ink-400 mt-1">Run the A5 interview and lock it first.</div>
              )}
              {err.detail && <pre className="text-xs mt-1 whitespace-pre-wrap">{typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail, null, 2)}</pre>}
            </div>
          </div>
        )}

        {proposal && (
          <>
            {/* Budget + totals bar */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <div className="p-3 rounded border border-ink-700 bg-ink-800/40">
                <div className="text-xs text-ink-400">in-scope cost</div>
                <div className={`text-lg font-mono ${overBudget ? 'text-red-300' : 'text-emerald-300'}`}>${inScopeTotal.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded border border-ink-700 bg-ink-800/40">
                <div className="text-xs text-ink-400">deferred cost</div>
                <div className="text-lg font-mono text-ink-300">${deferredTotal.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded border border-ink-700 bg-ink-800/40">
                <label className="text-xs text-ink-400 block">budget (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="optional ceiling"
                  className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div className="p-3 rounded border border-ink-700 bg-ink-800/40">
                <div className="text-xs text-ink-400">items</div>
                <div className="text-sm">
                  <span className="text-emerald-300 font-mono">{inScope.length}</span>
                  <span className="text-ink-500"> / </span>
                  <span className="text-ink-300 font-mono">{deferred.length}</span>
                  <span className="text-ink-500 text-xs ml-1">in / def</span>
                </div>
              </div>
            </div>

            {/* Two-column proposal */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3">
              {/* In v0.x */}
              <section className="rounded border border-emerald-800 bg-emerald-900/10">
                <div className="px-3 py-2 border-b border-emerald-800/60 text-sm font-medium flex items-center gap-2">
                  In v0.x <span className="text-xs text-ink-400">({inScope.length})</span>
                </div>
                <ul className="max-h-[60vh] overflow-y-auto p-2 space-y-1">
                  {inScope.map((r) => (
                    <li key={r.requirement_id}>
                      <button
                        type="button"
                        onClick={() => toggleSelect('in', r.requirement_id)}
                        className={
                          'w-full text-left px-2 py-1.5 rounded text-xs border ' +
                          (selectedSide === 'in' && selectedIds.has(r.requirement_id)
                            ? 'border-emerald-400 bg-emerald-800/30'
                            : 'border-transparent hover:border-emerald-700')
                        }
                      >
                        <span className="font-mono">{r.requirement_id}</span>
                        <span className="float-right font-mono text-ink-400">${r.est_cost_usd.toFixed(2)}</span>
                      </button>
                    </li>
                  ))}
                  {inScope.length === 0 && <li className="text-xs text-ink-500 px-2 py-1">(empty)</li>}
                </ul>
              </section>

              {/* Move controls */}
              <div className="flex md:flex-col items-center justify-center gap-2 md:px-2">
                <button
                  type="button"
                  onClick={() => moveSelected('to-deferred')}
                  disabled={selectedSide !== 'in' || selectedIds.size === 0}
                  className="px-2 py-1 text-xs rounded border border-ink-700 hover:bg-ink-800 disabled:opacity-30"
                  title="move selected to deferred"
                ><ArrowLeftRight className="w-4 h-4" /></button>
                <button
                  type="button"
                  onClick={() => moveSelected('to-in')}
                  disabled={selectedSide !== 'def' || selectedIds.size === 0}
                  className="px-2 py-1 text-xs rounded border border-ink-700 hover:bg-ink-800 disabled:opacity-30"
                  title="move selected to in-scope"
                ><ArrowLeftRight className="w-4 h-4 rotate-180" /></button>
              </div>

              {/* Deferred */}
              <section className="rounded border border-ink-700 bg-ink-800/40">
                <div className="px-3 py-2 border-b border-ink-700 text-sm font-medium flex items-center gap-2">
                  Deferred to v0.2+ <span className="text-xs text-ink-400">({deferred.length})</span>
                </div>
                <ul className="max-h-[60vh] overflow-y-auto p-2 space-y-1">
                  {deferred.map((r) => (
                    <li key={r.requirement_id}>
                      <button
                        type="button"
                        onClick={() => toggleSelect('def', r.requirement_id)}
                        className={
                          'w-full text-left px-2 py-1.5 rounded text-xs border ' +
                          (selectedSide === 'def' && selectedIds.has(r.requirement_id)
                            ? 'border-amber-400 bg-amber-800/30'
                            : 'border-transparent hover:border-ink-600')
                        }
                      >
                        <span className="font-mono">{r.requirement_id}</span>
                        <span className="float-right font-mono text-ink-400">${(r.est_cost_usd || 0).toFixed(2)}</span>
                        {r.reason && <div className="text-[10px] text-ink-500 italic mt-0.5">{r.reason}</div>}
                      </button>
                    </li>
                  ))}
                  {deferred.length === 0 && <li className="text-xs text-ink-500 px-2 py-1">(empty)</li>}
                </ul>
              </section>
            </div>

            {/* Notes + lock */}
            <div className="mt-3 p-3 rounded border border-ink-700 bg-ink-800/40">
              <label className="text-xs text-ink-400">Notes (saved on snapshot)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. cut act 2 for v0.1 — re-evaluate after demo"
                className="w-full bg-ink-900 border border-ink-700 rounded p-2 text-sm mt-1 focus:outline-none focus:border-emerald-600"
              />
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-ink-400">
                  {overBudget && <span className="text-red-300">in-scope cost exceeds budget</span>}
                </div>
                <button
                  type="button"
                  onClick={lock}
                  disabled={busy || overBudget || inScope.length === 0}
                  className="px-3 py-1.5 text-sm rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 inline-flex items-center gap-1"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  {busy ? 'locking…' : (latest ? `Lock new v0.${(latest.version || 0) + 1}` : 'Lock v0.1')}
                </button>
              </div>
            </div>

            {/* History */}
            {history.length > 0 && (
              <div className="mt-4 p-3 rounded border border-ink-700 bg-ink-800/40">
                <div className="text-xs uppercase tracking-wide text-ink-400 mb-2 flex items-center gap-1">
                  <History className="w-3 h-3" /> snapshot history
                </div>
                <ul className="text-xs space-y-1">
                  {history.map((s) => (
                    <li key={s.version} className="flex items-center gap-2">
                      <span className="font-mono">{s.file_version}</span>
                      <span className="text-ink-400">{s.locked_at}</span>
                      <span className="text-emerald-300">{s.in_scope_count} in</span>
                      <span className="text-ink-400">{s.deferred_count} def</span>
                      {s.est_cost_in_scope_usd != null && (
                        <span className="text-ink-400 inline-flex items-center gap-1">
                          <Coins className="w-3 h-3" /> ${s.est_cost_in_scope_usd.toFixed(2)}
                        </span>
                      )}
                      {s.notes && <span className="italic text-ink-500 truncate">{s.notes}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
