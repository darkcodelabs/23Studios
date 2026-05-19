import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2, MessageSquareQuote, Mic, MicOff, AlertCircle, ShieldCheck,
  SkipForward, Forward, Brain, Bot, Lock
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

const SEV_STYLE = {
  critical: 'text-red-300 border-red-700 bg-red-900/30',
  high:     'text-orange-300 border-orange-700 bg-orange-900/30',
  medium:   'text-amber-300 border-amber-700 bg-amber-900/30',
  low:      'text-ink-300 border-ink-700 bg-ink-800'
};
const STATUS_STYLE = {
  pending:    'text-ink-300',
  answered:   'text-emerald-300',
  deferred:   'text-ink-500 line-through',
  autopilot:  'text-blue-300',
  skipped:    'text-ink-500',
  thinking:   'text-amber-300'
};

export default function Interview() {
  const { id } = useParams();
  const [queue, setQueue] = useState(null);
  const [state, setState] = useState(null);
  const [selectedQid, setSelectedQid] = useState(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [building, setBuilding] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/interview/queue`);
      setQueue(r.queue);
      setState(r.state || null);
      if (r.queue && r.queue.questions.length) {
        const firstPending = r.queue.questions.find((q) => q.status === 'pending') || r.queue.questions[0];
        setSelectedQid(firstPending.id);
      }
    } catch (e) {
      if (e.status === 404) setQueue(null);
      else setErr(e);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function buildQueue() {
    setBuilding(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${id}/interview/queue`, {});
      setQueue(r.queue);
      if (r.queue.questions.length) setSelectedQid(r.queue.questions[0].id);
      const st = await api.get(`/api/projects/${id}/interview/queue`);
      setState(st.state || null);
    } catch (e) { setErr(e); }
    finally { setBuilding(false); }
  }

  async function submitAnswer(action, value) {
    if (!selectedQid) return;
    try {
      const r = await api.post(`/api/projects/${id}/interview/answer`, {
        question_id: selectedQid,
        action,
        value: value === undefined ? draft : value,
        note: note || undefined
      });
      // Update local queue from response.
      setQueue((q) => {
        if (!q) return q;
        const next = { ...q, questions: q.questions.map((x) => x.id === r.question.id ? r.question : x) };
        next.answered_count = r.queue_progress.answered_count;
        next.pending_count = r.queue_progress.pending_count;
        return next;
      });
      setDraft('');
      setNote('');
      // Auto-advance to next pending question.
      setQueue((q) => {
        if (!q) return q;
        const idx = q.questions.findIndex((x) => x.id === selectedQid);
        const after = q.questions.slice(idx + 1).find((x) => x.status === 'pending')
          || q.questions.find((x) => x.status === 'pending');
        if (after) setSelectedQid(after.id);
        return q;
      });
    } catch (e) { setErr(e); }
  }

  async function lockInterview() {
    if (!confirm('Lock interview now? Critical-severity gaps must be answered or deferred first.')) return;
    try {
      const r = await api.post(`/api/projects/${id}/interview/lock`, {});
      alert(`Locked. Scope candidate: ${r.scope_lock_candidate.proposed_in_scope.length} in-scope, ${r.scope_lock_candidate.proposed_deferred.length} deferred. Visit /scope to finalize.`);
      await load();
    } catch (e) { setErr(e); }
  }

  // Voice input — Web Speech API. Falls back to text-only if unsupported.
  const speechSupported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  function toggleRecord() {
    if (!speechSupported) return;
    if (recording) {
      try { recRef.current && recRef.current.stop(); } catch (_e) { /* ignore */ }
      setRecording(false);
      return;
    }
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Rec();
    r.continuous = false;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (e) => {
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0].transcript;
      }
      setDraft((cur) => (cur ? cur + ' ' : '') + txt);
    };
    r.onend = () => setRecording(false);
    r.onerror = () => setRecording(false);
    recRef.current = r;
    setRecording(true);
    try { r.start(); } catch (_e) { setRecording(false); }
  }

  const selected = useMemo(() => {
    if (!queue || !selectedQid) return null;
    return queue.questions.find((q) => q.id === selectedQid) || null;
  }, [queue, selectedQid]);

  const grouped = useMemo(() => {
    if (!queue) return {};
    const out = {};
    for (const q of queue.questions) {
      const cat = q.category || 'other';
      if (!out[cat]) out[cat] = [];
      out[cat].push(q);
    }
    return out;
  }, [queue]);

  const canLock = useMemo(() => {
    if (!queue || !state || state.locked_at) return false;
    return !queue.questions.some((q) => q.severity === 'critical' && q.status === 'pending');
  }, [queue, state]);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle={`interview · ${id}`} showSiderailToggle={false} />
      <div className="max-w-7xl mx-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5" /> Interactive interview
          </h1>
          <div className="flex items-center gap-2">
            {queue && (
              <div className="text-xs text-ink-300">
                {queue.answered_count} / {queue.total_questions} answered · {queue.pending_count} pending
              </div>
            )}
            <button type="button" onClick={buildQueue} className="px-3 py-1.5 text-sm rounded border border-ink-700 hover:bg-ink-800" disabled={building}>
              {building ? 'building…' : (queue ? 'rebuild queue' : 'build queue')}
            </button>
            <button
              type="button"
              onClick={lockInterview}
              disabled={!canLock || (state && !!state.locked_at)}
              className={`px-3 py-1.5 text-sm rounded text-white ${canLock ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-ink-700 cursor-not-allowed opacity-60'}`}
            >
              <span className="inline-flex items-center gap-1"><Lock className="w-4 h-4" /> {state?.locked_at ? 'locked' : 'lock scope'}</span>
            </button>
          </div>
        </div>

        {err && (
          <div className="p-3 rounded border border-red-700 bg-red-900/30 mb-3 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" /><div>{err.message || String(err)}{err.detail ? <pre className="text-xs mt-1 whitespace-pre-wrap">{JSON.stringify(err.detail, null, 2)}</pre> : null}</div>
          </div>
        )}

        {!queue && !loading && (
          <div className="p-6 rounded border border-ink-700 bg-ink-800 text-sm text-ink-300">
            No question queue yet. Click <strong>build queue</strong> — requires A4 coverage report.
          </div>
        )}

        {queue && (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-3">
            {/* Queue panel */}
            <aside className="rounded border border-ink-700 bg-ink-800/40 max-h-[78vh] overflow-y-auto">
              <div className="px-2 py-2 text-xs uppercase tracking-wide text-ink-400 border-b border-ink-700">queue</div>
              {Object.keys(grouped).sort().map((cat) => (
                <div key={cat} className="px-2 py-2 border-b border-ink-700/60">
                  <div className="text-xs text-ink-400 mb-1">{cat}</div>
                  {grouped[cat].map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setSelectedQid(q.id)}
                      className={
                        'w-full text-left text-xs px-2 py-1.5 rounded mb-1 border ' +
                        (q.id === selectedQid ? 'border-emerald-500 bg-emerald-900/30' : 'border-transparent hover:border-ink-700')
                      }
                    >
                      <span className={'inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ' + (q.severity === 'critical' ? 'bg-red-400' : q.severity === 'high' ? 'bg-orange-400' : q.severity === 'medium' ? 'bg-amber-400' : 'bg-ink-500')} />
                      <span className={STATUS_STYLE[q.status] || ''}>{q.question_text.slice(0, 60)}{q.question_text.length > 60 ? '…' : ''}</span>
                    </button>
                  ))}
                </div>
              ))}
            </aside>

            {/* Question panel */}
            <section className="rounded border border-ink-700 bg-ink-800/40 p-4 min-h-[60vh]">
              {!selected ? (
                <div className="text-ink-400 text-sm">Select a question.</div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded border ${SEV_STYLE[selected.severity] || ''}`}>{selected.severity}</span>
                    <span className="text-xs text-ink-400">{selected.category}</span>
                    <span className={`text-xs ml-auto ${STATUS_STYLE[selected.status] || ''}`}>{selected.status}</span>
                  </div>
                  <h2 className="text-lg font-medium mb-3">{selected.question_text}</h2>
                  {selected.related_scenes && selected.related_scenes.length > 0 && (
                    <div className="text-xs text-ink-400 mb-3">related scenes: {selected.related_scenes.join(', ')}</div>
                  )}

                  <div className="flex flex-wrap gap-2 mb-3">
                    {(selected.default_options || []).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => submitAnswer('answer', opt)}
                        className="px-2 py-1 text-xs rounded border border-ink-600 hover:bg-emerald-900/30 hover:border-emerald-700"
                      >{opt}</button>
                    ))}
                  </div>

                  <div className="mb-2">
                    <label className="block text-xs text-ink-400 mb-1">Custom answer</label>
                    <div className="flex gap-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        className="flex-1 bg-ink-900 border border-ink-700 rounded p-2 text-sm focus:outline-none focus:border-emerald-600"
                        placeholder="Type your answer, or use the mic"
                      />
                      <button
                        type="button"
                        onClick={toggleRecord}
                        disabled={!speechSupported}
                        title={speechSupported ? (recording ? 'stop recording' : 'voice input') : 'Web Speech API not supported in this browser'}
                        className={`px-3 rounded border ${recording ? 'border-red-600 text-red-300 bg-red-900/30' : 'border-ink-700 hover:bg-ink-800'} ${!speechSupported ? 'opacity-40' : ''}`}
                      >
                        {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs text-ink-400 mb-1">Note (logged with decision)</label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full bg-ink-900 border border-ink-700 rounded p-2 text-sm focus:outline-none focus:border-emerald-600"
                      placeholder="optional rationale"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => submitAnswer('answer')} disabled={!draft.trim()} className="px-3 py-1.5 text-sm rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40">
                      <span className="inline-flex items-center gap-1"><ShieldCheck className="w-4 h-4" /> Answer</span>
                    </button>
                    <button type="button" onClick={() => submitAnswer('skip')} className="px-3 py-1.5 text-sm rounded border border-ink-700 hover:bg-ink-800">
                      <span className="inline-flex items-center gap-1"><SkipForward className="w-4 h-4" /> Skip</span>
                    </button>
                    <button type="button" onClick={() => submitAnswer('autopilot')} className="px-3 py-1.5 text-sm rounded border border-blue-700 hover:bg-blue-900/30 text-blue-300">
                      <span className="inline-flex items-center gap-1"><Bot className="w-4 h-4" /> Autopilot decides</span>
                    </button>
                    <button type="button" onClick={() => submitAnswer('think')} className="px-3 py-1.5 text-sm rounded border border-amber-700 hover:bg-amber-900/30 text-amber-300">
                      <span className="inline-flex items-center gap-1"><Brain className="w-4 h-4" /> Need to think</span>
                    </button>
                    <button type="button" onClick={() => submitAnswer('defer')} className="px-3 py-1.5 text-sm rounded border border-ink-700 hover:bg-ink-800">
                      <span className="inline-flex items-center gap-1"><Forward className="w-4 h-4" /> Defer to v0.2</span>
                    </button>
                  </div>

                  <div className="text-xs text-ink-500 mt-3">source: {selected.source}</div>
                </div>
              )}
            </section>

            {/* Live state diff panel */}
            <aside className="rounded border border-ink-700 bg-ink-800/40 p-3 max-h-[78vh] overflow-y-auto">
              <div className="text-xs uppercase tracking-wide text-ink-400 mb-2">interview state</div>
              {state ? (
                <div className="text-xs space-y-1">
                  <div>started: <span className="font-mono">{state.started_at}</span></div>
                  <div>locked: <span className="font-mono">{state.locked_at || '—'}</span></div>
                  <div className="mt-2 text-ink-400">{Object.keys(state.answers || {}).length} answers recorded</div>
                  <div className="mt-3 space-y-1">
                    {Object.values(state.answers || {}).slice(-20).reverse().map((a) => (
                      <div key={a.question_id + a.ts} className="border border-ink-700 rounded p-1.5">
                        <div className="font-mono text-[10px] text-ink-400">{a.ts}</div>
                        <div><span className="text-emerald-300">{a.action}</span> {typeof a.value === 'string' ? a.value : JSON.stringify(a.value)}</div>
                        {a.user_note && <div className="text-ink-400 italic">“{a.user_note}”</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div className="text-ink-400 text-xs">no state yet</div>}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
