// CostPanel.jsx — Phase 6 B8 (Cost Panel)
//
// Persistent top-right panel; mounted in App.jsx and only renders on
// /project/<id>/... routes. Collapsed it shows total + cap meter; expanded
// it shows per-stage subtotals + recent calls + cap editor + CSV link.

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, DollarSign, Download, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';

const POLL_MS = 5000;

function fmtUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '$—';
  const n = Number(v);
  if (n >= 100) return '$' + n.toFixed(2);
  if (n >= 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}

function projectIdFromPath(pathname) {
  const m = pathname.match(/^\/project\/([^/]+)/);
  return m ? m[1] : null;
}

function classForPct(pct) {
  if (pct >= 100) return 'border-red-500 bg-red-950/40';
  if (pct >= 90) return 'border-yellow-500 bg-yellow-950/30';
  return 'border-ink-700 bg-ink-900';
}

function meterColor(pct) {
  if (pct >= 100) return 'bg-red-500';
  if (pct >= 90) return 'bg-yellow-500';
  if (pct >= 75) return 'bg-amber-400';
  return 'bg-emerald-500';
}

export default function CostPanel() {
  const loc = useLocation();
  const projectId = projectIdFromPath(loc.pathname);

  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  const [capInput, setCapInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Poll while a project is in view. Other routes (dashboard, login) skip
  // entirely so we don't burn API hits during navigation.
  useEffect(() => {
    if (!projectId) { setData(null); return; }
    let alive = true;
    let timer = null;
    async function fetchOnce() {
      try {
        const r = await api.get(`/api/projects/${encodeURIComponent(projectId)}/cost?recent=50`);
        if (alive) { setData(r); setErr(null); }
      } catch (e) {
        if (alive) setErr(e && (e.detail?.detail || e.detail?.error || e.message) || 'fetch_failed');
      }
    }
    fetchOnce();
    timer = setInterval(fetchOnce, POLL_MS);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [projectId]);

  const pct = data && data.cap_pct ? Math.round(data.cap_pct) : 0;
  const banner = useMemo(() => {
    if (!data || data.cap_usd == null) return null;
    if (pct >= 100) return { tone: 'red', text: `Spend cap reached (${fmtUsd(data.total_spend_usd)} / ${fmtUsd(data.cap_usd)}). New OpenRouter calls are blocked.` };
    if (pct >= 90) return { tone: 'yellow', text: `Spend at ${pct}% of cap. Approaching limit.` };
    return null;
  }, [data, pct]);

  async function saveCap() {
    if (!projectId) return;
    const v = parseFloat(capInput);
    if (!isFinite(v) || v <= 0) return;
    setSaving(true);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/cost/cap`, { cap_usd: v });
      setCapInput('');
      const r = await api.get(`/api/projects/${encodeURIComponent(projectId)}/cost?recent=50`);
      setData(r);
    } catch (_e) { /* swallow; UI shows cap unchanged */ }
    finally { setSaving(false); }
  }

  if (!projectId) return null;

  return (
    <div className="fixed bottom-2 left-2 z-40 w-[240px] font-mono text-xs text-ink-100 pointer-events-auto">
      <div className={`rounded border ${classForPct(pct)} shadow-lg shadow-black/50`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-ink-800/60 transition-colors"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <DollarSign size={14} />
          <span className="text-ink-200">Cost</span>
          <span className="ml-auto font-semibold">
            {data ? fmtUsd(data.total_spend_usd) : '—'}
          </span>
          {data && data.cap_usd != null ? (
            <span className="text-ink-400">/ {fmtUsd(data.cap_usd)}</span>
          ) : null}
        </button>

        {data && data.cap_usd != null ? (
          <div className="h-1 bg-ink-800 mx-2 mb-2 rounded overflow-hidden">
            <div className={`h-full ${meterColor(pct)} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        ) : null}

        {banner ? (
          <div className={`flex items-center gap-1.5 mx-2 mb-2 p-1.5 rounded text-[11px] ${banner.tone === 'red' ? 'bg-red-900/60 text-red-200' : 'bg-yellow-900/40 text-yellow-200'}`}>
            <AlertTriangle size={12} className="shrink-0" />
            <span className="leading-tight">{banner.text}</span>
          </div>
        ) : null}

        {open ? (
          <div className="px-2 pb-2 space-y-2 border-t border-ink-800 pt-2">
            {err ? (
              <div className="text-red-400">err: {String(err).slice(0, 80)}</div>
            ) : null}

            <div>
              <div className="text-ink-400 mb-1">by stage</div>
              {data && Object.keys(data.by_stage || {}).length ? (
                <ul className="space-y-0.5">
                  {Object.entries(data.by_stage).sort((a, b) => b[1] - a[1]).map(([stage, cost]) => (
                    <li key={stage} className="flex items-baseline">
                      <span className="text-ink-300">{stage}</span>
                      <span className="ml-auto">{fmtUsd(cost)}</span>
                    </li>
                  ))}
                </ul>
              ) : <div className="text-ink-500">no calls yet</div>}
            </div>

            {data && Object.keys(data.by_scene || {}).length ? (
              <div>
                <div className="text-ink-400 mb-1">by scene (top 8)</div>
                <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                  {Object.entries(data.by_scene).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([scene, cost]) => (
                    <li key={scene} className="flex items-baseline gap-2">
                      <span className="text-ink-300 truncate" title={scene}>{scene}</span>
                      <span className="ml-auto">{fmtUsd(cost)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <details className="text-ink-300">
              <summary className="cursor-pointer text-ink-400 mb-1 select-none">
                recent calls ({data ? data.call_count : 0})
              </summary>
              <div className="max-h-48 overflow-y-auto mt-1 space-y-1">
                {(data && data.recent_calls ? data.recent_calls : []).map((c, i) => (
                  <div key={i} className="border border-ink-800 rounded p-1 leading-tight">
                    <div className="flex items-baseline gap-1">
                      <span className="text-ink-500">
                        {new Date(c.ts).toLocaleTimeString()}
                      </span>
                      <span className="ml-auto font-semibold">{fmtUsd(c.total_cost_usd)}</span>
                    </div>
                    <div className="text-ink-400 truncate" title={c.model}>
                      {c.stage}{c.scene_id ? ` · ${c.scene_id}` : ''} · {c.model || '—'}
                    </div>
                    {c.prompt_tokens || c.completion_tokens ? (
                      <div className="text-ink-500">
                        {c.prompt_tokens || 0} in / {c.completion_tokens || 0} out
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>

            <div className="border-t border-ink-800 pt-2">
              <div className="text-ink-400 mb-1">cap</div>
              <div className="flex gap-1 items-center">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={capInput}
                  placeholder={data && data.cap_usd != null ? String(data.cap_usd) : 'usd'}
                  onChange={(e) => setCapInput(e.target.value)}
                  className="flex-1 bg-ink-950 border border-ink-700 rounded px-1.5 py-0.5 text-ink-100 focus:border-ink-500 outline-none"
                />
                <button
                  type="button"
                  disabled={saving || !capInput}
                  onClick={saveCap}
                  className="px-2 py-0.5 bg-ink-800 hover:bg-ink-700 border border-ink-700 rounded disabled:opacity-40"
                >set</button>
              </div>
            </div>

            <a
              href={((typeof window !== 'undefined' && window.__APP_BASE__) || '') +
                `/api/projects/${encodeURIComponent(projectId)}/cost/export.csv`}
              className="flex items-center gap-1 text-ink-400 hover:text-ink-200"
            >
              <Download size={12} /> export csv
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
