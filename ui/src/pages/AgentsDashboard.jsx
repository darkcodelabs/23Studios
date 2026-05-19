import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, AlertTriangle, X, Users, Clock,
  CheckCircle2, XCircle, Activity, Crown, ChevronRight
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

const REFRESH_MS = 5000;

function fmtRelative(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statusColor(status) {
  if (status === 'awaiting_permission') return 'bg-amber-400';
  if (status === 'idle') return 'bg-green-400';
  if (status === 'unknown') return 'bg-ink-500';
  return 'bg-ink-500';
}

function statusLabel(status) {
  if (status === 'awaiting_permission') return 'awaiting permission';
  return status || 'unknown';
}

export default function AgentsDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState('all'); // all | pending | idle
  const [teamFilter, setTeamFilter] = useState('all');
  const [detail, setDetail] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await api.get('/api/agents');
      setData(r);
      setErr(null);
    } catch (e) {
      setErr(e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const teams = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.agents.map((a) => a.team))).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.agents.filter((a) => {
      if (teamFilter !== 'all' && a.team !== teamFilter) return false;
      if (filter === 'pending' && a.status !== 'awaiting_permission') return false;
      if (filter === 'idle' && a.status === 'awaiting_permission') return false;
      return true;
    });
  }, [data, filter, teamFilter]);

  const pendingCount = useMemo(() => {
    if (!data) return 0;
    return data.agents.reduce((n, a) => n + a.pending_permissions.length, 0);
  }, [data]);

  async function handleDecision(agent, requestId, approve) {
    try {
      await api.post(`/api/agents/${encodeURIComponent(agent.team)}/${encodeURIComponent(agent.name)}/permission`, {
        request_id: requestId,
        approve
      });
      // Optimistic: drop the decided permission locally so the banner clears.
      setData((d) => {
        if (!d) return d;
        const agents = d.agents.map((a) => {
          if (a.team !== agent.team || a.name !== agent.name) return a;
          const pending = a.pending_permissions.filter((p) => p.request_id !== requestId);
          return { ...a, pending_permissions: pending, status: pending.length > 0 ? 'awaiting_permission' : (a.last_activity_ms ? 'idle' : 'unknown') };
        });
        return { ...d, agents };
      });
      // Server-truth refresh.
      load(true);
    } catch (e) {
      alert(`failed to record decision: ${e.detail?.detail || e.message || 'unknown'}`);
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle="agents" />
      <div className="px-4 py-3 border-b border-ink-800 flex items-center gap-3">
        <h1 className="text-sm text-ink-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-ink-400" />
          Agent dashboard
          {data ? <span className="text-ink-500 text-xs font-mono">{filtered.length}/{data.count}</span> : null}
        </h1>
        {pendingCount > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 text-xs">
            <AlertTriangle className="w-3 h-3" />
            {pendingCount} pending permission{pendingCount === 1 ? '' : 's'}
          </span>
        ) : null}
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-xs">
          <FilterChip label="all" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterChip label="pending" active={filter === 'pending'} onClick={() => setFilter('pending')} />
          <FilterChip label="idle" active={filter === 'idle'} onClick={() => setFilter('idle')} />
        </div>
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="bg-ink-800/60 border-0 border-b border-b-ink-700 focus:border-b-accent text-ink-100 rounded-md px-2 py-1 text-xs font-mono outline-none"
        >
          <option value="all">all teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          type="button"
          className={`btn text-xs ${autoRefresh ? 'text-accent' : ''}`}
          onClick={() => setAutoRefresh((v) => !v)}
          title={autoRefresh ? 'auto-refresh every 5s (click to pause)' : 'paused — click to resume'}
        >
          <Activity className="w-3 h-3" /> {autoRefresh ? 'live' : 'paused'}
        </button>
        <button type="button" className="btn-icon" onClick={() => load()} title="refresh now" aria-label="refresh">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {err ? (
        <div className="px-4 py-3 text-sm text-red-400">
          failed to load agents: {err.detail?.detail || err.message || 'unknown'}
        </div>
      ) : null}

      {!data && loading ? (
        <div className="p-6 flex items-center gap-2 text-ink-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> reading teams…
        </div>
      ) : data && data.count === 0 ? (
        <div className="p-10 text-center text-ink-500 text-sm">
          No teams found under <span className="font-mono">~/.claude/teams/</span>
        </div>
      ) : (
        <div
          className="p-4 grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}
        >
          {filtered.map((a) => (
            <AgentCard
              key={`${a.team}::${a.name}`}
              agent={a}
              onOpenDetail={() => setDetail(a)}
              onDecision={(reqId, approve) => handleDecision(a, reqId, approve)}
            />
          ))}
        </div>
      )}

      {detail ? (
        <AgentDetailModal
          teamName={detail.team}
          agentName={detail.name}
          onClose={() => setDetail(null)}
          onDecision={(reqId, approve) => handleDecision(detail, reqId, approve)}
        />
      ) : null}
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-xs ${active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800/60'}`}
    >
      {label}
    </button>
  );
}

