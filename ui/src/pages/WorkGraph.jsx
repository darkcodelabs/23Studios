import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2, AlertCircle, Workflow, RefreshCw, Coins, CheckCircle2, Circle,
  XCircle, Play, X
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

const STATUS_FILL = {
  pending: '#3f3f46',         // ink-700
  in_progress: '#f59e0b',     // amber-500
  done: '#10b981',            // emerald-500
  failed: '#ef4444',          // red-500
  blocked: '#71717a',         // ink-500
  skipped: '#52525b'          // ink-600
};
const STATUS_STROKE = {
  pending: '#52525b',
  in_progress: '#fbbf24',
  done: '#34d399',
  failed: '#f87171',
  blocked: '#a1a1aa',
  skipped: '#71717a'
};

// SVG layered DAG layout. Topo-sort by depends_on to assign each node a
// layer (X coord); spread same-layer nodes evenly along Y. Pure JS, no deps.
function layoutGraph(nodes) {
  const byId = {};
  for (const n of nodes) byId[n.id] = { ...n, _layer: 0 };
  // Topo sort: layer = max(layer of deps) + 1
  function visit(id, seen) {
    if (seen.has(id)) return byId[id]._layer; // cycle guard
    seen.add(id);
    const node = byId[id];
    if (!node) return 0;
    let maxDepLayer = -1;
    for (const dep of node.depends_on || []) {
      const dl = visit(dep, seen);
      if (dl > maxDepLayer) maxDepLayer = dl;
    }
    node._layer = maxDepLayer + 1;
    return node._layer;
  }
  for (const n of nodes) visit(n.id, new Set());

  // Group by layer
  const byLayer = {};
  for (const id in byId) {
    const l = byId[id]._layer;
    (byLayer[l] = byLayer[l] || []).push(byId[id]);
  }
  const layers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
  const LAYER_W = 240;
  const NODE_H = 60;
  const PADDING_X = 40;
  const PADDING_Y = 30;

  const positioned = [];
  let maxLayerNodes = 0;
  for (const l of layers) {
    maxLayerNodes = Math.max(maxLayerNodes, byLayer[l].length);
  }
  const canvasH = Math.max(360, maxLayerNodes * NODE_H + PADDING_Y * 2);

  for (const l of layers) {
    const inLayer = byLayer[l].sort((a, b) => a.id.localeCompare(b.id));
    const slice = canvasH / (inLayer.length + 1);
    inLayer.forEach((n, i) => {
      positioned.push({
        ...n,
        _x: PADDING_X + l * LAYER_W,
        _y: PADDING_Y + (i + 1) * slice
      });
    });
  }
  const canvasW = (layers.length || 1) * LAYER_W + PADDING_X * 2;
  return { nodes: positioned, canvasW, canvasH };
}

