import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Check, RefreshCw, Shuffle } from 'lucide-react';
import { api } from '../lib/api.js';

// ConceptPicker — three-concept fan-out gate UI.
// Route: /project/:id/concepts

function Chip({ label }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-ink-800 text-ink-300 ring-1 ring-ink-700">
      {label}
    </span>
  );
}

function ReviseModal({ concept, onClose, onDone }) {
  const { id } = useParams();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${id}/concepts/regenerate`, {
        concept_id: concept.id,
        notes,
      });
      onDone(r.concept);
    } catch (e) {
      setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'failed');
    } finally { setBusy(false); }
  }, [id, concept.id, notes, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-ink-950 border border-ink-800 rounded-xl shadow-2xl w-full max-w-md p-5 mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink-100">Revise: {concept.title_suggestion || concept.id}</h2>
        <textarea
          className="w-full h-28 bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm text-ink-100 placeholder-ink-600 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="What should change? (e.g. make protagonist older, remove combat)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-ink-400 hover:text-ink-200">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}

function HybridizeModal({ concepts, onClose, onDone }) {
  const { id } = useParams();
  const [selected, setSelected] = useState([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const toggle = (cid) => {
    setSelected((prev) =>
      prev.includes(cid) ? prev.filter((x) => x !== cid) : prev.length < 2 ? [...prev, cid] : prev
    );
  };

  const submit = useCallback(async () => {
    if (selected.length !== 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${id}/concepts/hybridize`, { ids: selected, notes });
      onDone(r.concept);
    } catch (e) {
      setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'failed');
    } finally { setBusy(false); }
  }, [id, selected, notes, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-ink-950 border border-ink-800 rounded-xl shadow-2xl w-full max-w-md p-5 mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink-100 flex items-center gap-2">
          <Shuffle className="w-4 h-4" /> Hybridize two concepts
        </h2>
        <div className="space-y-1.5">
          {concepts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm border ${
                selected.includes(c.id)
                  ? 'border-brand-500 bg-brand-950 text-ink-100'
                  : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-600'
              }`}
            >
              <span className="font-medium">{c.id}</span>
              {c.title_suggestion && <span className="ml-2 text-ink-400">{c.title_suggestion}</span>}
            </button>
          ))}
        </div>
        <textarea
          className="w-full h-20 bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm text-ink-100 placeholder-ink-600 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="Any requirements to preserve? (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-ink-400 hover:text-ink-200">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || selected.length !== 2}
            className="px-3 py-1.5 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Blend
          </button>
        </div>
      </div>
    </div>
  );
}

function ConceptCard({ concept, chosen, locked, onPick, onRevise }) {
  const [expanded, setExpanded] = useState(false);
  const isCurrent = chosen === concept.id;
  const preview = concept.pitch_text ? concept.pitch_text.slice(0, 200) : '';
  const hasMore = concept.pitch_text && concept.pitch_text.length > 200;

  return (
    <div className={`flex flex-col rounded-xl border p-4 gap-3 ${
      isCurrent ? 'border-brand-500 bg-brand-950/30 ring-1 ring-brand-500' : 'border-ink-800 bg-ink-900'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-ink-500">{concept.id}</span>
            <Chip label={concept.tone_seed} />
          </div>
          <h3 className="text-sm font-semibold text-ink-100 leading-snug">
            {concept.title_suggestion || '(untitled)'}
          </h3>
        </div>
        {isCurrent && <Check className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {concept.genre && <Chip label={concept.genre} />}
        {concept.mechanic_hook && <Chip label={concept.mechanic_hook} />}
      </div>

      <p className="text-xs text-ink-400 leading-relaxed">
        {expanded ? concept.pitch_text : preview}
        {!expanded && hasMore && (
          <button
            className="ml-1 text-brand-400 hover:text-brand-300 underline underline-offset-2"
            onClick={() => setExpanded(true)}
          >
            more
          </button>
        )}
        {expanded && hasMore && (
          <button
            className="ml-1 text-ink-500 hover:text-ink-300 underline underline-offset-2"
            onClick={() => setExpanded(false)}
          >
            less
          </button>
        )}
      </p>

      {!locked && (
        <div className="flex gap-2 mt-auto pt-1">
          <button
            onClick={() => onPick(concept.id)}
            className="flex-1 px-3 py-1.5 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white font-medium"
          >
            Pick
          </button>
          <button
            onClick={() => onRevise(concept)}
            className="px-3 py-1.5 text-sm rounded-md border border-ink-700 bg-ink-800 hover:bg-ink-700 text-ink-300 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Revise
          </button>
        </div>
      )}

      {locked && isCurrent && (
        <div className="flex items-center gap-1.5 text-xs text-brand-400 pt-1 font-medium">
          <Check className="w-3.5 h-3.5" /> Selected
        </div>
      )}
    </div>
  );
}

export default function ConceptPicker() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [concepts, setConcepts] = useState([]);
  const [gate, setGate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [picking, setPicking] = useState(false);
  const [revising, setRevising] = useState(null);   // concept being revised
  const [hybridizing, setHybridizing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/projects/${id}/concepts`);
      setConcepts(r.concepts || []);
      setGate(r.gate);
      setErr(null);
    } catch (e) {
      setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'failed to load');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const pick = useCallback(async (conceptId) => {
    setPicking(true);
    try {
      const r = await api.post(`/api/projects/${id}/concepts/choose`, { chosen_id: conceptId });
      setGate(r.gate);
    } catch (e) {
      setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'pick failed');
    } finally { setPicking(false); }
  }, [id]);

  const onReviseDone = useCallback((updated) => {
    setConcepts((prev) => prev.map((c) => c.id === updated.id ? updated : c));
    setRevising(null);
  }, []);

  const onHybridDone = useCallback((hybrid) => {
    setConcepts((prev) => {
      const exists = prev.find((c) => c.id === hybrid.id);
      return exists ? prev.map((c) => c.id === hybrid.id ? hybrid : c) : [...prev, hybrid];
    });
    setHybridizing(false);
  }, []);

  const locked = gate && gate.status === 'locked';

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-ink-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> loading concepts…
      </div>
    );
  }

  if (err) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-ink-400 text-sm">
        <p className="text-red-400">{err}</p>
        <button onClick={load} className="text-brand-400 hover:text-brand-300 underline">retry</button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-ink-950 p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/library')}
          className="p-1.5 rounded-md hover:bg-ink-800 text-ink-400 hover:text-ink-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-base font-semibold text-ink-100">Concept Pick</h1>
          <p className="text-xs text-ink-500">
            {locked
              ? `Locked — ${gate.chosen} selected`
              : 'Choose a concept to continue autopilot, or revise / hybridize first.'}
          </p>
        </div>
      </div>

      {/* Concept cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {concepts.map((c) => (
          <ConceptCard
            key={c.id}
            concept={c}
            chosen={gate && gate.chosen}
            locked={locked}
            onPick={pick}
            onRevise={setRevising}
          />
        ))}
      </div>

      {/* Hybridize row */}
      {!locked && concepts.length >= 2 && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setHybridizing(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-ink-700 bg-ink-900 hover:bg-ink-800 text-ink-300 text-sm"
          >
            <Shuffle className="w-4 h-4" /> Hybridize two concepts
          </button>
        </div>
      )}

      {/* Locked CTA */}
      {locked && (
        <div className="flex justify-center pt-2">
          <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand-900/40 border border-brand-700 text-brand-300 text-sm">
            <Check className="w-4 h-4" />
            Gate locked — re-run autopilot to continue from story stage.
          </div>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
        </div>
      )}

      {revising && (
        <ReviseModal concept={revising} onClose={() => setRevising(null)} onDone={onReviseDone} />
      )}

      {hybridizing && (
        <HybridizeModal concepts={concepts} onClose={() => setHybridizing(false)} onDone={onHybridDone} />
      )}
    </div>
  );
}
