import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Loader2, Check, X, AlertTriangle, Clock, Rocket, RefreshCw, Download, ShieldCheck, CheckCircle2, Circle
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// Phase 6 B11 — ShipStatus.
//
// Reads ?job=<id> from the URL, fetches the job snapshot, and renders one
// row per step. Polls every 1.5s while the job is still running.

const STEP_LABELS = {
  lint:     'Lua lint',
  drift:    'Drift flags',
  approval: 'Approval queue',
  export:   'SDK export → .pdx',
  zip:      'Zip artifact',
  sim:      'Sim walkthrough',
  deliver:  'Deliver to games tree'
};

function StepRow({ step }) {
  const Icon =
    step.status === 'pass'    ? Check    :
    step.status === 'fail'    ? X        :
    step.status === 'running' ? Loader2  :
                                Clock;
  const tone =
    step.status === 'pass'    ? 'text-emerald-400' :
    step.status === 'fail'    ? 'text-red-400'     :
    step.status === 'running' ? 'text-ink-300 animate-spin' :
                                'text-ink-600';
  const ms = (step.started_at && step.ended_at) ? (step.ended_at - step.started_at) : null;

  const detail = (() => {
    const r = step.result;
    if (!r) return null;
    const bits = [];
    if (r.summary) bits.push(`errors=${r.summary.errors} · warnings=${r.summary.warnings}`);
    if (r.count != null) bits.push(`${r.count} item${r.count === 1 ? '' : 's'}`);
    if (r.job_id) bits.push(`job ${r.job_id.slice(0, 12)}…`);
    if (r.size_bytes) bits.push(`${(r.size_bytes / 1024 / 1024).toFixed(2)} MB`);
    if (r.dest_dir) bits.push(`→ ${r.dest_dir}`);
    if (r.mode) bits.push(`mode=${r.mode}`);
    if (r.error) bits.push(`error: ${r.error}`);
    if (r.note) bits.push(r.note);
    return bits.join(' · ');
  })();

  return (
    <div className="flex items-start gap-3 px-3 py-2 border-b border-ink-800 last:border-b-0">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tone}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-100">{STEP_LABELS[step.name] || step.name}</span>
          {ms != null && <span className="text-[10px] text-ink-500">{ms}ms</span>}
          {step.result?.soft && <span className="text-[10px] text-amber-300 uppercase tracking-wide">soft</span>}
        </div>
        {detail && <div className="text-[11px] text-ink-500 mt-0.5 font-mono break-words">{detail}</div>}
      </div>
    </div>
  );
}