export default function WorkGraph() {
  const { id } = useParams();
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/graph`);
      setGraph(r.graph);
    } catch (e) {
      if (e.status === 404) setGraph(null);
      else setErr(e);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function regenerate() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${id}/graph/generate`, {});
      setGraph(r.graph);
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  }

  async function patchNode(nodeId, patch) {
    try {
      const r = await api.patch(`/api/projects/${id}/graph/nodes/${encodeURIComponent(nodeId)}`, patch);
      setGraph((g) => {
        if (!g) return g;
        return { ...g, nodes: g.nodes.map((n) => n.id === nodeId ? r.node : n) };
      });
    } catch (e) { setErr(e); }
  }

  const layout = useMemo(() => {
    if (!graph || !graph.nodes) return null;
    return layoutGraph(graph.nodes);
  }, [graph]);

  const selected = useMemo(() => {
    if (!graph || !selectedId) return null;
    return graph.nodes.find((n) => n.id === selectedId) || null;
  }, [graph, selectedId]);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle={`work graph · ${id}`} showSiderailToggle={false} />
      <div className="max-w-7xl mx-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Workflow className="w-5 h-5" /> Work graph
          </h1>
          <div className="flex items-center gap-2">
            {graph && (
              <div className="text-xs text-ink-300 flex items-center gap-3">
                <span><span className="font-mono text-emerald-300">{graph.totals.done_count}</span> done</span>
                <span><span className="font-mono text-amber-300">{graph.totals.in_progress_count}</span> wip</span>
                <span><span className="font-mono text-ink-300">{graph.totals.pending_count}</span> pending</span>
                {graph.totals.failed_count > 0 && (
                  <span><span className="font-mono text-red-300">{graph.totals.failed_count}</span> failed</span>
                )}
                <span className="text-ink-400 inline-flex items-center gap-1">
                  <Coins className="w-3 h-3" /> ${graph.totals.est_cost_total_usd?.toFixed(2) ?? '—'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded border border-ink-700 hover:bg-ink-800 inline-flex items-center gap-1"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {graph ? 'regenerate' : 'generate'}
            </button>
          </div>
        </div>

        {err && (
          <div className="p-3 rounded border border-red-700 bg-red-900/30 mb-3 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>
              {err.message || String(err)}
              {err.code === 'no_scope' && (
                <div className="text-xs text-ink-400 mt-1">Lock a scope (/scope) before generating the graph.</div>
              )}
            </div>
          </div>
        )}

        {!graph && !loading && !err && (
          <div className="p-6 rounded border border-ink-700 bg-ink-800 text-sm text-ink-300">
            No work graph yet. Click <strong>generate</strong> — requires a locked scope (A6).
          </div>
        )}

        {graph && layout && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
            <section className="rounded border border-ink-700 bg-ink-800/40 overflow-auto" style={{ maxHeight: '78vh' }}>
              <svg
                width={layout.canvasW}
                height={layout.canvasH}
                style={{ display: 'block' }}
              >
                {/* Edges first so nodes draw on top */}
                <g>
                  {graph.nodes.flatMap((n) => {
                    const src = layout.nodes.find((p) => p.id === n.id);
                    if (!src) return [];
                    return (n.depends_on || []).map((depId) => {
                      const dst = layout.nodes.find((p) => p.id === depId);
                      if (!dst) return null;
                      // Source = dependent's left edge; dst = dependency's right edge
                      const x1 = dst._x + 70, y1 = dst._y;
                      const x2 = src._x - 70, y2 = src._y;
                      const mx = (x1 + x2) / 2;
                      return (
                        <path
                          key={`${depId}->${n.id}`}
                          d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                          fill="none"
                          stroke="#3f3f46"
                          strokeWidth="1.5"
                          opacity="0.6"
                        />
                      );
                    }).filter(Boolean);
                  })}
                </g>
                {/* Nodes */}
                <g>
                  {layout.nodes.map((n) => (
                    <g
                      key={n.id}
                      transform={`translate(${n._x - 70}, ${n._y - 22})`}
                      onClick={() => setSelectedId(n.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        width={140}
                        height={44}
                        rx={6}
                        ry={6}
                        fill={STATUS_FILL[n.status] || '#3f3f46'}
                        stroke={selectedId === n.id ? '#10b981' : (STATUS_STROKE[n.status] || '#52525b')}
                        strokeWidth={selectedId === n.id ? 2 : 1}
                      />
                      <text x={70} y={18} textAnchor="middle" fill="#e4e4e7" fontSize="11" fontFamily="monospace">
                        {n.id.length > 22 ? n.id.slice(0, 21) + '…' : n.id}
                      </text>
                      <text x={70} y={32} textAnchor="middle" fill="#a1a1aa" fontSize="9">
                        {n.kind} · {n.status}
                      </text>
                    </g>
                  ))}
                </g>
              </svg>
            </section>

            <aside className="rounded border border-ink-700 bg-ink-800/40 p-3 max-h-[78vh] overflow-y-auto">
              {!selected ? (
                <div className="text-xs text-ink-400">Click a node for details.</div>
              ) : (
                <div className="text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-mono text-sm">{selected.id}</div>
                    <button type="button" onClick={() => setSelectedId(null)} className="text-ink-500 hover:text-ink-300">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <Row k="title" v={selected.title} />
                    <Row k="kind" v={selected.kind} mono />
                    <Row k="status" v={selected.status} />
                    <Row k="agent" v={selected.agent_assignment} mono />
                    <Row k="prompt source" v={selected.prompt_source} mono />
                    <Row k="cost" v={`$${selected.est_cost_usd?.toFixed(2) ?? '—'}`} mono />
                    <Row k="reroll budget" v={String(selected.reroll_budget ?? 0)} mono />
                    {selected.anchor_inputs?.length > 0 && (
                      <Row k="anchors" v={selected.anchor_inputs.join('\n')} mono />
                    )}
                    {selected.skill_rules?.length > 0 && (
                      <Row k="rules" v={selected.skill_rules.join(', ')} />
                    )}
                    {selected.depends_on?.length > 0 && (
                      <Row k="depends on" v={selected.depends_on.join('\n')} mono />
                    )}
                    {selected.blocks?.length > 0 && (
                      <Row k="blocks" v={selected.blocks.join('\n')} mono />
                    )}
                    {selected.gate_blocks?.length > 0 && (
                      <Row k="gate blocks" v={selected.gate_blocks.join(', ')} mono />
                    )}
                    {selected.started_at && <Row k="started" v={selected.started_at} mono />}
                    {selected.finished_at && <Row k="finished" v={selected.finished_at} mono />}
                    {selected.output_paths?.length > 0 && (
                      <Row k="outputs" v={selected.output_paths.join('\n')} mono />
                    )}
                    {selected.attempt_log?.length > 0 && (
                      <div>
                        <div className="text-ink-400">attempts ({selected.attempt_log.length})</div>
                        <ul className="space-y-0.5 mt-1">
                          {selected.attempt_log.map((a, i) => (
                            <li key={i} className="font-mono text-[10px] text-ink-500">
                              {a.ok ? <CheckCircle2 className="w-3 h-3 inline text-emerald-400 mr-1" /> : <XCircle className="w-3 h-3 inline text-red-400 mr-1" />}
                              {a.ts} {a.cost_usd != null && `$${a.cost_usd}`} {a.note}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-ink-700">
                    <div className="text-ink-400 mb-1">manual override</div>
                    <div className="flex flex-wrap gap-1">
                      {['pending', 'in_progress', 'done', 'failed', 'skipped'].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => patchNode(selected.id, { status: s })}
                          disabled={selected.status === s}
                          className={
                            'px-2 py-0.5 rounded border text-[11px] ' +
                            (selected.status === s
                              ? 'border-emerald-600 bg-emerald-900/30 text-emerald-300 opacity-60'
                              : 'border-ink-700 hover:bg-ink-800')
                          }
                        >{s}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, mono = false }) {
  return (
    <div>
      <div className="text-ink-400 text-[10px] uppercase tracking-wide">{k}</div>
      <div className={mono ? 'font-mono whitespace-pre-wrap break-all' : 'whitespace-pre-wrap break-words'}>{v || '—'}</div>
    </div>
  );
}
