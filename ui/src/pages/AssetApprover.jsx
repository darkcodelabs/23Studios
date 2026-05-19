import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Check, X, RotateCcw, Shuffle, Shield, SkipForward,
  Loader2, ChevronLeft, ChevronRight, AlertCircle, FileText
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

const PENDING = new Set(['pending', 'deferred', 'defer', null, undefined]);

// One-letter / number hotkeys per spec. The numeric keys cover the three
// re-roll / fallback actions so power users can blast through 50 assets.
const HOTKEYS = {
  a:    'approve',
  r:    'reject',
  ' ':  'defer',
  '1':  'reroll_same',
  '2':  'reroll_variant',
  '3':  'fallback_safe'
};

const DECISION_META = {
  approve:        { label: 'Approve',           tone: 'emerald', Icon: Check,       hint: 'A' },
  reject:         { label: 'Reject',            tone: 'rose',    Icon: X,           hint: 'R' },
  reroll_same:    { label: 'Re-roll same',      tone: 'amber',   Icon: RotateCcw,   hint: '1' },
  reroll_variant: { label: 'Re-roll variant',   tone: 'amber',   Icon: Shuffle,     hint: '2' },
  fallback_safe:  { label: 'Filter-safe §',     tone: 'sky',     Icon: Shield,      hint: '3' },
  defer:          { label: 'Defer',             tone: 'zinc',    Icon: SkipForward, hint: 'Space' }
};

const TONE_CLASSES = {
  emerald: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  rose:    'bg-rose-600 hover:bg-rose-500 text-white',
  amber:   'bg-amber-600 hover:bg-amber-500 text-white',
  sky:     'bg-sky-600 hover:bg-sky-500 text-white',
  zinc:    'bg-zinc-700 hover:bg-zinc-600 text-white'
};

function DriftBadge({ score }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-zinc-400">drift n/a</span>;
  }
  // Lower = closer to anchor. Show a hint band.
  const band = score < 0.2 ? 'emerald' : score < 0.5 ? 'amber' : 'rose';
  const cls = {
    emerald: 'bg-emerald-900/60 text-emerald-200',
    amber:   'bg-amber-900/60 text-amber-200',
    rose:    'bg-rose-900/60 text-rose-200'
  }[band];
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>
      drift {score.toFixed(2)}
    </span>
  );
}

