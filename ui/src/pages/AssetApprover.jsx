import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  RefreshCw, Loader2, AlertTriangle, Check, X, Repeat, Shuffle,
  Shield, Clock, Image as ImageIcon, ChevronLeft, ChevronRight, Sparkles
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// Phase 6 B3 — Asset Approver.
//
// Side-by-side review of generated images vs. their anchor, prompt, canon
// sections, SKILL.md rule checks, and drift verdict. Hotkeys drive the queue
// so the operator never needs to touch the mouse:
//
//   A         approve
//   R         reject
//   space     defer (move to tail)
//   1         reroll_same
//   2         reroll_variant
//   3         fallback_safe
//   J / →     next item
//   K / ←     prev item
//   ?         show key map

const HOTKEYS = [
  { key: 'A',        decision: 'approve',        label: 'Approve',         icon: Check,    cls: 'bg-emerald-600 hover:bg-emerald-500' },
  { key: 'R',        decision: 'reject',         label: 'Reject',          icon: X,        cls: 'bg-red-600 hover:bg-red-500' },
  { key: 'Space',    decision: 'defer',          label: 'Defer',           icon: Clock,    cls: 'bg-ink-700 hover:bg-ink-600' },
  { key: '1',        decision: 'reroll_same',    label: 'Reroll · same',   icon: Repeat,   cls: 'bg-amber-600 hover:bg-amber-500' },
  { key: '2',        decision: 'reroll_variant', label: 'Reroll · variant',icon: Shuffle,  cls: 'bg-amber-600 hover:bg-amber-500' },
  { key: '3',        decision: 'fallback_safe',  label: 'Fallback (safe)', icon: Shield,   cls: 'bg-sky-600 hover:bg-sky-500' }
];

