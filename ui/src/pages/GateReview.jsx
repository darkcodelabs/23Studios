import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ShieldAlert, ShieldCheck, Check, X, Clock, Loader2,
  AlertCircle
} from 'lucide-react';
import { api } from '../lib/api.js';

// GateReview — per-gate full-screen review page.
//
// Shows the gate's description + each sub_decision as a row with
// Approve / Reject / Defer / Reset buttons. The big "Sign Off" button at
// the bottom enables only when every required sub_decision has a non-null
// decision. Sign-off is a separate POST that locks the gate.
//
// For Gate 2 specifically the spec calls for "comparison.html-style
// side-by-side anchor vs generated for every scene." Without B3's scene
// approver feeding individual asset decisions back into the gate, the
// current implementation surfaces the same per-sub-decision UX with a
// note pointing to the asset approver; the comparison content slots in
// once B3 lands.
export default function GateReview() {
  const { id, gateId } = useParams();
  const navigate = useNavigate();
  const [gate, setGate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null); // sub_decision id currently saving
  const [signingOff, setSigningOff] = useState(false);
  const [signOffNote, setSignOffNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/projects/${id}/gates/${gateId}`);
      setGate(r);
      setErr(null);
    } catch (e) {
      setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'failed to load gate');
    } finally { setLoading(false); }
  }, [id, gateId]);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (subDecisionId, decision) => {
    setBusy(subDecisionId);
    try {
      const r = await api.post(`/api/projects/${id}/gates/${gateId}/decide`, {
        sub_decision_id: subDecisionId, decision
      });
      setGate(r);
    } catch (e) {
      setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'decide failed');
    } finally { setBusy(null); }
  }, [id, gateId]);

  const signOff = useCallback(async () => {
    setSigningOff(true);
    try {
      const r = await api.post(`/api/projects/${id}/gates/${gateId}/signoff`, {
        note: signOffNote || undefined
      });
      setGate(r);
      setSignOffNote('');
    } catch (e) {
      setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'signoff failed');
    } finally { setSigningOff(false); }
  }, [id, gateId, signOffNote]);

  const canSignOff = useMemo(() => {
    if (!gate || gate.status === 'signed_off') return false;
    const req = (gate.sub_decisions || []).filter((sd) => sd.required);
    return req.every((sd) => sd.decision != null);
  }, [gate]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-ink-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> loading gate…
      </div>
    );
  }
  if (!gate) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-ink-400 text-sm">
        <AlertCircle className="w-5 h-5 mb-2 text-amber-400" />
        {err || 'gate not found'}
        <button type="button" onClick={() => navigate(`/project/${id}`)}
                className="mt-3 btn text-xs"><ArrowLeft className="w-3 h-3" /> back to project</button>
      </div>
    );
  }

  const signed = gate.status === 'signed_off';
  return (
    <div className="min-h-full bg-ink-900 text-ink-100">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-ink-800 bg-ink-900 sticky top-0 z-30">
        <button type="button" onClick={() => navigate(`/project/${id}`)} className="btn text-xs">
          <ArrowLeft className="w-3.5 h-3.5" /> project
        </button>
        <span className="text-ink-600 text-xs">/</span>
        {signed
          ? <ShieldCheck className="w-4 h-4 text-emerald-400" />
          : <ShieldAlert className="w-4 h-4 text-amber-400" />}
        <h1 className="text-sm font-medium truncate">{gate.name}</h1>
        <span className={
          'ml-auto pill ' +
          (signed ? 'pill-ok' : gate.status === 'active' ? 'pill-warn' : '')
        }>{gate.status}</span>
      </header>
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {gate.description && (
          <p className="text-sm text-ink-300 leading-relaxed">{gate.description}</p>
        )}
        {err && (
          <div className="text-xs text-red-300 bg-red-900/30 border border-red-800/60 rounded px-3 py-2">
            {String(err)}
          </div>
        )}
        <div className="space-y-2">
          {(gate.sub_decisions || []).map((sd) => (
            <SubDecisionRow
              key={sd.id} sd={sd} signed={signed} busy={busy === sd.id}
              onDecide={(d) => decide(sd.id, d)}
            />
          ))}
        </div>
        {!signed && (
          <div className="border-t border-ink-800 pt-4 space-y-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-ink-500">Sign-off note (optional)</span>
              <textarea rows={2} value={signOffNote}
                        onChange={(e) => setSignOffNote(e.target.value)}
                        placeholder="rationale, caveats, deferred items…"
                        className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm resize-none" />
            </label>
            <button
              type="button"
              onClick={signOff}
              disabled={!canSignOff || signingOff}
              className={
                'w-full py-3 rounded-md text-sm font-medium flex items-center justify-center gap-2 ' +
                (canSignOff
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-ink-800 text-ink-500 cursor-not-allowed')
              }
              title={canSignOff ? 'sign off this gate' : 'resolve all required decisions first'}
            >
              {signingOff
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ShieldCheck className="w-4 h-4" />}
              {signingOff ? 'signing off…' : canSignOff ? 'Sign Off' : 'Required decisions still pending'}
            </button>
          </div>
        )}
        {signed && (
          <div className="border-t border-ink-800 pt-4 text-sm">
            <div className="flex items-center gap-2 text-emerald-300">
              <ShieldCheck className="w-4 h-4" />
              Signed off by <span className="font-mono">{gate.signed_off_by || 'user'}</span>
              <span className="text-ink-500">·</span>
              <Clock className="w-3 h-3" />
              <span className="text-ink-400 text-xs">{new Date(gate.signed_off_at).toLocaleString()}</span>
            </div>
            {gate.signoff_note && (
              <p className="mt-2 text-xs text-ink-300 italic">{gate.signoff_note}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SubDecisionRow({ sd, signed, busy, onDecide }) {
  const decided = sd.decision != null;
  const decisionColor = sd.decision === 'approve'
    ? 'text-emerald-400'
    : sd.decision === 'reject'
      ? 'text-red-400'
      : sd.decision === 'defer'
        ? 'text-amber-400'
        : 'text-ink-500';
  return (
    <div className={
      'rounded-md ring-1 px-3 py-2.5 ' +
      (decided ? 'ring-ink-800 bg-ink-900' : 'ring-amber-900/60 bg-amber-900/10')
    }>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink-100">
            {sd.label}
            {sd.required && <span className="ml-1 text-[10px] text-amber-400 align-top">required</span>}
          </div>
          {sd.ts && (
            <div className="text-[11px] text-ink-500 mt-0.5">
              <span className={decisionColor}>{sd.decision || 'cleared'}</span>
              <span> · </span>{sd.decided_by || 'user'}
              <span> · </span>{new Date(sd.ts).toLocaleTimeString()}
            </div>
          )}
        </div>
        {!signed && (
          <div className="flex items-center gap-1">
            <DecideBtn label="approve" current={sd.decision} value="approve"
                       onClick={onDecide} busy={busy} icon={<Check className="w-3 h-3" />}
                       activeClass="bg-emerald-600 text-white" />
            <DecideBtn label="reject" current={sd.decision} value="reject"
                       onClick={onDecide} busy={busy} icon={<X className="w-3 h-3" />}
                       activeClass="bg-red-600 text-white" />
            <DecideBtn label="defer" current={sd.decision} value="defer"
                       onClick={onDecide} busy={busy} icon={<Clock className="w-3 h-3" />}
                       activeClass="bg-amber-600 text-white" />
            {sd.decision && (
              <button
                type="button"
                onClick={() => onDecide(null)}
                disabled={busy}
                className="text-[11px] px-1.5 py-0.5 text-ink-400 hover:text-ink-200"
                title="clear decision"
              >reset</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DecideBtn({ label, current, value, onClick, busy, icon, activeClass }) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      disabled={busy}
      title={label}
      className={
        'text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors ' +
        (active ? activeClass : 'bg-ink-800 hover:bg-ink-700 text-ink-200')
      }
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}