function SkillRuleList({ results }) {
  if (!Array.isArray(results) || results.length === 0) {
    return <div className="text-xs text-zinc-400">no SKILL.md rules checked</div>;
  }
  return (
    <ul className="text-xs space-y-1">
      {results.map((r, i) => {
        const ok = r.pass !== false;
        return (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-0.5 ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>
              {ok ? <Check size={12} /> : <X size={12} />}
            </span>
            <span className="text-zinc-200">
              <span className="font-mono opacity-70">#{r.rule || r.id || '?'}</span>{' '}
              <span>{r.label || r.message || (ok ? 'pass' : 'fail')}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function AssetApprover() {
  const { id } = useParams();
  const [queue, setQueue] = useState([]);
  const [meta, setMeta] = useState({ pending_count: 0, decided_count: 0, total: 0, cost_so_far: 0, gates_blocked: 0 });
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(null);

  const pending = useMemo(() => queue.filter((it) => PENDING.has(it.status)), [queue]);
  const current = pending[cursor] || null;

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${encodeURIComponent(id)}/approvals/queue`);
      setQueue(r.queue || []);
      setMeta({
        pending_count: r.pending_count || 0,
        decided_count: r.decided_count || 0,
        total:         r.total || 0,
        cost_so_far:   r.cost_so_far || 0,
        gates_blocked: r.gates_blocked || 0
      });
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const decide = useCallback(async (decision) => {
    if (!current || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post(
        `/api/projects/${encodeURIComponent(id)}/approvals/${encodeURIComponent(current.id)}/decide`,
        { decision }
      );
      // Replace this item in queue with decided version, advance cursor.
      setQueue((prev) => prev.map((it) => (it.id === current.id ? r.item : it)));
      setMeta((m) => {
        const wasPending = PENDING.has(current.status);
        const stillPending = PENDING.has(r.item.status);
        const delta = wasPending && !stillPending ? -1 : 0;
        return {
          ...m,
          pending_count: Math.max(0, m.pending_count + delta),
          decided_count: m.decided_count - delta,
          gates_blocked: r.item.status === 'reject' ? m.gates_blocked + 1 : m.gates_blocked
        };
      });
      // Keep cursor pointed at "next pending"; if we just decided the last,
      // clamp it.
      setCursor((c) => Math.min(c, Math.max(0, pending.length - 2)));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }, [current, busy, id, pending.length]);

  // Hotkeys: A/R/space + 1/2/3 + arrow keys for nav.
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (fullscreen && e.key === 'Escape') { setFullscreen(null); return; }
      const key = e.key.toLowerCase();
      if (HOTKEYS[key]) {
        e.preventDefault();
        decide(HOTKEYS[key]);
        return;
      }
      if (e.key === 'ArrowRight') { setCursor((c) => Math.min(c + 1, Math.max(0, pending.length - 1))); }
      if (e.key === 'ArrowLeft')  { setCursor((c) => Math.max(0, c - 1)); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, pending.length, fullscreen]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <Nav />

      <div className="flex-1 flex flex-col px-6 pt-4 pb-20">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold">Asset Approver</h1>
            <p className="text-sm text-zinc-400">
              One decision per asset. Hotkeys: A approve · R reject · Space defer · 1 reroll · 2 variant · 3 §-safe
            </p>
          </div>
          <button
            onClick={fetchQueue}
            className="text-xs px-3 py-1.5 border border-zinc-700 rounded hover:bg-zinc-800"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh queue'}
          </button>
        </div>

        {err && (
          <div className="mb-3 p-3 rounded border border-rose-700 bg-rose-950/60 text-rose-200 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5" />
            <div>{err.message || String(err)}</div>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
            <Loader2 className="animate-spin mr-2" size={16} /> loading queue…
          </div>
        )}

        {!loading && !current && (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 text-sm">
            <FileText size={32} className="mb-3 opacity-60" />
            <div>Nothing to approve.</div>
            <div className="text-xs mt-1">
              {meta.decided_count} decided · {meta.total} total
            </div>
          </div>
        )}

        {!loading && current && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
            {/* LEFT: prompt + canon + skill */}
            <div className="flex flex-col gap-3 min-h-0">
              <section className="border border-zinc-800 rounded p-3 bg-zinc-900/50 flex-1 min-h-0 flex flex-col">
                <div className="text-xs uppercase tracking-wide text-zinc-400 mb-2">Prompt sent</div>
                <pre className="text-xs whitespace-pre-wrap overflow-auto flex-1 text-zinc-200 font-mono">
                  {current.prompt_sent || '(no prompt recorded)'}
                </pre>
              </section>

              <section className="border border-zinc-800 rounded p-3 bg-zinc-900/50">
                <div className="text-xs uppercase tracking-wide text-zinc-400 mb-2">Canon § cited</div>
                {current.canon_section_cited ? (
                  <div className="text-sm text-sky-300 font-mono">{current.canon_section_cited}</div>
                ) : (
                  <div className="text-xs text-zinc-500">no canon section cited</div>
                )}
              </section>

              <section className="border border-zinc-800 rounded p-3 bg-zinc-900/50">
                <div className="text-xs uppercase tracking-wide text-zinc-400 mb-2">SKILL.md rule check</div>
                <SkillRuleList results={current.skill_rule_results} />
              </section>

              <section className="border border-zinc-800 rounded p-3 bg-zinc-900/50 flex items-center gap-3">
                <div className="text-xs uppercase tracking-wide text-zinc-400">Drift</div>
                <DriftBadge score={current.drift_score} />
              </section>
            </div>

            {/* RIGHT: output + anchor */}
            <div className="flex flex-col gap-3 min-h-0">
              <section className="border border-zinc-800 rounded p-3 bg-zinc-900/50 flex-1 min-h-0 flex flex-col">
                <div className="text-xs uppercase tracking-wide text-zinc-400 mb-2 flex items-center justify-between">
                  <span>Generated output</span>
                  {current.scene_id && <span className="font-mono text-zinc-500">scene: {current.scene_id}</span>}
                </div>
                {current.image_url ? (
                  <img
                    src={current.image_url}
                    alt="generated"
                    className="max-w-full max-h-full object-contain mx-auto cursor-zoom-in border border-zinc-800 bg-zinc-950"
                    onClick={() => setFullscreen(current.image_url)}
                  />
                ) : (
                  <div className="text-xs text-zinc-500">no image_path available</div>
                )}
              </section>

              <section className="border border-zinc-800 rounded p-3 bg-zinc-900/50">
                <div className="text-xs uppercase tracking-wide text-zinc-400 mb-2">Anchored reference</div>
                {current.anchor_url ? (
                  <img
                    src={current.anchor_url}
                    alt="anchor"
                    className="max-h-40 object-contain mx-auto cursor-zoom-in border border-zinc-800 bg-zinc-950"
                    onClick={() => setFullscreen(current.anchor_url)}
                  />
                ) : (
                  <div className="text-xs text-zinc-500">no anchor for this asset</div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER: actions + queue progress + cost */}
      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur z-10">
        <div className="px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <button
              className="p-1 rounded border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
              disabled={cursor === 0 || pending.length === 0}
              aria-label="previous"
            ><ChevronLeft size={14} /></button>
            <span>
              {pending.length === 0 ? '0 / 0' : `${Math.min(cursor + 1, pending.length)} / ${pending.length}`} pending
            </span>
            <button
              className="p-1 rounded border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
              onClick={() => setCursor((c) => Math.min(c + 1, Math.max(0, pending.length - 1)))}
              disabled={cursor >= pending.length - 1}
              aria-label="next"
            ><ChevronRight size={14} /></button>
            <span className="text-zinc-600">|</span>
            <span>{meta.decided_count} decided</span>
            <span className="text-zinc-600">|</span>
            <span>cost so far ${meta.cost_so_far.toFixed(2)}</span>
            {meta.gates_blocked > 0 && (
              <>
                <span className="text-zinc-600">|</span>
                <span className="text-rose-300">{meta.gates_blocked} gate{meta.gates_blocked === 1 ? '' : 's'} blocked</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(DECISION_META).map(([key, m]) => {
              const Icon = m.Icon;
              return (
                <button
                  key={key}
                  onClick={() => decide(key)}
                  disabled={!current || busy}
                  className={`text-xs px-3 py-1.5 rounded flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${TONE_CLASSES[m.tone]}`}
                  title={`${m.label} (${m.hint})`}
                >
                  <Icon size={13} /> {m.label}
                  <span className="ml-1 text-[10px] opacity-70 font-mono">{m.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {fullscreen && (
        <div
          onClick={() => setFullscreen(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6 cursor-zoom-out"
        >
          <img src={fullscreen} alt="fullscreen" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}