function rawAssetUrl(projectId, relPath) {
  if (!relPath) return null;
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

function Pill({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-ink-800 text-ink-300 border-ink-700',
    ok:      'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warn:    'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad:     'bg-red-500/15 text-red-300 border-red-500/30'
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  );
}

function ImagePane({ projectId, relPath, label, placeholderNote }) {
  const src = rawAssetUrl(projectId, relPath);
  const [errored, setErrored] = useState(false);
  return (
    <div className="flex flex-col bg-ink-800 border border-ink-700 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-400 flex items-center justify-between">
        <span>{label}</span>
        {relPath ? <span className="font-mono text-ink-500 truncate ml-2 max-w-[70%]" title={relPath}>{relPath}</span> : null}
      </div>
      <div className="relative flex-1 bg-ink-900 flex items-center justify-center min-h-[180px]">
        {src && !errored ? (
          <img
            src={src}
            alt={label}
            className="max-h-full max-w-full image-render-pixel"
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="text-ink-500 text-xs flex flex-col items-center gap-1">
            <ImageIcon className="w-6 h-6 opacity-40" />
            <span>{placeholderNote || 'no image'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RuleCheckRow({ check }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 border-b border-ink-800 last:border-b-0">
      {check.pass ? (
        <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
      ) : (
        <X className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-200 truncate">
          <span className="font-mono text-ink-400">{check.rule}</span>{check.rule ? ' · ' : ''}{check.label}
        </div>
        {check.note ? <div className="text-[11px] text-red-300 mt-0.5">{check.note}</div> : null}
      </div>
    </div>
  );
}

function DriftBadge({ verdict }) {
  if (!verdict || !verdict.flagged) {
    return <Pill tone="ok">drift · clean</Pill>;
  }
  const dist = verdict.perceptual_distance;
  const thresh = verdict.threshold;
  return (
    <Pill tone="bad">
      drift · {verdict.kind || 'flag'}{dist != null ? ` · d=${dist}` : ''}{thresh != null ? `/${thresh}` : ''}
    </Pill>
  );
}

function HotkeyHint() {
  return (
    <div className="text-[11px] text-ink-500 leading-relaxed">
      <div><span className="font-mono text-ink-300">A</span> approve · <span className="font-mono text-ink-300">R</span> reject · <span className="font-mono text-ink-300">space</span> defer</div>
      <div><span className="font-mono text-ink-300">1</span> reroll same · <span className="font-mono text-ink-300">2</span> reroll variant · <span className="font-mono text-ink-300">3</span> fallback</div>
      <div><span className="font-mono text-ink-300">J/→</span> next · <span className="font-mono text-ink-300">K/←</span> prev</div>
    </div>
  );
}

export default function AssetApprover() {
  const { id: projectId } = useParams();
  const [queue, setQueue] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [reason, setReason] = useState('');
  const reasonRef = useRef(null);

  const refresh = useCallback(async (preserveCursor = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/approvals/queue`);
      const items = (r && r.items) || [];
      setQueue({ items, count: r?.count || items.length, total_cost_usd: r?.total_cost_usd || 0 });
      if (!preserveCursor) setCursor(0);
      else setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
    } catch (e) {
      setError(e && e.message ? String(e.message) : 'failed to load queue');
      setQueue({ items: [], count: 0, total_cost_usd: 0 });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refresh(false); }, [refresh]);

  const items = queue?.items || [];
  const current = items[cursor] || null;

  const goNext = useCallback(() => {
    setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)));
    setReason('');
  }, [items.length]);
  const goPrev = useCallback(() => {
    setCursor((c) => Math.max(c - 1, 0));
    setReason('');
  }, []);

  const decide = useCallback(async (decision) => {
    if (!current || deciding) return;
    setDeciding(true);
    setError(null);
    try {
      const r = await api.post(
        `/api/projects/${projectId}/approvals/${encodeURIComponent(current.asset_id)}/decide`,
        { decision, reason: reason || undefined }
      );
      setLastResult({ asset_id: current.asset_id, decision: r.decision, removed: !!r.removed_from_queue });
      setReason('');
      // Optimistic: drop item if removed; keep + bump cursor if deferred.
      if (r.removed_from_queue) {
        setQueue((q) => {
          if (!q) return q;
          const next = { ...q, items: q.items.filter((x) => x.asset_id !== current.asset_id) };
          next.count = next.items.length;
          return next;
        });
        // Cursor stays at same index — the next item slides into place.
        setCursor((c) => Math.min(c, Math.max(0, items.length - 2)));
      } else {
        // Defer — refetch so server-side sort places it correctly.
        await refresh(true);
      }
    } catch (e) {
      setError(e && e.message ? String(e.message) : 'decide failed');
    } finally {
      setDeciding(false);
    }
  }, [current, deciding, projectId, reason, refresh, items.length]);

  // Hotkeys — disabled while typing in the reason field.
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); decide('approve'); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); decide('reject'); }
      else if (e.key === ' ')                 { e.preventDefault(); decide('defer'); }
      else if (e.key === '1')                 { e.preventDefault(); decide('reroll_same'); }
      else if (e.key === '2')                 { e.preventDefault(); decide('reroll_variant'); }
      else if (e.key === '3')                 { e.preventDefault(); decide('fallback_safe'); }
      else if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'k' || e.key === 'ArrowLeft')  { e.preventDefault(); goPrev(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, goNext, goPrev]);

  const totalCost = useMemo(() => (queue?.total_cost_usd || 0).toFixed(4), [queue]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <Nav subtitle="Asset approver" />
      <div className="px-4 py-2 border-b border-ink-800 bg-ink-900 flex items-center gap-3 text-sm">
        <Link to={`/project/${projectId}`} className="text-ink-400 hover:text-ink-200">← project</Link>
        <span className="text-ink-500">·</span>
        <span className="text-ink-300">
          {loading ? '…' : `${items.length} pending`}
          {items.length > 0 ? ` · ${cursor + 1} / ${items.length}` : ''}
        </span>
        <span className="text-ink-500">·</span>
        <span className="text-ink-500 text-xs">queue cost ${totalCost}</span>
        <div className="flex-1" />
        {lastResult ? (
          <span className="text-xs text-ink-400">
            last: <span className="text-ink-200">{lastResult.asset_id}</span> → <span className="text-ink-200">{lastResult.decision}</span>{lastResult.removed ? '' : ' (deferred)'}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => refresh(true)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs"
          disabled={loading}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} refresh
        </button>
      </div>

      {error ? (
        <div className="mx-4 mt-3 px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      ) : null}

      {loading && !queue ? (
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> loading queue…
        </div>
      ) : !current ? (
        <div className="flex-1 flex flex-col items-center justify-center text-ink-400 text-sm gap-2">
          <Sparkles className="w-6 h-6 opacity-50" />
          queue is empty — nothing to approve
          <Link to={`/project/${projectId}`} className="text-ink-300 hover:text-ink-100 underline mt-2">back to project</Link>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 p-3 overflow-hidden">
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-3 min-h-0">
            <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
              <ImagePane projectId={projectId} relPath={current.generated_path} label="output" placeholderNote="no generated image yet" />
              <ImagePane projectId={projectId} relPath={current.anchor_path}    label="anchor" placeholderNote="no anchor reference" />
            </div>
            <div className="bg-ink-800 border border-ink-700 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] uppercase tracking-wide text-ink-400">prompt</span>
                <span className="text-[11px] text-ink-500">· attempt {current.attempts || 1}</span>
              </div>
              <div className="text-xs text-ink-200 font-mono whitespace-pre-wrap break-words max-h-32 overflow-auto">
                {current.prompt_text || <span className="text-ink-500">no prompt recorded</span>}
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-4 flex flex-col gap-3 min-h-0 overflow-auto">
            <div className="bg-ink-800 border border-ink-700 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-ink-400">{current.kind || 'asset'}</span>
                <span className="font-mono text-[11px] text-ink-300">{current.asset_id}</span>
              </div>
              <div className="text-[11px] text-ink-500 flex flex-wrap gap-x-3 gap-y-1">
                {current.scene_id ? <span>scene <span className="text-ink-300">{current.scene_id}</span></span> : null}
                {current.character_id ? <span>character <span className="text-ink-300">{current.character_id}</span></span> : null}
                {current.cost_usd ? <span>cost <span className="text-ink-300">${(+current.cost_usd).toFixed(4)}</span></span> : null}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <DriftBadge verdict={current.drift_verdict} />
                {current.skill_pass ? (
                  <Pill tone="ok">skill · {current.skill_rule_checks?.length || 0} pass</Pill>
                ) : (
                  <Pill tone="bad">skill · {current.skill_failed_count} failed</Pill>
                )}
              </div>
            </div>

            <div className="bg-ink-800 border border-ink-700 rounded-lg">
              <div className="px-3 py-1.5 border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-400">
                canon sections
              </div>
              <div className="p-2 flex flex-wrap gap-1.5">
                {(current.canon_sections || []).length === 0 ? (
                  <span className="text-[11px] text-ink-500 px-1">no canon refs</span>
                ) : current.canon_sections.map((s) => (
                  <span key={s} className="inline-flex items-center px-1.5 py-0.5 text-[10px] rounded bg-ink-900 border border-ink-700 font-mono text-ink-200">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-ink-800 border border-ink-700 rounded-lg">
              <div className="px-3 py-1.5 border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-400 flex items-center justify-between">
                <span>SKILL.md rules</span>
                {current.skill_rule_checks?.length ? (
                  <span className="text-[10px] text-ink-500">{current.skill_rule_checks.length} checks</span>
                ) : null}
              </div>
              {(current.skill_rule_checks || []).length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-ink-500">no rules evaluated</div>
              ) : (
                <div>
                  {current.skill_rule_checks.map((c, i) => <RuleCheckRow key={i} check={c} />)}
                </div>
              )}
            </div>

            <div className="bg-ink-800 border border-ink-700 rounded-lg p-3 space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-ink-400 block">
                reason (optional · attached to decision log)
              </label>
              <textarea
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="why this decision?"
                className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-accent/60 font-mono"
              />
              <div className="grid grid-cols-3 gap-1.5">
                {HOTKEYS.map(({ key, decision, label, icon: Icon, cls }) => (
                  <button
                    key={decision}
                    type="button"
                    onClick={() => decide(decision)}
                    disabled={deciding}
                    title={`hotkey: ${key}`}
                    className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] text-white disabled:opacity-50 ${cls}`}
                  >
                    <Icon className="w-3 h-3" />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={goPrev}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 text-ink-100 text-[11px]"
                  disabled={cursor === 0}
                >
                  <ChevronLeft className="w-3 h-3" /> prev
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 text-ink-100 text-[11px]"
                  disabled={cursor >= items.length - 1}
                >
                  next <ChevronRight className="w-3 h-3" />
                </button>
                <div className="flex-1" />
                {deciding ? <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-400" /> : null}
              </div>
              <div className="border-t border-ink-700 pt-2">
                <HotkeyHint />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
