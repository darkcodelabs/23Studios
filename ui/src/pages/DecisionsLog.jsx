import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, ScrollText, Download } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

const ALL = '__all__';

function fmtTs(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch (_e) { return iso; }
}

function csvCell(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join(' | ') : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows) {
  const cols = ['ts', 'decided_by', 'category', 'question', 'options', 'choice', 'rationale', 'source_refs', 'graph_node_id', 'escalated_from'];
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

export default function DecisionsLog() {
  const { id } = useParams();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [decidedBy, setDecidedBy] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (decidedBy !== ALL) params.set('decided_by', decidedBy);
      if (category !== ALL) params.set('category', category);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      const q = params.toString();
      const r = await api.get(`/api/projects/${encodeURIComponent(id)}/decisions${q ? `?${q}` : ''}`);
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [id, decidedBy, category, from, to]);

  useEffect(() => {
    api.get('/api/decisions/_categories')
      .then((r) => setCategories(Array.isArray(r.categories) ? r.categories : []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const decidedByOptions = useMemo(() => {
    const set = new Set(['orchestrator', 'user']);
    for (const it of items) if (it.decided_by) set.add(it.decided_by);
    return Array.from(set).sort();
  }, [items]);

  const exportCsv = useCallback(() => {
    const csv = rowsToCsv(items);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decisions_${id}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [items, id]);

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText size={24} /> Decision log
          </h1>
          <button
            onClick={exportCsv}
            className="text-xs px-3 py-1.5 border border-gray-700 rounded hover:bg-gray-800 flex items-center gap-1"
            disabled={items.length === 0}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4 text-xs">
          <label className="flex flex-col gap-1">
            <span className="opacity-60">decided by</span>
            <select
              value={decidedBy}
              onChange={(e) => setDecidedBy(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            >
              <option value={ALL}>all</option>
              {decidedByOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="opacity-60">category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            >
              <option value={ALL}>all</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="opacity-60">from</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="opacity-60">to</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            />
          </label>
        </div>

        {err && <div className="p-3 bg-red-900/40 border border-red-500 rounded mb-4 text-sm">{err.message || String(err)}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 border border-gray-800 rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-left">
                <tr>
                  <th className="px-2 py-1.5 font-medium">when</th>
                  <th className="px-2 py-1.5 font-medium">who</th>
                  <th className="px-2 py-1.5 font-medium">category</th>
                  <th className="px-2 py-1.5 font-medium">question</th>
                  <th className="px-2 py-1.5 font-medium">choice</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-2 py-4 text-center opacity-60"><Loader2 className="inline animate-spin" size={14} /> loading…</td></tr>
                )}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-4 text-center opacity-60">no decisions logged yet</td></tr>
                )}
                {!loading && items.map((it, i) => (
                  <tr
                    key={`${it.ts}-${i}`}
                    onClick={() => setSelected(it)}
                    className={`cursor-pointer hover:bg-gray-800/50 border-t border-gray-800 ${selected === it ? 'bg-gray-800/70' : ''}`}
                  >
                    <td className="px-2 py-1.5 font-mono opacity-80 whitespace-nowrap">{fmtTs(it.ts)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{it.decided_by}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{it.category}</td>
                    <td className="px-2 py-1.5 truncate max-w-xs" title={it.question}>{it.question}</td>
                    <td className="px-2 py-1.5 truncate max-w-xs" title={it.choice}>{it.choice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-gray-800 rounded p-3 text-xs">
            {!selected && <div className="opacity-60">Select a row to inspect.</div>}
            {selected && (
              <div className="space-y-3">
                <div>
                  <div className="opacity-50">when</div>
                  <div className="font-mono">{fmtTs(selected.ts)}</div>
                </div>
                <div>
                  <div className="opacity-50">decided by</div>
                  <div>{selected.decided_by}</div>
                </div>
                <div>
                  <div className="opacity-50">category</div>
                  <div>{selected.category}</div>
                </div>
                <div>
                  <div className="opacity-50">question</div>
                  <div className="whitespace-pre-wrap">{selected.question}</div>
                </div>
                {selected.options && selected.options.length > 0 && (
                  <div>
                    <div className="opacity-50">options</div>
                    <ul className="list-disc pl-4">
                      {selected.options.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </div>
                )}
                <div>
                  <div className="opacity-50">choice</div>
                  <div className="whitespace-pre-wrap text-green-400">{selected.choice}</div>
                </div>
                {selected.rationale && (
                  <div>
                    <div className="opacity-50">rationale</div>
                    <div className="whitespace-pre-wrap">{selected.rationale}</div>
                  </div>
                )}
                {selected.source_refs && selected.source_refs.length > 0 && (
                  <div>
                    <div className="opacity-50">source refs</div>
                    <ul className="list-disc pl-4">
                      {selected.source_refs.map((r, i) => <li key={i} className="font-mono">{r}</li>)}
                    </ul>
                  </div>
                )}
                {selected.graph_node_id && (
                  <div>
                    <div className="opacity-50">graph node</div>
                    <div className="font-mono">{selected.graph_node_id}</div>
                  </div>
                )}
                {selected.escalated_from && (
                  <div>
                    <div className="opacity-50">escalated from</div>
                    <div>{selected.escalated_from}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