function AgentCard({ agent, onOpenDetail, onDecision }) {
  const hasPending = agent.pending_permissions.length > 0;
  return (
    <div className={`rounded-xl bg-ink-900 ring-1 ${hasPending ? 'ring-amber-500/50' : 'ring-ink-800'} overflow-hidden hover:ring-ink-700/60 transition-shadow`}>
      <div className="px-3 py-2 border-b border-ink-800 flex items-center gap-2">
        <span className={`pill-dot ${statusColor(agent.status)}`} />
        {agent.is_lead ? <Crown className="w-3 h-3 text-amber-400 shrink-0" title="team lead" /> : null}
        <span className="text-sm text-ink-100 font-medium truncate">{agent.name}</span>
        <span className="text-[10px] text-ink-500 font-mono truncate">{agent.team}</span>
        <div className="flex-1" />
        <span className="text-[10px] text-ink-500 font-mono whitespace-nowrap" title={agent.last_activity_iso || ''}>
          <Clock className="w-3 h-3 inline -mt-0.5 mr-0.5" />{fmtRelative(agent.last_activity_iso)}
        </span>
      </div>

      {hasPending ? (
        <div className="px-3 py-2.5 bg-amber-500/10 border-b border-amber-500/30">
          <div className="flex items-center gap-1.5 text-amber-300 text-xs font-semibold mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            pending permission{agent.pending_permissions.length > 1 ? `s · ${agent.pending_permissions.length}` : ''}
          </div>
          {agent.pending_permissions.map((p) => (
            <PermissionBanner key={p.request_id} req={p} onDecision={onDecision} />
          ))}
        </div>
      ) : null}

      <div className="px-3 py-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-ink-400">
        <div>type</div>
        <div className="text-ink-300 font-mono truncate" title={agent.agent_type || ''}>{agent.agent_type || '—'}</div>
        <div>status</div>
        <div className="text-ink-300 font-mono">{statusLabel(agent.status)}</div>
        <div>backend</div>
        <div className="text-ink-300 font-mono">{agent.backend_type || '—'}</div>
        <div>cwd</div>
        <div className="text-ink-300 font-mono truncate" title={agent.cwd || ''}>{agent.cwd || '—'}</div>
        <div>model</div>
        <div className="text-ink-300 font-mono truncate" title={agent.model || ''}>{agent.model || '—'}</div>
      </div>

      <div className="px-3 py-2 border-t border-ink-800 flex items-center gap-2">
        <button type="button" className="btn text-xs" onClick={onOpenDetail}>
          inbox <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function PermissionBanner({ req, onDecision }) {
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState(null);

  async function decide(approve) {
    if (busy || decided) return;
    setBusy(true);
    try {
      await onDecision(req.request_id, approve);
      setDecided(approve ? 'approved' : 'denied');
    } finally {
      setBusy(false);
    }
  }

  const inputPreview = (() => {
    if (!req.input) return null;
    if (typeof req.input === 'string') return req.input;
    if (req.input.command) return req.input.command;
    try { return JSON.stringify(req.input); } catch (_e) { return null; }
  })();

  return (
    <div className="rounded-md bg-ink-900/70 ring-1 ring-amber-500/30 p-2 mb-1.5 last:mb-0">
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="pill text-[10px] bg-amber-500/20 text-amber-200">{req.tool_name || 'tool'}</span>
        <span className="text-ink-300 truncate">{req.description || '(no description)'}</span>
      </div>
      {inputPreview ? (
        <pre className="text-[10px] font-mono text-ink-400 bg-ink-950/60 rounded p-1.5 mb-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-all">{inputPreview}</pre>
      ) : null}
      <div className="flex items-center gap-1.5 text-[10px] text-ink-500">
        <span className="font-mono truncate">req: {req.request_id}</span>
        <span>·</span>
        <span>{fmtRelative(req.requested_at)}</span>
        <div className="flex-1" />
        {decided === 'approved' ? (
          <span className="inline-flex items-center gap-1 text-green-400 text-[11px]">
            <CheckCircle2 className="w-3 h-3" /> approved
          </span>
        ) : decided === 'denied' ? (
          <span className="inline-flex items-center gap-1 text-red-400 text-[11px]">
            <XCircle className="w-3 h-3" /> denied
          </span>
        ) : (
          <>
            <button
              type="button"
              className="btn text-[11px] py-1 px-2"
              disabled={busy}
              onClick={() => decide(false)}
              title="record deny decision"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />} deny
            </button>
            <button
              type="button"
              className="btn-primary text-[11px] py-1 px-2"
              disabled={busy}
              onClick={() => decide(true)}
              title="record approve decision"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AgentDetailModal({ teamName, agentName, onClose, onDecision }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/api/agents/${encodeURIComponent(teamName)}/${encodeURIComponent(agentName)}`);
        if (alive) setData(r.agent);
      } catch (e) {
        if (alive) setErr(e);
      }
    })();
    return () => { alive = false; };
  }, [teamName, agentName]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.currentTarget === e.target) onClose(); }}
      className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-6"
    >
      <div className="bg-ink-900 ring-1 ring-ink-800 rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-4 h-11 flex items-center gap-2 border-b border-ink-800">
          <Users className="w-4 h-4 text-ink-500" />
          <span className="text-sm text-ink-200 font-mono">{agentName}</span>
          <span className="text-[11px] text-ink-500 font-mono">@ {teamName}</span>
          <div className="flex-1" />
          <button type="button" className="btn-icon" onClick={onClose} aria-label="close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs">
          {err ? (
            <div className="text-red-400">failed to load: {err.detail?.detail || err.message || 'unknown'}</div>
          ) : !data ? (
            <div className="flex items-center gap-2 text-ink-500"><Loader2 className="w-4 h-4 animate-spin" /> loading…</div>
          ) : (
            <>
              {data.pending_permissions.length > 0 ? (
                <section>
                  <h3 className="text-amber-300 text-[11px] uppercase tracking-wider mb-2">Pending permissions</h3>
                  <div className="space-y-2">
                    {data.pending_permissions.map((p) => (
                      <PermissionBanner key={p.request_id} req={p} onDecision={onDecision} />
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-1 text-[11px]">
                <div className="text-ink-400">type</div>           <div className="font-mono">{data.agent_type || '—'}</div>
                <div className="text-ink-400">model</div>          <div className="font-mono">{data.model || '—'}</div>
                <div className="text-ink-400">backend</div>        <div className="font-mono">{data.backend_type || '—'}</div>
                <div className="text-ink-400">cwd</div>            <div className="font-mono break-all">{data.cwd || '—'}</div>
                <div className="text-ink-400">is lead</div>        <div className="font-mono">{data.is_lead ? 'yes' : 'no'}</div>
                <div className="text-ink-400">last activity</div>  <div className="font-mono">{data.last_activity_iso ? `${fmtRelative(data.last_activity_iso)} · ${data.last_activity_iso}` : '—'}</div>
              </section>

              {data.prompt ? (
                <section>
                  <h3 className="text-ink-400 text-[11px] uppercase tracking-wider mb-1">Spawn prompt</h3>
                  <pre className="bg-ink-950/50 rounded p-2 text-[10px] font-mono text-ink-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {data.prompt.slice(0, 4000)}{data.prompt.length > 4000 ? '\n…(truncated)' : ''}
                  </pre>
                </section>
              ) : null}

              <section>
                <h3 className="text-ink-400 text-[11px] uppercase tracking-wider mb-1">Recent messages</h3>
                <div className="space-y-1.5">
                  {(data.recent_messages || []).length === 0 ? (
                    <div className="text-ink-500 italic">(empty)</div>
                  ) : data.recent_messages.map((m, i) => (
                    <div key={i} className="rounded bg-ink-800/40 p-2">
                      <div className="flex items-center gap-2 text-[10px] text-ink-500 mb-1">
                        <span className="font-mono">{m.from || '?'}</span>
                        {m.summary ? <span>· {m.summary}</span> : null}
                        <div className="flex-1" />
                        <span>{fmtRelative(m.timestamp)}</span>
                      </div>
                      <div className="text-[11px] text-ink-300 font-mono whitespace-pre-wrap break-words">
                        {m.text_preview || '(empty)'}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