function GateChecklist({ projectId }) {
  const [gates, setGates] = useState(null);
  const [busy, setBusy] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/projects/${projectId}/gates`);
      const list = Array.isArray(r?.gates) ? r.gates : (Array.isArray(r) ? r : []);
      setGates(list.filter((g) => Array.isArray(g.blocks)));
    } catch (_e) { setGates([]); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function signOff(gateId) {
    setBusy(gateId);
    try {
      await api.post(`/api/projects/${projectId}/gates/${gateId}/signoff`,
        { notes: notes || null, signed_off_by: 'cory' });
      setOpenId(null);
      setNotes('');
      await load();
    } catch (e) { /* surface inline below */ }
    finally { setBusy(null); }
  }

  async function seed() {
    setBusy('__seed');
    try { await api.post(`/api/projects/${projectId}/gates/seed`, {}); await load(); }
    catch (_e) { /* noop */ }
    finally { setBusy(null); }
  }

  if (gates === null) {
    return (
      <div className="bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-ink-400 text-xs flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" /> loading gates…
      </div>
    );
  }

  if (gates.length === 0) {
    return (
      <div className="bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
        <span className="text-ink-400">no canonical gates seeded for this project.</span>
        <button
          type="button"
          onClick={seed}
          disabled={busy === '__seed'}
          className="ml-auto px-2 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50"
        >
          {busy === '__seed' ? 'seeding…' : 'seed 6 gates'}
        </button>
      </div>
    );
  }

  const done = gates.filter((g) => g.status === 'signed_off').length;

  return (
    <div className="bg-ink-800 border border-ink-700 rounded-lg">
      <div className="px-3 py-2 border-b border-ink-700 flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-accent" />
        <span className="text-sm text-ink-100">Human review gates</span>
        <span className="text-[11px] text-ink-500">{done}/{gates.length} signed off</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={load}
          className="text-[11px] text-ink-400 hover:text-ink-200 inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> refresh
        </button>
      </div>
      <ul>
        {gates.map((g) => {
          const signed = g.status === 'signed_off';
          const open = openId === g.id;
          return (
            <li key={g.id} className="border-b border-ink-800 last:border-b-0">
              <div className="flex items-start gap-3 px-3 py-2">
                {signed
                  ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" />
                  : <Circle className="w-4 h-4 mt-0.5 text-ink-500 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-ink-100">{g.name}</span>
                    <span className="text-[10px] text-ink-500 font-mono">phase {g.phase}</span>
                    {Array.isArray(g.blocks) && g.blocks.length > 0 && (
                      <span className="text-[10px] text-amber-300 font-mono">
                        blocks: {g.blocks.join(', ')}
                      </span>
                    )}
                  </div>
                  {g.notes && (
                    <div className="text-[11px] text-ink-500 mt-0.5 font-mono break-words">{g.notes}</div>
                  )}
                  {signed && g.signed_off_at && (
                    <div className="text-[10px] text-emerald-400/80 mt-0.5">
                      signed {new Date(g.signed_off_at).toLocaleString()} by {g.signed_off_by || 'unknown'}
                    </div>
                  )}
                </div>
                {!signed && (
                  <button
                    type="button"
                    onClick={() => { setOpenId(open ? null : g.id); setNotes(g.notes || ''); }}
                    className="text-[11px] px-2 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  >
                    {open ? 'cancel' : 'sign off'}
                  </button>
                )}
              </div>
              {open && !signed && (
                <div className="px-3 pb-3 -mt-1 space-y-2">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="optional notes — what convinced you?"
                    className="w-full text-xs bg-ink-900 border border-ink-700 rounded px-2 py-1 text-ink-100 font-mono"
                    rows={2}
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => signOff(g.id)}
                      disabled={busy === g.id}
                      className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 text-xs hover:bg-emerald-500/30 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {busy === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      confirm sign-off
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ShipStatus() {
  const { id: projectId } = useParams();
  const [params] = useSearchParams();
  const jobId = params.get('job');
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState([]);
  const pollRef = useRef(null);

  const fetchJob = useCallback(async () => {
    if (!jobId) {
      setLoading(false);
      try {
        const r = await api.get(`/api/projects/${projectId}/ship/jobs`);
        setRecent(r.jobs || []);
      } catch (e) { setError(e?.message || 'failed'); }
      return;
    }
    try {
      const r = await api.get(`/api/projects/${projectId}/ship/jobs/${encodeURIComponent(jobId)}`);
      setJob(r);
      setLoading(false);
    } catch (e) {
      setError(e?.message || 'failed to fetch ship job');
      setLoading(false);
    }
  }, [projectId, jobId]);

  useEffect(() => {
    fetchJob();
    pollRef.current = setInterval(() => {
      if (!job || job.status === 'running') fetchJob();
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [fetchJob, job]);

  // Stop polling once terminal.
  useEffect(() => {
    if (job && job.status !== 'running') {
      clearInterval(pollRef.current);
    }
  }, [job]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <Nav subtitle="Ship status" />
      <div className="px-4 py-2 border-b border-ink-800 bg-ink-900 flex items-center gap-3 text-sm">
        <Link to={`/project/${projectId}`} className="text-ink-400 hover:text-ink-200">← project</Link>
        <span className="text-ink-500">·</span>
        <Link
          to={`/project/${projectId}/design-validate`}
          className="inline-flex items-center gap-1 text-ink-400 hover:text-ink-200 text-xs"
          title="Static design validator"
        >
          <ShieldCheck className="w-3.5 h-3.5" /> design validator
        </Link>
        <span className="text-ink-500">·</span>
        {jobId ? (
          <span className="text-ink-300 font-mono text-xs">{jobId}</span>
        ) : (
          <span className="text-ink-300">recent ship jobs</span>
        )}
        <div className="flex-1" />
        {job && (
          <span className={
            'text-xs px-2 py-0.5 rounded border ' + (
              job.status === 'done'    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
              job.status === 'failed'  ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                                         'bg-amber-500/15 text-amber-300 border-amber-500/30'
            )
          }>
            {job.status}
          </span>
        )}
        <button
          type="button"
          onClick={fetchJob}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs"
        >
          <RefreshCw className="w-3 h-3" /> refresh
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {loading && !job && !recent.length ? (
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> loading…
        </div>
      ) : !jobId ? (
        <div className="flex-1 overflow-auto p-4 space-y-3">
          <div className="max-w-2xl mx-auto">
            <GateChecklist projectId={projectId} />
          </div>
          <div className="max-w-2xl mx-auto bg-ink-800 border border-ink-700 rounded-lg">
            <div className="px-3 py-2 border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-400">
              recent ship jobs
            </div>
            {recent.length === 0 ? (
              <div className="p-4 text-ink-500 text-sm">no ship attempts yet. start one from the project page.</div>
            ) : (
              <ul>
                {recent.map((r) => (
                  <li key={r.id} className="border-b border-ink-800 last:border-b-0">
                    <Link
                      to={`/project/${projectId}/ship?job=${encodeURIComponent(r.id)}`}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-ink-700"
                    >
                      <Rocket className="w-3.5 h-3.5 text-ink-400" />
                      <span className="font-mono text-xs text-ink-200 flex-1">{r.id}</span>
                      <span className="text-[11px] text-ink-500">{new Date(r.started_at).toLocaleString()}</span>
                      <span className={
                        'text-[10px] px-1.5 py-0.5 rounded uppercase ' + (
                          r.status === 'done'   ? 'bg-emerald-500/15 text-emerald-300' :
                          r.status === 'failed' ? 'bg-red-500/15 text-red-300' :
                                                  'bg-amber-500/15 text-amber-300'
                        )
                      }>{r.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : !job ? (
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> loading job {jobId}…
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="max-w-2xl mx-auto space-y-3">
            <GateChecklist projectId={projectId} />
            <div className="bg-ink-800 border border-ink-700 rounded-lg">
              <div className="px-3 py-2 border-b border-ink-700 flex items-center gap-2">
                <Rocket className="w-3.5 h-3.5 text-accent" />
                <span className="text-sm text-ink-100">{job.steps.length} steps</span>
                <div className="flex-1" />
                {job.finished_at && job.started_at && (
                  <span className="text-[11px] text-ink-500">{((job.finished_at - job.started_at) / 1000).toFixed(2)}s total</span>
                )}
              </div>
              {job.steps.map((s) => <StepRow key={s.name} step={s} />)}
            </div>
            {job.error && (
              <div className="px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" /> {job.error}
              </div>
            )}
            {job.status === 'done' && (
              <div className="px-3 py-2 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> shipped — artifact in
                <span className="font-mono">{job.steps.find((x) => x.name === 'deliver')?.result?.dest_dir || 'examples/'}</span>
                <a
                  href={(window.__APP_BASE__ || '') + `/api/projects/${projectId}/sdk/build/latest`}
                  className="ml-auto inline-flex items-center gap-1 text-emerald-200 hover:text-emerald-100"
                  rel="noopener"
                >
                  <Download className="w-3 h-3" /> download .pdx
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
