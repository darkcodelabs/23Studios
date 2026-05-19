import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, RefreshCw, ListTree, DollarSign, AlertCircle } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api, getCsrfToken } from '../lib/api.js';

// Honour code-server proxy mount for SSE (raw fetch outside the api lib).
function appBase() {
  if (typeof window === 'undefined') return '';
  if (window.__APP_BASE__ !== undefined) return window.__APP_BASE__;
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  return m ? m[1] : '';
}

const KIND_LABEL = {
  scene_bg: 'Scene background',
  character_portrait: 'Character portrait',
  sprite: 'Sprite',
  ui_surface: 'UI surface',
  inventory_item: 'Inventory item',
  imagetable: 'Imagetable',
  launcher_asset: 'Launcher asset',
  scene_lua: 'Scene Lua module',
  dialog_block: 'Dialog block',
  sfx_cue: 'SFX cue',
  music_bed: 'Music bed'
};

export default function Requirements() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [err, setErr] = useState(null);
  const [kindFilter, setKindFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/requirements`);
      setDoc(r.derived || null);
    } catch (e) {
      if (e.status === 404) setDoc(null);
      else setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function runDerive() {
    setRunning(true);
    setProgress([]);
    setErr(null);

    // POST via SSE — fetch() with streaming reader, since EventSource doesn't do POST.
    try {
      const csrf = getCsrfToken();
      const r = await fetch(`${appBase()}/api/projects/${id}/requirements/derive`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'text/event-stream', 'x-csrf-token': csrf || '' }
      });
      if (!r.ok || !r.body) {
        setErr(new Error(`derive_failed status=${r.status}`));
        setRunning(false);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Parse SSE: events separated by blank line, each with `event:` + `data:` lines.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split(/\n\n/);
        buf = events.pop() || '';
        for (const blk of events) {
          const lines = blk.split('\n');
          let evt = 'message';
          let dataLines = [];
          for (const ln of lines) {
            if (ln.startsWith('event:')) evt = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataLines.push(ln.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          let payload = null;
          try { payload = JSON.parse(dataLines.join('\n')); } catch (_e) { payload = { raw: dataLines.join('\n') }; }
          setProgress((p) => [...p, { evt, payload, ts: Date.now() }].slice(-200));
          if (evt === 'done') {
            // Refresh the derived doc.
            await load();
          }
          if (evt === 'error') setErr(new Error(payload.message || 'derive_error'));
        }
      }
    } catch (e) { setErr(e); }
    finally { setRunning(false); }
  }

  const reqs = (doc && doc.requirements) || [];
  const kinds = ['all', ...Object.keys(doc?.counts_by_kind || {})];
  const filtered = kindFilter === 'all' ? reqs : reqs.filter((r) => r.kind === kindFilter);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle={`requirements · ${id}`} showSiderailToggle={false} />
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ListTree className="w-5 h-5" /> Derived requirements
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="px-3 py-1.5 text-sm rounded border border-ink-700 hover:bg-ink-800"
              disabled={loading || running}
            >
              <span className="inline-flex items-center gap-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                reload
              </span>
            </button>
            <button
              type="button"
              onClick={runDerive}
              className="px-3 py-1.5 text-sm rounded bg-emerald-700 hover:bg-emerald-600 text-white"
              disabled={running}
            >
              {running ? 'deriving…' : (doc ? 're-derive' : 'derive now')}
            </button>
          </div>
        </div>

        {err && (
          <div className="p-3 rounded border border-red-700 bg-red-900/30 mb-4 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>{err.message || String(err)}</div>
          </div>
        )}

        {!doc && !loading && (
          <div className="p-6 rounded border border-ink-700 bg-ink-800 text-sm text-ink-300">
            No derived requirements yet. Click <strong>derive now</strong> to read source material
            + reference catalog and emit a structured requirements doc.
          </div>
        )}

        {running && (
          <div className="mb-4 p-3 rounded border border-ink-700 bg-ink-800/50 text-xs font-mono max-h-40 overflow-auto">
            {progress.length === 0 && <div className="text-ink-400">starting…</div>}
            {progress.map((p, i) => (
              <div key={i}><span className="text-emerald-400">{p.evt}</span> {JSON.stringify(p.payload)}</div>
            ))}
          </div>
        )}

        {doc && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="p-3 rounded border border-ink-700 bg-ink-800">
                <div className="text-xs text-ink-400">total items</div>
                <div className="text-xl font-mono">{doc.totals.total_items}</div>
              </div>
              <div className="p-3 rounded border border-ink-700 bg-ink-800">
                <div className="text-xs text-ink-400 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> 0-reroll
                </div>
                <div className="text-xl font-mono">${doc.totals.est_cost_usd_zero_reroll}</div>
              </div>
              <div className="p-3 rounded border border-ink-700 bg-ink-800">
                <div className="text-xs text-ink-400 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> 1.5-reroll avg
                </div>
                <div className="text-xl font-mono">${doc.totals.est_cost_usd_avg_reroll_1_5}</div>
              </div>
              <div className="p-3 rounded border border-ink-700 bg-ink-800">
                <div className="text-xs text-ink-400">source</div>
                <div className="text-sm font-mono truncate" title={doc.extraction_source}>
                  {doc.extraction_source}
                </div>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap mb-4">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={
                    'px-2 py-1 text-xs rounded border ' +
                    (kindFilter === k
                      ? 'border-emerald-500 bg-emerald-900/40 text-emerald-200'
                      : 'border-ink-700 hover:bg-ink-800')
                  }
                >
                  {k === 'all' ? `all · ${doc.totals.total_items}` : `${KIND_LABEL[k] || k} · ${doc.counts_by_kind[k]}`}
                </button>
              ))}
            </div>

            <div className="rounded border border-ink-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-ink-300 text-xs">
                  <tr>
                    <th className="text-left p-2">id</th>
                    <th className="text-left p-2">kind</th>
                    <th className="text-left p-2">title</th>
                    <th className="text-left p-2">anchors</th>
                    <th className="text-left p-2">deps</th>
                    <th className="text-right p-2">est $</th>
                    <th className="text-left p-2">agent</th>
                    <th className="text-left p-2">status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-ink-800 hover:bg-ink-800/40">
                      <td className="p-2 font-mono text-xs text-ink-300">{r.id}</td>
                      <td className="p-2 text-xs">{r.kind}</td>
                      <td className="p-2">{r.title}</td>
                      <td className="p-2 text-xs text-ink-400">
                        {r.anchor_refs.length > 0 ? r.anchor_refs.length : <span className="text-amber-400">unanchored</span>}
                      </td>
                      <td className="p-2 text-xs text-ink-400">{r.dependencies.length}</td>
                      <td className="p-2 text-right font-mono">{r.est_cost_usd.toFixed(2)}</td>
                      <td className="p-2 text-xs text-ink-400 truncate max-w-[180px]" title={r.agent_assignment || ''}>{r.agent_assignment || '—'}</td>
                      <td className="p-2 text-xs">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-ink-500 mt-2">generated_at {doc.generated_at}</div>
          </>
        )}
      </div>
    </div>
  );
}
