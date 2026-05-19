import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ClipboardList, RefreshCw, Check, RotateCcw, Copy, ChevronDown, ChevronRight,
  Loader2, FileText, AlertCircle, Lock, Clock
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTs(iso) {
  if (!iso) return '';
  try { return new Date(iso).toISOString().replace('T', ' ').slice(0, 16); }
  catch (_e) { return iso; }
}

function StatusPill({ status }) {
  const map = {
    draft:    'bg-yellow-800/60 text-yellow-300 border-yellow-700',
    revise:   'bg-red-800/60 text-red-300 border-red-700',
    approved: 'bg-green-800/60 text-green-300 border-green-700',
    locked:   'bg-ink-700 text-ink-300 border-ink-600',
  };
  const cls = map[status] || map.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${cls}`}>
      {status === 'draft'    && <Clock size={10} />}
      {status === 'revise'   && <AlertCircle size={10} />}
      {status === 'approved' && <Check size={10} />}
      {status === 'locked'   && <Lock size={10} />}
      {status}
    </span>
  );
}

function TypeIcon({ type }) {
  const icons = {
    concept:   '💡',
    gate:      '🚦',
    batch:     '🖼',
    milestone: '🏗',
    release:   '🚀',
  };
  return <span className="text-base" title={type}>{icons[type] || '📋'}</span>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function doCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }
  return (
    <button
      type="button"
      onClick={doCopy}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-ink-800 hover:bg-ink-700 border border-ink-700 font-mono"
      title="Copy command"
    >
      {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
      {copied ? 'copied' : text}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Per-item row
// ---------------------------------------------------------------------------

function ItemRow({ item, projectId, onApprove, onRevise, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [reviseTxt, setReviseTxt] = useState('');
  const [showRevise, setShowRevise] = useState(false);

  const linkTarget = item.type === 'concept'
    ? `/project/${projectId}/concepts`
    : item.type === 'gate'
      ? `/project/${projectId}/gates/${item.meta?.gate_id || ''}`
      : item.type === 'milestone'
        ? `/project/${projectId}/milestones`
        : null;

  return (
    <div className="rounded-md ring-1 ring-ink-800 bg-ink-900 overflow-hidden">
      {/* Header row */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-ink-400 hover:text-ink-200 flex-shrink-0"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <TypeIcon type={item.type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono text-ink-100 truncate">{item.id}</span>
            {item.meta?.name && <span className="text-xs text-ink-400 truncate">{item.meta.name}</span>}
            {item.meta?.title && <span className="text-xs text-ink-400 truncate">{item.meta.title}</span>}
          </div>
          {item.meta?.description && (
            <div className="text-[11px] text-ink-500 truncate mt-0.5">{item.meta.description}</div>
          )}
          {typeof item.meta?.required_total === 'number' && (
            <div className="text-[11px] text-ink-500 mt-0.5">
              {item.meta.required_resolved}/{item.meta.required_total} required decisions resolved
            </div>
          )}
          {item.meta?.boots === false && (
            <div className="text-[11px] text-red-400 mt-0.5">
              Build failed — {(item.meta.errors || []).slice(0, 2).join('; ')}
            </div>
          )}
        </div>
        <StatusPill status={item.status} />
        {linkTarget && (
          <Link to={linkTarget} className="text-[11px] text-sky-400 hover:underline flex-shrink-0">
            open
          </Link>
        )}
        {/* Action buttons */}
        {item.status !== 'approved' && item.status !== 'locked' && (
          <button
            type="button"
            onClick={() => onApprove(item.id)}
            disabled={busy === item.id}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-green-900/60 hover:bg-green-800/70 text-green-300 border border-green-800 disabled:opacity-50"
          >
            {busy === item.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
            Approve
          </button>
        )}
        {item.status !== 'locked' && (
          <button
            type="button"
            onClick={() => setShowRevise((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-red-900/60 hover:bg-red-800/70 text-red-300 border border-red-800"
          >
            <RotateCcw size={10} />
            Revise
          </button>
        )}
      </div>

      {/* Revise inline input */}
      {showRevise && (
        <div className="px-3 pb-2 flex items-center gap-2 border-t border-ink-800 pt-2">
          <input
            type="text"
            value={reviseTxt}
            onChange={(e) => setReviseTxt(e.target.value)}
            placeholder="Describe what needs to change…"
            className="flex-1 text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1 text-ink-100"
          />
          <button
            type="button"
            onClick={() => { onRevise(item.id, reviseTxt); setShowRevise(false); setReviseTxt(''); }}
            disabled={!reviseTxt.trim() || busy === item.id}
            className="px-2 py-1 text-[11px] rounded bg-red-900 text-red-300 border border-red-800 disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-ink-800 px-3 py-3 space-y-3 text-xs text-ink-400">
          {/* Files */}
          {item.files && item.files.length > 0 && (
            <div>
              <div className="text-[11px] text-ink-500 mb-1 flex items-center gap-1">
                <FileText size={11} /> Files
              </div>
              <ul className="space-y-0.5 font-mono">
                {item.files.map((f) => (
                  <li key={f} className="text-ink-400 break-all">{f}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Review questions */}
          {item.review_questions && item.review_questions.length > 0 && (
            <div>
              <div className="text-[11px] text-ink-500 mb-1">Review questions</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {item.review_questions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            </div>
          )}

          {/* Copy commands */}
          <div>
            <div className="text-[11px] text-ink-500 mb-1">Commands (copy to use)</div>
            <div className="flex flex-wrap gap-2">
              {item.approve_cmd && <CopyButton text={item.approve_cmd} />}
              {item.revise_cmd  && <CopyButton text={item.revise_cmd} />}
              {item.preview_cmd && <CopyButton text={item.preview_cmd} />}
            </div>
          </div>

          {/* Changes notes if present */}
          {item.changes_notes && (
            <div>
              <div className="text-[11px] text-ink-500 mb-1">Revision notes</div>
              <div className="text-ink-300 whitespace-pre-wrap">{item.changes_notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decisions panel
// ---------------------------------------------------------------------------

function DecisionsPanel({ projectId }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/api/projects/${projectId}/decisions`)
      .then((r) => { if (alive) setItems(Array.isArray(r.items) ? r.items : []); })
      .catch((e) => { if (alive) setErr(e.message || 'failed'); });
    return () => { alive = false; };
  }, [projectId]);

  if (err) return <div className="p-3 text-xs text-red-400">{err}</div>;
  if (!items) return <div className="p-3 text-xs text-ink-500 flex gap-1"><Loader2 size={12} className="animate-spin" /> loading decisions…</div>;
  if (items.length === 0) return <div className="p-3 text-xs text-ink-500">No decisions recorded yet.</div>;

  return (
    <div className="space-y-3">
      {[...items].reverse().map((d, i) => (
        <div key={d.id || i} className="text-xs border-b border-ink-800 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-ink-400">{fmtTs(d.made_at)}</span>
            <span className="px-1.5 py-0.5 rounded bg-ink-800 text-ink-300 text-[11px]">{d.category}</span>
            <span className="text-ink-500">by {d.by}</span>
          </div>
          <div className="text-ink-100 mb-0.5"><strong>Decision:</strong> {d.decision_text}</div>
          {d.rationale && <div className="text-ink-400 mb-0.5"><strong>Rationale:</strong> {d.rationale}</div>}
          {d.references && d.references.length > 0 && (
            <div className="text-ink-500 font-mono text-[11px]">
              refs: {d.references.join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ReviewBoard() {
  const { id } = useParams();
  const [board, setBoard]     = useState(null);
  const [counts, setCounts]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy]       = useState(null);
  const [err, setErr]         = useState(null);
  const [showDecisions, setShowDecisions] = useState(false);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/review`);
      setBoard(r.board);
      setCounts(r.counts);
    } catch (e) {
      setErr(e.message || 'failed to load review board');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      await api.post(`/api/projects/${id}/review/sync`, {});
      await loadBoard();
    } catch (e) {
      setErr(e.message || 'sync failed');
    } finally { setSyncing(false); }
  }, [id, loadBoard]);

  const doApprove = useCallback(async (itemId) => {
    setBusy(itemId);
    try {
      await api.post(`/api/projects/${id}/review/approve`, { item_id: itemId });
      await loadBoard();
    } catch (e) {
      setErr(e.message || 'approve failed');
    } finally { setBusy(null); }
  }, [id, loadBoard]);

  const doRevise = useCallback(async (itemId, changes) => {
    setBusy(itemId);
    try {
      await api.post(`/api/projects/${id}/review/revise`, { item_id: itemId, changes });
      await loadBoard();
    } catch (e) {
      setErr(e.message || 'revise failed');
    } finally { setBusy(null); }
  }, [id, loadBoard]);

  // Group items by phase
  const phases = {};
  if (board && Array.isArray(board.items)) {
    for (const item of board.items) {
      const ph = item.phase;
      if (!phases[ph]) phases[ph] = [];
      phases[ph].push(item);
    }
  }
  const phaseNums = Object.keys(phases).map(Number).sort((a, b) => a - b);

  const PHASE_LABELS = {
    0: 'Phase 0 — Initial Concept',
    1: 'Phase 1 — Scope & Bible',
    2: 'Phase 2 — Visual Ship',
    3: 'Phase 3 — Code Review',
    4: 'Phase 4 — Release',
  };

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle="Review Board" />

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-ink-400" />
            <h1 className="text-base font-semibold">Review Board</h1>
            <Link to={`/project/${id}`} className="text-xs text-ink-500 hover:text-ink-300 ml-1">
              ← project
            </Link>
          </div>
          <button
            type="button"
            onClick={doSync}
            disabled={syncing}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-ink-800 hover:bg-ink-700 border border-ink-700 disabled:opacity-50"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Sync now
          </button>
        </div>

        {err && (
          <div className="mb-4 p-3 rounded bg-red-900/40 border border-red-800 text-sm text-red-300 flex items-center gap-2">
            <AlertCircle size={14} /> {err}
          </div>
        )}

        {/* Count chips */}
        {counts && (
          <div className="flex flex-wrap gap-2 mb-5">
            {[
              { label: 'pending',  value: counts.pending,  color: 'bg-yellow-900/40 text-yellow-300 border-yellow-800' },
              { label: 'approved', value: counts.approved, color: 'bg-green-900/40 text-green-300 border-green-800' },
              { label: 'locked',   value: counts.locked,   color: 'bg-ink-800 text-ink-300 border-ink-700' },
              { label: 'revise',   value: counts.revise,   color: 'bg-red-900/40 text-red-300 border-red-800' },
              { label: 'total',    value: counts.total,    color: 'bg-ink-800 text-ink-400 border-ink-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className={`px-3 py-1 rounded-full text-xs border ${color}`}>
                {value} {label}
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-ink-400 py-8 justify-center">
            <Loader2 size={16} className="animate-spin" /> loading board…
          </div>
        )}

        {!loading && !board && !err && (
          <div className="py-12 text-center space-y-3">
            <p className="text-ink-300 font-medium">Review board is empty.</p>
            <p className="text-ink-500 text-[13px] max-w-sm mx-auto">
              Sync to scan gates, concepts, and batches and populate the board.
            </p>
            <button
              type="button"
              onClick={doSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent hover:bg-accent/90 text-white text-sm font-medium disabled:opacity-50"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync to scan gates + concepts + batches
            </button>
          </div>
        )}

        {/* Items by phase */}
        {!loading && phaseNums.map((ph) => (
          <div key={ph} className="mb-6">
            <h2 className="text-xs font-semibold text-ink-500 uppercase tracking-widest mb-2">
              {PHASE_LABELS[ph] || `Phase ${ph}`}
            </h2>
            <div className="space-y-2">
              {phases[ph].map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  projectId={id}
                  onApprove={doApprove}
                  onRevise={doRevise}
                  busy={busy}
                />
              ))}
            </div>
          </div>
        ))}

        {!loading && board && (!board.items || board.items.length === 0) && (
          <div className="py-12 text-center space-y-3">
            <p className="text-ink-300 font-medium">Review board is empty.</p>
            <p className="text-ink-500 text-[13px] max-w-sm mx-auto">
              Sync to scan gates, concepts, and batches and populate the board.
            </p>
            <button
              type="button"
              onClick={doSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent hover:bg-accent/90 text-white text-sm font-medium disabled:opacity-50"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync to scan gates + concepts + batches
            </button>
          </div>
        )}

        {board && (
          <div className="text-[11px] text-ink-600 mt-2">
            Last synced: {fmtTs(board.synced_at) || 'never'}
          </div>
        )}

        {/* Decisions log panel */}
        <div className="mt-8 border border-ink-800 rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDecisions((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-ink-900 hover:bg-ink-800 text-left text-sm"
          >
            {showDecisions ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <FileText size={14} className="text-ink-500" />
            <span className="text-ink-200">View decisions log</span>
          </button>
          {showDecisions && (
            <div className="px-3 py-3 border-t border-ink-800">
              <DecisionsPanel projectId={id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
