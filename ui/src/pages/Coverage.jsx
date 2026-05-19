import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, RefreshCw, ShieldCheck, AlertCircle, AlertTriangle, XOctagon } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api, getCsrfToken } from '../lib/api.js';

function appBase() {
  if (typeof window === 'undefined') return '';
  if (window.__APP_BASE__ !== undefined) return window.__APP_BASE__;
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  return m ? m[1] : '';
}

const STATUS_BADGE = {
  covered:     { color: 'bg-emerald-900/40 border-emerald-700 text-emerald-200', icon: ShieldCheck, label: 'covered' },
  derivable:   { color: 'bg-amber-900/30 border-amber-700 text-amber-200',       icon: AlertCircle,  label: 'derivable' },
  needs_canon: { color: 'bg-orange-900/30 border-orange-700 text-orange-200',    icon: AlertTriangle, label: 'needs canon' },
  uncovered:   { color: 'bg-red-900/40 border-red-700 text-red-200',             icon: XOctagon,    label: 'uncovered' }
};

export default function Coverage() {
  const { id } = useParams();
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [err, setErr] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/requirements/coverage`);
      setRep(r.coverage || null);
    } catch (e) {
      if (e.status === 404) setRep(null);
      else setErr(e);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function runAnalyze() {
    setRunning(true);
    setProgress([]);
    setErr(null);
    try {
      const csrf = getCsrfToken();
      const r = await fetch(`${appBase()}/api/projects/${id}/requirements/coverage`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'text/event-stream', 'x-csrf-token': csrf || '' }
      });
      if (!r.ok || !r.body) {
        setErr(new Error(`coverage_failed status=${r.status}`));
        setRunning(false);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split(/\n\n/);
        buf = events.pop() || '';
        for (const blk of events) {
          const lines = blk.split('\n');
          let evt = 'message';
          const dataLines = [];
          for (const ln of lines) {
            if (ln.startsWith('event:')) evt = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataLines.push(ln.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          let payload = null;
          try { payload = JSON.parse(dataLines.join('\n')); } catch (_e) { payload = { raw: dataLines.join('\n') }; }
          setProgress((p) => [...p, { evt, payload }].slice(-100));
          if (evt === 'done') await load();
          if (evt === 'error') setErr(new Error(payload.message || 'coverage_error'));
        }
      }
    } catch (e) { setErr(e); }
    finally { setRunning(false); }
  }

  const per = (rep && rep.per_requirement) || [];
  const filtered = statusFilter === 'all' ? per : per.filter((p) => p.status === statusFilter);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle={`coverage · ${id}`} showSiderailToggle={false} />
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Coverage gaps
          </h1>
          <div className="flex items-center gap-2">
            <button type="button" onClick={load} className="px-3 py-1.5 text-sm rounded border border-ink-700 hover:bg-ink-800" disabled={loading || running}>
              <span className="inline-flex items-center gap-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} reload
              </span>
            </button>
            <button type="button" onClick={runAnalyze} className="px-3 py-1.5 text-sm rounded bg-emerald-700 hover:bg-emerald-600 text-white" disabled={running}>
              {running ? 'analyzing…' : (rep ? 're-analyze' : 'analyze now')}
            </button>
          </div>
        </div>

        {err && (
          <div className="p-3 rounded border border-red-700 bg-red-900/30 mb-4 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>{err.message || String(err)}</div>
          </div>
        )}

        {!rep && !loading && (
          <div className="p-6 rounded border border-ink-700 bg-ink-800 text-sm text-ink-300">
            No coverage report yet. Run analyze — requires derived requirements (A3) to exist first.
          </div>
        )}

        {running && progress.length > 0 && (
          <div className="mb-4 p-3 rounded border border-ink-700 bg-ink-800/50 text-xs font-mono max-h-32 overflow-auto">
            {progress.map((p, i) => (
              <div key={i}><span className="text-emerald-400">{p.evt}</span> {JSON.stringify(p.payload)}</div>
            ))}
          </div>
        )}

        {rep && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              <div className="p-3 rounded border border-ink-700 bg-ink-800">
                <div className="text-xs text-ink-400">total requirements</div>
                <div className="text-xl font-mono">{rep.totals.requirements}</div>
              </div>
              {['covered', 'derivable', 'needs_canon', 'uncovered'].map((k) => {
                const b = STATUS_BADGE[k];
                const Icon = b.icon;
                return (
                  <div key={k} className={`p-3 rounded border ${b.color}`}>
                    <div className="text-xs flex items-center gap-1"><Icon className="w-3 h-3" /> {b.label}</div>
                    <div className="text-xl font-mono">{rep.totals[k]}</div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
              <Rollup title="Scenes" rollup={rep.scenes} />
              <Rollup title="References" rollup={rep.references} mode="refs" />
              <Rollup title="Minigames" rollup={rep.minigames} mode="minigames" />
            </div>

            <div className="flex gap-2 flex-wrap mb-4">
              {['all', 'covered', 'derivable', 'needs_canon', 'uncovered'].map((k) => {
                const count = k === 'all' ? rep.totals.requirements : rep.totals[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStatusFilter(k)}
                    className={
                      'px-2 py-1 text-xs rounded border ' +
                      (statusFilter === k
                        ? 'border-emerald-500 bg-emerald-900/40 text-emerald-200'
                        : 'border-ink-700 hover:bg-ink-800')
                    }
                  >
                    {k} · {count}
                  </button>
                );
              })}
            </div>

            <div className="rounded border border-ink-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-ink-300 text-xs">
                  <tr>
                    <th className="text-left p-2">status</th>
                    <th className="text-left p-2">id</th>
                    <th className="text-left p-2">kind</th>
                    <th className="text-left p-2">title</th>
                    <th className="text-left p-2">canon</th>
                    <th className="text-left p-2">anchor</th>
                    <th className="text-left p-2">reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const b = STATUS_BADGE[p.status] || STATUS_BADGE.uncovered;
                    return (
                      <tr key={p.requirement_id} className="border-t border-ink-800 hover:bg-ink-800/40">
                        <td className="p-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded border ${b.color}`}>{b.label}</span>
                        </td>
                        <td className="p-2 font-mono text-xs text-ink-300">{p.requirement_id}</td>
                        <td className="p-2 text-xs">{p.kind}</td>
                        <td className="p-2">{p.title}</td>
                        <td className="p-2 text-xs">{p.canon_section || <span className="text-ink-500">—</span>}</td>
                        <td className="p-2 text-xs">
                          {p.has_anchor
                            ? <span className="text-emerald-300">✓</span>
                            : (p.borrowed_anchor
                              ? <span className="text-amber-300">borrow {p.borrowed_anchor.borrowed_from}</span>
                              : <span className="text-red-300">none</span>)}
                        </td>
                        <td className="p-2 text-xs text-ink-300">{p.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-ink-500 mt-2">
              {rep.canon_sections_found} canon section(s) parsed · generated_at {rep.generated_at}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Rollup({ title, rollup, mode }) {
  return (
    <div className="p-3 rounded border border-ink-700 bg-ink-800">
      <div className="text-sm font-semibold mb-2">{title} <span className="text-ink-400">({rollup.total})</span></div>
      {mode === 'refs' ? (
        <div className="space-y-1 text-xs">
          <div><span className="text-emerald-300">{rollup.anchored}</span> anchored</div>
          <div><span className="text-amber-300">{rollup.ambiguous.length}</span> ambiguous</div>
          <div><span className="text-red-300">{rollup.unanchored.length}</span> unanchored</div>
          <div className="text-ink-400 mt-1">
            {rollup._bible_chars_unreferenced} bible-named without image
          </div>
        </div>
      ) : mode === 'minigames' ? (
        <div className="space-y-1 text-xs">
          <div><span className="text-emerald-300">{rollup.covered.length}</span> covered by platform recipe</div>
          <div><span className="text-amber-300">{rollup.needs_custom_recipe.length}</span> needs custom recipe</div>
          <div><span className="text-ink-400">{rollup.deferred_by_default.length}</span> deferred-by-default</div>
        </div>
      ) : (
        <div className="space-y-1 text-xs">
          <div><span className="text-emerald-300">{rollup.covered.length}</span> covered</div>
          <div><span className="text-amber-300">{rollup.derivable.length}</span> derivable</div>
          <div><span className="text-orange-300">{rollup.needs_canon.length}</span> needs canon</div>
          <div><span className="text-red-300">{rollup.uncovered.length}</span> uncovered</div>
        </div>
      )}
    </div>
  );
}
